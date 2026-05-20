# Refactor To Command Compiler

This document is the implementation guide for moving Pig's deterministic routing from a metadata/BM25 selector toward a typed command compiler.

It is intentionally scoped to deterministic computer-use commands on Unix-like systems. Do not treat this as a general natural-language understanding project. The goal is to turn fuzzy user utterances into safe, typed local operations.

## Current Baseline

The code currently does:

```text
Pi discovers skills
Pig reads skill commands from pi.getCommands()
Pig loads adjacent routing/direct-exec metadata
Pig applies broad family gates
Pig scores eligible metadata with BM25
Pig thresholds direct execution
Pig falls back to skill expansion or normal chat
```

That baseline is useful, but it is still label-centric.

The refactor goal is to ask:

```text
What typed command is being requested?
```

instead of:

```text
Which label is this sentence closest to?
```

## Compiler Shape

Target architecture:

```text
utterance
  -> gate
  -> parser / extractor
  -> CommandIR candidates
  -> typecheck
  -> resolve references
  -> check preconditions
  -> lower to deterministic action
  -> execute
  -> update state / log
```

The model or extractor proposes structure. Pig validates, resolves, lowers, executes, and logs.

## CommandIR

Define a small typed intermediate representation.

Suggested initial TypeScript shape:

```ts
type CommandIR =
  | ChatIR
  | ScreenCommandIR
  | ImageCommandIR
  | WeatherCommandIR
  | FileCommandIR
  | SearchCommandIR;

type ChatIR = {
  kind: "chat";
  reason: "phatic" | "general_question" | "ambiguous" | "no_command";
  confidence: number;
};

type ScreenCommandIR = {
  kind: "command";
  domain: "screen";
  action: "capture" | "open" | "show" | "inspect";
  object: "screenshot" | "screen";
  target?: "current" | "last" | "recent";
  confidence: number;
};

type ImageCommandIR = {
  kind: "command";
  domain: "image";
  action: "capture" | "open" | "show" | "inspect";
  object: "photo" | "image";
  target?: "current" | "last" | "recent" | "attached";
  confidence: number;
};

type WeatherCommandIR = {
  kind: "command";
  domain: "weather";
  action: "lookup";
  object: "weather";
  time?: "today" | "tomorrow" | string;
  location?: string;
  confidence: number;
};
```

The schema can grow later, but the first pass should stay small.

## Stage 1: Gate

The gate decides broad route before detailed extraction:

```text
chat
local_command
weather/info_lookup
vision
search
ambiguous
```

This prevents mistakes like:

```text
how are you today -> weather
```

while still allowing:

```text
how is the weather today -> weather.lookup
```

Weather routing should require an actual weather concept:

```text
weather
forecast
rain
snow
temperature
temp
wind
outside
jacket
storm
radar
humidity
```

Bare time words like `today` must not be enough.

## Stage 2: Parser / Extractor

The extractor emits one or more `CommandIR` candidates.

It may use:

```text
keywords
BM25
examples
small model output
```

These tools propose structure. They do not decide execution.

Embeddings are not part of the first implementation pass.

## Stage 3: Typechecker

The typechecker rejects invalid command structures before resolution or execution.

Example invalid structure:

```json
{
  "kind": "command",
  "domain": "weather",
  "action": "open",
  "object": "weather"
}
```

Weather supports `lookup`, not `open`, so this must be rejected or routed to fallback.

Typechecking should answer:

```text
Does this domain support this action?
Does this action support this object?
Does this object support this target?
Are required fields present?
```

## Stage 4: Reference Resolver

The resolver maps user references onto Pig state.

Examples:

```text
the screenshot -> recent_screenshot_path
the image -> last_image_path
today -> current date/time window
last file -> last_opened_file
my location -> default_location
```

Example state:

```json
{
  "recent_screenshot_path": "/tmp/pig/screenshots/latest.png",
  "last_image_path": "/tmp/pig/screenshots/latest.png",
  "last_opened_file": "/home/user/example.txt",
  "default_location": "Jim Falls, WI"
}
```

If a reference cannot be resolved, Pig should not guess. It should fallback or ask for clarification.

## Stage 5: Preconditions

Preconditions check whether a valid command can run now.

Examples:

```text
screen.capture.screenshot.current
  requires active_display

screen.open.screenshot.last
  requires recent_screenshot_path

screen.inspect.screen.current
  requires active_display

weather.lookup.today
  requires default or explicit location
```

Preconditions are a final reality check, not part of string matching.

## Stage 6: Lowering Table

The lowering table maps validated, resolved `CommandIR` to exact operations.

Initial lowering examples:

```text
screen.capture.screenshot.current
  -> take-screenshot.capture

screen.open.screenshot.last
  -> take-screenshot.view-latest

screen.inspect.screen.current
  -> take-screenshot.capture with image attachment

screen.inspect.screenshot.last
  -> attach resolved screenshot to Gemma visual inspection flow

image.capture.photo
  -> take-photo.capture

image.inspect.photo
  -> take-photo.capture with image attachment

weather.lookup.today
  -> weather.brief
```

The lowering table is where deterministic behavior belongs. The parser should not directly pick scripts.

## Stage 7: Executor And State

Execution should:

```text
run only lowered, eligible direct_exec actions
return structured success/failure
update Pig state when relevant
write route/execution logs
fallback safely on execution failure
```

Examples of state updates:

