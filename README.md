# pig-classifier-intent-router

Pig extension package for routing voice/audio transcripts and other Pig input through a deterministic-affordance classifier in Pig's input layer.

Core question:

```text
Does this transcript confidently match one of our known deterministic affordances?
```

If yes, use the deterministic path. If no, send the transcript as a normal Pig/Gemma message.

## Router shape

The router is intentionally split into three nodes:

```text
1. Broad family gate
   → deterministic | normal_msg

2. Metadata/BM25 selector
   → choose the best matching Pi-discovered skill/intent inside the matched family

3. Execution gate
   → direct_exec if metadata says a script is safe and the request is exact enough
   → otherwise pi_skill contextual path
```

Current implementation is staged deterministic code: Pi discovers skills, the router reads adjacent `routing.json`/`direct-exec.json` metadata, applies broad family gates, scores eligible skill/intent metadata with lightweight BM25, checks required context, and thresholds direct execution. Planned refactor: move the selector toward a typed command compiler for deterministic computer-use domains.

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

Routing and direct-exec metadata are loaded beside each discovered skill's `sourceInfo.baseDir`.

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
resolveSkill(name, resources.catalog)
buildSkillUserMessage(skill, text)
runDirectExecAction(candidate, timeoutMs, resources.actions)
buildDirectExecResultMessage(decision, result)
logVoiceRouteDecision(decision)
```

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
