import type { CompilerCommandSchemaMetadata, RouteResources } from "../router.js";
import type { CommandIR, TypecheckResult } from "./ir.js";

function asList(value: unknown): string[] | null {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return null;
}

function matches(expected: unknown, actual: string | undefined): boolean {
  const list = asList(expected);
  if (!list) return true;
  if (!actual) return false;
  return list.includes(actual);
}

function schemas(resources: RouteResources): CompilerCommandSchemaMetadata[] {
  return resources.catalog.flatMap((skill) => skill.compilerSchemas);
}

export function typecheckCommandIR(ir: CommandIR, resources: RouteResources): TypecheckResult {
  if (ir.kind === "chat") return { ok: true, errors: [] };
  const allSchemas = schemas(resources);
  if (allSchemas.length === 0) return { ok: false, errors: ["no compiler command schemas loaded"] };

  const matchedDomain = allSchemas.filter((schema) => matches(schema.match.domain, ir.domain));
  if (matchedDomain.length === 0) return { ok: false, errors: [`unsupported domain: ${ir.domain}`] };

  const matched = matchedDomain.filter((schema) =>
    matches(schema.match.action, ir.action)
    && matches(schema.match.object, ir.object)
    && matches(schema.match.target, ir.target)
  );
  if (matched.length === 0) return { ok: false, errors: [`no schema matched ${ir.domain}.${ir.action}.${ir.object}${ir.target ? `.${ir.target}` : ""}`] };

  const missing: string[] = [];
  const fields = new Set(Object.keys(ir));
  const slots = ir.slots ?? {};
  for (const schema of matched) {
    const missingForSchema = schema.requiredFields.filter((field) => !fields.has(field) && !(field in slots));
    if (missingForSchema.length === 0) return { ok: true, errors: [] };
    missing.push(...missingForSchema);
  }
  return { ok: false, errors: [`missing required field(s): ${[...new Set(missing)].join(", ")}`] };
}
