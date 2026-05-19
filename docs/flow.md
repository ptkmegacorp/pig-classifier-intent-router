# Pig Classifier Intent Router Flow

```mermaid
flowchart TD
    A[Voice/audio transcript] --> B[pi-voice-vad-gemma normalizes text]
    B --> C[pi.sendUserMessage cleaned text]
    C --> D0[Pig input event hook]
    D0 --> D[pig-classifier-intent-router]
    D --> E0[Broad rules gate]
    E0 --> E1{Broad bucket}
    E1 -- normal_msg --> I[sendUserMessage transcript]
    E1 -- deterministic --> E[Deterministic selector: rules now / embeddings later]
    E --> X{Execution gate}
    X -- exact + safe metadata --> J[Execute opted-in script]
    X -- contextual skill --> G[Expand selected SKILL.md block]
    X -- not confident --> I
    G --> H[sendUserMessage skill block + transcript]
    H --> K[Pig model follows loaded skill]
    J --> R[Transform to compact script-result prompt]
    R --> L
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
