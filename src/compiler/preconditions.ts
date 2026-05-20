import type { PreconditionResult, ResolvedCommand } from "./ir.js";

export function checkCommandPreconditions(resolved: ResolvedCommand): PreconditionResult {
  const missing: string[] = [];
  const { ir, refs, state } = resolved;

  if (ir.domain === "screen") {
    if (["capture", "inspect", "open", "show"].includes(ir.action) && !state.activeDisplay) missing.push("active_display");
    if ((ir.action === "open" || ir.action === "show") && ir.object === "screenshot" && !refs.recent_screenshot_path) missing.push("recent_screenshot_path");
  }

  if (ir.domain === "weather" && !ir.location && !refs.default_location) missing.push("default_location");

  return { ok: missing.length === 0, missing };
}
