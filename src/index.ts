import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, SlashCommandInfo } from "@mariozechner/pi-coding-agent";
import { compileVoiceCommand, DEFAULT_EXTRACTOR_STACK } from "./compiler/compiler.js";
import { defaultCommandExtractor } from "./compiler/defaultExtractor.js";
import { metadataBm25Extractor } from "./compiler/metadataBm25Extractor.js";
import { embeddingExtractor } from "./compiler/embeddingExtractor.js";
import { runExtractorStack } from "./compiler/extractors.js";
import { getLoweringRules } from "./compiler/lower.js";
import { getPigCommandState } from "./compiler/state.js";
import {
  buildDirectExecResultMessage,
  buildSkillUserMessage,
  buildVisualInspectionMessage,
  findDirectExecImagePath,
  getVoiceDispatchLogPath,
  loadRouteResourcesFromCommands,
  logVoiceRouteDecision,
  resolveSkill,
  routeVoiceTranscript,
  runDirectExecAction,
  shouldAttachDirectExecImage,
} from "./router.js";

export {
  compileVoiceCommand,
  DEFAULT_EXTRACTOR_STACK,
  defaultCommandExtractor,
  metadataBm25Extractor,
  embeddingExtractor,
  getLoweringRules,
  getPigCommandState,
  runExtractorStack,
  buildDirectExecResultMessage,
  buildSkillUserMessage,
  buildVisualInspectionMessage,
  findDirectExecImagePath,
  getVoiceDispatchLogPath,
  loadRouteResourcesFromCommands,
  logVoiceRouteDecision,
  resolveSkill,
  routeVoiceTranscript,
  runDirectExecAction,
  shouldAttachDirectExecImage,
};


function mimeTypeForImagePath(path: string): string | null {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return null;
  }
}

function readImageAttachment(path: string): ImageContent | null {
  const mimeType = mimeTypeForImagePath(path);
  if (!mimeType) return null;
  try {
    return { type: "image", mimeType, data: readFileSync(path).toString("base64") };
  } catch {
    return null;
  }
}

function appendImage(images: ImageContent[] | undefined, image: ImageContent): ImageContent[] {
  return [...(images ?? []), image];
}

function existingSkillPaths(cwd: string): string[] {
  return [
    join(homedir(), ".pig", "agent", "skills"),
    join(cwd, ".pig", "skills"),
  ].filter((path) => existsSync(path));
}

export default function pigClassifierIntentRouter(pi: ExtensionAPI) {
  function notify(message: string, type: "info" | "success" | "warning" | "error" = "info"): void {
    // Command context has a better notify path; this is only for startup.
    void type;
    console.log(`[pig-classifier-intent-router] ${message}`);
  }

  function routeResources() {
    return loadRouteResourcesFromCommands(pi.getCommands().filter((command): command is SlashCommandInfo & { source: "skill" } => command.source === "skill"));
  }

  async function routeTextForPi(text: string): Promise<{ messageText: string; decision: Awaited<ReturnType<typeof routeVoiceTranscript>>; resources: ReturnType<typeof routeResources> }> {
    const resources = routeResources();
    const decision = await routeVoiceTranscript(text, resources);
    logVoiceRouteDecision(decision);

    let messageText = decision.text;
    if (decision.executionMode === "pi_skill" && decision.candidateSkill) {
      const skill = resolveSkill(decision.candidateSkill, resources.catalog);
      if (skill) {
        messageText = buildSkillUserMessage(skill, decision.text);
      }
    }
    return { messageText, decision, resources };
  }

  pi.on("resources_discover", (event) => ({
    skillPaths: existingSkillPaths(event.cwd),
  }));

  pi.on("input", async (event) => {
    const text = event.text.trim();
    if (!text) return { action: "continue" as const };

    // Do not route explicit commands or already-expanded skill blocks.
    if (text.startsWith("/") || text.startsWith("<skill ")) {
      return { action: "continue" as const };
    }

    const { messageText, decision, resources } = await routeTextForPi(text);

    if (decision.executionMode === "direct_exec" && decision.directExec) {
      try {
        const result = await runDirectExecAction(decision.directExec, 30000, resources.actions);
        const imagePath = shouldAttachDirectExecImage(decision) ? findDirectExecImagePath(decision, result) : null;
        const image = imagePath ? readImageAttachment(imagePath) : null;
        if (image && imagePath) {
          return {
            action: "transform" as const,
            text: buildVisualInspectionMessage(decision, imagePath, result),
            images: appendImage(event.images, image),
          };
        }
        return { action: "transform" as const, text: buildDirectExecResultMessage(decision, result), images: event.images };
      } catch (err) {
        // Fail safe: do not block the user. Fall back to normal Pig/Gemma handling.
        console.warn(`[pig-classifier-intent-router] direct_exec failed: ${err instanceof Error ? err.message : String(err)}`);
        return { action: "continue" as const };
      }
    }

    if (decision.executionMode !== "pi_skill") {
      return { action: "continue" as const };
    }

    // Transform the incoming voice/audio/typed text into the same shape as an
    // explicit /skill:name invocation, while leaving uncertain text untouched.
    return { action: "transform" as const, text: messageText, images: event.images };
  });

  pi.registerCommand("intent-route", {
    description: "Classify text with Pig classifier intent router and show the bucket decision",
    handler: async (args, ctx) => {
      const text = (args ?? "").trim();
      if (!text) {
        ctx.ui.notify("Usage: /intent-route <text>", "info");
        return;
      }
      const resources = routeResources();
      const decision = await routeVoiceTranscript(text, resources);
      try {
        logVoiceRouteDecision(decision);
      } catch {
        // ignore logging failure in diagnostic command
      }
      ctx.ui.notify(JSON.stringify(decision, null, 2), "info");
    },
  });

  pi.registerCommand("intent-send", {
    description: "Route text, expand a confident skill if matched, and send to Pig",
    handler: async (args, ctx) => {
      const text = (args ?? "").trim();
      if (!text) {
        ctx.ui.notify("Usage: /intent-send <text>", "info");
        return;
      }
      const { messageText, decision } = await routeTextForPi(text);
      ctx.ui.notify(`intent bucket=${decision.bucket} skill=${decision.candidateSkill ?? "none"} confidence=${decision.confidence}`, "info");
      if (ctx.isIdle()) pi.sendUserMessage(messageText);
      else pi.sendUserMessage(messageText, { deliverAs: "followUp" });
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const skills = routeResources().catalog.map((s) => s.name).join(", ") || "none";
    ctx.ui.notify(
      `🐷 classifier intent router ready. Catalog: ${skills}. Log: ${getVoiceDispatchLogPath()}. Related skill: intent-router-error-log.`,
      "info",
    );
  });

  notify("extension loaded");
}
