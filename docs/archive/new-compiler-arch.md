# Handoff: Pig Typed Command Compiler

## Core idea

Do **not** build Pig as a smarter intent router.

Build it as a small command compiler:

```text
natural language
  → CommandIR
  → validate
  → resolve references
  → check preconditions
  → lower to deterministic action
  → execute
```

Pig’s job is to turn fuzzy human language into safe, typed, local operations.

The model proposes structure. Pig validates and executes.

Source basis: 

---

## Why this pattern

Pig is not mainly classifying topics. It is translating user language into actions like:

```text
take screenshot
open last screenshot
describe current screen
lookup weather today
search for query
open file
```

These requests are naturally structured as:

```text
action + object + target/context
```

So Pig should avoid a giant list of brittle full intents and instead use a compact internal command representation.

---

## Architecture

```text
User utterance
  ↓
Gate
  ↓
Parser / extractor
  ↓
CommandIR
  ↓
Typechecker
  ↓
Reference resolver
  ↓
Precondition checker
  ↓
Lowering table
  ↓
Executor
  ↓
State update / log
```

---

## CommandIR

Define a typed intermediate representation.

Example shape:

```ts
type CommandIR =
  | ChatIR
  | ScreenCommandIR
  | VisionCommandIR
  | WeatherCommandIR
  | FileCommandIR
  | SearchCommandIR;
```

Example screen command:

```ts
type ScreenCommandIR = {
  kind: "command";
  domain: "screen";
  action: "capture" | "open" | "show";
  object: "screenshot" | "screen";
  target?: "current" | "last" | "recent";
  confidence: number;
};
```

Example weather command:

```ts
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

Example chat fallback:

```ts
type ChatIR = {
  kind: "chat";
  reason: "phatic" | "general_question" | "ambiguous" | "no_command";
  confidence: number;
};
```

---

## Key stages

### 1. Gate

Decides broad route:

```text
chat
local_command
weather/info_lookup
vision
search
ambiguous
```

This prevents mistakes like treating:

```text
how are you today
```

as weather, while correctly routing:

```text
how is the weather today
```

to weather lookup.

---

### 2. Parser / extractor

Produces one or more candidate `CommandIR` objects.

It may use keywords, BM25, embeddings, examples, or a small model.

These tools help propose structure. They do not decide execution.

---

### 3. Typechecker

Rejects invalid command structures.

Example:

```text
open the weather
```

should not blindly become:

```json
{
  "domain": "weather",
  "action": "open"
}
```

The typechecker should reject or reroute it because weather supports `lookup`, not `open`.

---

### 4. Reference resolver

Resolves phrases like:

```text
the screenshot
the image
today
last file
```

against Pig state.

Example state:

```json
{
  "recent_screenshot_path": "/tmp/pig/screenshots/latest.png",
  "last_image_path": "/tmp/pig/screenshots/latest.png",
  "last_opened_file": "/home/user/example.txt",
  "default_location": "Milwaukee, WI"
}
```

If a reference cannot be resolved, Pig should not guess.

---

### 5. Precondition checker

Checks whether an action is actually possible.

Examples:

```text
open last screenshot
  requires recent_screenshot_path

describe current screen
  requires screenshot capture + vision model/tool

lookup weather today
  requires default or explicit location
```

Failures should be structured, not silent.

---

### 6. Lowering table

Validated `CommandIR` lowers into exact operations.

```text
screen.capture.screenshot.current
  → scripts/screen/take-screenshot.sh

screen.open.screenshot.last
  → scripts/screen/open-last-screenshot.sh

vision.describe.screen.current
  → capture screenshot → Gemma vision flow

weather.lookup.today
  → weather.lookup({ time: "today" })

search.search.query
  → web/local search backend

file.open.path
  → deterministic file opener
```

This is where deterministic behavior belongs.

---

## Roles of each component

```text
BM25:
  exact word grounding

Embeddings:
  paraphrase matching

Extractor:
  emits candidate CommandIR

Typechecker:
  rejects invalid structures

Resolver:
  maps references to state

Pig harness:
  validates, lowers, executes, logs, updates state

Gemma:
  handles ambiguity, fallback, general chat, explanations
```

---

## First implementation scope

Keep the first version small:

```text
Domains:
  screen
  vision
  weather
  file
  search
  chat
```

Minimum useful commands:

```text
take screenshot
open last screenshot
show last screenshot
describe last screenshot
describe current screen
lookup weather today
lookup weather tomorrow
search query
open file by path
normal chat fallback
```

---

## Design principle

Bad:

```text
utterance → nearest intent → execute
```

Better:

```text
utterance → extracted frame → resolve → execute
```

Best for Pig:

```text
utterance
  → typed CommandIR
  → validate
  → resolve references
  → check preconditions
  → lower
  → execute
```

Pig should be a typed semantic command compiler, not just a router.

