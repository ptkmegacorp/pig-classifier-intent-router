import type { CommandIR, ResolvedCommand } from "./ir.js";
import type { PigCommandState } from "./state.js";

export function resolveCommandIR(ir: CommandIR, state: PigCommandState): ResolvedCommand | null {
  if (ir.kind === "chat") return null;
  const refs: Record<string, string> = {};
  if (ir.domain === "screen" && ir.object === "screenshot" && (ir.target === "last" || ir.target === "recent") && state.recentScreenshotPath) {
    refs.recent_screenshot_path = state.recentScreenshotPath;
  }
  if ((ir.domain === "screen" || ir.domain === "image") && state.lastImagePath) {
    refs.last_image_path = state.lastImagePath;
  }
  if (ir.domain === "image" && state.latestPhotoPath) {
    refs.latest_photo_path = state.latestPhotoPath;
  }
  if (ir.domain === "weather" && !ir.location && state.defaultLocation) {
    refs.default_location = state.defaultLocation;
  }
  return { ir, refs, state };
}
