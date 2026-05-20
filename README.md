# pig-classifier-intent-router

Pig extension package for routing voice/audio transcripts and other Pig input through a deterministic-affordance classifier in Pig's input layer.

Core question:

```text
What typed command, if any, is this transcript requesting?
```

If the compiler validates, resolves, and lowers a command, Pig uses the deterministic path. If not, the transcript continues as a normal Pig/Gemma message.

## Compiler shape

The router is now a thin extension wrapper around a typed command compiler:

```text
input eligibility is handled by the Pig input hook
→ extractor stack
   - temporary exact/rule extractor
   - metadata BM25 extractor over `compiler.json` intent metadata
   - optional FastEmbed embedding extractor over the same metadata (`PIG_ENABLE_EMBEDDING_EXTRACTOR=1`)
→ CommandIR candidate selection
→ typecheck
→ Pig command state / reference resolution
→ preconditions
→ table-driven lowering
→ direct_exec or pi_skill
→ otherwise normal_msg
```

BM25 and embeddings are now extractors, not routers. They emit `CommandIRCandidate`s from `compiler.json` metadata evidence; they do not select scripts or bypass compiler validation. The first exact/rule extractor is intentionally a placeholder; the important pieces now in place are CommandIR, stackable async extractor boundaries, metadata BM25 extraction, optional FastEmbed semantic extraction, Pig command state, typechecking, reference resolution, metadata-driven preconditions, table-loaded lowering to existing safe direct-exec actions, and compiler trace logging.

## Buckets

```text
deterministic  known affordance; then executionMode chooses pi_skill or direct_exec
normal_msg     safe fallback to normal Pig/Gemma message

executionMode=pi_skill     expand/load a Pig skill, then pass the transcript to it
executionMode=direct_exec  run an explicitly opted-in safe script, then pass compact result to Gemma

Current accepted metadata safety classes: `read_only_network`, `read_only_local`, and `local_capture`.
```

## Current Catalog

Pi owns skill discovery. This extension contributes Pig skill paths through `resources_discover`:

```text
~/.pig/agent/skills
./.pig/skills
```

At route time, the extension builds its route resources from:

```ts
pi.getCommands().filter((command) => command.source === "skill")
```

Routing, compiler, and direct-exec metadata are loaded beside each discovered skill's actual `SKILL.md` path. `compiler.json` owns language-to-IR metadata and lowering/precondition rules; `direct-exec.json` owns safe script eligibility.

Current obvious Pig skill affordances include:

- `weather`
- `take-screenshot`
- `take-photo`
- `intent-router-error-log`

Refactor guide:

```text
docs/refactor-to-command-compiler.md
```

## Integration with voice/audio input

This extension uses Pi/Pig's documented `input` event hook. That hook exists and fires for typed/RPC/extension-injected messages before skill/template expansion. Therefore the voice package does **not** need to import this router.

Flow:

```text
pi-voice-vad-gemma
→ mic/VAD/audio/Gemma transcription
→ cleaned transcript
→ pi.sendUserMessage(cleaned text)
→ Pig input event
→ pig-classifier-intent-router
→ deterministic direct_exec or pi_skill transform, else normal_msg fallback
→ Pig/Gemma
```

The router also exports functions for tests/diagnostics:

```ts
loadRouteResourcesFromCommands(commands)
routeVoiceTranscript(text, resources)
compileVoiceCommand(text, resources)
resolveSkill(name, resources.catalog)
buildSkillUserMessage(skill, text)
runDirectExecAction(candidate, timeoutMs, resources.actions)
buildDirectExecResultMessage(decision, result)
logVoiceRouteDecision(decision)
```

## Development

```bash
npm run check
npm test
```

`npm test` builds TypeScript and runs the compiler smoke regressions in `tests/compiler-smoke.mjs`.

## Commands

The extension provides diagnostic commands:

```text
/intent-route <text>   show bucket decision
/intent-send <text>    route text and send it to Pig
```

## Logs and training-process data

Runtime route decisions are written to:

```text
~/.pi/voice-dispatcher.jsonl
```

Override with:

```text
PI_VOICE_DISPATCH_LOG=/path/to/log.jsonl
PI_VOICE_DISPATCH_LOG_DISABLE=1
```

The related Pig skill is:

```text
~/.pig/agent/skills/intent-router-error-log
```

That skill is part of this workflow. It deterministically executes:

```text
scripts/router-log.sh harvest
```

and writes compact harvested process/RLHF data into:

```text
/home/bot/projects/classifiers/classifier-pi-skills/collected-training-process-data/
```

## Notes

This package is intentionally separate from Pig core. It is an extension/package-level router that can be iterated without changing Pig internals.
