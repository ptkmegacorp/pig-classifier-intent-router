import type { CommandIR, TypecheckResult } from "./ir.js";

const allowed = {
  screen: {
    capture: new Set(["screenshot"]),
    open: new Set(["screenshot"]),
    show: new Set(["screenshot"]),
    inspect: new Set(["screen", "screenshot"]),
  },
  image: {
    capture: new Set(["photo", "image"]),
    open: new Set(["photo", "image"]),
    show: new Set(["photo", "image"]),
    inspect: new Set(["photo", "image"]),
  },
  weather: {
    lookup: new Set(["weather"]),
  },
} as const;

export function typecheckCommandIR(ir: CommandIR): TypecheckResult {
  if (ir.kind === "chat") return { ok: true, errors: [] };
  const domain = allowed[ir.domain];
  if (!domain) return { ok: false, errors: [`unsupported domain: ${ir.domain}`] };
  const objects = (domain as Record<string, Set<string>>)[ir.action];
  if (!objects) return { ok: false, errors: [`${ir.domain} does not support action: ${ir.action}`] };
  if (!objects.has(ir.object)) return { ok: false, errors: [`${ir.domain}.${ir.action} does not support object: ${ir.object}`] };
  if ((ir.action === "open" || ir.action === "show") && !ir.target) return { ok: false, errors: [`${ir.domain}.${ir.action}.${ir.object} requires target`] };
  return { ok: true, errors: [] };
}
