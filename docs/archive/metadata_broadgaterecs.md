# Recommendation: Make Router Layers Metadata-Driven

## Scope

This recommendation covers the current deterministic routing path only:

```text
Layer 1: Broad gate
Layer 2: Skill/action selector
Layer 3: Direct-exec safety gate
```

Do not add new model-based routing, training, embedding recall, or broader architecture changes. The goal is to move skill-specific routing language out of router source code and into skill-owned metadata.

---

## Current Router Shape

The router currently works like this:

```text
user transcript
→ Layer 1: broad gate decides deterministic-ish vs normal_msg
→ Layer 2: selector chooses the closest skill/affordance
→ Layer 3: execution gate chooses direct_exec if safe/exact enough, otherwise pi_skill or normal_msg
```

This shape is correct. The problem is that some skill-specific matching terms still live directly in router code.

---

## Desired Design

Each skill should own its own routing metadata.

The router should be generic:

```text
load skills
→ read routing metadata
→ build broad-gate and selector indexes
→ read direct-exec metadata
→ enforce safety gate
```

The router should not contain hardcoded aliases for specific skills such as `take-screenshot`.

---

## Layer 1: Broad Gate

Layer 1 answers only this question:

```text
Does this transcript look like a possible known skill/tool affordance?
```

It does not choose the final skill and does not execute anything.

Layer 1 should build its known terms from skill metadata:

```json
{
  "routing": {
    "enabled": true,
    "deterministicAffordance": true,
    "examples": [
      "take a screenshot",
      "capture my screen",
      "grab a screenshot"
    ],
    "keywords": [
      "screenshot",
      "screen shot",
      "screen capture",
      "desktop",
      "display"
    ],
    "negativeExamples": [
      "what is a screenshot",
      "explain how screenshots work"
    ]
  }
}
```

For this pass, keep Layer 1 simple: normalize text, check phrases/tokens from metadata, and return either `deterministic` or `normal_msg`.

---

## Layer 2: Skill / Affordance Selector

Layer 2 runs only after Layer 1 says the input is deterministic-ish.

Layer 2 answers:

```text
Which skill is the closest match?
```

The existing scoring style can remain simple for now:

```text
phrase match > token match
best score must pass threshold
best score must beat second-best by margin
```

The important change is that Layer 2 should also use skill-owned metadata, not hardcoded router aliases.

For `take-screenshot`, the selector should score against:

```text
skill name
skill description
routing.examples
routing.keywords
```

The router should no longer need code like:

```ts
SKILL_ALIASES["take-screenshot"] = [...]
```

Skill-specific routing language belongs in the skill metadata.

---

## Layer 3: Direct-Exec Gate

Layer 3 answers:

```text
Is this request safe and exact enough to run directly?
```

This layer should remain separate from Layer 1 and Layer 2.

Routing metadata may say:

```text
this skill may be relevant
```

It must not imply:

```text
execute this command now
```

Direct execution should continue to come from explicit direct-exec metadata, such as `direct-exec.json`.

Example shape:

```json
{
  "actions": [
    {
      "id": "take-screenshot.capture",
      "description": "Capture the current screen.",
      "script": "scripts/capture.sh",
      "directExec": true,
      "safety": "local_capture",
      "requiresConfirmation": false,
      "defaultArgs": [],
      "keywords": ["screenshot", "capture screen"],
      "exactPhrases": ["take a screenshot", "take screenshot"]
    }
  ]
}
```

The router should keep enforcing the existing safety rules:

```text
directExec must be true
requiresConfirmation must be false
safety class must be allowed
script must resolve inside the skill's scripts directory
request must score above the direct-exec threshold
```

---

## Metadata Separation

Use this separation:

```text
routing metadata:
  used by Layer 1 and Layer 2
  broad detection and skill matching only

direct-exec metadata:
  used by Layer 3
  execution permission and safety only
```

Do not merge these concepts.

---

## Implementation Goal

After this change:

```text
router source = generic loading, scoring, thresholds, safety enforcement
skill metadata = skill-specific examples, keywords, direct-exec actions
```

Improving screenshot recognition should mean editing the `take-screenshot` skill metadata, not editing router source code.

---

## Acceptance Criteria

The implementation is successful if:

1. `take-screenshot` aliases/examples are removed from hardcoded router aliases.
2. `take-screenshot` still routes obvious requests such as:

   * `take a screenshot`
   * `capture my screen`
   * `grab a screenshot`
3. Layer 2 scores skills using skill-owned routing metadata.
4. Direct execution still comes only from `direct-exec.json` or equivalent direct-exec metadata.
5. Routing metadata alone cannot grant direct-exec permission.
6. Unrelated messages still fall back to `normal_msg`.
7. The router remains generic and does not need skill-specific code for `take-screenshot`.

---

## Non-Goals

Do not implement:

* model-based routing
* training loops
* new classifier systems
* new direct-exec behavior
* broad router refactors beyond metadata-driven Layer 1 and Layer 2 cleanup

