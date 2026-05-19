# pig-classifier-intent-router

Pig extension package for routing voice/audio transcripts and other Pig input through a deterministic-affordance classifier in Pig's input layer.

Core question:

```text
Does this transcript confidently match one of our known deterministic affordances?
```

If yes, use the deterministic path. If no, send the transcript as a normal Pig/Gemma message.

## Buckets

```text
pi_skill      deterministically expand/load a Pig skill, then pass the transcript to it
direct_exec   future deterministic script/action execution; not active yet
normal_msg    safe fallback to normal Pig/Gemma message
```

## Current catalog

By default the router catalogs Pig skills from:

```text
~/.pig/agent/skills
./.pig/skills
```

Set `PI_VOICE_INCLUDE_PI_SKILLS=1` to also include normal Pi skill roots.

Current obvious Pig skill affordances include:

- `weather`
- `take-screenshot`
- `take-photo`
- `intent-router-error-log`

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
→ pi_skill expansion or normal_msg fallback
→ Pig/Gemma
```

The router also exports functions for tests/diagnostics:

```ts
routeVoiceTranscript(text)
resolveSkill(name)
buildSkillUserMessage(skill, text)
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
