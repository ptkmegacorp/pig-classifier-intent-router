# Refactor To Extractor Pattern

This document is the implementation guide for moving Pig's deterministic routing from a metadata/BM25 selector toward a generic extractor/frame pattern.

It is intentionally scoped to computer-use style commands on Unix-like systems.
Do not treat this as a language understanding project. The goal is structured routing for deterministic actions.

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
What structured operation is being requested?
```

instead of:

```text
Which label is this sentence closest to?
```

## Design Goal

Use a generic frame extractor as the first-class translator for deterministic computer-use requests.

The extractor should:

```text
1. read the utterance
2. extract a structured command frame
3. abstain when the utterance is chat/ambiguous
4. let the resolver map the frame to an exact skill/script
5. let preconditions decide whether execution is valid
```

The extractor should stay generic across domains like:

```text
screen
photo
file
weather
window
app
search
```

No i3-specific logic belongs in the core design. i3 is only an example of the same generic shape.

## Frame Schema

Keep the frame small and stable.

Suggested initial schema:

```json
{
  "is_command": true,
  "domain": "screen | image | file | weather | window | app | search | chat",
  "action": "capture | open | show | describe | lookup | move | focus | search",
  "object": "screenshot | photo | file | weather | window | app | screen",
  "target": "last | current | focused | selected | attached | explicit_path | null",
  "direction": "up | down | left | right | null",
  "time": "today | tomorrow | explicit_date | null",
  "modifiers": ["attached", "current", "most recent"],
  "confidence": 0.0,
  "abstain_reason": null
}
```

For non-command utterances:

```json
{
  "is_command": false,
  "route": "normal_chat",
  "confidence": 0.92,
  "abstain_reason": "social/phatic greeting"
}
```

The extractor must be able to abstain. Without abstention, it will hallucinate structure from ordinary speech.

## Frame Semantics

The extractor should map stable operational phrases to frame values.

Examples:

```text
take a screenshot         -> domain=screen, action=capture, object=screenshot
open the screenshot       -> domain=screen, action=open, object=screenshot, target=last
view the screenshot       -> domain=screen, action=describe or inspect, object=screenshot, target=last
describe the screenshot   -> domain=screen, action=describe, object=screenshot, target=last
take a photo              -> domain=image, action=capture, object=photo
describe the photo        -> domain=image, action=describe, object=photo
how is the weather today  -> domain=weather, action=lookup, object=weather, time=today
how are you today         -> abstain / normal_chat
```

The important distinction is not lexical similarity. It is the operation being requested.

## Resolver

The resolver maps a valid frame to an exact capability.

Example:

```text
screen + capture + screenshot -> take-screenshot.capture
screen + open + screenshot + last -> take-screenshot.view-latest
screen + describe + screenshot + last -> take-screenshot.capture with image attachment
image + capture + photo -> take-photo.capture
image + describe + photo -> take-photo.capture with image attachment
weather + lookup + today -> weather.brief
```

The resolver should not guess. If the frame is missing a required component, it should abstain or ask for clarification.

## Preconditions

Frames can be correct while execution is invalid.

Examples:

```text
open the screenshot
```

Valid frame:

```json
{
  "domain": "screen",
  "action": "open",
  "object": "screenshot",
  "target": "last"
}
```

But execution should still require:

```text
recent_screenshot_path
```

Likewise:

```text
take a screenshot
```

should require:

```text
active_display
```

Preconditions are a final check, not part of the string match.

## Roles

Keep these responsibilities separate:

```text
Broad gate   = command-like vs chat-like
Extractor    = utterance -> structured frame
Resolver     = frame -> exact skill/script
State check  = required context present?
Gemma        = abstain / ambiguity handling
```

The router should not be the domain ontology. It should orchestrate the extraction and resolution steps.

## What To Reuse

Reuse the current Pi integration and metadata.

Keep:

```text
pi.getCommands()
resources_discover
routing.json
direct-exec.json
input event hook
direct_exec safety checks
required context checks
```

Keep BM25 as a stabilizer if useful.

Do not make embeddings a dependency for the first extractor pass.

## What To Replace

Replace the label-centric selection path for deterministic computer-use domains.

Current flow:

```text
metadata -> BM25 -> best skill -> direct_exec / pi_skill
```

Target flow:

```text
utterance -> extractor -> frame -> resolver -> preconditions -> execute / abstain
```

## Implementation Plan

Suggested staged refactor:

1. Define the frame schema in code.
2. Add a generic extractor interface.
3. Implement a default extractor for the current deterministic domains.
4. Build a resolver table from frame patterns to existing skills/scripts.
5. Keep broad gate and required-context checks.
6. Keep BM25 only as a backup stabilizer.
7. Add regression tests for screenshot and weather confusion.

## Initial Domains

Start with the domains already in the router:

```text
screen
image/photo
weather
chat abstain
```

That is enough to validate the extractor pattern before expanding to other computer-use areas.

## Regression Cases

The first regression set should distinguish:

```text
how are you today           -> normal_chat
how is the weather today    -> weather.lookup

take a screenshot           -> screen.capture
open the screenshot         -> screen.open_last_capture
view the screenshot         -> screen.inspect_last_capture or screen.capture_for_vision
describe the screenshot     -> screen.inspect_last_capture or screen.capture_for_vision

take a photo                -> image.capture
describe the photo          -> image.inspect_last_capture or image.capture_for_vision
```

## Non-Goals

Do not build a general natural language parser.
Do not add embeddings in the first pass.
Do not fold i3-specific command design into the core schema.
Do not remove Pi discovery or Pi command provenance.

## Bottom Line

The extractor is the generic translator.

The resolver is the deterministic mapper.

The state check is the final safety gate.

BM25 can remain as a stabilizer, but the main logic should become frame-first rather than label-first.