```text
take screenshot -> update recent_screenshot_path and last_image_path
take photo -> update last_image_path / latest_photo_path
open file -> update last_opened_file
weather lookup -> optionally update last_location / last_weather_time
```

Failures should be structured, not silent.

## Current Semantics To Preserve

The command compiler must preserve the behavior we already clarified:

```text
take a screenshot -> capture only
open the screenshot -> display latest screenshot to user
show me the last screenshot -> display latest screenshot to user
view the screenshot -> model inspects screenshot
look at my screen -> capture current screen and attach to model
describe the screenshot -> model inspects screenshot
take a photo -> capture only
describe the photo -> capture photo and attach to model
how are you today -> normal chat
how is the weather today -> weather lookup
```

## Roles

Keep these responsibilities separate:

```text
BM25             = exact word grounding
Extractor        = utterance -> CommandIR candidates
Typechecker      = reject invalid structures
Reference resolver = map references to state
Precondition checker = verify required context
Lowering table   = CommandIR -> exact script/tool
Executor         = run deterministic action and update state
Gemma            = ambiguity, fallback, general chat, explanations
```

The router should orchestrate compiler stages. It should not become the domain ontology.

## What To Reuse

Reuse the current Pi integration and metadata:

```text
pi.getCommands()
resources_discover
routing.json
direct-exec.json
input event hook
direct_exec safety checks
required context checks
route/execution logging
```

Keep BM25 as a stabilizer if useful.

Do not add embeddings in the first compiler pass.

## What To Replace

Replace the label-centric selection path for deterministic computer-use domains.

Current flow:

```text
metadata -> BM25 -> best skill -> direct_exec / pi_skill
```

Target flow:

```text
utterance -> CommandIR candidates -> typecheck -> resolve refs -> preconditions -> lower -> execute / fallback
```

## Refactor Plan And Current Implementation

This refactor is being implemented inside `pig-classifier-intent-router`, which remains a Pig extension package. Pig is a local fork/downstream of the Pi harness, so this package should keep using Pi/Pig extension surfaces (`input`, `resources_discover`, `pi.getCommands()`, skill command provenance) while replacing the internal deterministic routing architecture.

Current staged plan:

1. Define `CommandIR` types in code. **Done:** see `src/compiler/ir.ts`.
2. Add a replaceable extractor boundary that emits `CommandIR` candidates. **Done:** `src/compiler/extractors.ts` defines a `CommandExtractor` interface and `runExtractorStack()`, so future extractors can be stacked or swapped without changing validation/lowering.
3. Keep a placeholder extractor only to exercise the pipeline. **Done:** `src/compiler/defaultExtractor.ts` is intentionally a temporary dumb rule extractor.
4. Implement compiler stages independent of the final extractor:
   - state snapshot: `src/compiler/state.ts`
   - typecheck: `src/compiler/typecheck.ts`
   - reference resolution: `src/compiler/resolve.ts`
   - preconditions: `src/compiler/preconditions.ts`
   - metadata/table-driven lowering: `src/compiler/lower.ts`
   - orchestration/trace: `src/compiler/compiler.ts`
5. Route through the compiler first, then fall back to the legacy metadata/BM25 router when the compiler emits chat, fails validation, misses preconditions, or cannot lower. **Done:** `routeVoiceTranscript()` now attaches `compilerTrace` to route decisions.
6. Keep required-context checks as preconditions and keep direct-exec safety metadata as the executor/lowering eligibility source.
7. Keep BM25 only as a backup stabilizer during transition.
8. Add regression tests for screenshot, photo, and weather confusion. **Started:** `tests/compiler-smoke.mjs` covers the core flow after `npm run build`.
9. Replace the placeholder extractor with the real extractor once the compiler contract and trace shape are stable.

The temporary extractor should not receive much investment. Its purpose is only to exercise the typed compiler pipeline so the rest of the architecture can be debugged now.

## Initial Domains

Start with the domains already in the router:

```text
screen
image/photo
weather
chat fallback
```

That is enough to validate the compiler pattern before expanding to files, search, app/window control, or other Unix-like computer-use areas.

## Regression Cases

The first regression set should distinguish:

```text
how are you today
  -> ChatIR(reason=phatic)

how is the weather today
  -> WeatherCommandIR(action=lookup, object=weather, time=today)

take a screenshot
  -> ScreenCommandIR(action=capture, object=screenshot, target=current)

open the screenshot
  -> ScreenCommandIR(action=open, object=screenshot, target=last)

show me the last screenshot
  -> ScreenCommandIR(action=show, object=screenshot, target=last)

view the screenshot
  -> ScreenCommandIR(action=inspect, object=screenshot, target=last)

look at my screen
  -> ScreenCommandIR(action=inspect, object=screen, target=current)

describe the screenshot
  -> ScreenCommandIR(action=inspect, object=screenshot, target=last)

take a photo
  -> ImageCommandIR(action=capture, object=photo)

describe the photo
  -> ImageCommandIR(action=inspect, object=photo)
```

## Non-Goals

Do not build a general natural-language parser.
Do not add embeddings in the first pass.
Do not fold i3-specific command design into the core schema.
Do not remove Pi discovery or Pi command provenance.
Do not let model/extractor output execute without typechecking and lowering.

## Bottom Line

Pig should become a small typed semantic command compiler.

The extractor proposes `CommandIR`.

The harness validates, resolves, lowers, executes, logs, and updates state.

Gemma handles ambiguity and normal conversation.
