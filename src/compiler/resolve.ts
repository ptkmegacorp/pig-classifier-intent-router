import type { CommandIR, ResolvedCommand } from "./ir.js";
import type { PigCommandState } from "./state.js";

export type ReferenceResolverProvider = (ir: Exclude<CommandIR, { kind: "chat" }>, state: PigCommandState) => Record<string, string | null | undefined>;

const providers: ReferenceResolverProvider[] = [];

export function registerReferenceResolverProvider(provider: ReferenceResolverProvider): void {
  providers.push(provider);
}

export function getReferenceResolverProviderCount(): number {
  return providers.length;
}

function add(refs: Record<string, string | null | undefined>, key: string, value: string | null | undefined): void {
  if (value) refs[key] = value;
}

registerReferenceResolverProvider((ir, state) => ({
  active_display: state.activeDisplay ? "true" : null,
  default_location: ir.domain === "weather" && !ir.location ? state.defaultLocation : null,
  focused_window_name: state.focusedWindowName,
  focused_workspace: state.focusedWorkspace,
  selected_text: state.selectedText,
}));

registerReferenceResolverProvider((ir, state) => {
  const out: Record<string, string | null> = {};
  if (ir.domain === "screen" && ir.object === "screenshot" && (ir.target === "last" || ir.target === "recent")) add(out, "recent_screenshot_path", state.recentScreenshotPath);
  if (ir.domain === "screen" || ir.domain === "image") add(out, "last_image_path", state.lastImagePath);
  if (ir.domain === "image") add(out, "latest_photo_path", state.latestPhotoPath);
  return out;
});

export function resolveCommandIR(ir: CommandIR, state: PigCommandState): ResolvedCommand | null {
  if (ir.kind === "chat") return null;
  const refs: Record<string, string> = {};
  for (const provider of providers) {
    const produced = provider(ir, state);
    for (const [key, value] of Object.entries(produced)) add(refs, key, value);
  }
  return { ir, refs, state };
}
