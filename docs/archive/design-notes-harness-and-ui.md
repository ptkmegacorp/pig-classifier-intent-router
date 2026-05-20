# Design notes: harness boundary, UI mapping, and side channels

Saved from design discussions (May 2026).

---

## Part 1 — Code/ML boundary and UI mapping

### The meeting point

You have three layers, not two:

| Layer | What it is | Example |
|-------|------------|---------|
| **Deterministic** | Known affordance, safe script, fixed I/O | Router → `take-screenshot.sh` → paths |
| **Orchestration** | When to invoke which layer; shape of the turn | `direct_exec` vs `pi_skill`, attach image vs “call read” |
| **Neural** | Language, intent nuance, visual reasoning | Gemma interprets pixels, answers “what’s on screen?” |

“Normal code” owns **safety and side effects**. The neural net owns **judgment under ambiguity**. The interesting line is **orchestration**: who decides *that vision should happen this turn*?

### Two philosophies at that line

**Push pixels up (harness decides)**  
Capture → attach image to the user turn. The model never “discovers” vision; it only reasons.  
→ High reliability, less tool literacy, more tokens.

**Push procedure down (model decides)**  
Capture → paths in text → SKILL says “call `read`”.  
→ Cheaper, more flexible, fails when priors beat instructions (`direct_exec` + “don’t invent” is especially toxic here).

Neither is pure ML nor pure code. **Orchestration is the contract** between them.

### How to think about it

1. **Affordance vs execution**  
   Router answers: “Is this screenshot-shaped?” (affordance).  
   It should not answer: “What’s in the image?” (neural).  
   Blurring that is why `direct_exec` capture + “describe the screen” breaks.

2. **Commitment point**  
   Every turn has a moment where the harness **commits** to what the model sees:  
   - text only  
   - text + paths  
   - text + pixels  
   After that, prompting is damage control.

3. **Skills are compiled hints, not guarantees**  
   SKILL.md is soft policy for a stochastic executor.  
   Hard guarantees need code: routing rules, attach-image, or a mandatory tool step the harness enforces.

4. **The neural part is not “the model” only**  
   Embeddings/reranking in the router (later) are also neural—but **offline, bounded, auditable**.  
   Live Gemma is neural **online, unbounded**.  
   Put offline ML on *routing*; put online ML on *interpretation*.

5. **Failure modes tell you who should own what**  
   - Wrong skill chosen → improve router (code/embedding).  
   - Right capture, no vision → orchestration (attach or forced read).  
   - Vision but wrong description → model/temperature/prompt.

### A simple rule of thumb

> **Code picks the affordance and prepares evidence.  
> The harness commits evidence to the turn.  
> The model only judges what’s already in front of it.**

`read` is not “file I/O”—it’s the **handoff from filesystem to perception**. Whether that handoff is automatic (attach) or tool-gated (`read`) is the design choice on the line.

For voice + Gemma, bias toward **harness commits pixels** for inspect intents; keep **model chooses tools** for open-ended coding. Same stack, different commitment points per affordance.

---

## You’re building a prosthetic UI

A normal UI maps **motor intent → widgets → app behavior**.  
Your stack maps **sensory + linguistic intent → affordances → harness/model behavior**.

Voice, screenshot, weather aren’t “features” in the app sense—they’re **channels** from your nervous system into the machine:

| You (biological) | Machine (prosthetic) |
|------------------|----------------------|
| Hear / say | VAD + transcript |
| Look / “what’s on screen” | Screenshot + vision context |
| Want weather before going out | `weather` script |
| Vague “help with this” | Full Gemma reasoning |

The intent router is the analog of **pre-attentive filtering**: before full thought, you already know “this feels like weather” vs “this needs real thinking.”

### The mirror isn’t 1:1—it’s layered

Humans don’t run one process:

1. **Reflex** — “screenshot” → hand moves (low latency, low cognition)  
2. **Habit** — open viewer, glance, answer from memory  
3. **Deliberation** — read the scene, infer, explain

Your stack mirrors that:

- **`direct_exec`** ≈ reflex (script, paths, done)  
- **`pi_skill`** ≈ habit with a checklist (SKILL.md procedure)  
- **`normal_msg`** ≈ full deliberation (open conversation with Gemma)

The friction you hit (Gemma won’t `read` the image) is where the mirror **skips a layer**: you looked (capture happened) but the “cognitive” side wasn’t given the same sensory input you’d have after opening your eyes.

### UI design question, not ML question

So the design question becomes:

> **At which layer should sensation become available to “thought”?**

- **Before the model** (attach image, auto-ingest) = sensation is *given*, like vision you can’t un-see  
- **After the model chooses** (`read` tool) = sensation is *available*, like knowing you can look and choosing to  

Both are valid UIs. Reflex paths want the first; exploratory coding wants the second.

