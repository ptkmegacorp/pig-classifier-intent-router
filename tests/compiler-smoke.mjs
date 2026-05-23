import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileVoiceCommand } from "../dist/compiler/compiler.js";

process.env.DISPLAY = process.env.DISPLAY || ":99";
const screenshotDir = mkdtempSync(join(tmpdir(), "pig-compiler-test-"));
writeFileSync(join(screenshotDir, "latest-screenshot"), "/tmp/latest.png");
process.env.SCREENSHOT_DIR = screenshotDir;
process.env.PIG_DEFAULT_LOCATION = "Jim Falls, WI";

function action(id, skill, outputImageKey = null, requiredContext = []) {
  return {
    id, skill, description: id, script: `scripts/${id}.sh`, scriptPath: `/tmp/${id}.sh`, baseDir: "/tmp",
    directExec: true, safety: id.includes("weather") ? "read_only_network" : "local_capture", requiresConfirmation: false,
    defaultArgs: [], keywords: [], exactPhrases: [], family: skill.includes("weather") ? "weather" : skill.includes("photo") ? "image" : "screen",
    attachImageWhenIntent: null, runWhenIntent: null, requiredContext, outputImageKey,
  };
}

const catalog = [
  { name: "take-screenshot", description: "", filePath: "/tmp/SKILL.md", baseDir: "/tmp", commandName: null, family: "screen", keywords: [], examples: [], negativeExamples: [], intents: {}, compilerIntents: [], compilerSchemas: [
    { match: { domain: "screen", action: ["capture", "open", "show", "inspect"], object: ["screen", "screenshot"] }, requiredFields: ["domain", "action", "object"] },
  ], compilerLowering: [
    { match: { domain: "screen", action: "capture", object: "screenshot", target: "current" }, actionId: "take-screenshot.capture", fallbackSkill: "take-screenshot", matchedIntents: [], requiredContext: ["active_display"], reason: "lowered screen capture" },
    { match: { domain: "screen", action: "inspect" }, actionId: "take-screenshot.capture", fallbackSkill: "take-screenshot", matchedIntents: ["visual_inspect"], requiredContext: ["active_display"], reason: "lowered screen inspect" },
    { match: { domain: "screen", action: ["open", "show"], object: "screenshot", target: ["last", "recent"] }, actionId: "take-screenshot.view-latest", fallbackSkill: "take-screenshot", matchedIntents: ["display_to_user"], requiredContext: ["active_display", "recent_screenshot_path"], reason: "lowered screenshot view" },
  ] },
  { name: "take-photo", description: "", filePath: "/tmp/SKILL.md", baseDir: "/tmp", commandName: null, family: "image", keywords: [], examples: [], negativeExamples: [], intents: {}, compilerIntents: [], compilerSchemas: [
    { match: { domain: "image", action: ["capture", "open", "show", "inspect"], object: ["photo", "image"] }, requiredFields: ["domain", "action", "object"] },
  ], compilerLowering: [
    { match: { domain: "image", action: "capture" }, actionId: "take-photo.capture", fallbackSkill: "take-photo", matchedIntents: [], requiredContext: [], reason: "lowered photo capture" },
    { match: { domain: "image", action: "inspect" }, actionId: "take-photo.capture", fallbackSkill: "take-photo", matchedIntents: ["visual_inspect"], requiredContext: [], reason: "lowered photo inspect" },
  ] },
  { name: "weather", description: "", filePath: "/tmp/SKILL.md", baseDir: "/tmp", commandName: null, family: "weather", keywords: [], examples: [], negativeExamples: [], intents: {}, compilerIntents: [], compilerSchemas: [
    { match: { domain: "weather", action: "lookup", object: "weather" }, requiredFields: ["domain", "action", "object"] },
  ], compilerLowering: [
    { match: { domain: "weather", action: "lookup", object: "weather" }, actionId: "weather.brief", fallbackSkill: "weather", matchedIntents: [], requiredContext: ["default_location"], reason: "lowered weather" },
  ] },
];

const resources = { catalog, actions: [
  action("take-screenshot.capture", "take-screenshot", "SCREENSHOT", ["active_display"]),
  action("take-screenshot.view-latest", "take-screenshot", null, ["active_display", "recent_screenshot_path"]),
  action("take-photo.capture", "take-photo", "PHOTO"),
  action("weather.brief", "weather", null, ["default_location"]),
] };

const chat = await compileVoiceCommand("how are you today", resources);
assert.equal(chat.handled, false);
assert.equal(chat.trace.selectedIR.kind, "chat");

const weather = await compileVoiceCommand("how is the weather today", resources);
assert.equal(weather.handled, true);
assert.equal(weather.directExec.actionId, "weather.brief");
assert.equal(weather.trace.selectedIR.domain, "weather");

const capture = await compileVoiceCommand("take a screenshot", resources);
assert.equal(capture.handled, true);
assert.equal(capture.directExec.actionId, "take-screenshot.capture");
assert.equal(capture.trace.selectedIR.action, "capture");

const show = await compileVoiceCommand("show me the last screenshot", resources);
assert.equal(show.handled, true);
assert.equal(show.directExec.actionId, "take-screenshot.view-latest");
assert.equal(show.trace.resolved.refs.recent_screenshot_path, "/tmp/latest.png");

const inspect = await compileVoiceCommand("look at my screen", resources);
assert.equal(inspect.handled, true);
assert.equal(inspect.directExec.actionId, "take-screenshot.capture");
assert.deepEqual(inspect.directExec.matchedIntents, ["visual_inspect"]);

const photo = await compileVoiceCommand("describe the photo", resources);
assert.equal(photo.handled, true);
assert.equal(photo.directExec.actionId, "take-photo.capture");
assert.deepEqual(photo.directExec.matchedIntents, ["visual_inspect"]);

console.log("compiler smoke tests passed");
