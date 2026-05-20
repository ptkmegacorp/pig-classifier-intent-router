Here’s the handoff version:

---

# Pig Router: BM25 + Metadata + Embeddings Routing Design

## Problem

Pig currently uses BM25/metadata routing, but pure lexical matching is starting to fail on semantically similar or operationally confusing requests.

Example:

```text
"how are you today"
"how is the weather today"
```

These are lexically/semantically close, but they should route very differently:

```text
"how are you today"        → normal chat
"how is the weather today" → weather/info tool
```

Another problem:

```text
"take a screenshot"
"open the screenshot"
"describe the screenshot"
```

These all mention screenshots, but they are different actions.

The solution is **not** to replace BM25 with embeddings. The solution is to make routing staged.

---

# Core Principle

Use each routing layer for what it is good at:

```text
metadata      = hard boundaries / skill eligibility
BM25          = exact-word precision
embeddings    = semantic recall
preconditions = safety / context validation
Gemma         = ambiguity handler
```

Embeddings should help find semantically similar examples, but embeddings should **not** be allowed to globally choose and execute tools by themselves.

---

# Recommended Routing Pipeline

```text
User utterance
   ↓
1. Broad gate
   ↓
2. Metadata filter
   ↓
3. BM25 lexical scoring
   ↓
4. Embedding similarity over intent examples
   ↓
5. Preconditions / required context
   ↓
6. Execute, clarify, or fallback to Gemma
```

---

# Visual Example

User says:

```text
"open the screenshot"
```

Router flow:

```text
[1] Broad Gate
Classify broad family:
chat / screen / image / files / window-control / search

→ screen/files

[2] Metadata Filter
Only consider intents tagged screen/files.

Candidates:
- screen.capture
- screen.open_last_capture
- screen.describe_current
- file.open

[3] BM25
Exact-word evidence:
"open"       → boosts open/view/display intents
"screenshot" → boosts screenshot-related intents

Top candidates:
- screen.open_last_capture
- file.open

[4] Embeddings
Compare user utterance against stored examples:

screen.open_last_capture examples:
- "show me the last screenshot"
- "open the screenshot"
- "view the captured image"
- "display the screenshot"

Closest intent:
→ screen.open_last_capture

[5] Preconditions
Does Pig actually have a recent screenshot path/state?

yes → execute screen.open_last_capture
no  → fallback or ask clarification
```

---

# Contrast Example

User says:

```text
"take a screenshot"
```

Flow:

```text
Broad Gate → screen
Metadata → screen intents only
BM25 → "take" + "screenshot" boosts capture
Embeddings → close to "capture current screen"
Preconditions → display/session available
Result → execute screen.capture
```

---

# Important Rule

Do **not** do this:

```text
all skills
   ↓
embedding nearest neighbor
   ↓
execute
```

Do this instead:

```text
broad family
   ↓
metadata filter
   ↓
BM25 precision score
   ↓
embedding recall score
   ↓
precondition check
   ↓
execute / clarify / fallback
```

---

# Intent Metadata Shape

Each skill/intent should expose routing metadata.

Example:

```yaml
intent: screen.capture
family: screen
description: Capture the current screen.
positive_examples:
  - take a screenshot
  - grab my screen
  - capture the current display
  - screenshot this window
positive_terms:
  - take
  - capture
  - grab
  - screenshot
required_context:
  - active_display
negative_examples:
  - open the screenshot
  - show me the last screenshot
  - describe this image
```

Example:

```yaml
intent: screen.open_last_capture
family: screen
description: Open or display the most recent screenshot.
positive_examples:
  - open the screenshot
  - show me the last screenshot
  - view the captured image
  - display the screenshot
positive_terms:
  - open
  - show
  - view
  - display
required_context:
  - recent_screenshot_path
negative_examples:
  - take a screenshot
  - capture my screen
  - describe the screenshot
```

---

# Scoring Model

A simple combined score is enough:

```text
final_score =
  metadata_match_score
+ bm25_score
+ embedding_score
+ action_verb_score
+ context_score
- negative_example_penalty
```

But metadata and preconditions should behave more like gates than soft hints.

For example:

```text
If required_context is missing:
    do not execute directly
```

And:

```text
If intent family does not match broad gate:
    remove candidate
```

---

# Ambiguity Handling

Pig should abstain when confidence is weak.

Rules:

```text
if top_score < threshold:
    fallback_to_gemma

if top_score - second_score < margin:
    fallback_to_gemma_or_clarify

if required_context_missing:
    fallback_to_gemma_or_clarify

if top positive match and top negative match are both high:
    mark ambiguous
```

Example ambiguous utterance:

```text
"show me the screen"
```

Could mean:

```text
- take a screenshot
- open recent screenshot
- describe current screen
```

Pig should not guess unless context makes one option obvious.

---

# What Embeddings Should Index

Embeddings should index **intent examples**, not only skill descriptions.

Bad:

```text
"Screenshot skill: handles screenshots."
```

Good:

```text
"take a screenshot"                 → screen.capture
"grab my current screen"            → screen.capture
"open the screenshot"               → screen.open_last_capture
"show me the last screenshot"       → screen.open_last_capture
"describe what is on my screen"     → screen.describe_current
"look at this image"                → image.describe
```

This lets embeddings help with semantic recall while still routing to concrete deterministic intents.

---

# Minimal Implementation Goal

The next version should not be a giant rewrite.

Recommended first milestone:

```text
1. Keep current BM25/metadata router.
2. Add intent-level positive_examples and negative_examples.
3. Embed those examples into a small local vector index.
4. Use metadata to restrict candidate intents before embedding search.
5. Combine BM25 + embedding score.
6. Add required_context checks before execution.
7. Add abstain/fallback behavior.
8. Add regression tests for confusing phrases.
```

---

# Regression Test Examples

The implementation should correctly distinguish these:

```text
"how are you today"           → normal_chat
"how is the weather today"    → weather.lookup

"take a screenshot"           → screen.capture
"open the screenshot"         → screen.open_last_capture
"show me the last screenshot" → screen.open_last_capture
"describe the screenshot"     → image/screen describe intent
"look at my screen"           → screen.describe_current or screen.capture_then_describe

"move window up"              → i3.move_window_up
"move workspace up"           → workspace/navigation intent, not window move
```

---

# Final Design Summary

Pig’s router should be staged:

```text
Metadata decides what is allowed.
BM25 rewards exact operational wording.
Embeddings recover paraphrases.
Preconditions prevent invalid execution.
Gemma handles ambiguity.
```

Embeddings are useful, but they should be treated as a **semantic helper inside a constrained routing system**, not as the main decision-maker.

