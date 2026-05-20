# Pig Routing Handoff: Extractor Pattern for Screenshot, Weather, and i3 Commands

## Core Recommendation

For Pig, use an **extractor/frame pattern** as the center of gravity for deterministic machine-control routing.

Do not primarily ask:

```text
Which full intent name is this closest to?
```

Ask:

```text
What structured operation is being requested?
```

That means Pig should translate user utterances into a structured command frame first, then resolve that frame into an exact script/tool.

---

## Why Extractor Pattern Fits Pig Better

A flat intent router treats every command as a separate label:

```text
"move window up"        → i3.move_window_up
"move window down"      → i3.move_window_down
"focus window up"       → i3.focus_window_up
"open the screenshot"   → screen.open_last_capture
"take a screenshot"     → screen.capture
"describe screenshot"   → screen.describe_capture
```

This gets messy because many commands share the same words but require different operations.

An extractor instead produces compositional structure:

```json
{
  "domain": "i3",
  "action": "move",
  "object": "window",
  "direction": "up"
}
```

Then Pig resolves that frame into the exact script:

```text
i3 + move + window + up → scripts/i3/move-window-up
```

This scales better than having many near-duplicate intents competing against each other.

---

## Recommended Pig Routing Shape

```text
User utterance
   ↓
Broad gate
   ↓
Frame extractor
   ↓
Frame validator
   ↓
Resolver
   ↓
Precondition/state check
   ↓
Execute or fallback
```

More explicitly:

```text
1. Broad gate:
   chat vs command vs info lookup vs search vs vision

2. Extractor:
   produce domain/action/object/args

3. Resolver:
   map structured frame to exact Pig skill/script

4. Preconditions:
   check required system state

5. Fallback:
   send to Gemma or ask clarification when ambiguous
```

---

## Screenshot Example

Flat intent-router version gets tangled:

```text
"take a screenshot"      → screen.capture
"open the screenshot"    → screen.open_last_capture
"show the screenshot"    → screen.open_last_capture
"describe screenshot"    → screen.describe_capture
"look at my screen"      → screen.capture_then_describe
```

These all share words like `screen`, `screenshot`, `show`, `look`, and `describe`, so BM25/embeddings can confuse them.

Extractor version separates the operation.

### User says:

```text
"take a screenshot"
```

Extractor output:

```json
{
  "is_command": true,
  "domain": "screen",
  "action": "capture",
  "object": "screenshot"
}
```

Resolver:

```text
screen + capture + screenshot → take-screenshot script
```

---

### User says:

```text
"open the screenshot"
```

Extractor output:

```json
{
  "is_command": true,
  "domain": "screen",
  "action": "open",
  "object": "screenshot",
  "target": "last"
}
```

Resolver:

```text
screen + open + screenshot + last → open-last-screenshot script
```

Precondition:

```text
recent_screenshot_path exists?
  yes → execute
  no  → fallback or ask clarification
```

---

### User says:

```text
"describe the screenshot"
```

Extractor output:

```json
{
  "is_command": true,
  "domain": "vision",
  "action": "describe",
  "object": "screenshot",
  "target": "last"
}
```

Resolver:

```text
vision + describe + screenshot + last → send screenshot to vision/Gemma
```

---

## Weather Mishap Example

Problem phrases:

```text
"how are you today"
"how is the weather today"
```

A flat BM25/embedding router may see these as close because they share:

```text
how / are-is / you-weather / today
```

But operationally they are different:

```text
"how are you today"        → normal chat
"how is the weather today" → weather lookup
```

The extractor/gate pattern fixes this by first deciding whether the utterance is a command/info request or just normal chat.

### User says:

```text
"how are you today"
```

Extractor output:

```json
{
  "is_command": false,
  "route": "normal_chat",
  "reason": "social/phatic greeting"
}
```

Resolver:

```text
no direct tool → Gemma/chat
```

---

### User says:

```text
"how is the weather today"
```

Extractor output:

```json
{
  "is_command": true,
  "domain": "weather",
  "action": "lookup",
  "object": "weather",
  "time": "today"
}
```

Resolver:

```text
weather + lookup + today → weather.lookup(today)
```

Important rule: weather routing should require an actual weather object/concept, such as:

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

So this should not route to weather:

```text
"how are you today"
```

because it lacks a weather object/concept.

---

## i3 Example

Flat intent routing creates many labels:

```text
i3.move_window_up
i3.move_window_down
i3.move_window_left
i3.move_window_right
i3.focus_window_up
i3.focus_window_down
i3.move_workspace_up
i3.focus_workspace_up
```

Extractor routing uses a frame:

```text
"move window up"
```

```json
{
  "is_command": true,
  "domain": "i3",
  "action": "move",
  "object": "window",
  "target": "focused",
  "direction": "up"
}
```

Resolver:

```text
i3 + move + window + focused + up → i3.move_window_up
```

Contrast:

```text
"focus window up"
```

```json
{
  "is_command": true,
  "domain": "i3",
  "action": "focus",
  "object": "window",
  "direction": "up"
}
```

Resolver:

```text
i3 + focus + window + up → i3.focus_window_up
```

And:

```text
"move workspace up"
```

