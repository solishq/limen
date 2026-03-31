# VOICE SYNTHESIS RESEARCH: The Soul of SolisHQ

**Date**: 2026-03-30
**Author**: SolisHQ Research (Meta-Orchestrator / Researcher)
**Classification**: Foundational Research -- Voice Identity & Synthesis Architecture
**Confidence Level Key**: [CONFIRMED] = multiple independent sources agree; [LIKELY] = strong evidence, <3 sources; [UNCERTAIN] = single source or inference

---

## Table of Contents

1. [Part 1: State of the Art (2025-2026)](#part-1-state-of-the-art)
2. [Part 2: Voice Identity Design](#part-2-voice-identity-design)
3. [Part 3: Custom Voice Creation Methods](#part-3-custom-voice-creation-methods)
4. [Part 4: Local-First Architecture (Apple Silicon)](#part-4-local-first-architecture)
5. [Part 5: Calibration Engine](#part-5-calibration-engine)
6. [Part 6: Voice Pipeline Architecture](#part-6-voice-pipeline-architecture)
7. [Part 7: The Honest Recommendation](#part-7-the-honest-recommendation)
8. [Appendix A: Model Comparison Matrix](#appendix-a-model-comparison-matrix)
9. [Appendix B: Sources](#appendix-b-sources)

---

## Part 1: State of the Art

### 1.1 The Landscape Has Transformed

[CONFIRMED] The gap between human speech and synthetic speech has effectively closed in 2025-2026. The TTS Arena (Hugging Face blind comparison system) shows top models achieving ELO scores above 1500, with human evaluators frequently unable to distinguish synthetic from natural speech.

**TTS Arena Top Rankings (March 2026)**:

| Rank | Model | ELO | Type | Notes |
|------|-------|-----|------|-------|
| 1 | Vocu V3.0 | 1583 | Commercial | Newest entrant |
| 2 | Inworld TTS | 1577 | Commercial | #1 in audio fidelity benchmarks |
| 3 | Inworld TTS MAX | 1575 | Commercial | Higher quality variant |
| 4 | CastleFlow v1.0 | 1574 | Commercial | |
| 5 | Hume Octave | 1565 | Commercial | Emotional intelligence leader |
| 6 | Papla P1 | 1561 | Commercial | |
| 7 | MiniMax Speech-02-HD | 1544 | Commercial | |
| 8 | Eleven Flash v2.5 | 1541 | Commercial | Market leader by adoption |

**Key observation**: All top-8 models are commercial/proprietary. Open-source models are closing the gap rapidly but are not yet at parity for the very best quality tier.

### 1.2 Commercial Models -- Detailed Analysis

#### ElevenLabs (Eleven v3, Flash v2.5)
- **Architecture**: Proprietary, likely autoregressive + flow-matching hybrid
- **Quality**: Industry benchmark for realism. 81.97% pronunciation accuracy. ELO ~1541 (Flash v2.5)
- **Voice Cloning**: Professional cloning from 30 seconds of audio. Available from $5/mo Starter plan
- **Emotional Range**: Strong. Multiple speaking styles per voice
- **Streaming**: Yes, real-time audio streaming
- **Latency**: Sub-300ms time-to-first-audio
- **Languages**: 70+ languages
- **Pricing**: $0.06/1K chars (Flash), $0.12/1K chars (Multilingual v2/v3). Overages: $0.18-$0.30/1K chars
- **Custom Voices**: Voice Design (text-describable) + Voice Cloning (audio reference)
- **License**: Proprietary. Voice ownership terms complex
- **Runs Locally**: No
- [CONFIRMED] Market leader by adoption and ecosystem breadth

#### OpenAI TTS (gpt-4o-mini-tts)
- **Architecture**: Transformer-based, integrated with GPT-4o family
- **Quality**: Between Google WaveNet and ElevenLabs. Significant improvement in Dec 2025 update
- **Voice Cloning**: Custom voices available, but restricted to "eligible customers" -- requires sales contact and consent recording from voice actor
- **Emotional Range**: Good. Instructible via system prompt (gpt-4o-mini-tts supports style directions)
- **Streaming**: Yes, via Realtime API
- **Latency**: Sub-500ms
- **Languages**: 40+ languages
- **Pricing**: ~$0.015/1K chars (tts-1), ~$0.030/1K chars (tts-1-hd)
- **Voices**: Only 6 built-in voices (Alloy, Echo, Fable, Onyx, Nova, Shimmer)
- **Runs Locally**: No
- [CONFIRMED] Simplest API integration. Cheapest among top-tier commercial options

#### Cartesia Sonic 3
- **Architecture**: State Space Models (SSMs) -- fundamentally different from transformer-based TTS
- **Quality**: High naturalness, strong emotional range
- **Voice Cloning**: Short audio sample cloning
- **Latency**: Industry-leading 40ms time-to-first-audio. 90ms model latency. Sub-200ms first chunk
- **Streaming**: Yes, designed for streaming-first
- **Emotional Range**: Genuinely impressive -- excitement, sadness, laughter
- **Pricing**: Not publicly listed (API access)
- **Runs Locally**: No
- [CONFIRMED] Lowest latency in the industry by a factor of 4x

#### Hume AI (Octave 2, EVI 3)
- **Architecture**: Voice-based LLM trained on text, speech, and emotion tokens simultaneously
- **Quality**: High. Emotional intelligence is the differentiator
- **Emotional Range**: Best in class. Understands when to whisper, shout, calmly explain. Infers emotion from script content
- **Latency**: EVI 3 responds in under 300ms. Octave 2 generates audio in under 200ms
- **Languages**: 11 languages (Octave 2)
- **Voice Cloning**: Personality mimicry rather than voice cloning per se
- **Pricing**: Octave 2 is half the price of Octave 1 (specific pricing requires inquiry)
- **Runs Locally**: No
- [CONFIRMED] If emotion is the primary concern, Hume is the technology to study

#### Inworld TTS 1.5 Max
- **Architecture**: Proprietary
- **Quality**: #1 on TTS Arena. ELO 1577
- **Latency**: Sub-250ms
- **Pricing**: $10/1M characters
- **Focus**: Gaming/interactive entertainment
- **Runs Locally**: No
- [LIKELY] Best raw quality, but focused on gaming use cases

#### Deepgram Aura-2
- **Architecture**: Proprietary, purpose-built for enterprise
- **Quality**: Strong, especially for enterprise content (drug names, legal terms, alphanumeric)
- **Latency**: Sub-200ms baseline TTFB, optimized to 90ms
- **Streaming**: WebSocket support, 40+ concurrent connections
- **Languages**: 7 languages, 40+ English voices
- **Pricing**: $0.030/1K characters
- **Runs Locally**: No
- [CONFIRMED] Best for enterprise/production voice agent use cases

#### PlayHT 2.0
- **Quality**: Good emotional range
- **Voice Cloning**: Instant clone from 30 seconds, even lower quality audio
- **Pricing**: Creator $31.20/mo (3M chars/year), Unlimited $29/mo
- **Runs Locally**: No

#### Resemble AI
- **Quality**: High quality, plus Chatterbox open-source family
- **Custom Voice**: Creator $29/mo (10K seconds), Professional $99/mo (80K seconds)
- **Unique Feature**: Perth watermarking on all generated audio
- **Runs Locally**: No (API), but Chatterbox is open source

#### WellSaid Labs
- **Quality**: High, enterprise-focused
- **Custom Voice**: Enterprise only, custom pricing (typically 3-5x advertised rates)
- **Runs Locally**: No
- [UNCERTAIN] Focused on enterprise content creation, less suitable for real-time agent use

### 1.3 Open-Source Models -- Detailed Analysis

#### Tier 1: Production-Ready, High Quality

**Chatterbox (Resemble AI) -- MIT License**
- **Architecture**: 350M parameter, streamlined. Turbo variant reduces decoder from 10 steps to 1
- **Quality**: Beats ElevenLabs in blind tests with 63.75% listener preference
- **Voice Cloning**: Short reference clip for speaker adaptation
- **Emotional Range**: First OSS model with emotion exaggeration control. Built-in tags: [laugh], [cough], [chuckle]
- **Streaming**: Sub-200ms inference latency
- **Languages**: 15+ languages
- **License**: MIT -- fully permissive, commercial use allowed
- **Hardware**: 8-16GB VRAM (GPU). Apple Silicon (MPS) supported. CPU fallback available
- **Apple Silicon**: Yes, via MPS backend. MLX-Audio integration available
- **Fine-tuning**: Requires CUDA GPU with 18GB+ VRAM
- [CONFIRMED] The strongest overall open-source TTS option in March 2026

**Orpheus TTS (Canopy AI) -- Apache 2.0**
- **Architecture**: Llama-3B backbone adapted for speech-LLM. Available in 3B, 1B, 400M, 150M variants
- **Training Data**: 100K+ hours of English speech
- **Quality**: Human-level in blind evaluations
- **Voice Cloning**: Zero-shot from short audio sample
- **Emotional Range**: Guided emotion control via text prompts (happiness, sadness, anger, sarcasm, excitement)
- **Streaming**: 25-50ms latency
- **Languages**: English primary. Multilingual models in research preview (April 2025)
- **License**: Apache 2.0
- **Apple Silicon**: Not natively optimized. Workaround via LM Studio (GGUF quantized). MLX-Audio has Orpheus support
- [CONFIRMED] Best emotion control among open-source models

**Fish Speech V1.5 -- Apache 2.0**
- **Architecture**: DualAR (Dual Autoregressive Transformer)
- **Training Data**: 1M+ hours of multilingual audio
- **Quality**: ELO 1339 on TTS Arena. WER 3.5% English, CER 1.2% English, CER 1.3% Chinese
- **Voice Cloning**: Zero-shot
- **Languages**: English, Japanese, Korean, Chinese, French, German, Arabic, Spanish
- **License**: Apache 2.0
- **Unique Feature**: Does not rely on phonemes -- handles any language script directly
- [CONFIRMED] Best multilingual open-source option

**Qwen3-TTS (Alibaba) -- Apache 2.0**
- **Architecture**: LLM-based, dual-track streaming. 0.6B to 1.7B parameter variants
- **Quality**: Claims to outperform ElevenLabs and SeedTTS in voice quality and speaker similarity
- **Voice Cloning**: 3-second rapid clone
- **Voice Design**: Generate new voices from natural language description (critical for SolisHQ)
- **Emotional Range**: Emotion and prosody control via text instructions
- **Streaming**: 97ms latency
- **Languages**: 10 languages (Chinese, English, Japanese, Korean, German, French, Russian, Portuguese, Spanish, Italian)
- **License**: Apache 2.0
- **Apple Silicon**: MLX support via mlx-audio library (community port by Prince Canuma)
- **Released**: January 2026
- [CONFIRMED] Most capable voice design system -- can create voices from descriptions without reference audio

**CosyVoice2-0.5B (Alibaba/FunAudioLLM) -- Apache 2.0**
- **Architecture**: LLM-based, integrated offline/streaming modeling
- **Quality**: Top-tier for real-time streaming
- **Streaming**: 150ms first-packet latency with minimal quality loss
- **Voice Cloning**: Zero-shot
- **License**: Apache 2.0
- **Note**: CosyVoice 3.0 (Fun-CosyVoice) is successor, surpassing 2.0 in all metrics
- [CONFIRMED] Best streaming-optimized open-source model

#### Tier 2: Good Quality, Specific Strengths

**Kokoro-82M -- Apache 2.0**
- **Architecture**: Lightweight, 82M parameters
- **Quality**: #1 ranked in TTS Spaces Arena before release. Comparable to much larger models
- **Speed**: Sub-0.3 second inference across all text lengths. Sub-200ms latency
- **Languages**: American English, British English, Japanese, Chinese, French, Spanish, Italian, Portuguese, Hindi
- **Voice Presets**: 54 built-in voices
- **Apple Silicon**: Excellent. Runs effortlessly on any M-series chip. MLX support via mlx-audio
- **License**: Apache 2.0
- **Cost**: Under $1/million characters when served via API
- **Voice Cloning**: Not natively supported (preset voices only)
- [CONFIRMED] Best lightweight/fast option. Ideal for prototyping and low-latency scenarios. But limited voice customization

**Sesame CSM-1B -- CC BY-NC (non-commercial, Apache 2.0 planned)**
- **Architecture**: Llama backbone + audio decoder producing Mimi audio codes. 1B parameters
- **Quality**: Designed to cross the "uncanny valley" of conversational voice
- **Key Innovation**: Uses full conversation history to produce contextually appropriate speech
- **Voice Cloning**: Yes, from reference audio
- **Apple Silicon**: MLX support available. ~8.1GB VRAM on MLX, 4.5GB on CUDA
- **License**: Currently CC BY-NC. Apache 2.0 planned for future releases
- **Languages**: English primary. 20+ languages planned
- **Limitation**: Audio generation model only -- not a general LLM. Cannot generate text
- [CONFIRMED] Most conversationally aware model. BUT non-commercial license is a blocker for SolisHQ

**F5-TTS -- Mixed Licensing**
- **Architecture**: Flow matching with Diffusion Transformer (DiT). 335M parameters. Non-autoregressive
- **Quality**: Among the most realistic zero-shot voice cloning
- **Voice Cloning**: Zero-shot from few seconds of audio
- **Languages**: English, Chinese (more coming)
- **Emotional Range**: Emotion expression capabilities
- **License**: Original model CC BY-NC. OpenF5-TTS variant: Apache 2.0
- **Note**: Very active community. Emotion-conditioned variants exist
- [CONFIRMED] Strong cloning quality. Use OpenF5-TTS for commercial work

**StyleTTS 2 -- MIT License**
- **Architecture**: Style diffusion + adversarial training with large speech language models (WavLM as discriminator)
- **Quality**: Surpasses human recordings on LJSpeech (single speaker). Matches human on VCTK (multi-speaker). Published at NeurIPS 2023
- **Voice Cloning**: Zero-shot speaker adaptation
- **Emotional Range**: Style diffusion enables emotional synthesis conditioned on text
- **License**: MIT
- **Apple Silicon**: Not natively optimized. PyTorch MPS possible but untested
- **Limitation**: Research-oriented. Less production-ready than Chatterbox/Orpheus
- [CONFIRMED] Academically the first to demonstrate human-level TTS. Pioneer, but newer models have surpassed it in production readiness

**Spark-TTS (SparkAudio) -- CC BY-NC-SA (non-commercial)**
- **Architecture**: Built entirely on Qwen2.5 LLM. Eliminates need for separate flow-matching models
- **Quality**: Good naturalness
- **Voice Cloning**: Zero-shot, cross-lingual
- **Voice Design**: Controllable generation -- adjust gender, pitch, speaking rate
- **Languages**: Chinese, English
- **License**: CC BY-NC-SA 4.0 -- NON-COMMERCIAL ONLY
- [LIKELY] Interesting architecture but license blocks commercial use

**IndexTTS-2**
- **Architecture**: Based on XTTS with conformer speech encoder + BigVGAN2 decoder
- **Quality**: Outperforms SOTA in WER, speaker similarity, emotional fidelity
- **Speciality**: Precise duration control (ideal for video dubbing)
- **Voice Cloning**: Zero-shot
- **License**: Unclear from research -- needs verification
- [LIKELY] Best for dubbing/video use cases

#### Tier 3: Useful But Limited

**Bark (Suno) -- Commercial Use Allowed**
- **Architecture**: GPT-style, similar to AudioLM and VALL-E. Uses EnCodec
- **Quality**: Good for creative/expressive audio. Less consistent for clean TTS
- **Unique**: Can generate music, background noise, sound effects. Nonverbal sounds (laughing, sighing, crying)
- **Voice Presets**: 100+ across supported languages
- **Limitation**: Not conventional TTS -- fully generative. Can deviate unexpectedly from script
- **Speed**: Slow inference
- [CONFIRMED] Creative tool, not production TTS. Useful for sound effects/non-speech

**Tortoise TTS -- Apache 2.0**
- **Architecture**: Autoregressive + diffusion decoder. Trained on ~50K hours
- **Quality**: Very high (multi-voice probabilistic model)
- **Speed**: Extremely slow. ~2 minutes per sentence on K80. tortoise-tts-fast gets 5x improvement
- **Voice Cloning**: Yes, good quality
- [CONFIRMED] Legacy. Quality was once best-in-class but speed makes it impractical vs. modern alternatives

**Piper TTS -- GPL**
- **Architecture**: VITS-based, ONNX runtime. Extremely lightweight
- **Quality**: Good for its size class. Not human-level
- **Speed**: 10x faster than real-time. Runs on Raspberry Pi 4
- **License**: GPL (copyleft)
- **Use Case**: Embedded systems, offline voice assistants
- [CONFIRMED] Wrong tool for SolisHQ. Quality insufficient. GPL license incompatible with Apache 2.0 products

**XTTS v2 (Coqui) -- Coqui Public Model License (non-commercial)**
- **Architecture**: Multilingual voice cloning from 6-second audio clips
- **Quality**: Good, but surpassed by Chatterbox, Orpheus, Qwen3-TTS
- **Languages**: 17 languages
- **Status**: Coqui company shut down in early 2024. Community-maintained
- **License**: Non-commercial only
- [CONFIRMED] Historical significance but superseded. Non-commercial license is a blocker

**MetaVoice-1B -- Apache 2.0**
- **Architecture**: 1.2B parameters, trained on 100K hours
- **Quality**: Very high English quality with emotional tone control
- **Voice Cloning**: Zero-shot from 30 seconds (American & British voices)
- **Limitation**: English only. MetaVoice acquired by ElevenLabs -- future uncertain
- [LIKELY] Quality is excellent but single-language and uncertain future

**VoiceCraft -- CC BY-NC-SA**
- **Architecture**: Token infilling neural codec language model
- **Unique Feature**: Speech editing (insert, delete, replace operations within existing recordings)
- **Quality**: Nearly indistinguishable edits from unedited recordings
- **License**: Non-commercial
- [LIKELY] Useful for voice editing use cases. Not for primary TTS pipeline

**Parler TTS (Hugging Face)**
- **Architecture**: Text-describable voice generation
- **Quality**: Moderate. Controls gender, pitch, speaking style, background noise
- **Unique**: Natural language voice description ("a warm female voice with a slight British accent")
- **License**: Open source
- [LIKELY] Interesting for voice design exploration, but quality below production tier

#### Models NOT Available for Use

**VALL-E / VALL-E 2 / VALL-E X (Microsoft)**
- **Quality**: VALL-E 2 achieved first human parity in zero-shot TTS
- **Status**: Research paper only. Microsoft never released code or pretrained models
- **Community**: Open-source reimplementations exist but quality is significantly below the paper
- [CONFIRMED] Influential research, but unavailable. Its ideas live on in Orpheus, Fish Speech, etc.

### 1.4 Summary: The Field in March 2026

The TTS landscape has undergone a revolution. Key trends:

1. **Quality convergence**: Top open-source models (Chatterbox, Orpheus, Fish Speech) now rival commercial offerings in blind tests
2. **Emotion as differentiator**: Raw quality is table stakes. Emotional intelligence (Hume), controllability (Orpheus), and conversational awareness (Sesame CSM) are the new frontiers
3. **LLM-based architectures dominate**: Qwen3-TTS, Orpheus, CosyVoice -- all built on LLM backbones (Qwen, Llama). This is the winning architecture pattern
4. **Voice design emerging**: Qwen3-TTS and Parler TTS allow creating voices from text descriptions. This eliminates the need for reference audio
5. **Apple Silicon is a first-class target**: mlx-audio supports Kokoro, Qwen3-TTS, CSM, Chatterbox, Orpheus, and more natively on M-series chips
6. **Sub-100ms latency achieved**: Cartesia Sonic 3 at 40ms TTFA. Orpheus at 25-50ms streaming. Real-time conversation is solved

---

## Part 2: Voice Identity Design

### 2.1 What Research Says About Voice Perception

#### Gender
[CONFIRMED] Research from Nature (Scientific Reports, 2025) shows voice gender preference is context-dependent:
- **Male voices**: Favored for authority, expertise, financial advising, technical support
- **Female voices**: Preferred for assistance, customer service, navigation, healthcare
- **Gender role congruity**: When voice gender aligns with expected role, trust increases. When misaligned, trust-enhancing effect of gender similarity diminishes

[CONFIRMED] Most voice assistants (Siri, Alexa, Cortana) defaulted to female voices based on anecdotal evidence that users prefer female voices across cultures. However, this is increasingly challenged:
- Apple, Google, and Amazon now offer gender-neutral or male-first options
- Research suggests the "female preference" was overfit to assistant/servant framing

**SolisHQ Recommendation**: The Solis voice should be gender-fluid or offer both options, but the DEFAULT should be chosen based on the product's positioning:
- Solis as "AI partner/co-worker" (not servant) --> slightly masculine or androgynous voice conveys authority + partnership
- Accipio as "commerce intelligence" --> neutral/professional
- Vox as "personal assistant" --> warm, potentially feminine undertones for approachability

**First-principles derivation**: SolisHQ positions itself as an engineering-grade AI company, not a consumer assistant. The voice should convey **competence, partnership, and depth** -- not servility. A warm baritone with moderate pitch variation is the optimal default.

#### Age
[LIKELY] Research on perceived age in voice:
- Young voices (20-30): Energetic, innovative, but potentially lacking gravitas
- Mid-range voices (30-45): Sweet spot. Competence + energy. The "experienced colleague" archetype
- Older voices (50+): Authority, wisdom, but potentially perceived as slow or old-fashioned

**SolisHQ Recommendation**: Target 30-40 perceived age. Mature enough for trust, young enough for dynamism.

#### Accent & Pronunciation
[CONFIRMED] International English (non-regional) is most universally understood. Specific findings:
- Neutral American English has the widest comprehension base globally
- British RP (Received Pronunciation) signals formality/expertise but can feel distant
- Regional accents (Southern US, Australian, etc.) polarize -- some love, some struggle to understand

**SolisHQ Recommendation**: Neutral American English as default, with clear diction. Future: offer accent variants per market.

#### Speaking Rate
[CONFIRMED] Research consistently identifies 150-160 WPM as optimal:
- University of Edinburgh study: Listeners at 190+ WPM retained 30% less information
- Comprehension drops dramatically above 160 WPM
- Princeton University (2014): Moderate-paced speakers rated 20% more trustworthy than fast/slow extremes
- Rhythmic pace with pauses every 4-6 words: 27% higher retention vs. uneven/rushed speech

**SolisHQ Implementation**: Target 150 WPM baseline. Adjust contextually:
- Complex explanations: 130-140 WPM
- Routine confirmations: 160-170 WPM
- Urgent alerts: 140-150 WPM with emphasis

### 2.2 The Uncanny Valley of Voice

[CONFIRMED] Sesame AI's research on "crossing the uncanny valley of conversational voice" identifies the core challenge:

> Characters with inconsistently artificial and human features are perceived more negatively than characters that are consistently artificial or human.

**Key findings**:
1. Nearly-human voices with subtle flaws feel MORE unsettling than obviously robotic ones
2. Discomfort peaks when users cannot immediately tell if the voice is artificial
3. What matters is not perfect human-likeness but **naturalness and consistency**
4. The solution: "embrace imperfection -- not perfect voices, but believable ones"

**SolisHQ Design Principles**:
- Do NOT aim for perfect human mimicry. Aim for consistent, warm, slightly stylized speech
- Include subtle breathing sounds (increases perceived humanness)
- Occasional strategic micro-pauses (cognitive processing simulation)
- Do NOT include filler words ("um", "uh") -- these work for humans gaining trust but feel artificial when an AI uses them
- The voice should be recognizably "Solis" -- a signature, not a disguise

### 2.3 Emotional Range Requirements

For SolisHQ's product suite, the following emotional states are critical:

| Emotion | Priority | Use Case |
|---------|----------|----------|
| **Confidence** | Critical | Default speaking mode. Authoritative but not arrogant |
| **Warmth** | Critical | Greetings, positive confirmations, good news |
| **Empathy** | Critical | Error acknowledgment, user frustration, apologies |
| **Curiosity** | High | Asking clarifying questions, exploring options |
| **Urgency** | High | Alerts, time-sensitive information, security warnings |
| **Humor** | Medium | Light moments, easter eggs, personality display |
| **Apology** | Medium | Mistakes, service failures, limitations |
| **Excitement** | Medium | Achievements, milestones, positive discoveries |
| **Calm authority** | High | Complex explanations, technical guidance |

### 2.4 The Solis Voice Identity Specification

```
Name: "Solis Voice" (internal codename until personality is finalized)
Gender: Warm baritone (perceived male, ~30-40 years)
Pitch: Medium-low fundamental frequency (F0: 100-130 Hz)
Timbre: Clear, slightly resonant, not breathy
Speaking Rate: 150 WPM baseline, context-adaptive
Prosody: Moderate pitch variation (not monotone, not sing-song)
Breathing: Subtle breath sounds at natural pause points
Pauses: Thoughtful micro-pauses before important points
Emphasis: Key words slightly raised in pitch and volume
Emotional Range: Full (see table above)
Consistency: Same identity across all products
Uniqueness: Not cloned from any real person. Synthetically designed
```

---

## Part 3: Custom Voice Creation Methods

### Method A: Voice Cloning (Record a Real Person)

**Process**: Hire voice actor, record speech, fine-tune TTS model on recordings

**Data Requirements**:
| Model | Minimum Audio | Recommended | Quality Level |
|-------|---------------|-------------|---------------|
| ElevenLabs | 30 seconds | 5-30 minutes | Good to excellent |
| Qwen3-TTS | 3 seconds | 30+ seconds | Good |
| XTTS v2 | 6 seconds | 10+ minutes | Moderate to good |
| Orpheus | Short sample | Not specified | Good |
| High-quality custom | 5-20 hours | 20+ hours | Excellent |

**Cost Estimates**:
- Fiverr voice cloning service: Starting at $95
- Non-SAG voice actor (1 hour recording): $300-$600
- Professional voice actor (full session, 2-4 hours): $1,000-$3,000
- SAG-AFTRA voice actor (full session): $3,000-$10,000+

**Legal Requirements (2025-2026)**:
[CONFIRMED] SAG-AFTRA contracts now require:
1. **Consent**: Written approval before any voice replication
2. **Compensation**: Fair payment (upfront fees or residuals)
3. **Control**: Actor retains right to decline or limit use

[CONFIRMED] California AB 2602 (effective Jan 1, 2025): Requires performer's contractual consent and proper representation before using a digital replica. Contract must include reasonably specific description of intended uses.

**Pros**: Unique voice guaranteed (it's a real person's voice). High quality achievable. Emotional range captured naturally.
**Cons**: Legal complexity. Ongoing obligations to the actor. Actor could become unavailable. Voice is "borrowed" -- not truly owned by SolisHQ. SAG-AFTRA restrictions expanding.

**Risk Assessment**: MEDIUM-HIGH. Legal landscape is shifting toward greater performer protections. Ongoing contractual obligations create dependency.

### Method B: Voice Design (Synthetic Creation)

**Process**: Use a model that supports voice attribute control to design a voice from parameters

**Available Tools**:
- **Qwen3-TTS Voice Design**: Describe voice in natural language ("a warm male voice with moderate pitch, confident tone, slight resonance"). Generates matching voice
- **Parler TTS**: Text-describable voices with control over gender, pitch, style, background noise
- **Spark-TTS**: Adjustable gender, pitch, speaking rate (but CC BY-NC-SA license blocks commercial use)
- **ElevenLabs Voice Design**: Create custom voices from text descriptions (commercial)

**Cost**: Zero for open-source tools. Only compute cost
**Legal**: No real person involved. No consent, compensation, or control issues. Voice is fully owned
**Quality**: Approaching cloned voice quality. Qwen3-TTS voice design is genuinely impressive
**Uniqueness**: Guaranteed -- the voice is mathematically generated

**Pros**: No legal risk. Full ownership. Infinite iteration. No dependency on a person
**Cons**: Quality may be slightly below best cloned voices. Less "natural" starting point. Requires iteration to find the right character

**Risk Assessment**: LOW. This is the future of custom voice creation

### Method C: Voice Mixing (Blend Multiple Sources)

**Process**: Interpolate between multiple voices in latent space

**Available Tools**:
- XTTS v2 supports speaker interpolation
- Some models support blending in embedding space
- Can combine characteristics: Voice A's timbre + Voice B's speaking style

**Cost**: Low (compute only)
**Quality**: Variable. Interpolation can produce artifacts
**Uniqueness**: High -- blended voices are mathematically unique

**Pros**: Creative flexibility. Can aim for specific characteristics
**Cons**: Harder to control. Quality unpredictable. May inherit artifacts from source voices

**Risk Assessment**: LOW-MEDIUM. Useful as exploration tool, not primary method

### Method D: Full Custom Training

**Process**: Train a TTS model from scratch on custom dataset

**Requirements**:
- Professional recording studio
- Voice talent for 20+ hours of diverse speech
- GPU cluster for training (minimum: 4x A100 for weeks)
- ML engineering expertise
- Total cost: $20,000-$100,000+

**Pros**: Maximum control. Highest possible quality. Full ownership of model and voice
**Cons**: Enormous cost and time. Requires ML expertise. Risk of failure

**Risk Assessment**: HIGH cost, LOW technical risk (proven approaches exist)

### Recommendation for SolisHQ

**Primary approach: Method B (Voice Design) using Qwen3-TTS**

Rationale:
1. Zero legal risk -- no person's voice, no contracts, no ongoing obligations
2. Qwen3-TTS voice design creates voices from text descriptions under Apache 2.0
3. Infinite iteration -- describe what you want, generate, evaluate, refine
4. Full ownership of the resulting voice
5. MLX support means it runs locally on Apple Silicon
6. If voice design quality is insufficient, can pivot to Method A (cloning a hired actor) using the same Qwen3-TTS model

**Fallback approach: Method A with non-SAG freelance voice actor**

If synthetic voice design doesn't achieve the desired character:
1. Hire a freelance voice actor through a platform with clear AI-training licensing
2. Record 1-2 hours of diverse speech (conversations, explanations, greetings, apologies)
3. Fine-tune Qwen3-TTS or Chatterbox on the recordings
4. Ensure contract explicitly grants perpetual, irrevocable rights for AI voice synthesis

---

## Part 4: Local-First Architecture (Apple Silicon)

### 4.1 The MLX Ecosystem

[CONFIRMED] mlx-audio is the primary TTS framework for Apple Silicon. Built on Apple's MLX framework by Prince Canuma (Blaizzy). Key facts:

- **Repository**: github.com/Blaizzy/mlx-audio
- **Maturity**: 265 commits, 16 releases, 1+ year in development
- **Swift Package**: mlx-audio-swift available for native macOS/iOS integration
- **Performance**: Up to 40% faster audio generation compared to PyTorch on Apple Silicon

**Supported TTS Models on MLX**:

| Model | Parameters | Languages | Voice Clone | Quality | License |
|-------|-----------|-----------|-------------|---------|---------|
| Kokoro | 82M | 9 | No (presets) | High | Apache 2.0 |
| Qwen3-TTS | 0.6B-1.7B | 10 | Yes (3s) | Very High | Apache 2.0 |
| CSM (Sesame) | 1B | English | Yes | Very High | CC BY-NC |
| Chatterbox | 350M | 15+ | Yes | Very High | MIT |
| Orpheus | 150M-3B | English | Yes | Very High | Apache 2.0 |
| Spark-TTS | 0.5B | 2 | Yes | Good | CC BY-NC-SA |
| Dia | - | English | No | Good | - |
| OuteTTS | - | English | No | Good | - |
| Ming Omni | 0.5B+ | Multi | Yes | Good | - |
| Voxtral | 4B | 9 | No (20 voices) | Good | - |

### 4.2 M1 Pro Performance Characteristics

[CONFIRMED] The M1 Pro has 16GB unified memory and 16-core GPU. Performance characteristics:

- **Kokoro-82M**: Sub-0.3 second inference for any text length. Real-time factor well below 1.0. Runs effortlessly
- **Sesame CSM-1B**: ~8.1GB VRAM on MLX. Fits in M1 Pro 16GB but leaves little headroom
- **Qwen3-TTS-0.6B**: Should fit comfortably. MLX support via community port. Performance data limited
- **Qwen3-TTS-1.7B**: Will require quantization (4-bit or 8-bit) to fit in 16GB alongside other processes
- **Chatterbox-350M**: 8GB VRAM minimum. Tight on M1 Pro 16GB but feasible
- **Orpheus-150M**: Comfortable fit. Larger variants (1B, 3B) will be tight or impossible

[CONFIRMED] Metal GPU via MLX is the recommended execution path for Apple Silicon in 2025-2026. CoreML has limitations with dynamic shapes and large parameter counts. Neural Engine is inflexible for general inference.

### 4.3 Apple's Native Voice APIs

[CONFIRMED] Apple provides two relevant APIs:

1. **AVSpeechSynthesizer**: System TTS API. Can use system voices, downloaded voices, and Personal Voice
2. **Speech Synthesis Provider**: Allows registering a custom speech synthesizer with the system, making it available to ALL apps

**Personal Voice** (introduced WWDC 2023):
- User records their own voice on-device
- Synthesis happens entirely on-device (privacy-first)
- Available via `requestPersonalVoiceAuthorization` API
- Intended for accessibility (Live Speech)
- Cannot be used to create arbitrary custom voices -- only the user's own voice

**Speech Synthesis Provider** (the interesting one):
- SolisHQ could register its custom TTS engine as a system-level speech synthesizer
- This would make the Solis voice available to any app using AVSpeechSynthesizer
- Requires building a proper Audio Unit extension
- This is how third-party TTS engines integrate with macOS/iOS

**SolisHQ Opportunity**: Build a Speech Synthesis Provider that wraps the MLX-based TTS model. This would:
1. Make the Solis voice a system-level voice on macOS
2. Enable any app to use the Solis voice
3. Demonstrate the voice technology to users outside the main product

### 4.4 Local Architecture Recommendation

```
                    SolisHQ Voice Engine (Local)

Text Input -----> [Prosody Planner] -----> [TTS Model (MLX)] -----> [Audio Output]
                       |                        |
                  LLM annotations          Model selection:
                  (emphasis, emotion,       - Kokoro-82M (fast, default)
                   pause markers)           - Qwen3-TTS (high quality, voice design)
                                            - Chatterbox (emotional, MIT)

                    Fallback: Cloud API (ElevenLabs/Cartesia)
                    when quality or language exceeds local capability
```

**Tiered approach**:
1. **Tier 1 (Fast/Default)**: Kokoro-82M via MLX. Sub-300ms. For routine confirmations, short phrases
2. **Tier 2 (Quality)**: Qwen3-TTS-0.6B via MLX. For longer speech, important communication
3. **Tier 3 (Cloud fallback)**: ElevenLabs or Cartesia API. For when local quality is insufficient or language is unsupported

---

## Part 5: Calibration Engine

### 5.1 Quality Metrics

[CONFIRMED] Standard metrics for TTS evaluation:

**Subjective (Human Evaluation)**:
- **MOS (Mean Opinion Score)**: Gold standard. 1-5 scale. Requires human evaluators. Expensive
- **MUSHRA**: Multiple Stimulus with Hidden Reference and Anchor. More discriminating than MOS
- **A/B Preference Testing**: Pairwise comparison. More reliable than absolute scoring. Used by TTS Arena

**Objective (Automated)**:
- **UTMOS / UTMOSv2**: Neural network that predicts MOS scores. Uses self-supervised learning (WavLM). Ensemble of deep NNs. State-of-the-art automated quality metric. BUT: saturates at very high quality levels (MUSHRA >80), losing discriminability among top systems
- **TTSDS2**: The ONLY objective metric achieving Spearman correlation >0.50 with every subjective score. Mean correlation 0.67. Provides factor-level diagnostics. Better than UTMOS for distinguishing modern high-quality systems
- **PESQ / POLQA**: Standardized telecom quality metrics. Good for comparing degradation but not naturalness
- **WER (Word Error Rate)**: Measures intelligibility. Fish Speech V1.5: 3.5% WER
- **Speaker Similarity (SIM)**: Cosine similarity of speaker embeddings. Measures how well a cloned voice matches the original
- **F0 Contour Analysis**: Measures pitch patterns. Good for prosody evaluation
- **Distill-MOS**: Compressed MOS predictor. More efficient than full UTMOS

**Emerging (2025-2026)**:
- **URGENT-PK**: System ranking via pairwise comparisons rather than absolute MOS. Motivated by evidence that humans are more reliable in A/B tests
- **Semantic coherence metrics**: Measuring whether the voice's emotion matches the text content

### 5.2 SolisHQ Calibration Architecture

```
                     Calibration Loop

[TTS Output] ---> [Automated Metrics] ---> [Score Dashboard]
                        |                        |
                   UTMOS/TTSDS2              Trend tracking
                   WER (via Whisper)         Regression alerts
                   Speaker SIM               Quality gates
                   F0 analysis
                        |
                   [Human Eval (periodic)]
                        |
                   A/B tests with users
                   MOS scoring sessions
                        |
                   [Model Selection / Tuning]
                        |
                   Adjust parameters
                   Switch models
                   Fine-tune
```

**Implementation Plan**:

1. **Automated Pipeline** (run on every voice generation):
   - UTMOS score (threshold: >4.0 for production, >3.5 for development)
   - WER via Whisper transcription + comparison (threshold: <5%)
   - Latency measurement (threshold: <500ms for local, <300ms for cloud)

2. **Periodic Human Evaluation** (weekly during development, monthly in production):
   - A/B tests: Solis voice vs. ElevenLabs reference
   - MOS scoring on representative sentences across all emotion types
   - "Uncanny valley" detection: Binary question "does this sound natural?"

3. **Regression Detection**:
   - Track UTMOS and WER over time
   - Alert if scores drop >0.2 UTMOS or >1% WER from baseline
   - Automatic rollback to previous model version if regression detected

4. **Continuous Improvement**:
   - Quarterly model upgrades as new open-source models release
   - Fine-tuning on user feedback (opt-in voice quality ratings)
   - A/B test new models against current production voice

### 5.3 Target Quality Levels

| Phase | UTMOS Target | WER Target | Human MOS Target | Timeline |
|-------|-------------|------------|------------------|----------|
| MVP | >3.5 | <8% | >3.5 | This week |
| V1 | >4.0 | <5% | >4.0 | This month |
| V2 | >4.3 | <3% | >4.3 | Q2 2026 |
| Human Parity | >4.5 | <2% | >4.5 | Q4 2026 |

---

## Part 6: Voice Pipeline Architecture

### 6.1 End-to-End Pipeline

```
[1. Text Source]
    Claude / Solis Agent / Accipio generates text response
         |
         v
[2. Prosody Planning]
    LLM annotates text with:
    - Emotion tags: <confident>, <warm>, <urgent>
    - Emphasis markers: *important word*
    - Pause indicators: ... (thoughtful pause)
    - Speaking rate modifiers: [slow]complex explanation[/slow]
         |
         v
[3. SSML Generation]
    Convert annotations to model-specific format:
    - Chatterbox: [laugh], [cough], emotion exaggeration level
    - Orpheus: Emotion prompt text
    - Qwen3-TTS: Emotion/prosody instructions
    - Generic: SSML tags (<emphasis>, <break>, <prosody>)
         |
         v
[4. Model Selection]
    Based on:
    - Required quality (routine vs. important)
    - Latency budget (real-time vs. async)
    - Emotion complexity
    - Language
    Route to: Kokoro (fast) | Qwen3-TTS (quality) | Cloud (fallback)
         |
         v
[5. TTS Inference]
    MLX-based inference on Apple Silicon
    Streaming output (chunk-by-chunk audio generation)
         |
         v
[6. Audio Post-Processing]
    - Volume normalization
    - Silence trimming
    - Optional: noise gate
    - Quality check: UTMOS score
         |
         v
[7. Audio Output]
    - macOS audio output (AVAudioPlayer / Core Audio)
    - Streaming to speaker/headphones
    - Optional: save to file for async playback
```

### 6.2 Key Architecture Decisions

**Should prosody be LLM-controlled?**
[LIKELY] Yes. The agent (Claude/Solis) that generates the text understands the intent and emotion better than any post-hoc analysis. The text generation step should include prosody hints. This is how Hume AI's EVI works -- the LLM is trained on text + emotion tokens together.

**SSML vs. model-native control**:
Modern TTS models (Chatterbox, Orpheus, Qwen3-TTS) support emotion control natively through text prompts or special tokens. SSML is useful as a cross-model abstraction layer but most models have richer native controls.

**Streaming architecture**:
[CONFIRMED] Critical for real-time conversation. The pipeline should:
1. Begin TTS inference as soon as the first sentence is complete (not waiting for full response)
2. Stream audio chunks to the speaker while generating subsequent chunks
3. Support interruption: if user speaks, stop current audio generation immediately

**Interrupt handling**:
When the user speaks mid-sentence:
1. Immediately stop audio playback
2. Cancel remaining TTS generation
3. Route user speech to STT (Whisper)
4. Process user input
5. Generate response and resume TTS

**Multi-language strategy**:
- English: Local (Kokoro, Qwen3-TTS, Chatterbox)
- Major languages (Chinese, Japanese, Korean, Spanish, French, German): Local via Qwen3-TTS or Fish Speech
- Other languages: Cloud fallback (ElevenLabs with 70+ languages)
- SAME VOICE IDENTITY across all languages (this is hard -- requires voice cloning that transfers across languages)

### 6.3 Integration with Current Vox Architecture

Current Vox uses macOS `say` command with system voices. Migration path:

```
Phase 1 (This Week):
  Replace `say` with Kokoro-82M via mlx-audio CLI
  Same interface, dramatically better voice

Phase 2 (This Month):
  Implement voice selection layer
  Add Qwen3-TTS for quality mode
  Voice design: create the Solis voice identity

Phase 3 (This Quarter):
  Full prosody pipeline with LLM emotion annotations
  Streaming architecture
  Calibration engine
  Speech Synthesis Provider (system-level voice)
```

---

## Part 7: The Honest Recommendation

### Q1: What is the BEST voice model available right now?

**For raw quality**: Inworld TTS 1.5 Max (ELO 1583 on TTS Arena) or Vocu V3.0 (ELO 1583)
**For emotional intelligence**: Hume AI Octave 2 / EVI 3
**For ecosystem/accessibility**: ElevenLabs (70+ languages, voice cloning, voice design, massive community)
**For latency**: Cartesia Sonic 3 (40ms TTFA)

All are commercial, cloud-only services.

### Q2: What is the BEST voice model that runs LOCALLY on M1 Pro?

**For speed**: Kokoro-82M. 82M parameters, sub-300ms, Apache 2.0. Runs effortlessly on M1 Pro. 54 voice presets. But no custom voice cloning.

**For quality + features**: Chatterbox (350M, MIT, emotion control, voice cloning, Apple Silicon via MLX). Tight fit on 16GB but feasible.

**For voice design (creating a unique voice)**: Qwen3-TTS-0.6B (Apache 2.0, create voices from text descriptions, 3-second cloning, MLX support). This is the most strategically important model for SolisHQ.

**Best balance**: Kokoro for fast/routine speech + Qwen3-TTS for quality/custom voice work.

### Q3: What is the cheapest path to a unique, human-sounding voice?

**$0 path**:
1. Install mlx-audio (`pip install mlx-audio`)
2. Use Qwen3-TTS voice design to describe the Solis voice in natural language
3. Generate samples, iterate on the description until satisfied
4. Use the designed voice across all products
5. Total cost: $0 (your time only)

**$100-$500 path** (if synthetic voice design isn't enough):
1. Hire a freelance voice actor on Fiverr/Voices.com ($100-$300 for 1-hour recording)
2. Ensure contract explicitly grants AI training and synthesis rights in perpetuity
3. Fine-tune Qwen3-TTS or Chatterbox on the recordings
4. Total cost: $100-$500

### Q4: What is the highest-quality path regardless of cost?

1. Hire a professional voice actor ($3,000-$5,000 for multi-session recording)
2. Record 10-20 hours of diverse speech in a professional studio ($2,000-$5,000 studio time)
3. Fine-tune the best available model (Chatterbox or Qwen3-TTS) on the recordings
4. Run UTMOS + human MOS evaluation
5. Iterate: additional recording sessions to fill quality gaps
6. Deploy locally via MLX with cloud fallback
7. Total cost: $10,000-$25,000

### Q5: What should SolisHQ do THIS WEEK?

1. **Install mlx-audio** and get Kokoro-82M running locally
   ```bash
   pip install mlx-audio
   # Test with: mlx_audio tts --model kokoro --text "Hello, I am Solis"
   ```

2. **Replace the `say` command in Vox** with Kokoro-82M
   - Same text-in, audio-out interface
   - Dramatically better voice quality immediately
   - Sub-300ms latency, fully local, Apache 2.0

3. **Install Qwen3-TTS** via mlx-audio and begin voice design experiments
   - Describe the target Solis voice in natural language
   - Generate 20-30 samples with different descriptions
   - Compare, iterate, narrow down the voice identity

4. **Set up UTMOS** for automated quality scoring of generated samples

### Q6: What should SolisHQ do THIS MONTH?

1. **Finalize the Solis voice identity** using Qwen3-TTS voice design
   - Lock down the voice parameters (pitch, timbre, warmth, speaking rate)
   - Generate a reference recording library (100+ phrases covering all emotions)
   - Run A/B tests against ElevenLabs and Apple system voices

2. **Build the voice selection layer**
   - Kokoro for fast/routine speech
   - Qwen3-TTS (or Chatterbox) for quality mode
   - Automatic selection based on context

3. **Implement basic prosody pipeline**
   - LLM-generated emotion tags in text
   - Map to model-native controls
   - Streaming audio output

4. **Set up calibration dashboard**
   - UTMOS scores for every generation
   - WER tracking
   - Latency tracking
   - Weekly human evaluation sessions

5. **Evaluate Chatterbox** side-by-side with Qwen3-TTS
   - Chatterbox's MIT license is even more permissive than Apache 2.0
   - Emotion exaggeration control is unique
   - 350M parameters may run faster than Qwen3-TTS-0.6B

### Q7: What should SolisHQ do THIS YEAR?

1. **Q2 2026**: Productionize the voice pipeline
   - Full streaming architecture
   - Interrupt handling
   - Multi-product deployment (Vox, Solis, Accipio)
   - Voice calibration reaching V1 quality targets (UTMOS >4.0)

2. **Q3 2026**: Voice as differentiator
   - Release the Solis voice as a Speech Synthesis Provider (system-level macOS voice)
   - Marketing: "The voice that IS your AI" -- recognition, not just quality
   - Multi-language voice identity (same character in English, Spanish, etc.)
   - Explore Sesame CSM when Apache 2.0 license is released (conversational awareness)

3. **Q4 2026**: Voice intelligence
   - Voice calibration reaching human parity (UTMOS >4.5)
   - Emotional intelligence: voice adapts to user's emotional state (inspired by Hume AI's approach)
   - Voice personalization: subtle adjustments per user preference
   - Consider whether the Solis voice should be offered as a product/API itself

4. **Ongoing**: Track the field
   - New models release monthly. Orpheus, Chatterbox, CosyVoice, Qwen3-TTS are all rapidly improving
   - The community MLX ports typically follow within weeks of a model release
   - Re-evaluate the primary TTS model quarterly

### Q8: What should SolisHQ NEVER do?

1. **NEVER use a stock/preset voice that every other product uses**
   - No "Alloy" (OpenAI), no "Rachel" (ElevenLabs), no "Samantha" (Apple)
   - These voices are heard by millions. They scream "generic AI"
   - The Solis voice must be unique -- designed, not selected from a dropdown

2. **NEVER lock into a single commercial vendor**
   - No "our voice is ElevenLabs voice ID xyz-123"
   - Commercial APIs change pricing, change models, deprecate voices
   - Always maintain a local-capable voice that doesn't depend on any API

3. **NEVER ship a voice that hasn't been calibrated**
   - Every voice change must pass through UTMOS + human evaluation
   - "It sounds good to me" is not a quality gate. Metrics are
   - Regression testing on voice changes, just like code changes

4. **NEVER clone a real person's voice without airtight legal agreements**
   - The legal landscape is tightening rapidly (SAG-AFTRA, California AB 2602)
   - If you must clone, use non-SAG freelancers with explicit, written AI-training licenses
   - Better yet: use synthetic voice design (Method B) and avoid the issue entirely

5. **NEVER pursue perfect human mimicry**
   - The uncanny valley research is clear: consistency > perfection
   - A slightly stylized, recognizably-Solis voice builds brand identity
   - A voice trying to pass as human and failing is worse than an honest AI voice

6. **NEVER let the voice be an afterthought**
   - Voice is not a feature. It is the interface
   - Every interaction with Solis products goes through the voice
   - Budget time, engineering resources, and iteration cycles for voice quality
   - Track voice quality with the same rigor as uptime or latency

7. **NEVER ignore the open-source wave**
   - The field moves at breakneck speed. Monthly new model releases
   - Commercial advantages are eroding. Chatterbox beats ElevenLabs in blind tests
   - SolisHQ's advantage is being early to the open-source local-first voice stack

8. **NEVER add filler words ("um", "uh") to AI speech**
   - Research shows fillers increase trust... for humans
   - When an AI uses fillers, it signals either dishonesty (pretending to think) or incompetence
   - Use thoughtful pauses instead -- they convey the same processing signal without the artifice

---

## Appendix A: Model Comparison Matrix

### Open-Source Models (Commercial-Use Allowed)

| Model | Params | License | Quality | Speed | Clone | Emotion | Languages | Apple Silicon | Best For |
|-------|--------|---------|---------|-------|-------|---------|-----------|---------------|----------|
| Chatterbox | 350M | MIT | 9/10 | 8/10 | Yes | Yes (exaggeration control) | 15+ | MLX | Overall best OSS |
| Orpheus | 150M-3B | Apache 2.0 | 9/10 | 9/10 | Yes (zero-shot) | Yes (guided prompts) | English (multi preview) | MLX (via mlx-audio) | Emotion control |
| Qwen3-TTS | 0.6B-1.7B | Apache 2.0 | 9/10 | 8/10 | Yes (3s) | Yes | 10 | MLX (community) | Voice design + clone |
| Fish Speech 1.5 | - | Apache 2.0 | 9/10 | 7/10 | Yes | Limited | 8 | Unknown | Multilingual |
| Kokoro | 82M | Apache 2.0 | 8/10 | 10/10 | No (presets) | Limited | 9 | MLX (native) | Speed / lightweight |
| CosyVoice2 | 0.5B | Apache 2.0 | 8/10 | 9/10 | Yes | Limited | Multi | Unknown | Streaming |
| StyleTTS 2 | - | MIT | 8/10 | 7/10 | Yes | Yes (style diffusion) | English | No | Research |
| OpenF5-TTS | 335M | Apache 2.0 | 8/10 | 7/10 | Yes | Yes | English, Chinese | Unknown | Voice cloning quality |
| MetaVoice | 1.2B | Apache 2.0 | 8/10 | 7/10 | Yes (30s) | Yes | English only | Unknown | English-only quality |
| Tortoise | - | Apache 2.0 | 7/10 | 2/10 | Yes | Limited | English | No | Legacy |
| Bark | - | Commercial OK | 6/10 | 3/10 | No (presets) | Yes (nonverbal) | Multi | No | Sound effects |

### Commercial Models

| Model | Quality | Latency | Clone | Emotion | Languages | Price/1K chars | Best For |
|-------|---------|---------|-------|---------|-----------|----------------|----------|
| ElevenLabs v3 | 9.5/10 | <300ms | Yes (30s) | Good | 70+ | $0.06-$0.12 | All-rounder |
| Inworld TTS 1.5 | 10/10 | <250ms | Yes | Good | Multi | $0.01 | Raw quality |
| Hume Octave 2 | 9/10 | <200ms | Personality | Best | 11 | Inquiry | Emotion |
| Cartesia Sonic 3 | 9/10 | 40ms | Yes | Good | Multi | Inquiry | Latency |
| OpenAI TTS | 8.5/10 | <500ms | Restricted | Good | 40+ | $0.015-$0.030 | Integration |
| Deepgram Aura-2 | 8/10 | 90ms | No | Limited | 7 | $0.030 | Enterprise |

### License Summary for SolisHQ

| License | Commercial OK | SolisHQ Compatible | Models |
|---------|---------------|-------------------|--------|
| Apache 2.0 | Yes | Yes | Qwen3-TTS, Orpheus, Fish Speech, Kokoro, CosyVoice2, OpenF5, MetaVoice, Tortoise |
| MIT | Yes | Yes | Chatterbox, StyleTTS 2 |
| CC BY-NC | No | NO | Sesame CSM, F5-TTS (original), Spark-TTS |
| CC BY-NC-SA | No | NO | VoiceCraft, Spark-TTS |
| Coqui PML | No | NO | XTTS v2 |
| GPL | Copyleft | NO (incompatible with Apache 2.0) | Piper |

---

## Appendix B: Sources

### TTS Model Rankings & Comparisons
- [Best Open-Source TTS Models 2026 - BentoML](https://www.bentoml.com/blog/exploring-the-world-of-open-source-text-to-speech-models)
- [TTS Model Comparison - Artificial Analysis](https://artificialanalysis.ai/text-to-speech/models)
- [Open-Source TTS Models - Modal](https://modal.com/blog/open-source-tts)
- [TTS Guide 2026 - Fat Cow Digital](https://fatcowdigital.com/blog/ai-topics/ai-text-to-speech-guide-2026/)
- [Best TTS APIs 2026 - Speechmatics](https://www.speechmatics.com/company/articles-and-news/best-tts-apis-in-2025-top-12-text-to-speech-services-for-developers)
- [Small TTS Models Guide - SiliconFlow](https://www.siliconflow.com/articles/en/best-small-text-to-speech-models-2025)
- [TTS Arena Leaderboard - Hugging Face](https://tts-agi-tts-arena-v2.hf.space/leaderboard)
- [Best TTS APIs 2026 - Inworld](https://inworld.ai/resources/best-voice-ai-tts-apis-for-real-time-voice-agents-2026-benchmarks)
- [TTS Model Comparison 2026 - Greeden](https://blog.greeden.me/en/2026/03/12/latest-tts-model-comparison-2026-the-definitive-guide-to-choosing-by-use-case-across-gemini-azure-elevenlabs-openai-amazon-polly-and-oss/)

### Individual Models
- [F5-TTS GitHub](https://github.com/swivid/f5-tts)
- [F5-TTS - Uberduck Review](https://www.uberduck.ai/post/f5-tts-is-the-most-realistic-open-source-zero-shot-text-to-speech-so-far)
- [StyleTTS 2 GitHub](https://github.com/yl4579/StyleTTS2)
- [StyleTTS 2 Paper - NeurIPS 2023](https://proceedings.neurips.cc/paper_files/paper/2023/hash/3eaad2a0b62b5ed7a2e66c2188bb1449-Abstract-Conference.html)
- [Kokoro-82M - Hugging Face](https://huggingface.co/hexgrad/Kokoro-82M)
- [Kokoro TTS Review 2026](https://reviewnexa.com/kokoro-tts-review/)
- [Sesame CSM GitHub](https://github.com/SesameAILabs/csm)
- [Sesame - Crossing the Uncanny Valley](https://www.sesame.com/research/crossing_the_uncanny_valley_of_voice)
- [Orpheus TTS GitHub](https://github.com/canopyai/Orpheus-TTS)
- [Chatterbox GitHub (Resemble AI)](https://github.com/resemble-ai/chatterbox)
- [Chatterbox - BentoML Overview](https://www.bentoml.com/blog/exploring-the-world-of-open-source-text-to-speech-models)
- [Fish Speech GitHub](https://github.com/fishaudio/fish-speech)
- [Fish Speech 1.5 - Hugging Face](https://huggingface.co/fishaudio/fish-speech-1.5)
- [Qwen3-TTS GitHub](https://github.com/QwenLM/Qwen3-TTS)
- [Qwen3-TTS Launch Blog](https://qwen.ai/blog?id=qwen3tts-0115)
- [CosyVoice2 Paper](https://funaudiollm.github.io/pdf/CosyVoice_2.pdf)
- [CosyVoice GitHub](https://github.com/FunAudioLLM/CosyVoice)
- [IndexTTS](https://index-tts.github.io/)
- [Spark-TTS GitHub](https://github.com/SparkAudio/Spark-TTS)
- [Bark GitHub (Suno)](https://github.com/suno-ai/bark)
- [Tortoise TTS GitHub](https://github.com/neonbjb/tortoise-tts)
- [Piper TTS GitHub](https://github.com/OHF-Voice/piper1-gpl)
- [XTTS v2 - Hugging Face](https://huggingface.co/coqui/XTTS-v2)
- [MetaVoice GitHub](https://github.com/metavoiceio/metavoice-src)
- [VoiceCraft GitHub](https://github.com/jasonppy/VoiceCraft)
- [Parler TTS - Hugging Face](https://huggingface.co/papers)

### Commercial Services
- [ElevenLabs Pricing](https://elevenlabs.io/pricing/api)
- [ElevenLabs vs OpenAI TTS - Vapi](https://vapi.ai/blog/elevenlabs-vs-openai)
- [Cartesia Sonic 3](https://cartesia.ai/sonic)
- [Hume AI Octave 2](https://www.hume.ai/blog/octave-2-launch)
- [Hume AI EVI 3](https://www.hume.ai/blog/introducing-evi-3)
- [Deepgram Aura-2](https://deepgram.com/learn/introducing-aura-2-enterprise-text-to-speech)
- [OpenAI TTS Guide](https://platform.openai.com/docs/guides/text-to-speech)
- [OpenAI Custom Voice API](https://platform.openai.com/docs/api-reference/audio/createVoice)
- [PlayHT Pricing](https://play.ht/)
- [Resemble AI Pricing](https://www.resemble.ai/pricing/)
- [WellSaid Labs Pricing](https://www.wellsaid.io/pricing)
- [Inworld TTS](https://inworld.ai/tts)

### Apple Silicon & MLX
- [mlx-audio GitHub](https://github.com/Blaizzy/mlx-audio)
- [mlx-audio-swift GitHub](https://github.com/Blaizzy/mlx-audio-swift)
- [Kokoro on Apple Silicon - DEV Community](https://dev.to/xadenai/building-a-local-voice-ai-stack-whisper-ollama-kokoro-tts-on-apple-silicon-eo0)
- [Sesame CSM MLX GitHub](https://github.com/senstella/csm-mlx)
- [Sesame CSM Gradio (CUDA/MLX/CPU)](https://github.com/akashjss/sesame-csm)
- [Qwen3-TTS Apple Silicon](https://github.com/kapi2800/qwen3-tts-apple-silicon)
- [MLX Benchmarking Paper](https://arxiv.org/abs/2510.18921)
- [Apple Speech Synthesis Provider](https://developer.apple.com/documentation/AVFAudio/creating-a-custom-speech-synthesizer)
- [Apple Personal Voice - WWDC23](https://developer.apple.com/videos/play/wwdc2023/10033/)

### Voice Identity Research
- [AI Voice Gender and Trust - Nature Scientific Reports 2025](https://www.nature.com/articles/s41598-025-00884-9)
- [Voice Pitch and Trust Perception](https://www.sciencedirect.com/science/article/abs/pii/S0003687022001879)
- [Perceived Tone, Age, Gender on Voice Assistants](https://arxiv.org/pdf/2405.04791)
- [Uncanny Valley of Voice - ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2451958824000630)
- [Imperfection in AI Voice - Wayline](https://www.wayline.io/blog/ai-voice-uncanny-valley-imperfection)
- [Speaking Rate and Comprehension](https://tctecinnovation.com/blogs/daily-blog/how-your-speaking-speed-affects-what-people-remember)
- [150 WPM Sales Pace](https://www.hyperbound.ai/blog/150-words-minute-sales-pace)
- [ElevenLabs Conversational Voice Design Guide](https://elevenlabs.io/docs/conversational-ai/best-practices/conversational-voice-design)

### Quality Metrics
- [UTMOS Overview](https://www.emergentmind.com/topics/utmos)
- [TTSDS2 Paper](https://www.isca-archive.org/ssw_2025/minixhofer25_ssw.pdf)
- [UrgentMOS](https://arxiv.org/html/2601.18438)
- [TTS Evaluation Metrics GitHub](https://github.com/Shengqiang-Li/TTS-Evaluation)
- [TTS Benchmark 2025 - Smallest.ai](https://smallest.ai/blog/tts-benchmark-2025-smallestai-vs-elevenlabs-report)

### Legal
- [SAG-AFTRA AI Resources](https://www.sagaftra.org/contracts-industry-resources/member-resources/artificial-intelligence)
- [SAG-AFTRA Replica Studios Agreement](https://www.sagaftra.org/sag-aftra-and-replica-studios-introduce-groundbreaking-ai-voice-agreement-ces)
- [AI Clauses in Entertainment Contracts](https://rodriqueslaw.com/blog/ai-clauses-entertainment-contracts/)
- [California AB 2602 - AI and Entertainment](https://www.dwt.com/insights/2025/03/state-laws-regulating-ai-in-entertainment-industry)
- [OpenAI Voice Engine Status (TechCrunch)](https://techcrunch.com/2025/03/06/a-year-later-openai-still-hasnt-released-its-voice-cloning-tool/)

---

## Document History

| Date | Author | Change |
|------|--------|--------|
| 2026-03-30 | SolisHQ Research | Initial comprehensive research |

---

*SolisHQ -- We innovate, invent, then disrupt.*
*The voice is not a feature. It is the soul.*
