import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  buildDirectExecResultMessage,
  buildSkillUserMessage,
  getVoiceDispatchLogPath,
  loadSkillCatalog,
  logVoiceRouteDecision,
  resolveSkill,
  routeVoiceTranscript,
  runDirectExecAction,
} from "./router.js";

export {
  buildDirectExecResultMessage,
  buildSkillUserMessage,
  getVoiceDispatchLogPath,
  loadSkillCatalog,
  logVoiceRouteDecision,
  resolveSkill,
  routeVoiceTranscript,
  runDirectExecAction,
};

export default function pigClassifierIntentRouter(pi: ExtensionAPI) {
  function notify(message: string, type: "info" | "success" | "warning" | "error" = "info"): void {
    // Command context has a better notify path; this is only for startup.
    void type;
    console.log(`[pig-classifier-intent-router] ${message}`);
  }

  function routeTextForPi(text: string): { messageText: string; decision: ReturnType<typeof routeVoiceTranscript> } {
    const decision = routeVoiceTranscript(text);
    logVoiceRouteDecision(decision);

    let messageText = decision.text;
    if (decision.executionMode === "pi_skill" && decision.candidateSkill) {
      const skill = resolveSkill(decision.candidateSkill);
      if (skill) {
        messageText = buildSkillUserMessage(skill, decision.text);
      }
    }
    return { messageText, decision };
  }

  pi.on("input", async (event) => {
    const text = event.text.trim();
    if (!text) return { action: "continue" as const };

    // Do not route explicit commands or already-expanded skill blocks.
    if (text.startsWith("/") || text.startsWith("<skill ")) {
      return { action: "continue" as const };
    }

    const { messageText, decision } = routeTextForPi(text);

    if (decision.executionMode === "direct_exec" && decision.directExec) {
      try {
        const result = await runDirectExecAction(decision.directExec);
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
      const decision = routeVoiceTranscript(text);
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
      const { messageText, decision } = routeTextForPi(text);
      ctx.ui.notify(`intent bucket=${decision.bucket} skill=${decision.candidateSkill ?? "none"} confidence=${decision.confidence}`, "info");
      if (ctx.isIdle()) pi.sendUserMessage(messageText);
      else pi.sendUserMessage(messageText, { deliverAs: "followUp" });
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const skills = loadSkillCatalog().map((s) => s.name).join(", ") || "none";
    ctx.ui.notify(
      `🐷 classifier intent router ready. Catalog: ${skills}. Log: ${getVoiceDispatchLogPath()}. Related skill: intent-router-error-log.`,
      "info",
    );
  });

  notify("extension loaded");
}