```json
{
  "is_command": true,
  "domain": "i3",
  "action": "move",
  "object": "workspace",
  "direction": "up"
}
```

Resolver:

```text
i3 + move + workspace + up → workspace movement intent, not window movement
```

This avoids confusing `move window up` with `move workspace up`.

---

## Command Frame Schema

A practical initial schema could look like:

```json
{
  "is_command": true,
  "domain": "screen | vision | image | file | i3 | workspace | weather | search | chat",
  "action": "capture | open | show | describe | move | focus | close | lookup | search",
  "object": "screenshot | image | file | window | workspace | weather | screen",
  "target": "last | current | focused | selected | attached | explicit_path | null",
  "direction": "up | down | left | right | null",
  "time": "today | tomorrow | explicit_date | null",
  "confidence": 0.0
}
```

For non-command/chat utterances:

```json
{
  "is_command": false,
  "route": "normal_chat",
  "reason": "social/phatic greeting",
  "confidence": 0.92
}
```

The extractor must have an abstain path. Without abstention, it will hallucinate structure from ordinary speech.

---

## Role of Embeddings

Embeddings still help, but they should not be the main decision-maker.

Use embeddings as a semantic helper for mapping weird phrasing to canonical frame values.

Examples:

```text
"grab my screen"              → action=capture, object=screenshot/screen
"pull up the screenshot"      → action=open/show, object=screenshot, target=last
"what's it like outside"      → domain=weather, action=lookup
"shove the active window up"  → domain=i3, action=move, object=window, direction=up
```

Embeddings answer:

```text
What does this wording resemble?
```

The extractor/harness answers:

```text
What structured command is this?
Is it valid?
Can we execute it now?
```

---

## Role of BM25 / Exact Matching

BM25 remains useful as a stabilizer for exact operational words.

Examples:

```text
open      → boost open/show/display actions
take      → boost capture actions
capture   → boost capture actions
describe  → boost vision/description actions
weather   → boost weather domain
window    → boost i3 window object
workspace → boost i3 workspace object
```

BM25 helps prevent embeddings from overgeneralizing.

---

## Role of Metadata and Preconditions

Metadata/schema defines what operations exist and what they require.

Example:

```yaml
operation: screen.open_last_capture
frame_match:
  domain: screen
  action: open
  object: screenshot
  target: last
requires:
  - recent_screenshot_path
executor: scripts/screen/open-last-screenshot.sh
```

Example:

```yaml
operation: screen.capture
frame_match:
  domain: screen
  action: capture
  object: screenshot
requires:
  - active_display
executor: scripts/screen/take-screenshot.sh
```

Example:

```yaml
operation: weather.lookup
frame_match:
  domain: weather
  action: lookup
  object: weather
requires:
  - location_available_or_default
executor: skills/weather.lookup
```

Preconditions matter because the extractor can be correct while execution is invalid.

Example:

```text
"open the screenshot"
```

Correct extraction:

```json
{
  "domain": "screen",
  "action": "open",
  "object": "screenshot",
  "target": "last"
}
```

But if there is no recent screenshot path, Pig should not execute. It should fallback or ask.

---

## Final Architecture Split

```text
Broad gate      = chat vs command vs info lookup
Extractor       = domain/action/object/args
Embeddings      = paraphrase helper
BM25            = exact keyword stabilizer
Metadata/schema = allowed frame definitions
State checker   = final reality check
Resolver        = frame → exact script/tool
Gemma           = ambiguity handler
```

The important principle:

```text
small models perceive
harness validates
resolver maps
scripts execute
Gemma handles weirdness
```

---

## Minimal Implementation Milestone

Do not build a giant system first.

Build this small version:

```text
1. Keep broad gate.
2. Add frame extraction for a few domains:
   - screen
   - vision/image
   - i3/window
   - weather
   - normal_chat
3. Define a small command-frame schema.
4. Add resolver table from frame → existing Pig skill/script.
5. Add precondition checks.
6. Use BM25/keywords as stabilizers.
7. Use embeddings only as a paraphrase helper, not global authority.
8. Add regression tests for known confusions.
```

---

## Regression Tests

The implementation should correctly distinguish:

```text
"how are you today"           → normal_chat
"how is the weather today"    → weather.lookup

"take a screenshot"           → screen.capture
"open the screenshot"         → screen.open_last_capture
"show me the last screenshot" → screen.open_last_capture
"describe the screenshot"     → vision.describe_screenshot
"look at my screen"           → screen.capture_then_describe or screen.describe_current

"move window up"              → i3.move_window_up
"focus window up"             → i3.focus_window_up
"move workspace up"           → workspace movement, not window movement
```

---

## Bottom Line

For Pig, extractor/frame routing makes more sense than pure embedding intent routing.

Flat intent routing asks:

```text
Which label is this sentence closest to?
```

Extractor routing asks:

```text
What operation is being requested?
```

Because Pig is controlling deterministic tools, the second question is better.

The clean model:

```text
extractor = main translator
embeddings = paraphrase helper
BM25 = exact-word stabilizer
metadata/schema = allowed operations
state = final reality check
resolver = exact deterministic mapping
Gemma = fallback for ambiguity
```


ignore the i3 specifics stuff, its just an example, also lets not worry about embeddings yet
