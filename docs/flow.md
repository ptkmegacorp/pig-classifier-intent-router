# Pig Classifier Intent Router Flow

```mermaid
flowchart TD
    A[Voice/audio transcript] --> B[pi-voice-vad-gemma normalizes text]
    B --> C[pi.sendUserMessage cleaned text]
    C --> D0[Pig input event hook]
    D0 --> D[pig-classifier-intent-router]
    D --> E0[Known deterministic affordance catalog]
    E0 --> E[Rule scorer now / embeddings later]
    E --> F{Confident bucket?}
    F -- pi_skill --> G[Expand selected SKILL.md block]
    G --> H[sendUserMessage skill block + transcript]
    F -- normal_msg --> I[sendUserMessage transcript]
    F -. future direct_exec .-> J[Execute deterministic action/script]
    H --> K[Pig model follows loaded skill]
    I --> L[Pig/Gemma normal response]
    C -. JSONL .-> M[~/.pi/voice-dispatcher.jsonl]
    M --> N[intent-router-error-log skill]
    N --> O[collected-training-process-data]
```

Related deterministic harvest skill:

```text
/home/bot/.pig/agent/skills/intent-router-error-log
```

That skill should only run its script and report printed paths/counts.