### “Nerve endings” vs “cognition”

Rough mapping:

- **Nerve endings** — mic, desktop pixels, phone camera, logs on disk. Raw signals.  
- **Affordance detection** — router + keywords + (later) embeddings. “What kind of moment is this?”  
- **Motor programs** — skills + scripts. Reliable sequences.  
- **Cognition** — Gemma on whatever made it into the turn.

You’re not replacing your cognition—you’re **outsourcing motor programs and sometimes perception**, while keeping judgment where ambiguity lives.

### One sentence to hold onto

**The harness is the somatosensory + motor cortex; the model is association cortex—only as good as what actually reached it.**

Stepping back: you’re designing how *your* perception-action loop gets compiled into a machine loop. The line between code and neural net is exactly where **sensation turns into something thinkable**—same problem biology solved with eyes → thalamus → cortex, just with files and tokens instead.

---

## Part 2 — Side convo, terminal control, and Pi/Pig channels

### Is there a “side convo” in Pi/Pig?

**Not as a first-class “second chat thread.”** Pi is one session tree, one agent loop per user prompt. What you want is closer to **preflight orchestration**: harness does work, then shapes what the model sees—or skips the model entirely.

Pi gives you several **layers of that**, from most “reflex” to most “dialogue”:

#### 1. Harness-only (no model) — terminal *is* the UI

`input` → `{ action: "handled" }`: extension runs `ls`, paints your terminal widget, done. User never talks to Gemma for “show files.”

That’s not a side convo; it’s **UI code**. Best when the affordance is fixed (“list files here”) and you don’t need interpretation.

#### 2. Same turn, hidden context — “side channel into one mind”

`before_agent_start` can inject a **`custom_message`** with `display: false`. It **enters LLM context** but not the TUI (session-format docs).

Pattern: user says “show me files” → harness runs `ls` → inject hidden block: `TERMINAL_STATE: …` → Gemma replies in character *with ground truth already there*.

That’s the closest thing to a **silent side task**: not a second conversation, but **extra messages only the model eats**. One cognition pass, two producers (harness + user).

Also: `input` **transform** can prepend terminal output to the user text before the loop starts—same idea, even more invisible.

#### 3. Model tool loop — “side convo” as tool rounds

Classic Pi: Gemma calls `bash`/`read`, harness returns results, loop continues. The “side” is **tool_result messages** in the same thread.

Your Pig setup often **disables bash** and uses `exec_skill_script` instead—so the terminal controller is really: **harness-defined tools or scripts**, not free shell. That’s intentional: motor cortex, not open loop.

#### 4. Queued second prompt — follow-up, not parallel

`sendUserMessage(..., { deliverAs: "followUp" })` runs **after** the current agent stops. That’s a **sequential** side task (“now summarize what the terminal showed”), not concurrent.

`steer` interrupts mid-stream—useful for cancellation, not silent prep.

#### 5. True separate convo — second session

`withSession` / replacement session / RPC second process = **another agent instance**. Real side convo, but heavy: two contexts, merge discipline, cost, drift.

Use when the side task needs **many model turns** (planning, debugging a command) isolated from the user-facing persona.

### Terminal example, mapped

“I want a Gemma-controlled terminal; when I ask to see files, the right `ls` runs on *its* terminal.”

Split the desire:

| Piece | Who should own it |
|--------|-------------------|
| **Which command** (ls vs find vs tree) | Harness/router if affordance is clear; Gemma if open-ended |
| **Running it** | Harness (always)—real PTY, safety, cwd |
| **Showing it** | TUI widget (not the chat transcript) |
| **Talking about it** | Gemma, only after harness injected truth |

So you usually **don’t** want Gemma to *discover* `ls` in a side thread. You want:

1. Harness runs `ls` (deterministic or policy-selected).  
2. Terminal UI updates (human nerve ending).  
3. Optional hidden inject or transform so Gemma’s *spoken* answer matches what actually ran.

That’s the same boundary as screenshots: **sensation (terminal output) committed before interpretation.**

### How to think about “side convo” architecturally

Treat it as **three channels**, not two chats:

```
User utterance  ──►  [Channel A: visible chat]
Harness reflex  ──►  [Channel B: terminal / screenshots / widgets]
Synthesis       ──►  [Channel C: what Gemma is allowed to reason on]
```

Pi merges B→C via transform, hidden `custom_message`, or tool results. Channel A stays clean for the human.

A **real** side convo (two models talking) is rarely what you want for a terminal—it’s slow, opaque, and hard to keep in sync with the PTY. You want **one model, richer turn**, or **zero model** for pure UI.

### Design rule

> **Side tasks should be harness commits to context, not secret dialogues—unless the side task itself requires open-ended reasoning.**

For a Pig terminal: build **terminal state as first-class harness output**, then let Gemma be the voice *about* that state—not a second agent guessing what ran.
