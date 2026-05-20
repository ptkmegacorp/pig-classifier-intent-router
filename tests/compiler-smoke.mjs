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

function action(id, skill, outputImageKey = null) {
  return {
    id,
    skill,
    description: id,
    script: `scripts/${id}.sh`,
    scriptPath: `/tmp/${id}.sh`,
    baseDir: "/tmp",
    directExec: true,
    safety: id.includes("weather") ? "read_only_network" : "local_capture",
    requiresConfirmation: false,
    defaultArgs: [],
    keywords: [],
    exactPhrases: [],
    family: skill.includes("weather") ? "weather" : skill.includes("photo") ? "image" : "screen",
    attachImageWhenIntent: null,
    runWhenIntent: null,
    requiredContext: [],
    outputImageKey,
  };
}

const resources = {
  catalog: [],
  actions: [
    action("take-screenshot.capture", "take-screenshot", "SCREENSHOT"),
    action("take-screenshot.view-latest", "take-screenshot"),
    action("take-photo.capture", "take-photo", "PHOTO"),
    action("weather.brief", "weather"),
  ],
};

const chat = compileVoiceCommand("how are you today", resources);
assert.equal(chat.handled, false);
assert.equal(chat.trace.selectedIR.kind, "chat");

const weather = compileVoiceCommand("how is the weather today", resources);
assert.equal(weather.handled, true);
assert.equal(weather.directExec.actionId, "weather.brief");
assert.equal(weather.trace.selectedIR.domain, "weather");

const capture = compileVoiceCommand("take a screenshot", resources);
assert.equal(capture.handled, true);
assert.equal(capture.directExec.actionId, "take-screenshot.capture");
assert.equal(capture.trace.selectedIR.action, "capture");

const show = compileVoiceCommand("show me the last screenshot", resources);
assert.equal(show.handled, true);
assert.equal(show.directExec.actionId, "take-screenshot.view-latest");
assert.equal(show.trace.resolved.refs.recent_screenshot_path, "/tmp/latest.png");

const inspect = compileVoiceCommand("look at my screen", resources);
assert.equal(inspect.handled, true);
assert.equal(inspect.directExec.actionId, "take-screenshot.capture");
assert.deepEqual(inspect.directExec.matchedIntents, ["visual_inspect"]);

const photo = compileVoiceCommand("describe the photo", resources);
assert.equal(photo.handled, true);
assert.equal(photo.directExec.actionId, "take-photo.capture");
assert.deepEqual(photo.directExec.matchedIntents, ["visual_inspect"]);

console.log("compiler smoke tests passed");
