Status: implemented.

Pig’s router no longer owns skill discovery. Pi owns discovery; the router consumes Pi’s discovered skill commands and adds routing intelligence on top.

## Current Boundary

The router still has three decision nodes:

```text
1. broad family gate
2. metadata/BM25 selector
3. execution gate
```

The extension contributes Pig skill paths to Pi via `resources_discover`:

```text
~/.pig/agent/skills
./.pig/skills
```

The router catalog is built from Pi-discovered skill commands:

```ts
pi.getCommands().filter((cmd) => cmd.source === "skill")
```

Pi already discovers skills from global paths, project paths, packages, settings, and CLI-added skill paths; it also recursively discovers directories with `SKILL.md`. ([GitHub][2]) Pi also exposes skill commands through `pi.getCommands()`, including `sourceInfo.path`, `scope`, `origin`, and `baseDir`, and explicitly says `sourceInfo` should be the canonical provenance field. ([GitHub][3])

So the router does not maintain its own idea of:

```text
where skills live
which root wins
what scope a skill came from
whether it is package/user/project
how to parse ownership from paths
```

Pi already does that.

---

## What the Code Reuses From Pi

### 1. Use Pi skill discovery as the catalog

The extension uses:

```ts
pi.getCommands().filter(cmd => cmd.source === "skill")
```

That gives you the discovered skill list, descriptions, paths, scope, and provenance.

Then the BM25 router indexes those skill command entries plus adjacent router metadata.

Conceptually:

```text
Pi discovered skills
        ↓
Pig router builds route index
        ↓
BM25 / embeddings rank intent examples
        ↓
Pig chooses direct_exec / pi_skill / normal fallback
```

Keep custom parsing only for extra routing metadata that Pi does not natively use.

---

### 2. Use `resources_discover` to add Pig skill paths

Instead of hardcoding Pig roots inside the router, make Pig contribute its skill paths to Pi’s resource system.

Pi extensions can return extra `skillPaths` from the `resources_discover` event. ([GitHub][3])

So Pig should do this:

```ts
pi.on("resources_discover", () => ({
  skillPaths: [
    "~/.pig/agent/skills",
    ".pig/skills"
  ]
}));
```

Then Pi owns discovery.

Your router later reads from `pi.getCommands()`.

This makes Pig skills first-class Pi skills instead of a parallel universe.

---

### 3. Keep using Pi’s `input` event

You already did this correctly. Your repo says the extension uses Pi/Pig’s `input` event hook and that the voice package does not need to import the router. ([GitHub][1]) Pi’s docs confirm the `input` event fires before skill/template expansion and can intercept, transform, or handle the prompt. ([GitHub][3])

So keep:

```text
voice transcript
→ pi.sendUserMessage(text)
→ Pig input event
→ router
→ direct_exec / skill expansion / normal Gemma message
```

Do **not** build a separate voice dispatcher that bypasses Pi.

---

### 4. Keep package/extension packaging

Your package already declares itself as a Pi package/extension through the `pi.extensions` manifest. ([GitHub][4]) Pi packages already support conventional `extensions/`, `skills/`, `prompts/`, and `themes/` directories. ([GitHub][5])

So embeddings should be added as an extension dependency/service inside this package, not as a Pig core modification.

Correct shape:

```text
pig-classifier-intent-router
  ├── extension entrypoint
  ├── route index builder
  ├── bm25 scorer
  ├── embedding scorer
  └── direct_exec validator
```

Not:

```text
modify Pig core
fork Pi discovery
fork skill registry
fork command system
```

---

## What not to replace

Do **not** replace your direct execution safety gate with Pi’s normal LLM tool system.

Pi has `registerTool()` for tools the LLM can call, and those tools appear in the model-facing tool system. ([GitHub][3]) But your use case is different: you want the router to deterministically run safe scripts **before** handing ambiguity to Gemma.

So keep a custom `direct_exec` layer.

But change where metadata lives.

Better:

```text
Pi owns skill discovery.
Pig owns deterministic direct_exec eligibility.
```

---

## Best metadata location

Right now you use separate `direct-exec.json`.

That is okay, but the cleaner version is probably:

```text
SKILL.md
direct-exec.json
scripts/
```

with Pi discovering the skill, and Pig only looking for extra routing/direct-exec metadata beside the discovered `SKILL.md`.

Example:

```text
~/.pig/agent/skills/take-screenshot/
  SKILL.md
  direct-exec.json
  scripts/capture.sh
```

Pi discovers `take-screenshot`.

Pig router sees the Pi skill command, then checks:

```text
sourceInfo.baseDir/direct-exec.json
```

That avoids hardcoded roots while preserving your safety system.

---

## Revised architecture

```text
Pi resource system
  discovers skills/packages/settings/paths
        ↓
Pig router extension
  reads pi.getCommands(source=skill)
        ↓
builds route index
  skill name
  description
  sourceInfo.path
  sourceInfo.baseDir
  optional route metadata
  optional direct-exec metadata
        ↓
input event
  BM25 + embeddings + metadata scoring
        ↓
decision
  direct_exec
  pi_skill expansion
  normal Gemma fallback
```

---

## What you are unnecessarily recreating

```text
Skill root discovery        → use Pi resources_discover + Pi discovery
Skill provenance/scope      → use command.sourceInfo
Skill command registry      → use pi.getCommands()
Skill package integration   → use Pi package manifest/conventions
Input interception           → already using Pi input event; keep it
Reload/resource lifecycle    → use Pi /reload + resources_discover
```

## What should stay custom

```text
Broad gate
BM25 scoring
Embedding example index
Negative examples
Confidence/margin thresholds
direct_exec safety policy
Precondition checks
Training/error log harvesting
```

The blunt summary:

```text
Pi should own "what capabilities exist and where they came from."

Pig router should own "does this utterance confidently select one of them?"
```

That is the cleaner boundary.

[1]: https://github.com/ptkmegacorp/pig-classifier-intent-router "GitHub - ptkmegacorp/pig-classifier-intent-router · GitHub"
[2]: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md "pi/packages/coding-agent/docs/skills.md at main · earendil-works/pi · GitHub"
[3]: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md "pi/packages/coding-agent/docs/extensions.md at main · earendil-works/pi · GitHub"
[4]: https://raw.githubusercontent.com/ptkmegacorp/pig-classifier-intent-router/refs/heads/master/package.json "raw.githubusercontent.com"
[5]: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md "pi/packages/coding-agent/docs/packages.md at main · earendil-works/pi · GitHub"
