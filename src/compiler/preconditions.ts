import type { PreconditionResult, ResolvedCommand } from "./ir.js";

export function checkCommandPreconditions(resolved: ResolvedCommand, requiredContext: string[] = []): PreconditionResult {
  const missing: string[] = [];
  const { refs, state } = resolved;

  for (const item of new Set(requiredContext)) {
    switch (item) {
      case "active_display":
        if (!state.activeDisplay) missing.push(item);
        break;
      case "recent_screenshot_path":
        if (!refs.recent_screenshot_path) missing.push(item);
        break;
      case "default_location":
        if (!refs.default_location) missing.push(item);
        break;
      case "last_image_path":
        if (!refs.last_image_path) missing.push(item);
        break;
      case "latest_photo_path":
        if (!refs.latest_photo_path) missing.push(item);
        break;
      default:
        break;
    }
  }

  return { ok: missing.length === 0, missing };
}
