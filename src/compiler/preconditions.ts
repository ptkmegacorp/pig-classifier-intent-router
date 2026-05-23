import type { PigCommandState } from "./state.js";
import type { PreconditionResult, ResolvedCommand } from "./ir.js";

export type PreconditionProvider = (resolved: ResolvedCommand) => boolean;

const providers = new Map<string, PreconditionProvider>();

export function registerPreconditionProvider(name: string, provider: PreconditionProvider): void {
  providers.set(name, provider);
}

export function getPreconditionProviderNames(): string[] {
  return [...providers.keys()].sort();
}

function ref(name: string): PreconditionProvider {
  return (resolved) => Boolean(resolved.refs[name]);
}

function state(name: keyof PigCommandState): PreconditionProvider {
  return (resolved) => Boolean(resolved.state[name]);
}

registerPreconditionProvider("active_display", state("activeDisplay"));
registerPreconditionProvider("recent_screenshot_path", ref("recent_screenshot_path"));
registerPreconditionProvider("default_location", ref("default_location"));
registerPreconditionProvider("last_image_path", ref("last_image_path"));
registerPreconditionProvider("latest_photo_path", ref("latest_photo_path"));
registerPreconditionProvider("focused_window_name", ref("focused_window_name"));
registerPreconditionProvider("focused_workspace", ref("focused_workspace"));
registerPreconditionProvider("selected_text", ref("selected_text"));

export function checkCommandPreconditions(resolved: ResolvedCommand, requiredContext: string[] = []): PreconditionResult {
  const missing: string[] = [];
  for (const item of new Set(requiredContext)) {
    const provider = providers.get(item);
    if (provider && !provider(resolved)) missing.push(item);
  }
  return { ok: missing.length === 0, missing };
}
