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
    E1 -- direct_exec later --> J[Execute deterministic action/script]
    E1 -- pi_skill --> E[Catalog skill selector: rules now / embeddings later]
    E --> F{Confident skill?}
    F -- yes --> G[Expand selected SKILL.md block]
    F -- no --> I
    G --> H[sendUserMessage skill block + transcript]
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
