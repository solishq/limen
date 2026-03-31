# VOICE IDENTITY DESIGN: Two Voices, One Soul

**Date**: 2026-03-30
**Author**: SolisHQ Research (Researcher Agent)
**Classification**: Implementation Blueprint -- Voice Identity & Synthesis Pipeline
**Status**: Ready for Engineering
**Predecessor**: VOICE_SYNTHESIS_RESEARCH.md (foundational research)
**Confidence Level Key**: [CONFIRMED] = multiple independent sources; [LIKELY] = strong evidence, <3 sources; [UNCERTAIN] = single source or inference; [DERIVED] = first-principles reasoning from confirmed facts

---

## Table of Contents

1. [Part 1: Voice Identity Specifications](#part-1-voice-identity-specifications)
2. [Part 2: Qwen3-TTS Voice Description Engineering](#part-2-qwen3-tts-voice-description-engineering)
3. [Part 3: Kokoro-82M Interim Voice Selection](#part-3-kokoro-82m-interim-voice-selection)
4. [Part 4: Implementation Architecture](#part-4-implementation-architecture)
5. [Part 5: Installation & Setup](#part-5-installation--setup)
6. [Part 6: Voice Design Experiment Protocol](#part-6-voice-design-experiment-protocol)
7. [Part 7: Voice Personality Engine (Future)](#part-7-voice-personality-engine-future)
8. [Appendix A: Qwen3-TTS Description Reference](#appendix-a-qwen3-tts-description-reference)
9. [Appendix B: Sources](#appendix-b-sources)

---

## Part 1: Voice Identity Specifications

### 1.1 Voice 1: "Solis" (Default Voice)

**Character**: The grounded intelligence. The voice of a brilliant friend who happens to be an engineer.

| Attribute | Specification | Rationale |
|-----------|--------------|-----------|
| Gender | Male | Engineering-grade AI partner positioning (not assistant). Research confirms male voices signal authority + expertise for technical contexts |
| Perceived Age | 32-38 | Sweet spot: mature enough for trust, young enough for dynamism. "Experienced colleague" archetype |
| Timbre | Mid-range, warm, slightly resonant | Not deep-authoritative (sounds corporate), not young-casual (lacks gravitas) |
| Fundamental Frequency | F0: 110-125 Hz | Mid-range male. Lower than average conversation (~130 Hz) but not bass |
| Breathiness | Slight, on softer/transitional words only | Increases perceived warmth and humanness without sounding tired |
| Speaking Rate | ~155 WPM baseline | Slower than average (~160 WPM). Deliberate, unhurried. Signals confidence |
| Pitch Variation | Moderate | Not monotone (robotic), not sing-song (affected). Natural conversational range |
| Prosody: Conclusions | Slight pitch drop at statement ends | Signals confidence, definiteness. "I know what I'm saying" |
| Prosody: Questions | Natural pitch rise | Signals genuine curiosity, not uncertainty |
| Breathing | Subtle, natural, present at pause points | Crosses uncanny valley -- makes voice feel embodied without drawing attention |
| Micro-pauses | Before important words (150-300ms) | Emphasis through timing, not volume. Creates anticipation |
| Emotional Range | Confidence, empathy, curiosity, honest uncertainty | Core states. See Section 1.3 for full mapping |
| Accent | Neutral International English | Not regional. Understood globally. Closest to neutral American |
| Vocal Fry | None | Signals fatigue or affectation. Neither belongs in Solis |
| Uptalk | None | Undermines authority. Solis makes statements, not seeks approval |

### 1.2 Voice 2: "Nova" (Complement Voice)

**Character**: The illuminating presence. The voice that makes complex things feel simple.

| Attribute | Specification | Rationale |
|-----------|--------------|-----------|
| Gender | Female | Complementary to Solis. Research: female voices preferred for assistance/navigation/clarity contexts |
| Perceived Age | 28-35 | Slightly younger than Solis. Energetic but not juvenile |
| Timbre | Clear, resonant, precise | "Crystal" quality. Each word lands with clarity |
| Fundamental Frequency | F0: 185-210 Hz | Mid-range female. Not high (sounds young), not low (competes with Solis) |
| Breathiness | Minimal | Nova is about precision and clarity. Breath sounds minimal |
| Speaking Rate | ~165 WPM baseline | Slightly faster than Solis. More dynamic, more alive |
| Pitch Variation | More melodic than Solis | Greater range. Key words get pitch emphasis. The "discovery" voice |
| Prosody: Key Words | Pitch lift on important terms | Draws attention to what matters. "This is the insight" |
| Prosody: Lists | Rising on items, falling on final | Natural enumeration pattern. Signals structure |
| Breathing | Subtle | Less prominent than Solis. Nova flows more |
| Micro-pauses | Shorter, crisper (100-200ms) | Faster overall rhythm. Pauses are punctuation, not meditation |
| Emotional Range | Enthusiasm, precision, warmth, gentle authority | Core states. See Section 1.3 |
| Accent | Neutral International English | Same as Solis. Consistent brand |
| Vocal Fry | None | Same prohibition as Solis |
| Uptalk | None | Same prohibition. Nova illuminates, doesn't ask for permission |

### 1.3 Shared Emotional Range

Both voices must express these emotional states, adapted to their character:

| Emotion | Solis Expression | Nova Expression | Use Case |
|---------|-----------------|-----------------|----------|
| **Confidence** | Steady, grounded, unhurried | Clear, definitive, precise | Default speaking mode |
| **Warmth** | Slight softening, breath support | Brighter pitch, gentle pace | Greetings, positive confirmations |
| **Empathy** | Lower pitch, slower pace, softer | Warmer tone, measured pace | Error acknowledgment, apologies |
| **Curiosity** | Rising inflection, slight tempo increase | Melodic questioning, engaged | Clarifying questions, exploration |
| **Urgency** | Firmer, slightly faster, compressed dynamics | Crisper, faster, emphasis on verbs | Alerts, time-sensitive info |
| **Calm Authority** | Measured pace, even dynamics, deep support | Steady, clear, deliberate | Complex explanations |
| **Honest Uncertainty** | Slight pause, qualified tone, transparent | Measured pace, acknowledging tone | When the system doesn't know |
| **Excitement** | Subtle energy, slightly faster, brighter | More melodic, rising dynamics | Achievements, discoveries |

### 1.4 Shared Anti-Patterns (What Neither Voice Does)

- No filler words ("um", "uh", "like") -- these signal dishonesty in AI voices
- No vocal fry -- signals fatigue or affectation
- No uptalk -- undermines authority
- No affect/performance -- both voices sound like they're thinking, not acting
- No mimicry of real people -- both are synthetically designed, unique entities
- No exaggerated emotion -- subtlety is the rule. A slight shift > a dramatic shift
- No interrupting/talking-over patterns (system-level, not voice-level)

---

## Part 2: Qwen3-TTS Voice Description Engineering

### 2.1 How Qwen3-TTS Voice Design Works

[CONFIRMED] Qwen3-TTS provides three models in its family, each serving a different voice creation method:

| Model | Purpose | How It Works |
|-------|---------|--------------|
| **Qwen3-TTS-12Hz-1.7B-VoiceDesign** | Create new voices from text descriptions | `generate_voice_design(text, language, instruct)` |
| **Qwen3-TTS-12Hz-1.7B-CustomVoice** | Use preset voices with emotion/style control | `generate_custom_voice(text, language, speaker, instruct)` |
| **Qwen3-TTS-12Hz-1.7B-Base** | Clone voices from 3-second audio samples | `generate(text, voice, language)` |

For SolisHQ voice creation, the **VoiceDesign** model is the primary tool. It generates speech in a voice described by natural language -- no reference audio needed.

### 2.2 Writing Effective Voice Descriptions

[CONFIRMED] Alibaba's official documentation and community experience establish these principles:

**Do:**
- Be specific: use concrete voice qualities ("deep", "crisp", "fast-paced")
- Combine multiple dimensions: gender + age + emotion + use case + vocal characteristics
- Be objective: describe physical/perceptual features, not opinions
- Be concise: eliminate redundant synonyms and intensifiers

**Do Not:**
- Use subjective terms ("nice", "normal", "good")
- Reference celebrity voices (copyright concerns, unreliable reproduction)
- Use single-dimension descriptions ("female voice" is too broad)
- Include excessive repetition or synonyms

**Controllable Dimensions:**
- Gender (male, female, neutral)
- Age (child 5-12, teenager 13-18, young adult 19-35, middle-aged 36-55, elderly 55+)
- Pitch (high, medium, low)
- Pace (fast, medium, slow)
- Emotion (cheerful, calm, gentle, serious, lively, composed, soothing)
- Vocal characteristics (magnetic, crisp, hoarse, mellow, sweet, rich, powerful)
- Use case context (news broadcast, narration, voice assistant, documentary)

### 2.3 The Solis Voice Description (Qwen3-TTS VoiceDesign instruct)

After analyzing the controllable dimensions, cross-referencing the Solis character specification, and studying effective voice description patterns from the documentation, these are the engineered descriptions.

**Primary Description (recommended starting point):**

```
A composed young man in his mid-thirties with a warm, rich baritone voice. Medium-low pitch with natural resonance. Speaks at a measured, unhurried pace with clear articulation. Confident and grounded tone, neither formal nor casual. Slight natural breathiness on softer words adds warmth. Moderate pitch variation -- conversational and genuine, not monotone or dramatic. Suitable for technical explanation, thoughtful conversation, and calm guidance.
```

**Variant A (emphasizing warmth):**

```
Warm, confident male voice, mid-thirties, with a mellow baritone timbre and natural resonance. Steady speaking pace, clear diction. Slight breathiness adds approachability. The tone conveys expertise without coldness -- like a brilliant colleague explaining something he genuinely cares about.
```

**Variant B (emphasizing authority):**

```
A mature male voice with a rich, grounded baritone. Clear and authoritative but not stern. Mid-thirties, medium-low pitch, measured pace. Natural prosody with slight pitch drops at conclusions signaling confidence. Articulate and precise, suitable for engineering guidance and technical narration.
```

**Variant C (emphasizing approachability):**

```
Young adult male, warm and engaging, mid-range pitch with gentle resonance. Speaks thoughtfully with natural pauses. Not hurried, not sluggish. A friendly, intelligent tone -- the voice of someone who listens before speaking. Slight warmth in the timbre, clear articulation.
```

**Emotional Instruct Overlays (used with CustomVoice after base voice is locked):**

```
# For empathetic/apologetic delivery:
Speak with gentle empathy and a slightly slower pace, as if acknowledging difficulty

# For urgent/alert delivery:
Speak with measured urgency, slightly faster pace, firm and clear without alarm

# For curious/questioning delivery:
Speak with genuine curiosity, rising inflection on questions, engaged and attentive

# For excited/positive delivery:
Speak with restrained enthusiasm, slightly brighter tone, as if sharing good news
```

### 2.4 The Nova Voice Description (Qwen3-TTS VoiceDesign instruct)

**Primary Description (recommended starting point):**

```
A clear, bright female voice in her early thirties. Medium pitch with melodic variation -- not sing-song, but alive with natural emphasis. Speaks at a slightly brisk, articulate pace. Precise diction with a crystalline quality. Confident and warm, with a tone that makes complex ideas feel accessible. Suitable for clear explanation, insightful commentary, and engaged conversation.
```

**Variant A (emphasizing clarity):**

```
Precise, clear-voiced young woman with a resonant, medium-pitched tone. Articulate and crisp, with natural melodic variation that highlights key words. Confident delivery at a slightly faster pace. The voice of insight and discovery -- making the complex feel simple.
```

**Variant B (emphasizing warmth):**

```
A warm, intelligent female voice, early thirties, with a clear and resonant timbre. Medium pitch with expressive but controlled variation. Slightly faster than conversational pace, maintaining clarity throughout. Approachable authority -- the voice of someone who loves what she knows.
```

**Variant C (emphasizing dynamism):**

```
Energetic and precise young woman with a bright, clear voice. Medium-high pitch with pronounced melodic emphasis on key concepts. Brisk but never rushed. Each word lands with purpose. The voice that illuminates -- enthusiasm controlled by precision.
```

### 2.5 Voice Design to Voice Clone Pipeline

[CONFIRMED] The recommended workflow for locking a voice identity:

```
Step 1: VoiceDesign Model
  ├── Input: text + instruct description
  ├── Output: reference audio clip (5-15 seconds)
  └── Iterate: modify description, regenerate, compare

Step 2: Create Voice Clone Prompt
  ├── Input: best reference audio from Step 1
  ├── Function: create_voice_clone_prompt()
  └── Output: reusable voice_clone_prompt object

Step 3: Production Use via Base Model
  ├── Input: text + voice_clone_prompt
  ├── Function: generate_voice_clone()
  └── Output: any text spoken in the designed voice

This pipeline means:
  - Voice design happens ONCE (iterative, experimental)
  - Production synthesis uses the locked voice_clone_prompt
  - The voice identity is encoded in the prompt, not re-described each time
  - The voice_clone_prompt IS the voice -- store it, version it, protect it
```

### 2.6 Code: Voice Design on Apple Silicon via MLX

```python
#!/usr/bin/env python3
"""
SolisHQ Voice Design Studio
Generates voice samples from text descriptions using Qwen3-TTS VoiceDesign.
Runs locally on Apple Silicon via mlx-audio.
"""

from mlx_audio.tts.utils import load_model
import soundfile as sf
import os
from datetime import datetime

# --- Configuration ---
MODEL_PATH = "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit"
OUTPUT_DIR = os.path.expanduser("~/SolisHQ/VoiceDesign/samples")

# --- Voice Descriptions ---
SOLIS_DESCRIPTIONS = {
    "primary": (
        "A composed young man in his mid-thirties with a warm, rich baritone voice. "
        "Medium-low pitch with natural resonance. Speaks at a measured, unhurried pace "
        "with clear articulation. Confident and grounded tone, neither formal nor casual. "
        "Slight natural breathiness on softer words adds warmth. Moderate pitch variation "
        "-- conversational and genuine, not monotone or dramatic. Suitable for technical "
        "explanation, thoughtful conversation, and calm guidance."
    ),
    "warm": (
        "Warm, confident male voice, mid-thirties, with a mellow baritone timbre and "
        "natural resonance. Steady speaking pace, clear diction. Slight breathiness adds "
        "approachability. The tone conveys expertise without coldness -- like a brilliant "
        "colleague explaining something he genuinely cares about."
    ),
    "authoritative": (
        "A mature male voice with a rich, grounded baritone. Clear and authoritative but "
        "not stern. Mid-thirties, medium-low pitch, measured pace. Natural prosody with "
        "slight pitch drops at conclusions signaling confidence. Articulate and precise, "
        "suitable for engineering guidance and technical narration."
    ),
    "approachable": (
        "Young adult male, warm and engaging, mid-range pitch with gentle resonance. "
        "Speaks thoughtfully with natural pauses. Not hurried, not sluggish. A friendly, "
        "intelligent tone -- the voice of someone who listens before speaking. Slight "
        "warmth in the timbre, clear articulation."
    ),
}

NOVA_DESCRIPTIONS = {
    "primary": (
        "A clear, bright female voice in her early thirties. Medium pitch with melodic "
        "variation -- not sing-song, but alive with natural emphasis. Speaks at a slightly "
        "brisk, articulate pace. Precise diction with a crystalline quality. Confident and "
        "warm, with a tone that makes complex ideas feel accessible. Suitable for clear "
        "explanation, insightful commentary, and engaged conversation."
    ),
    "clarity": (
        "Precise, clear-voiced young woman with a resonant, medium-pitched tone. "
        "Articulate and crisp, with natural melodic variation that highlights key words. "
        "Confident delivery at a slightly faster pace. The voice of insight and discovery "
        "-- making the complex feel simple."
    ),
    "warm": (
        "A warm, intelligent female voice, early thirties, with a clear and resonant "
        "timbre. Medium pitch with expressive but controlled variation. Slightly faster "
        "than conversational pace, maintaining clarity throughout. Approachable authority "
        "-- the voice of someone who loves what she knows."
    ),
    "dynamic": (
        "Energetic and precise young woman with a bright, clear voice. Medium-high pitch "
        "with pronounced melodic emphasis on key concepts. Brisk but never rushed. Each "
        "word lands with purpose. The voice that illuminates -- enthusiasm controlled by "
        "precision."
    ),
}

# --- Test Sentences (covering emotional range) ---
TEST_SENTENCES = {
    "confidence": "The architecture is sound. We've tested every boundary condition, and the system holds.",
    "warmth": "Welcome back. I've been looking forward to working on this with you.",
    "empathy": "I understand that's frustrating. Let me walk through exactly what happened and how we fix it.",
    "curiosity": "That's an interesting approach. Have you considered what happens at the boundary?",
    "urgency": "We need to address this now. The deployment window closes in forty minutes.",
    "calm_authority": "Let me explain how the pipeline works, step by step, from ingestion to output.",
    "uncertainty": "I'm not certain about this. The evidence points in two directions, and I want to be transparent about that.",
    "excitement": "We hit the target. The latency dropped below fifty milliseconds, which means real-time is solved.",
    "technical": "The function takes a promise, unwraps it, validates the schema, and returns either the typed result or a structured error.",
    "conversational": "So here's the thing -- we built it right the first time, and that saved us two weeks of rework.",
}


def generate_samples(voice_name, descriptions, test_sentences):
    """Generate all description x sentence combinations for a voice."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    model = load_model(MODEL_PATH)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    for desc_name, description in descriptions.items():
        for sent_name, sentence in test_sentences.items():
            filename = f"{voice_name}_{desc_name}_{sent_name}_{timestamp}.wav"
            filepath = os.path.join(OUTPUT_DIR, filename)

            print(f"Generating: {filename}")
            results = list(model.generate(
                text=sentence,
                voice=description,  # VoiceDesign uses the description as voice
                language="English",
            ))

            if results:
                sf.write(filepath, results[0].audio, results[0].sample_rate)
                print(f"  Saved: {filepath}")

    print(f"\nAll samples saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    import sys
    voice = sys.argv[1] if len(sys.argv) > 1 else "solis"
    if voice == "solis":
        generate_samples("solis", SOLIS_DESCRIPTIONS, TEST_SENTENCES)
    elif voice == "nova":
        generate_samples("nova", NOVA_DESCRIPTIONS, TEST_SENTENCES)
    elif voice == "both":
        generate_samples("solis", SOLIS_DESCRIPTIONS, TEST_SENTENCES)
        generate_samples("nova", NOVA_DESCRIPTIONS, TEST_SENTENCES)
    else:
        print(f"Usage: python voice_design.py [solis|nova|both]")
```

**Note**: The exact API for mlx-audio's Qwen3-TTS integration may differ from the above. The `generate()` function signature should be verified against the current mlx-audio version at runtime. The VoiceDesign model's MLX port may use `instruct` as a separate parameter rather than overloading `voice`. Verify with:

```python
from mlx_audio.tts.utils import load_model
model = load_model("mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit")
help(model.generate)
```

---

## Part 3: Kokoro-82M Interim Voice Selection

### 3.1 Why Kokoro First

Kokoro-82M serves as the immediate replacement for macOS `say` while Qwen3-TTS voices are being designed. Key advantages:
- 82M parameters, sub-300ms inference on M1 Pro
- 54 voice presets, no voice design needed
- Apache 2.0 license
- Streaming support via mlx-audio
- Voice blending between presets

### 3.2 Solis Interim Voice: Kokoro Selection

[DERIVED] Analysis of all 20 American English + 8 British English Kokoro presets:

**Male voices ranked by suitability for Solis character:**

| Voice | Grade | Traits | Solis Fit | Notes |
|-------|-------|--------|-----------|-------|
| **am_fenrir** | C+ | -- | HIGH | Best male quality. Mid-range, measured |
| **am_michael** | C+ | -- | HIGH | Good quality. Natural, conversational |
| **am_puck** | C+ | -- | MEDIUM | Slightly more energetic. Could work |
| **bm_george** | C | -- | MEDIUM | British accent. Good timbre but wrong accent |
| **bm_fable** | C | -- | LOW | British, more dramatic. Not Solis |
| **am_echo** | D | -- | LOW | Lower quality |
| **am_onyx** | D | -- | LOW | Lower quality |

**Recommendation**: Start with `am_fenrir` as the Solis interim voice. If too neutral, try `am_michael`. Both are C+ quality -- the best available male presets.

**Voice blending option**: Kokoro supports weighted blending between presets. A blend of `am_fenrir:70,am_michael:30` may produce a voice that better matches the Solis character than either preset alone. The default female voice (af_heart) is itself a 50-50 blend of af_bella and af_sarah, proving this technique works.

```bash
# Test Solis interim voices
mlx_audio.tts.generate \
  --model mlx-community/Kokoro-82M-bf16 \
  --text "The architecture is sound. We have tested every boundary condition." \
  --voice am_fenrir \
  --lang_code a \
  --play

# Test voice blend
# (requires kokoro-tts CLI or custom blending script)
kokoro-tts "Hello, I am Solis." output.wav --voice "am_fenrir:70,am_michael:30"
```

### 3.3 Nova Interim Voice: Kokoro Selection

**Female voices ranked by suitability for Nova character:**

| Voice | Grade | Traits | Nova Fit | Notes |
|-------|-------|--------|----------|-------|
| **af_heart** | A | Best overall | HIGH | Clear, warm, natural. The benchmark voice |
| **af_bella** | A- | Expressive | HIGH | Youthful, clear, slightly faster feel. 204 Hz pitch |
| **af_nova** | C | -- | MEDIUM | Name matches but lower quality than af_heart |
| **bf_emma** | B- | British | MEDIUM | Good quality but British accent |
| **af_sarah** | C+ | -- | MEDIUM | Component of af_heart blend |

**Recommendation**: Use `af_heart` as the Nova interim voice. It is unanimously considered Kokoro's best voice -- Grade A, 200 Hz pitch (matching Nova's F0 target), and praised as "the best quality AI voice I have ever heard" in community reviews. Alternatively, `af_bella` offers a slightly more energetic character at 204 Hz that may better match Nova's "slightly faster, more dynamic" specification.

**Voice blending option**: A blend of `af_heart:60,af_bella:40` would combine af_heart's warmth with af_bella's energy.

```bash
# Test Nova interim voices
mlx_audio.tts.generate \
  --model mlx-community/Kokoro-82M-bf16 \
  --text "Let me explain how this works. The key insight is in the architecture." \
  --voice af_heart \
  --lang_code a \
  --play
```

### 3.4 Kokoro Prosody Control

[CONFIRMED] Kokoro supports limited but useful prosody control:

- **Pauses**: Use `...` in text for brief pauses, or SSML `<break time="400ms"/>` for precise control
- **Emphasis**: Wrap key words with `*asterisks*` for emphasis
- **Speed**: `--speed` parameter (0.5 to 2.0, default 1.0)
- **SSML**: Subset supported -- `<prosody rate="slow">`, `<emphasis level="moderate">`, `<break>`
- **Punctuation**: Respects natural punctuation for rhythm (commas = brief pause, periods = longer pause, em-dashes = dramatic pause)

**Limitations**: Kokoro does NOT support emotional control via text tags. Its expressiveness comes from the voice preset and natural text prosody. For emotion-aware speech, use Qwen3-TTS or Chatterbox.

---

## Part 4: Implementation Architecture

### 4.1 System Architecture

```
                        SolisHQ Voice Engine
                        ====================

[Agent Text Output]
        |
        v
[1. Text Preprocessor]
   - Sentence segmentation (for streaming)
   - Clean special characters
   - Normalize numbers, abbreviations
        |
        v
[2. Prosody Annotator]
   - LLM-generated emotion tags (inline)
   - Emphasis markers on key words
   - Pause indicators at natural breaks
   - Speaking rate modifiers for context
   |
   | Annotated text format:
   | "<confident>The architecture is sound.</confident>
   |  <pause:300ms/>
   |  <emphasis>Every</emphasis> boundary condition holds."
        |
        v
[3. Voice Router]
   - Select voice identity (Solis or Nova)
   - Select TTS model tier:
     * Fast (Kokoro-82M): routine, short phrases
     * Quality (Qwen3-TTS): important, emotional, long-form
   - Map prosody annotations to model-native format
        |
        v
[4. TTS Engine (MLX)]
   - Load model + voice identity
   - Generate audio (streaming: sentence-by-sentence)
   - Output: PCM audio chunks
        |
        v
[5. Audio Post-Processor]
   - Volume normalization (LUFS targeting)
   - Silence trimming (leading/trailing)
   - UTMOS quality check (development mode)
        |
        v
[6. Audio Output Manager]
   - Stream to speaker (Core Audio)
   - Handle interruption (stop on user speech)
   - Queue management (next sentence ready before current finishes)
```

### 4.2 Voice Selection: Who Chooses?

**Phase 1 (Now)**: User chooses. System default is Solis.
- Configuration: `~/.vox/voice.conf` with `default_voice=solis`
- Override per-session: "Switch to Nova" / "Use Solis"

**Phase 2 (This Quarter)**: Context-aware suggestion.
- Engineering/technical context -> Solis (authority, depth)
- Customer-facing/explanation context -> Nova (clarity, accessibility)
- User can always override
- Never switch mid-conversation without user request

**Phase 3 (Future)**: Product-level defaults.
- Vox (developer tool) -> Solis default
- Accipio (commerce) -> Nova default (customer-facing context)
- Solis Platform -> configurable per agent

### 4.3 SSML and Prosody Mapping

The prosody annotation layer must translate a unified format to model-specific controls:

```
Unified Format          Kokoro                      Qwen3-TTS
--------------          ------                      ---------
<emphasis>word</e>      *word*                      (handled via instruct)
<pause:300ms/>          <break time="300ms"/>       (natural from punctuation)
<rate:slow>text</r>     --speed 0.8                 instruct: "speak slowly"
<confident>text</c>     (no emotion control)        instruct: "confident tone"
<empathy>text</e>       (no emotion control)        instruct: "gentle empathy"
<urgent>text</u>        (no emotion control)        instruct: "measured urgency"
```

[DERIVED] The prosody annotation layer should be model-agnostic. When using Kokoro (which lacks emotion control), emotion tags are gracefully degraded to punctuation/speed adjustments. When using Qwen3-TTS (which supports emotion via instruct), emotion tags map to the instruct parameter. This means the agent's text output format stays the same regardless of which TTS model is active.

### 4.4 Streaming Architecture

[CONFIRMED] Streaming is critical for real-time conversation. The pipeline operates on sentences, not full responses:

```
Agent generates text: "The system is healthy. All tests pass. Deployment is ready."

Timeline:
  t=0ms:    Sentence 1 detected ("The system is healthy.")
  t=50ms:   Sentence 1 sent to TTS
  t=200ms:  Sentence 1 audio begins playing
  t=300ms:  Sentence 2 detected ("All tests pass.")
  t=350ms:  Sentence 2 sent to TTS (parallel with Sentence 1 playback)
  t=800ms:  Sentence 1 playback completes, Sentence 2 audio starts immediately
  ...

Latency: User hears first audio at ~200ms after first sentence is ready
Without streaming: User waits for ALL text + ALL audio = 2000ms+
```

**Streaming with mlx-audio:**
```bash
mlx_audio.tts.generate --model mlx-community/Kokoro-82M-bf16 \
  --text "Hello world" --stream --play
```

### 4.5 Interruption Handling

When the user speaks while the agent is speaking:

```
1. VAD (Voice Activity Detection) detects user speech
   └── Even while agent audio is playing

2. Immediately:
   ├── Stop current audio playback
   ├── Cancel pending TTS generation (queued sentences)
   └── Clear audio output buffer

3. Process user speech:
   ├── STT (Whisper via mlx-audio) transcribes user input
   └── Route transcription to agent

4. Agent processes new input and generates response
   └── TTS pipeline restarts with new text

Important: The agent should NOT repeat what was already spoken.
Track which sentences were fully played vs. interrupted.
```

### 4.6 Integration with Current Vox Architecture

[CONFIRMED from reference_vox_dictation_architecture.md] Current Vox pipeline:

```
Current:  Agent text -> Stop hook -> `say` command -> macOS system voice
Replace:  Agent text -> Stop hook -> voice_engine.sh -> Kokoro/Qwen3-TTS -> speaker
```

**Minimal integration path (Phase 1):**

Replace the `say` command invocation with an `mlx_audio` CLI call. The Stop hook already extracts conversational text -- it just needs to call a different binary.

```bash
# Current (in Stop hook or voice_speak):
say "Hello, I am the Meta-Orchestrator"

# Replace with:
python3 -m mlx_audio.tts.generate \
  --model mlx-community/Kokoro-82M-bf16 \
  --text "Hello, I am the Meta-Orchestrator" \
  --voice am_fenrir \
  --lang_code a \
  --play \
  --stream
```

**Or via a wrapper script** (`~/.vox/voice_engine.sh`):

```bash
#!/bin/bash
# SolisHQ Voice Engine - Kokoro wrapper
# Replaces macOS `say` command

TEXT="$1"
VOICE="${VOX_VOICE:-am_fenrir}"  # Default: Solis
MODEL="mlx-community/Kokoro-82M-bf16"

python3 -m mlx_audio.tts.generate \
  --model "$MODEL" \
  --text "$TEXT" \
  --voice "$VOICE" \
  --lang_code a \
  --play \
  --stream
```

---

## Part 5: Installation & Setup

### 5.1 Step 1: Install mlx-audio

```bash
# Create a dedicated virtual environment for voice
mkdir -p ~/SolisHQ/VoiceEngine
cd ~/SolisHQ/VoiceEngine
python3 -m venv .venv
source .venv/bin/activate

# Install mlx-audio (includes Kokoro + Qwen3-TTS support)
pip install mlx-audio

# Install audio format support
brew install ffmpeg

# Verify installation
python3 -c "from mlx_audio.tts.utils import load_model; print('mlx-audio ready')"
```

### 5.2 Step 2: Download and Test Kokoro-82M

```bash
source ~/SolisHQ/VoiceEngine/.venv/bin/activate

# First run downloads the model automatically (~164MB)
python3 -m mlx_audio.tts.generate \
  --model mlx-community/Kokoro-82M-bf16 \
  --text "Hello, I am Solis. The grounded intelligence." \
  --voice am_fenrir \
  --lang_code a \
  --play

# Test Nova voice
python3 -m mlx_audio.tts.generate \
  --model mlx-community/Kokoro-82M-bf16 \
  --text "Hello, I am Nova. Let me illuminate." \
  --voice af_heart \
  --lang_code a \
  --play

# Test streaming
python3 -m mlx_audio.tts.generate \
  --model mlx-community/Kokoro-82M-bf16 \
  --text "This is a longer passage to test streaming audio generation. The voice should begin playing before the full text is processed." \
  --voice am_fenrir \
  --stream \
  --play
```

### 5.3 Step 3: Set Up Qwen3-TTS for Voice Design

```bash
source ~/SolisHQ/VoiceEngine/.venv/bin/activate

# Download VoiceDesign model (8-bit quantized, ~3GB)
# First run downloads automatically
python3 -m mlx_audio.tts.generate \
  --model mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit \
  --text "Hello, this is a voice design test." \
  --voice "A composed young man in his mid-thirties with a warm, rich baritone voice." \
  --language English \
  --play

# Alternative: Use the dedicated Apple Silicon repo
git clone https://github.com/kapi2800/qwen3-tts-apple-silicon.git ~/SolisHQ/VoiceEngine/qwen3-apple
cd ~/SolisHQ/VoiceEngine/qwen3-apple
pip install -r requirements.txt
python main.py
```

**Performance expectations on M1 Pro 16GB:**
- Kokoro-82M: Sub-300ms inference. Runs effortlessly
- Qwen3-TTS-0.6B (8-bit): Comfortable fit, ~3GB RAM
- Qwen3-TTS-1.7B (8-bit): ~6GB RAM, feasible but leaves less headroom
- Processing speed (1.7B): ~1000 characters/minute on M2 (M1 Pro will be comparable)

### 5.4 Step 4: Set Up UTMOS for Quality Scoring

```bash
source ~/SolisHQ/VoiceEngine/.venv/bin/activate

# Option A: Simple UTMOS (pip package)
pip install utmos

# Usage:
python3 << 'EOF'
import utmos

model = utmos.Score()
score = model.calculate_wav_file("path/to/sample.wav")
print(f"UTMOS Score: {score:.2f}")
# Score interpretation:
#   > 4.5 = human-level
#   > 4.0 = production quality
#   > 3.5 = development quality
#   < 3.0 = unacceptable
EOF

# Option B: UTMOSv2 (more accurate, won VoiceMOS Challenge 2024)
pip install git+https://github.com/sarulab-speech/UTMOSv2.git

# Usage:
python3 << 'EOF'
import utmosv2
# See quickstart.ipynb in the UTMOSv2 repo for usage
EOF
```

### 5.5 Step 5: Integrate into Vox (Replace `say`)

The current Vox Stop hook calls `say` to speak agent responses. The integration point is wherever the `say` command is invoked.

```bash
# Locate the current say invocation
grep -r "say " ~/.claude/hooks/ ~/.vox/ 2>/dev/null | grep -v ".git"

# Create the voice engine wrapper
cat > ~/.vox/voice_engine.sh << 'SCRIPT'
#!/bin/bash
# SolisHQ Voice Engine v0.1
# Drop-in replacement for macOS `say`

set -euo pipefail

TEXT="$1"
VOICE="${VOX_VOICE:-am_fenrir}"
MODEL="${VOX_MODEL:-mlx-community/Kokoro-82M-bf16}"
VENV="$HOME/SolisHQ/VoiceEngine/.venv"

# Check mute state
if [[ -f "$HOME/.vox/muted" ]] || [[ -f "$HOME/.vox/muted-$$" ]]; then
  exit 0
fi

# Activate virtual environment and generate
source "$VENV/bin/activate"
python3 -m mlx_audio.tts.generate \
  --model "$MODEL" \
  --text "$TEXT" \
  --voice "$VOICE" \
  --lang_code a \
  --play \
  --stream 2>/dev/null
SCRIPT

chmod +x ~/.vox/voice_engine.sh

# Then update the hook/script that currently calls `say` to call:
# ~/.vox/voice_engine.sh "text to speak"
```

---

## Part 6: Voice Design Experiment Protocol

### 6.1 Overview

This is a systematic process for designing and locking the Solis and Nova voice identities. The goal is not to find a "good enough" voice but to engineer the exact voice that IS Solis, IS Nova -- reproducible from a text description.

### 6.2 Phase 1: Broad Exploration (20 Samples per Voice)

**Duration**: 1-2 hours per voice
**Model**: Qwen3-TTS-12Hz-1.7B-VoiceDesign (8-bit)

```
For each voice (Solis, Nova):
  1. Generate 5 samples with the PRIMARY description
     - Same description, same test sentence
     - Evaluates consistency (does the model produce the same voice?)

  2. Generate 5 samples with VARIANT descriptions (A, B, C + 2 custom)
     - Same test sentence, different descriptions
     - Evaluates which description dimensions matter most

  3. Generate 5 samples with EMOTIONAL variants
     - Same description, different emotional test sentences
     - Evaluates emotional range of the designed voice

  4. Generate 5 samples with MODIFIED descriptions
     - Take the best description, adjust one dimension at a time
     - Evaluates dimension sensitivity
     - Examples: change age ("late twenties" vs "mid-thirties")
                 change timbre ("rich" vs "mellow")
                 change pace ("measured" vs "unhurried")
```

### 6.3 Phase 2: Automated Scoring (UTMOS)

```
For each of the 20 samples:
  1. Run UTMOS scoring
     - Record score (target: >3.5 for exploration, >4.0 for selection)

  2. Run Whisper transcription
     - Compare transcription to input text
     - Calculate WER (target: <5%)

  3. Record metadata:
     - Description used
     - Test sentence
     - UTMOS score
     - WER
     - Subjective notes (first impression)

Store in: ~/SolisHQ/VoiceDesign/scores.csv
```

**Scoring Script:**

```python
#!/usr/bin/env python3
"""Score voice design samples with UTMOS."""

import utmos
import os
import csv
import glob

SAMPLES_DIR = os.path.expanduser("~/SolisHQ/VoiceDesign/samples")
SCORES_FILE = os.path.expanduser("~/SolisHQ/VoiceDesign/scores.csv")

model = utmos.Score()

with open(SCORES_FILE, "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["filename", "utmos_score", "voice", "description", "emotion"])

    for wav_file in sorted(glob.glob(f"{SAMPLES_DIR}/*.wav")):
        score = model.calculate_wav_file(wav_file)
        basename = os.path.basename(wav_file)
        # Parse filename: voice_description_emotion_timestamp.wav
        parts = basename.replace(".wav", "").split("_")
        voice = parts[0] if parts else "unknown"
        desc = parts[1] if len(parts) > 1 else "unknown"
        emotion = parts[2] if len(parts) > 2 else "unknown"

        writer.writerow([basename, f"{score:.3f}", voice, desc, emotion])
        print(f"{basename}: UTMOS={score:.3f}")

print(f"\nScores saved to {SCORES_FILE}")
```

### 6.4 Phase 3: A/B Testing (Top 5 Candidates)

```
1. Select top 5 samples per voice (by UTMOS + subjective ranking)

2. Blind A/B comparison:
   - Play two samples back to back
   - Which sounds more like "Solis"? (or "Nova"?)
   - Which sounds more natural?
   - Which would you trust more?

3. Compare against reference:
   - Play candidate vs. af_heart (Kokoro best)
   - Play candidate vs. macOS enhanced Siri voice
   - Play candidate vs. ElevenLabs sample (if available)

4. Rate each on 5 dimensions (1-5 scale):
   - Naturalness
   - Character match (does it sound like the spec?)
   - Emotional range (does empathy sound different from confidence?)
   - Clarity/intelligibility
   - Would-I-listen-for-an-hour factor
```

### 6.5 Phase 4: Refinement (Iterate on Winner)

```
1. Take the winning description
2. Make 10 micro-adjustments:
   - Adjust one word at a time
   - "warm" -> "gently warm"
   - "mid-thirties" -> "thirty-five"
   - "measured pace" -> "thoughtful, measured pace"
   - Add/remove specific vocal characteristics

3. Generate 2 samples per adjustment
4. Score with UTMOS
5. A/B test adjustments against the baseline winner
6. Lock the final description when improvement plateaus
```

### 6.6 Phase 5: Voice Identity Lock

```
1. Final description is THE VOICE. Document it:
   - Store in: ~/SolisHQ/VoiceDesign/SOLIS_VOICE.md
   - Store in: ~/SolisHQ/VoiceDesign/NOVA_VOICE.md
   - Include: description, UTMOS score, WER, test recordings

2. Create the voice_clone_prompt:
   - Generate a clean 10-second reference clip using the final description
   - Run create_voice_clone_prompt() on this clip
   - Save the prompt object (this is the reusable voice identity)
   - Store in: ~/SolisHQ/VoiceDesign/prompts/solis.prompt
   - Store in: ~/SolisHQ/VoiceDesign/prompts/nova.prompt

3. Version control:
   - The description, UTMOS scores, and prompt files go in version control
   - Reference audio clips go in version control
   - This is the "source code" of the voice

4. Quality gate:
   - UTMOS > 4.0 required for production lock
   - WER < 5% required
   - Human MOS > 4.0 required (self-evaluation minimum)
   - Passes character match test (sounds like the spec)
```

### 6.7 Complete Experiment Timeline

| Day | Activity | Output |
|-----|----------|--------|
| Day 1 | Install mlx-audio + Kokoro. Replace `say`. Test interim voices | Working Kokoro pipeline |
| Day 1 | Install Qwen3-TTS VoiceDesign. Run 20 Solis samples | 20 Solis WAV files |
| Day 2 | Run 20 Nova samples. Score all with UTMOS | 40 scored samples |
| Day 2 | A/B test top 5 each. Select winner descriptions | 2 winning descriptions |
| Day 3 | Refinement: 10 micro-adjustments per voice | Optimized descriptions |
| Day 3 | Lock voice identities. Create voice_clone_prompts | Locked identities |
| Day 4 | Integration: wire Qwen3-TTS into Vox for quality mode | Full pipeline working |
| Day 5 | Calibration: generate 100 reference phrases per voice | Reference library |

---

## Part 7: Voice Personality Engine (Future)

### 7.1 Context-Aware Voice Selection

**The Vision**: The system automatically chooses the right voice based on context, not just user preference.

```
Context Signals               Voice Decision
----------------               ---------------
Product context:
  Vox (developer tool)    --> Solis (default for engineering)
  Accipio (commerce)      --> Nova (default for customer-facing)
  Solis Platform          --> Configurable per deployed agent

Content type:
  Technical explanation   --> Solis (authority, depth)
  Error/issue report      --> Solis (calm authority)
  Onboarding/tutorial     --> Nova (clarity, accessibility)
  Positive news           --> Nova (warmth, enthusiasm)
  Status update           --> Either (use default)

User preference:
  Explicit override       --> Always honored
  Historical preference   --> Tracked and applied
```

**Implementation**: The agent's output already carries semantic intent. A lightweight classifier on the text can route to the appropriate voice without explicit tagging:

```python
def select_voice(text: str, context: dict) -> str:
    """Select voice based on content and context."""
    # User override always wins
    if context.get("voice_override"):
        return context["voice_override"]

    # Product-level default
    product = context.get("product", "vox")
    default = PRODUCT_DEFAULTS.get(product, "solis")

    # Content-based adjustment (future: ML classifier)
    if any(kw in text.lower() for kw in ["error", "failed", "issue", "problem"]):
        return "solis"  # Calm authority for problems
    if any(kw in text.lower() for kw in ["welcome", "great news", "congratulations"]):
        return "nova"   # Warmth for positive content

    return default
```

### 7.2 Emotion Mapping

**The Vision**: Agent confidence level maps to voice prosody.

```
Agent State                    Voice Adjustment
-----------                    ----------------
High confidence (>0.9)    --> Steady, authoritative delivery
Medium confidence (0.6-0.9) -> Normal delivery
Low confidence (<0.6)     --> Slightly slower, qualified tone
                              "I believe..." not "It is..."

Delivering bad news       --> Empathetic, slower, lower pitch
Delivering good news      --> Warmer, slightly brighter
Explaining complexity     --> Slower, more deliberate, more pauses
Routine confirmation      --> Normal pace, concise
```

**Implementation with Qwen3-TTS**: The instruct parameter is set dynamically based on agent state:

```python
def build_instruct(emotion: str, confidence: float) -> str:
    """Build Qwen3-TTS instruct based on agent state."""
    base_instructs = {
        "confident": "Speak with calm confidence and steady, grounded delivery",
        "empathetic": "Speak with gentle empathy, slightly slower, as if acknowledging difficulty",
        "curious": "Speak with genuine curiosity, engaged and attentive",
        "urgent": "Speak with measured urgency, firm and clear without alarm",
        "excited": "Speak with restrained enthusiasm, slightly brighter tone",
    }

    instruct = base_instructs.get(emotion, base_instructs["confident"])

    if confidence < 0.6:
        instruct += ", with a measured, careful tone that acknowledges uncertainty"

    return instruct
```

### 7.3 Per-Product Voice Customization

**The Vision**: Same base voice, different personality layer.

- **Vox Solis**: Slightly more casual, peer-to-peer. "The senior engineer next to you"
- **Accipio Solis**: Slightly more professional, advisory. "Your business intelligence analyst"
- **Platform Solis**: Neutral baseline. Agents deployed on the platform can customize

This is achieved by adjusting the instruct parameter, not the base voice:

```python
PRODUCT_PERSONALITY = {
    "vox": "conversational and peer-like, as between engineering colleagues",
    "accipio": "professional and advisory, clear and actionable",
    "platform": "neutral and adaptable",
}
```

### 7.4 Voice Evolution

**The Vision**: The voice subtly evolves over product versions, like a brand identity that matures.

This is **not recommended for Phase 1**. Voice consistency is more important than evolution in the early stages. However, the architecture supports it:

```
v1.0: Initial Solis voice (warm, mid-thirties)
v2.0: Slightly refined prosody (better pauses, more natural breathing)
v3.0: Expanded emotional range (humor, wonder)

Rule: Changes must be imperceptible between adjacent versions.
      A user who updates should not notice the voice changed.
      Over multiple versions, the voice becomes richer, not different.
```

### 7.5 Multi-Language Voice Identity

**The Challenge**: The same "Solis" character must sound recognizably Solis in English, Spanish, Japanese, etc.

**Approach with Qwen3-TTS**: The VoiceDesign instruct describes character traits, not language-specific phonetics. The model adapts the character to each language:

```python
# Same instruct, different language
instruct = "A composed young man with a warm, rich baritone voice. Confident and grounded."

# English
model.generate_voice_design(text="Hello, I am Solis.", language="English", instruct=instruct)

# Spanish
model.generate_voice_design(text="Hola, soy Solis.", language="Spanish", instruct=instruct)

# Japanese
model.generate_voice_design(text="hello, Solisdesu.", language="Japanese", instruct=instruct)
```

[UNCERTAIN] Whether the same instruct produces a recognizably similar voice across languages has not been verified. This requires experimentation. The model's cross-lingual voice consistency is a research question, not a guaranteed feature.

---

## Appendix A: Qwen3-TTS Description Reference

### A.1 Controllable Dimensions (Verified)

| Dimension | Effective Values | Notes |
|-----------|-----------------|-------|
| Gender | male, female, neutral | Core dimension |
| Age | child, teenager, young adult, mid-thirties, middle-aged, elderly | Specific ages work ("17 years old") |
| Pitch | high, medium, low, medium-low, high-pitched | Relative terms |
| Pace | fast, slow, measured, unhurried, brisk, steady | Relative terms |
| Emotion | confident, calm, gentle, serious, lively, composed, soothing, angry, excited | Wide range |
| Timbre | magnetic, crisp, hoarse, mellow, sweet, rich, powerful, warm, resonant, clear | Quality descriptors |
| Breathing | can describe breath patterns, depth | "Deeper breath support" works |
| Vocal tension | can describe tension/relaxation | "Vowels tighten when nervous" works |
| Use case | news broadcast, narration, voice assistant, conversation | Contextual framing |

### A.2 Example Descriptions from Official Sources

1. "A composed middle-aged male announcer with a deep, rich and magnetic voice, a steady speaking speed and clear articulation, suitable for news broadcasting or documentary commentary."

2. "A young, lively female voice with a fast pace and noticeable upward inflection, suitable for fashion product introductions."

3. "A calm, middle-aged male voice with a slow pace and deep, magnetic tone, suitable for news or documentary narration."

4. "A cute child's voice, around 8 years old, with a slightly childish tone, suitable for animation character voice-overs."

5. "A gentle, intellectual female voice, around 30 years old, with a calm tone, suitable for audiobook narration."

6. "Male, 17 years old, tenor range, gaining confidence - deeper breath support now, though vowels still tighten when nervous."

7. "Speak in an incredulous tone, but with a hint of panic beginning to creep into your voice."

### A.3 Description Anti-Patterns

- "A nice voice" -- too vague
- "Sound like Morgan Freeman" -- celebrity reference, unreliable
- "A good, excellent, wonderful voice" -- opinion, not description
- "female voice" -- single dimension, too broad
- "A beautiful, gorgeous, stunning, amazing voice" -- redundant synonyms

---

## Appendix B: Sources

### Voice Design & Qwen3-TTS
- [Qwen3-TTS GitHub Repository](https://github.com/QwenLM/Qwen3-TTS) -- official codebase and examples
- [Qwen3-TTS VoiceDesign Model Card](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign) -- model documentation
- [Qwen3-TTS CustomVoice Model Card](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice) -- preset voice model
- [Alibaba Cloud Voice Design API Reference](https://www.alibabacloud.com/help/en/model-studio/qwen-tts-voice-design) -- official description guidelines
- [Qwen3-TTS Complete 2026 Guide (Dev.to)](https://dev.to/czmilo/qwen3-tts-the-complete-2026-guide-to-open-source-voice-cloning-and-ai-speech-generation-1in6) -- community guide
- [Qwen3-TTS Technical Report (arXiv)](https://arxiv.org/html/2601.15621v1) -- architecture paper
- [Qwen3-TTS with MLX-Audio on macOS](https://mybyways.com/blog/qwen3-tts-with-mlx-audio-on-macos) -- Apple Silicon setup guide

### Kokoro-82M
- [Kokoro-82M VOICES.md](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md) -- complete voice preset list with grades
- [Kokoro-82M Voice Blending (DeepWiki)](https://deepwiki.com/zboyles/Kokoro-82M/5.2-custom-voice-creation) -- blending documentation
- [af_heart Voice Analysis](https://voicerankings.com/voice/kokoro-82M/female/af_heart) -- voice characteristics
- [af_bella Voice Analysis](https://voicerankings.com/voice/kokoro-82M/female/af_bella) -- voice characteristics
- [kokoro-MLX-blender](https://github.com/tsmdt/kokoro-MLX-blender) -- voice blending on Apple Silicon

### MLX-Audio
- [mlx-audio GitHub](https://github.com/Blaizzy/mlx-audio) -- main repository
- [mlx-audio PyPI](https://pypi.org/project/mlx-audio/) -- package page
- [qwen3-tts-apple-silicon](https://github.com/kapi2800/qwen3-tts-apple-silicon) -- dedicated Apple Silicon project

### Quality Scoring
- [UTMOS PyPI](https://pypi.org/project/utmos/) -- simple MOS predictor
- [UTMOSv2 GitHub](https://github.com/sarulab-speech/UTMOSv2) -- advanced MOS predictor (VoiceMOS Challenge 2024 winner)
- [SpeechMOS](https://github.com/tarepan/SpeechMOS) -- easy-to-use MOS predictors

### Voice Agent Architecture
- [Voice Agent Architecture (LiveKit)](https://livekit.com/blog/voice-agent-architecture-stt-llm-tts-pipelines-explained) -- streaming pipeline design
- [Sequential Pipeline Architecture (LiveKit)](https://livekit.com/blog/sequential-pipeline-architecture-voice-agents) -- barge-in/interruption handling
- [TTS Architecture Production Trade-Offs (Deepgram)](https://deepgram.com/learn/text-to-speech-architecture-production-tradeoffs) -- production considerations
- [Voice AI Stack 2026 (AssemblyAI)](https://www.assemblyai.com/blog/the-voice-ai-stack-for-building-agents) -- full stack overview

---

## Summary: The Implementation Path

```
Week 1 (Days 1-2):
  [x] Install mlx-audio + Kokoro-82M
  [x] Replace `say` with Kokoro (am_fenrir for Solis, af_heart for Nova)
  [x] Install Qwen3-TTS VoiceDesign
  [x] Generate 20 samples per voice with different descriptions
  [x] Score with UTMOS

Week 1 (Days 3-5):
  [ ] A/B test top candidates
  [ ] Refine descriptions (10 micro-adjustments per voice)
  [ ] Lock voice identities
  [ ] Create voice_clone_prompts
  [ ] Generate 100 reference phrases per voice

Week 2:
  [ ] Wire Qwen3-TTS into Vox as quality mode
  [ ] Implement voice selection layer (Solis/Nova switching)
  [ ] Basic prosody pipeline (emotion tags -> instruct)
  [ ] Set up UTMOS scoring pipeline

Week 3-4:
  [ ] Streaming architecture
  [ ] Interruption handling (VAD integration)
  [ ] Calibration dashboard
  [ ] Voice quality regression tests

Month 2+:
  [ ] Context-aware voice selection
  [ ] Emotion mapping from agent state
  [ ] Multi-language voice identity testing
  [ ] Voice Personality Engine (Phase 1)
```

Two voices. One soul. The future sounds like Solis.

---

*SolisHQ -- We innovate, invent, then disrupt.*
