# Voice Calibration Engine Specification

**Version:** 1.0.0
**Date:** 2026-03-30
**Author:** SolisHQ Research (Researcher Agent)
**Status:** Research-Complete, Ready for Implementation Review
**Classification:** Engineering Specification — Aerospace Precision

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Part 1: How Humans Judge Voice Quality](#2-part-1-how-humans-judge-voice-quality)
3. [Part 2: Automated Quality Metrics](#3-part-2-automated-quality-metrics)
4. [Part 3: Voice-Specific Calibration Targets](#4-part-3-voice-specific-calibration-targets)
5. [Part 4: The Calibration Loop Architecture](#5-part-4-the-calibration-loop-architecture)
6. [Part 5: Quality Gates](#6-part-5-quality-gates)
7. [Part 6: A/B Testing Framework](#7-part-6-ab-testing-framework)
8. [Part 7: Continuous Calibration (Post-Launch)](#8-part-7-continuous-calibration-post-launch)
9. [Part 8: Tools and Implementation](#9-part-8-tools-and-implementation)
10. [Appendix A: Research Sources and Confidence Levels](#10-appendix-a-research-sources-and-confidence-levels)

---

## 1. Executive Summary

This specification defines a complete automated voice calibration engine for three SolisHQ AI voices: **Anna** (warm, trust), **Nova** (clear, insight), and **Atlas** (measured, gravity). The engine takes a generated voice sample and returns a multi-dimensional score card with specific, research-derived thresholds for every acoustic parameter.

**Core Insight from Research:** The difference between "good TTS" and "indistinguishable from human" is not one dimension — it is at least nine. Sesame AI (Feb 2025) demonstrated that crossing the uncanny valley requires optimizing contextual prosody, natural imperfections, and conversational dynamics simultaneously. No single metric captures human-quality; the calibration engine must compose a multi-metric quality surface.

**State of the Art (March 2026):**
- UTMOS achieves Pearson correlation >0.87 with human MOS ratings
- Sesame CSM achieves near-indistinguishable speech via two-stage transformer on codec tokens
- Automated metrics saturate before human perception — the gap between MOS 4.2 and 4.8 requires sub-metrics

---

## 2. Part 1: How Humans Judge Voice Quality

### 2.1 The Nine Perceptual Dimensions

Human listeners evaluate voice quality across nine orthogonal dimensions. Each dimension must be measured independently because a voice can score perfectly on eight and fail catastrophically on one.

| # | Dimension | What Listeners Evaluate | Failure Mode |
|---|-----------|------------------------|--------------|
| 1 | **Naturalness** | "Does this sound like a real person talking?" | Uncanny valley — too perfect, robotic cadence |
| 2 | **Intelligibility** | "Can I understand every word effortlessly?" | Mumbled consonants, swallowed syllables |
| 3 | **Prosody** | "Does the rhythm feel right for the content?" | Monotone delivery, inappropriate emphasis |
| 4 | **Breathiness** | "Are there natural breath patterns?" | No breathing = robotic; too much = distracting |
| 5 | **Micro-pauses** | "Are thinking pauses in natural places?" | No pauses = machine-gun delivery; wrong pauses = broken |
| 6 | **Pitch Variation** | "Is the pitch contour natural?" | Monotone (too little) or sing-song (too much) |
| 7 | **Emotion** | "Does it convey warmth/clarity/authority?" | Flat affect or mismatched emotion |
| 8 | **Artifacts** | "Any clicks, buzzing, or unnatural transitions?" | Glitches destroy trust instantly |
| 9 | **Speaker Consistency** | "Same person throughout?" | Timbre drift mid-sentence |

**Evidence Level: CONFIRMED** — Multiple independent sources corroborate (ITU-T P.800, VoiceMOS Challenge 2024, MOS-Expanded scale research from Springer).

### 2.2 The Uncanny Valley of Voice

Research (ScienceDirect, 2024) confirms a vocal uncanny valley driven by **deviation from typical organic voices**. Key finding: it is not imperfection that triggers the uncanny valley — it is **inauthentic perfection**. A voice that is too smooth, too consistent, too rhythmically precise triggers listener discomfort.

**Implications for Calibration:**
- The engine must NOT optimize for maximum smoothness
- Natural jitter (0.2-0.5% cycle-to-cycle F0 variation) must be preserved
- Natural shimmer (0.3-1.0% amplitude variation) must be preserved
- Micro-imperfections are features, not bugs

### 2.3 MOS Methodology (ITU-T P.800)

The gold standard for subjective evaluation:
- Scale: 1 (Bad) to 5 (Excellent)
- Minimum: 4.0 for "near-human" quality
- Minimum: 4.5 for "indistinguishable from human" in isolation
- Context matters: A MOS of 4.5 in one test is not comparable to 4.5 in another
- Automated MOS predictors (UTMOS, NISQA) approximate this but have known ceiling effects above 4.2

---

## 3. Part 2: Automated Quality Metrics

### 3.1 Complete Metric Inventory

Every known metric for speech quality assessment, categorized by measurement type.

#### 3.1.1 Composite Quality Predictors (MOS Estimators)

| Metric | Measures | Reference Required | Library / Tool | M1 Pro | Latency/Sample | Human Correlation |
|--------|----------|-------------------|----------------|--------|----------------|-------------------|
| **UTMOS** (v2) | Overall naturalness MOS | No (non-intrusive) | `sarulab-speech/UTMOSv2` (PyTorch) | Yes (MPS) | ~200-500ms | r = 0.87 (Pearson) |
| **NISQA** (v2.0) | MOS + Noisiness + Coloration + Discontinuity + Loudness | No (non-intrusive) | `gabrielmittag/NISQA` (PyTorch), `torchmetrics` | Yes (MPS) | ~150-300ms | r = 0.85-0.90 |
| **DNSMOS** (P.835) | SIG (speech) + BAK (noise) + OVRL (overall) | No (non-intrusive) | `microsoft/DNS-Challenge` (ONNX), `speechmos` pip | Yes (CPU) | ~100-200ms | r = 0.94 (SIG), r = 0.98 (OVRL) |
| **MOSNet** | Overall MOS (voice conversion focus) | No (non-intrusive) | `lochenchou/MOSNet` (TF/Keras) | Yes (CPU) | ~100-200ms | r = 0.70-0.80 |
| **PESQ** (P.862) | Perceptual quality (narrowband/wideband) | Yes (full-reference) | `pip install pesq`, `torchmetrics[audio]` | Yes (CPU) | ~50-100ms | r = 0.93 (ITU standard) |
| **POLQA** (P.863) | Perceptual quality (super-wideband) | Yes (full-reference) | OPTICOM license (commercial) | Platform-dependent | ~100ms | r = 0.95 |
| **ViSQOL** | MOS-LQO (VoIP-optimized) | Yes (full-reference) | `google/visqol` (C++/Python) | Yes (CPU) | ~200ms | r = 0.90 |

**Selection for Calibration Engine:**
- **Primary:** UTMOS (non-intrusive, best general-purpose)
- **Secondary:** NISQA (sub-dimension breakdown), DNSMOS (noise/artifact detection)
- **Reference-based:** PESQ wideband (when reference audio available)
- **Excluded:** POLQA (commercial license), MOSNet (lower correlation, aging)

#### 3.1.2 Pitch and Prosody Metrics

| Metric | Measures | Tool | Computation | M1 Pro | Latency |
|--------|----------|------|-------------|--------|---------|
| **F0 Mean** | Average fundamental frequency (Hz) | Parselmouth (Praat), CREPE | Autocorrelation (Praat) or CNN (CREPE) | Yes | <50ms (Praat), ~100ms (CREPE) |
| **F0 Standard Deviation** | Pitch variation (Hz or semitones) | Parselmouth | SD of F0 contour, exclude unvoiced | Yes | <50ms |
| **F0 Range** | Min-max pitch span | Parselmouth | 5th-95th percentile of F0 | Yes | <50ms |
| **Jitter (local)** | Cycle-to-cycle F0 perturbation (%) | Parselmouth | Adjacent period comparison | Yes | <50ms |
| **Jitter (RAP)** | Relative average perturbation (%) | Parselmouth | 3-period running average | Yes | <50ms |

**F0 Extraction Method Selection:**
- **CREPE** for noisy or challenging audio (CNN-based, robust below 10 dB SNR)
- **Parselmouth pYIN** for clean audio (faster, well-validated, deterministic)
- Both produce F0 at 10ms hop size (100 frames/second)

#### 3.1.3 Voice Quality Metrics

| Metric | Measures | Tool | Target Range | M1 Pro | Latency |
|--------|----------|------|-------------|--------|---------|
| **HNR** | Harmonics-to-Noise Ratio (dB) | Parselmouth | 15-25 dB (modal voice) | Yes | <50ms |
| **Shimmer (local)** | Amplitude perturbation (%) | Parselmouth | 0.3-1.0% (natural) | Yes | <50ms |
| **H1-H2** | Spectral tilt / breathiness (dB) | PraatSauce / Parselmouth | 2-8 dB (modal), >8 dB (breathy) | Yes | <100ms |
| **H1-A3** | High-frequency spectral rolloff (dB) | PraatSauce | Voice-type dependent | Yes | <100ms |
| **Spectral Tilt** | Energy decay across frequency | Parselmouth / scipy | Voice-type dependent (dB/octave) | Yes | <50ms |
| **CPP** | Cepstral Peak Prominence (dB) | Parselmouth | >8 dB (clear voice) | Yes | <50ms |

#### 3.1.4 Temporal Metrics

| Metric | Measures | Tool | Target | M1 Pro | Latency |
|--------|----------|------|--------|--------|---------|
| **WPM** | Words per minute (speech rate) | Whisper ASR + timing | 140-170 WPM | Yes | ~500ms-2s (ASR) |
| **Pause Duration** | Mean/median pause length (ms) | Energy-based VAD + Parselmouth | 150-500ms (natural) | Yes | <100ms |
| **Pause Distribution** | Log-normal fit parameters | scipy + custom | Bi-Gaussian in log domain | Yes | <50ms |
| **Articulation Rate** | Syllables/sec excluding pauses | Whisper + phoneme alignment | 4.5-6.0 syl/sec | Yes | ~1-2s |

#### 3.1.5 Intelligibility Metrics

| Metric | Measures | Tool | Target | M1 Pro | Latency |
|--------|----------|------|--------|--------|---------|
| **WER** | Word Error Rate (%) | `jiwer` + Whisper large-v3 | <2% | Yes | ~1-3s |
| **CER** | Character Error Rate (%) | `jiwer` + Whisper | <1% | Yes | ~1-3s |
| **Homograph Accuracy** | Correct pronunciation of ambiguous words | Custom test set + Whisper | 100% (hard gate) | Yes | ~2-5s |

#### 3.1.6 Speaker Identity Metrics

| Metric | Measures | Tool | Target | M1 Pro | Latency |
|--------|----------|------|--------|--------|---------|
| **Speaker Cosine Similarity** | Identity preservation across samples | Resemblyzer (256-dim) | >0.85 (same voice) | Yes | ~200ms |
| **ECAPA-TDNN Similarity** | Speaker verification score | SpeechBrain ECAPA-TDNN | >0.80 | Yes | ~300ms |
| **Intra-speaker Variance** | Consistency across utterances | Batch embedding + std | <0.08 (cos dist std) | Yes | ~500ms/batch |

#### 3.1.7 Spectral Quality Metrics

| Metric | Measures | Tool | Target | M1 Pro | Latency |
|--------|----------|------|--------|--------|---------|
| **MCD** | Mel Cepstral Distortion (dB) | `pymcd` or `mel-cepstral-distance` | <5.0 dB (good), <4.0 dB (excellent) | Yes | <100ms |
| **Formant F1/F2/F3** | Vocal tract resonances (Hz) | Parselmouth | Voice-type dependent | Yes | <50ms |
| **LTAS Slope** | Long-Term Average Spectrum slope | scipy + numpy | Voice-type dependent | Yes | <100ms |

### 3.2 Metric Reliability Hierarchy

Not all metrics are equally trustworthy. This hierarchy determines tie-breaking:

1. **Tier 1 (Ground Truth):** Human MOS, Human A/B preference
2. **Tier 2 (High Correlation):** UTMOS (r=0.87), DNSMOS OVRL (r=0.98 for noise), PESQ (r=0.93)
3. **Tier 3 (Informative):** NISQA sub-dimensions, HNR, F0 statistics, WER/CER
4. **Tier 4 (Supplementary):** MCD, formant analysis, LTAS slope, jitter/shimmer
5. **Tier 5 (Diagnostic Only):** MOSNet, individual spectral tilt measures

When Tier 2 and Tier 3 metrics disagree, Tier 2 wins. When Tier 1 and Tier 2 disagree, Tier 1 wins absolutely.

---

## 4. Part 3: Voice-Specific Calibration Targets

### 4.1 Derivation Methodology

Every target below is derived from peer-reviewed research on acoustic correlates of the desired perceptual quality. The derivation chain is:

```
Personality Description
  -> Desired Perceptual Quality (warmth, clarity, authority)
    -> Acoustic Correlates from Literature
      -> Measurable Parameter + Target Range
```

### 4.2 Anna: Warm, Grounded, Trust

**Perceptual Goal:** A voice that makes listeners feel safe, understood, and at ease. Like a trusted friend explaining something important calmly.

| Parameter | Target | Tolerance | Derivation |
|-----------|--------|-----------|------------|
| **F0 Mean** | 190 Hz | +/- 15 Hz | Female conversational mean is 180-210 Hz. Warmth correlates with lower-mid register. 190 Hz sits in the "warm" zone — above the "dominant" zone (165-180 Hz) but below the "bright/energetic" zone (210-230 Hz). Sources: VoiceScience.org F0 norms; Springer voice trustworthiness review 2025. |
| **F0 SD** | 35 Hz (3.5 ST) | +/- 8 Hz | Female SD norm is 33-44 Hz. Warmth requires moderate variation — enough to avoid monotone (>25 Hz) but not so much it sounds excitable (>50 Hz). 35 Hz provides gentle, reassuring undulation. |
| **F0 Range (5-95th pct)** | 140-250 Hz | +/- 10 Hz bounds | Derived from mean 190 Hz +/- ~2 SD, with natural asymmetry (more room upward). |
| **Speaking Rate** | 155 WPM | +/- 10 WPM | Optimal comprehension at 150-160 WPM. Warmth benefits from slightly slower pace (trust requires processing time). 155 WPM is center of comfort zone. |
| **Pause Duration (median)** | 350 ms | +/- 100 ms | Natural conversational pauses: 200-500 ms median. Warmth benefits from slightly longer pauses (deliberate, not rushed). 350 ms signals "I'm thinking about what to say." |
| **HNR** | 18 dB | +/- 3 dB | Normal modal voice: 15-25 dB. Warmth correlates with slight breathiness (lower HNR = more noise). 18 dB is below the "crystal clear" zone (22+ dB) but well above "hoarse" (<12 dB). |
| **H1-H2 (Spectral Tilt)** | 7 dB | +/- 3 dB | Breathiness indicator. Modal voice: 2-6 dB. Breathy voice: >8 dB. Warmth benefits from slightly elevated H1-H2 (gentle spectral rolloff). 7 dB produces perceptible warmth without overt breathiness. |
| **Jitter (local)** | 0.35% | +/- 0.15% | Natural voice: 0.2-0.5%. Below 0.2% sounds synthetic. Above 0.5% sounds pathological. 0.35% is the natural sweet spot. |
| **Shimmer (local)** | 0.5% | +/- 0.2% | Natural voice: 0.3-1.0%. Same logic as jitter — preserve natural micro-variation. |
| **Speaker Similarity (self)** | >0.90 | hard floor | Anna must sound like Anna consistently. Higher than generic threshold (0.6) because identity consistency builds trust. |
| **UTMOS** | >=4.2 | hard floor | Near-human naturalness. 4.0 = "good with minor issues." 4.2 = consistently natural. |

**Formant Profile (Anna):**
- F1 (vowel openness): 500-800 Hz range (standard female)
- F2 (front-back): 1200-2200 Hz range (standard female)
- F3 (lip rounding/quality): 2500-3200 Hz — slightly lower than Nova for warmer timbre
- No prominent "actor's formant" peak (3-4 kHz) — warmth, not projection

### 4.3 Nova: Clear, Resonant, Insight

**Perceptual Goal:** A voice that makes listeners feel informed, illuminated, and engaged. Like a brilliant colleague explaining a breakthrough with contagious clarity.

| Parameter | Target | Tolerance | Derivation |
|-----------|--------|-----------|------------|
| **F0 Mean** | 210 Hz | +/- 15 Hz | Higher in female range for brightness and energy. Clarity correlates with slightly higher F0 (more harmonic energy in intelligibility-critical 1-4 kHz range). 210 Hz is "engaged conversational" register. |
| **F0 SD** | 42 Hz (4.0 ST) | +/- 8 Hz | Higher variation than Anna — Nova's insight quality requires more dynamic prosody. Emphasis patterns, rhetorical rises, discovery inflections all require larger pitch excursions. |
| **F0 Range (5-95th pct)** | 150-280 Hz | +/- 10 Hz bounds | Wider than Anna. Mean 210 Hz with larger SD produces broader excursion range. |
| **Speaking Rate** | 165 WPM | +/- 10 WPM | Faster than Anna — clarity and insight benefit from pace that conveys engagement without rushing. Still within 150-170 WPM comfort zone. |
| **Pause Duration (median)** | 280 ms | +/- 80 ms | Shorter than Anna — Nova's pauses are for emphasis and structure, not warmth. 280 ms is sufficient for cognitive punctuation without feeling slow. |
| **HNR** | 22 dB | +/- 3 dB | Higher HNR than Anna — clarity requires clean harmonic structure. 22 dB is "clear modal voice" territory. Less noise = crisper consonants, more intelligible. |
| **H1-H2 (Spectral Tilt)** | 4 dB | +/- 2 dB | Lower than Anna — less spectral tilt means more high-frequency energy, sharper harmonic definition. 4 dB is clean modal voice with presence. |
| **Jitter (local)** | 0.30% | +/- 0.10% | Slightly less than Anna. Clarity benefits from more periodic voice, but not perfectly periodic (which sounds synthetic). |
| **Shimmer (local)** | 0.4% | +/- 0.15% | Slightly less than Anna. Same reasoning. |
| **Speaker Similarity (self)** | >0.88 | hard floor | Slightly more tolerance than Anna because Nova's dynamic prosody naturally produces more embedding variance. |
| **UTMOS** | >=4.2 | hard floor | Same naturalness floor as Anna. |

**Formant Profile (Nova):**
- F1: 500-800 Hz (standard female)
- F2: 1300-2300 Hz — slightly higher mean than Anna for brighter vowel space
- F3: 2700-3400 Hz — higher than Anna, approaching "actor's formant" territory
- Moderate energy peak at 3-4 kHz (the "speaker's formant" / "ring") for projection and clarity

**Articulation Metrics (Nova-specific):**
- Consonant-vowel intensity ratio: higher than Anna (crisper consonants)
- Articulation rate: 5.5-6.0 syllables/sec (excluding pauses) — faster articulation reflects clarity
- Vowel space area (F1xF2 dispersion): larger than Anna — hyper-articulated vowels = clearer speech

### 4.4 Atlas: Measured, Deliberate, Authority

**Perceptual Goal:** A voice that makes listeners feel that someone serious and reliable is speaking. Like a seasoned leader delivering a considered judgment.

| Parameter | Target | Tolerance | Derivation |
|-----------|--------|-----------|------------|
| **F0 Mean** | 105 Hz | +/- 12 Hz | Male conversational mean: 100-120 Hz. Authority correlates with lower F0 (research: professionals lower pitch 14-33 Hz when giving expert advice). 105 Hz is "authoritative male" — low but not artificially so. |
| **F0 SD** | 20 Hz (3.0 ST) | +/- 6 Hz | Lower than Anna/Nova — authority requires measured, deliberate pitch movement. Research: charismatic male speakers use controlled F0 variation. 20 Hz avoids monotone (>15 Hz needed) while staying deliberate (<30 Hz). |
| **F0 Range (5-95th pct)** | 80-140 Hz | +/- 8 Hz bounds | Narrower than female voices. Mean 105 Hz with constrained SD. |
| **Speaking Rate** | 145 WPM | +/- 10 WPM | Slowest of the three — deliberation requires time. Authority suffers from speed (fast = anxious). 145 WPM is below comfort center but above attention-loss floor (120 WPM). |
| **Pause Duration (median)** | 420 ms | +/- 120 ms | Longest of the three — measured speakers pause more. Atlas's pauses are for gravity, weight. 420 ms is "considered" — the pause of someone who chooses words carefully. |
| **HNR** | 20 dB | +/- 3 dB | Between Anna and Nova. Authority requires a clear voice (not breathy) but with body (not clinical). 20 dB is healthy adult male modal voice. |
| **H1-H2 (Spectral Tilt)** | 3 dB | +/- 2 dB | Lowest of the three — authority benefits from strong harmonic presence across spectrum. Less spectral tilt = more "chest" quality. 3 dB is firm modal voice. |
| **Jitter (local)** | 0.30% | +/- 0.10% | Same as Nova — clean but natural. Male voices typically have slightly less jitter than female. |
| **Shimmer (local)** | 0.45% | +/- 0.15% | Natural male range. |
| **Speaker Similarity (self)** | >0.90 | hard floor | Authority requires absolute consistency — the listener must never doubt it's the same person. |
| **UTMOS** | >=4.2 | hard floor | Same naturalness floor. |

**Formant Profile (Atlas):**
- F1: 400-700 Hz (male range, lower than female)
- F2: 1000-1900 Hz — lower mean than female voices
- F3: 2200-2900 Hz — lower than female, contributing to perceived depth
- Formant dispersion: lower than female (formants closer together = perceived larger body/authority)
- Energy below 500 Hz: stronger than Anna/Nova — "chest resonance" quality

**Pacing Metrics (Atlas-specific):**
- Inter-phrase pause: 500-700 ms (longer than inter-word)
- Phrase-final lengthening: 1.3x normal syllable duration on final word of phrases
- Deliberation markers: occasional 600-800ms pauses mid-thought (not hesitation — weight)

---

## 5. Part 4: The Calibration Loop Architecture

### 5.1 System Overview

```
                          +---------------------+
                          |   TEXT + VOICE DESC  |
                          +----------+----------+
                                     |
                                     v
                          +----------+----------+
                          |   TTS GENERATION     |
                          |   (External Model)   |
                          +----------+----------+
                                     |
                                     v
                          +----------+----------+
                          |   METRIC ANALYZER    |
                          |   (This Engine)      |
                          |                      |
                          |  +----------------+  |
                          |  | F0 Analysis    |  |  <- Parselmouth + CREPE
                          |  +----------------+  |
                          |  | Voice Quality  |  |  <- HNR, H1-H2, Jitter, Shimmer
                          |  +----------------+  |
                          |  | MOS Prediction |  |  <- UTMOS, NISQA, DNSMOS
                          |  +----------------+  |
                          |  | Intelligibility|  |  <- Whisper + jiwer
                          |  +----------------+  |
                          |  | Speaker ID     |  |  <- Resemblyzer / ECAPA-TDNN
                          |  +----------------+  |
                          |  | Temporal       |  |  <- VAD + WPM calculation
                          |  +----------------+  |
                          |  | Spectral       |  |  <- MCD, LTAS, Formants
                          |  +----------------+  |
                          +----------+----------+
                                     |
                                     v
                          +----------+----------+
                          |   SCORE COMPILER     |
                          |                      |
                          |  Per-dimension score  |
                          |  Composite score      |
                          |  Delta from target    |
                          |  Pass/Fail per gate   |
                          +----------+----------+
                                     |
                          +----------+----------+
                          |   DECISION ENGINE    |
                          +----+------+----+----+
                               |      |    |
                    BETTER     |      |    |   ALL GATES
                    THAN BEST? |      |    |   PASSED?
                               v      v    v
                          +----+--+ +-+--+ +--+----+
                          | STORE | |RANK| | LOCK  |
                          | BEST  | |LOG | | VOICE |
                          +-------+ +----+ +-------+
                                              |
                                              v
                                     +--------+--------+
                                     |   ARCHIVE        |
                                     |   Score Card     |
                                     |   Audio File     |
                                     |   Parameters     |
                                     |   Timestamp      |
                                     +------------------+
```

### 5.2 Step-by-Step Specification

#### Step 1: INPUT

**Inputs:**
- `voice_id`: One of `anna`, `nova`, `atlas`
- `text`: The text to synthesize (minimum 30 words for statistical validity of metrics)
- `voice_config`: TTS model parameters (temperature, top_p, speaker embedding, etc.)
- `reference_audio` (optional): For full-reference metrics (PESQ)

**Validation:**
- Text must contain at least 3 sentences
- Text should include diverse phonemes (validation set provided)
- For comprehensive evaluation, use the Standard Calibration Corpus (see Section 5.4)

#### Step 2: GENERATE

**Action:** Call external TTS model with `voice_config` and `text`
**Output:** WAV file, 16kHz or 24kHz, mono, 16-bit PCM
**Automated:** Fully automated
**Duration constraint:** Audio must be 5-60 seconds for valid metric computation

#### Step 3: ANALYZE

**Action:** Run all applicable metrics in parallel where possible

**Parallelization groups:**
- **Group A (independent, CPU):** F0 analysis, HNR, jitter, shimmer, H1-H2, formants, spectral tilt, pause detection
- **Group B (independent, GPU):** UTMOS, NISQA, DNSMOS
- **Group C (independent, GPU):** Speaker embedding extraction
- **Group D (sequential, GPU):** Whisper transcription -> WER/CER calculation -> WPM calculation

Groups A, B, C run in parallel. Group D runs after audio is available.

**Total latency estimate (M1 Pro):**
- Groups A+B+C (parallel): ~500ms-1s
- Group D: ~2-4s
- **Total: ~3-5 seconds per sample**

#### Step 4: SCORE

**Action:** Compute per-dimension scores and composite score

**Per-dimension scoring:**
Each metric produces a raw value. The scoring function maps this to a 0-100 normalized score using the voice-specific target and tolerance:

```
score(metric, value, target, tolerance) =
  if |value - target| <= tolerance:
    100 - (|value - target| / tolerance) * 20    # 80-100 range
  elif |value - target| <= 2 * tolerance:
    60 + (2*tolerance - |value - target|) / tolerance * 20   # 60-80 range
  else:
    max(0, 60 - (|value - target| - 2*tolerance) / tolerance * 30)  # 0-60 range
```

**Composite score:**
Weighted sum of dimension scores. Weights reflect perceptual importance:

| Dimension | Weight | Justification |
|-----------|--------|---------------|
| UTMOS (naturalness) | 0.25 | Highest-correlation single metric |
| Intelligibility (WER) | 0.15 | Non-negotiable — must be understood |
| F0 conformance | 0.12 | Pitch is most perceptually salient |
| Prosody (F0 SD + pause patterns) | 0.12 | Rhythm and variation |
| Speaker consistency | 0.10 | Identity stability |
| Voice quality (HNR + H1-H2) | 0.10 | Warmth/clarity/authority signature |
| Artifacts (NISQA discontinuity) | 0.08 | Artifacts are trust-killers |
| Temporal (WPM + pauses) | 0.08 | Pacing and delivery |

Total: 1.00

#### Step 5: COMPARE

**Action:** Compare composite score to current best for this voice_id + text pair

**Decision logic:**
```python
if composite_score > best_score:
    store_as_new_best(sample, score_card)
    if all_gates_pass(score_card):
        flag_for_lock_review()
```

**Automated:** Fully automated comparison. Lock review can be automated or human-gated (see Step 6).

#### Step 6: ADJUST

**When composite score does not improve:**
- Log the parameter delta and score delta
- Adjust TTS parameters based on which dimensions scored lowest
- Parameter adjustment mapping (which TTS knob affects which metric):

| Low-Scoring Dimension | TTS Parameter to Adjust |
|-----------------------|------------------------|
| F0 too high/low | Speaker embedding pitch shift, model fine-tune |
| F0 SD too low (monotone) | Temperature increase, prosody model attention |
| WPM too fast/slow | Duration model parameters, pause insertion |
| HNR too low (breathy) | Speaker embedding selection, post-processing |
| Artifacts detected | Temperature decrease, denoiser post-processing |
| Speaker inconsistent | Embedding averaging across samples |

**Stopping criterion for adjustment loop:**
- Maximum 50 iterations per voice per text
- If no improvement in 10 consecutive iterations, declare plateau
- If composite score >90 but specific gates still fail, flag for human review

#### Step 7: GATE

**Action:** Check all quality gates (see Part 5)
**Decision:** All gates must pass. A single gate failure blocks lock.
**Human override:** Femi can override any gate with documented justification.

#### Step 8: ARCHIVE

**Stored per locked voice:**
- Audio file (WAV, 24kHz, 16-bit)
- Complete score card (all metrics, all values, all pass/fail)
- TTS parameters that produced this sample
- Timestamp and engine version
- Hash of audio file for integrity verification

### 5.3 Calibration Modes

| Mode | When | Behavior |
|------|------|----------|
| **Full Calibration** | New voice, new TTS model | Runs Standard Calibration Corpus (50+ texts), iterates up to 50x per text |
| **Quick Check** | Parameter tweak | Runs 5 key texts, single pass, reports scores |
| **Regression Test** | TTS model update | Runs locked corpus, compares to stored baseline, flags regressions >5% |
| **Continuous Monitor** | Production | Samples production output, alerts on drift |

### 5.4 Standard Calibration Corpus

The corpus must cover:
- Short utterances (5-10 words): greetings, acknowledgments
- Medium utterances (15-30 words): explanations, instructions
- Long utterances (50+ words): narratives, complex explanations
- Emotional range: neutral, encouraging, cautious, excited
- Phonetic coverage: all English phonemes in diverse contexts
- Edge cases: numbers, abbreviations, homographs (lead/lead, tear/tear, bass/bass, wound/wound, row/row)
- Prosodic challenges: lists, questions, exclamations, parenthetical asides

**Minimum corpus size:** 50 texts per voice (150 total)
**Recommended:** 100 texts per voice (300 total)

---

## 6. Part 5: Quality Gates

### 6.1 Gate Definitions

Every gate is binary: PASS or FAIL. All gates must pass to lock a voice.

#### Hard Gates (automatic, no override without Femi approval)

| Gate | Metric | Anna | Nova | Atlas | Ship Minimum | Rationale |
|------|--------|------|------|-------|-------------|-----------|
| **G1: Naturalness** | UTMOS | >=4.2 | >=4.2 | >=4.2 | >=4.0 | Below 4.0 is perceptibly synthetic |
| **G2: Intelligibility** | WER | <=2% | <=1.5% | <=2% | <=3% | Above 3% is unacceptable for any voice product |
| **G3: No Artifacts** | NISQA Discontinuity | >=4.0 | >=4.0 | >=4.0 | >=3.5 | Clicks/glitches destroy trust |
| **G4: Speaker ID** | Self-similarity | >=0.90 | >=0.88 | >=0.90 | >=0.85 | Must sound like same person |
| **G5: Homographs** | Accuracy | 100% | 100% | 100% | >=95% | Mispronounced homographs are instantly noticed |

#### Soft Gates (target, flagged for review if failed)

| Gate | Metric | Anna | Nova | Atlas | Derivation |
|------|--------|------|------|-------|------------|
| **G6: F0 Mean** | Hz | 175-205 | 195-225 | 93-117 | Target +/- tolerance from Part 3 |
| **G7: F0 SD** | Hz | 27-43 | 34-50 | 14-26 | Target +/- tolerance |
| **G8: Speaking Rate** | WPM | 145-165 | 155-175 | 135-155 | Target +/- tolerance |
| **G9: HNR** | dB | 15-21 | 19-25 | 17-23 | Target +/- tolerance |
| **G10: H1-H2** | dB | 4-10 | 2-6 | 1-5 | Target +/- tolerance |
| **G11: Jitter** | % | 0.20-0.50 | 0.20-0.40 | 0.20-0.40 | Natural range |
| **G12: Shimmer** | % | 0.30-0.70 | 0.25-0.55 | 0.30-0.60 | Natural range |
| **G13: Pause Median** | ms | 250-450 | 200-360 | 300-540 | Target +/- tolerance |
| **G14: NISQA Noisiness** | score | >=4.0 | >=4.2 | >=4.0 | Nova needs cleaner signal |
| **G15: NISQA Coloration** | score | >=3.8 | >=4.0 | >=3.8 | Coloration = timbral distortion |
| **G16: MCD** | dB | <=5.5 | <=5.0 | <=5.5 | Lower = closer to reference |

### 6.2 Gate Composition Rules

```
LOCK_ELIGIBLE = ALL(Hard Gates PASS) AND COUNT(Soft Gate FAIL) <= 2
```

A voice can be locked if:
- ALL 5 hard gates pass
- At most 2 of 11 soft gates fail (and those failures must be reviewed + justified)
- The composite score is >=85/100

### 6.3 Complete Score Card Template

```json
{
  "voice_id": "anna",
  "timestamp": "2026-03-30T14:22:00Z",
  "engine_version": "1.0.0",
  "audio_hash": "sha256:...",
  "text": "...",
  "composite_score": 91.3,
  "lock_eligible": true,
  "hard_gates": {
    "G1_utmos": { "value": 4.35, "target": 4.2, "pass": true },
    "G2_wer": { "value": 0.8, "target": 2.0, "pass": true },
    "G3_artifacts": { "value": 4.2, "target": 4.0, "pass": true },
    "G4_speaker_id": { "value": 0.93, "target": 0.90, "pass": true },
    "G5_homographs": { "value": 100, "target": 100, "pass": true }
  },
  "soft_gates": {
    "G6_f0_mean": { "value": 192, "target": 190, "tolerance": 15, "pass": true },
    "G7_f0_sd": { "value": 36, "target": 35, "tolerance": 8, "pass": true },
    "...": "..."
  },
  "raw_metrics": {
    "utmos": 4.35,
    "nisqa_overall": 4.1,
    "nisqa_noisiness": 4.3,
    "nisqa_coloration": 4.0,
    "nisqa_discontinuity": 4.2,
    "nisqa_loudness": 3.9,
    "dnsmos_sig": 4.1,
    "dnsmos_bak": 4.5,
    "dnsmos_ovrl": 4.2,
    "pesq_wb": null,
    "f0_mean": 192,
    "f0_sd": 36,
    "f0_range_5": 142,
    "f0_range_95": 248,
    "hnr": 18.2,
    "h1_h2": 6.8,
    "jitter_local": 0.33,
    "shimmer_local": 0.48,
    "wpm": 153,
    "pause_median_ms": 345,
    "wer": 0.8,
    "cer": 0.3,
    "speaker_similarity": 0.93,
    "mcd": 5.1,
    "cpp": 9.2
  }
}
```

---

## 7. Part 6: A/B Testing Framework

### 7.1 When to Use A/B Testing

Automated metrics have a **ceiling effect** above UTMOS ~4.3. When two samples both score above this threshold, the difference between them is often imperceptible to automated metrics but perceptible to humans. A/B testing bridges this gap.

**Trigger conditions:**
- Two candidate samples score within 3 points of each other (composite)
- Hard gates pass for both
- The dimension gap is in Tier 3+ metrics (where automated correlation is lower)

### 7.2 Blind A/B Test Protocol

**Test Design:** MUSHRA-inspired within-subject comparison (ITU-R BS.1534)

**Procedure:**
1. Listener hears Sample A and Sample B in randomized order (labels hidden)
2. Listener also hears a hidden reference (original human recording if available) and a low-quality anchor
3. Listener rates each on a 0-100 continuous scale for:
   - **Naturalness:** "How natural does this voice sound?"
   - **Voice Character:** "How well does this voice match [warm/clear/authoritative]?"
   - **Listening Comfort:** "How comfortable would you be listening to this voice for 10 minutes?"
   - **Preference:** "Which voice would you choose for daily use?"

**Questions (exactly four, no more):**
Fewer questions = less listener fatigue = more reliable responses. These four cover naturalness, personality match, sustained listening quality, and direct preference.

### 7.3 Sample Size and Statistical Significance

| Parameter | Value | Justification |
|-----------|-------|---------------|
| **Minimum listeners** | 15 | MUSHRA paired design requires fewer than MOS; ITU-R BS.1534 uses expert panels of 10-20 |
| **Recommended listeners** | 20-30 | Provides 95% CI width of ~5 MUSHRA points |
| **Significance level** | alpha = 0.05 | Standard |
| **Statistical test** | Paired t-test or Wilcoxon signed-rank | Paired design (same listener, both samples) |
| **Minimum detectable effect** | 5 MUSHRA points | Smaller differences are not perceptually meaningful |
| **Listener qualification** | Native English speakers, normal hearing, no audio engineering expertise | Expert listeners internalize the scale better but create non-representative results; naive listeners better match target users |

**Power calculation:**
With 20 listeners, paired design, SD ~15 MUSHRA points (typical), alpha=0.05:
- Power to detect 5-point difference: ~0.80
- Power to detect 10-point difference: ~0.99

### 7.4 Handling Ties

If A/B test shows no statistically significant difference (p > 0.05):
1. Check if confidence intervals overlap at the 90% level (less stringent)
2. If still tied: prefer the sample with higher speaker consistency score
3. If still tied: prefer the sample with lower artifact rate
4. If still tied: keep current best (inertia principle — don't change what works)

### 7.5 Partial Automation of Preference

Emerging research (E2EPref, 2025) shows that preference prediction models can approximate listener preferences with r ~0.75 correlation. This is insufficient to replace human testing but can:
- **Pre-filter** candidates before human testing (reduce from 20 candidates to 5)
- **Detect obvious losers** that would waste human evaluator time
- **Provide directional signal** during rapid iteration

**Recommendation:** Use UTMOS + NISQA composite as a pre-filter. Only escalate to human A/B when automated composite scores are within 3 points.

---

## 8. Part 7: Continuous Calibration (Post-Launch)

### 8.1 Regression Detection System

After a voice ships, quality can degrade from:
- TTS model updates (provider-side)
- Text patterns not covered during calibration
- Infrastructure changes (audio encoding, streaming artifacts)
- Gradual model drift

**Detection Architecture:**

```
Production Audio Stream
        |
        v (sample 1% of outputs)
  +-----+------+
  | Quick Score |  <- UTMOS + NISQA + Speaker Similarity only (fast path)
  +-----+------+
        |
        v
  +-----+------+
  | Baseline   |  <- Compare to stored calibration scores
  | Comparison |
  +-----+------+
        |
  +-----+------+
  | Alert       |
  | Engine      |
  +-------------+
```

**Alert Thresholds:**

| Condition | Severity | Action |
|-----------|----------|--------|
| UTMOS drops >0.2 from baseline | **Critical** | Immediate notification to Femi. Pause production if >0.5 drop. |
| Speaker similarity <0.80 vs reference | **Critical** | Voice identity crisis — immediate investigation |
| WER increases >2% from baseline | **High** | Investigate text patterns causing errors |
| Any NISQA sub-score drops >0.5 | **Medium** | Log and review within 24 hours |
| Composite score drift >5% over 7 days | **Medium** | Gradual drift detected — recalibrate |
| WPM drift >15 WPM from target | **Low** | Monitor, recalibrate at next cycle |

### 8.2 User Feedback Collection

**Mechanism:** Thumbs up/down on voice quality after each interaction

**Data collected:**
- Binary preference (good/bad)
- Optional: "What was wrong?" with pre-set categories:
  - "Sounded robotic"
  - "Couldn't understand some words"
  - "Sounded different than usual"
  - "Weird pauses or rhythm"
  - "Annoying tone"

**Statistical threshold for action:**
- If negative feedback rate exceeds 5% of interactions over 24-hour window: investigate
- If negative feedback rate exceeds 10%: emergency recalibration

### 8.3 Seasonal / Evolutionary Recalibration

Voices should evolve subtly over time — not because they degrade, but because user expectations and the competitive landscape shift.

**Cadence:**
- **Monthly:** Run full calibration corpus, compare to baseline, adjust if beneficial
- **Quarterly:** Review A/B test backlog, evaluate if a "better" version exists that exceeds current lock
- **Annually:** Full recalibration with updated UTMOS/NISQA models (as research advances)

### 8.4 New Text Pattern Detection

Monitor production for text patterns that expose weaknesses:
- Track WER by text category (numbers, names, technical terms, emotional content)
- Identify high-WER patterns and add to calibration corpus
- Track user feedback correlation with text features

**Automated weakness mining:**
```python
# Pseudo-code
for text, audio, metrics in production_samples:
    if metrics['wer'] > threshold or metrics['utmos'] < threshold:
        weakness_corpus.add(text, metrics)

# Quarterly: recalibrate specifically on weakness corpus
```

---

## 9. Part 8: Tools and Implementation

### 9.1 Language Decision: Python

**Decision: Python**

**Rationale:**
- All scoring tools are Python-native (UTMOS, NISQA, DNSMOS, Parselmouth, CREPE, Whisper)
- PyTorch ecosystem is Python-first; MPS (Metal Performance Shaders) GPU acceleration on M1 Pro
- No Swift equivalents exist for UTMOS, NISQA, or Parselmouth
- Performance-critical paths (F0 extraction, spectral analysis) are C++/C under the hood (Praat, numpy, scipy)
- Orchestration overhead is negligible relative to model inference time

### 9.2 Required Packages

```
# Core Dependencies
python>=3.10,<3.13
torch>=2.1.0              # PyTorch with MPS support
torchaudio>=2.1.0         # Audio I/O and transforms
numpy>=1.24,<2.0          # Numerical operations
scipy>=1.11               # Signal processing

# MOS Prediction
# UTMOSv2 (install from source)
git+https://github.com/sarulab-speech/UTMOSv2

# NISQA
torchmetrics[audio]>=1.0  # Includes NISQA, PESQ wrappers

# DNSMOS
speechmos>=0.3            # Microsoft AECMOS, DNSMOS, PLCMOS
onnxruntime>=1.15         # ONNX runtime for DNSMOS models

# PESQ
pesq>=0.0.4               # ITU-T P.862 implementation

# Pitch and Voice Quality
praat-parselmouth>=0.4.3  # Praat in Python (F0, HNR, jitter, shimmer, formants)
crepe>=0.0.13             # CNN pitch estimation (optional, for noisy audio)
librosa>=0.10             # Audio feature extraction, pYIN F0

# Intelligibility
openai-whisper>=20231117  # ASR for WER/CER (or faster-whisper)
jiwer>=3.0                # WER/CER calculation

# Speaker Identity
resemblyzer>=0.1.3        # Speaker embedding extraction (256-dim)
speechbrain>=1.0          # ECAPA-TDNN speaker verification

# Spectral Analysis
pymcd>=0.4                # Mel Cepstral Distortion
# OR
mel-cepstral-distance>=0.0.3

# Utilities
soundfile>=0.12           # Audio file I/O
resampy>=0.4              # Resampling
tqdm>=4.66                # Progress bars
pyyaml>=6.0               # Configuration
jsonschema>=4.0           # Score card validation
```

### 9.3 M1 Pro Compatibility and Performance

| Component | M1 Pro Support | Acceleration | Notes |
|-----------|---------------|-------------|-------|
| PyTorch | Native (MPS) | GPU via Metal | 5x inference speedup over CPU |
| UTMOS (wav2vec2) | Yes | MPS GPU | ~200-500ms per sample |
| NISQA | Yes | MPS GPU | ~150-300ms per sample |
| DNSMOS | Yes | CPU (ONNX) | ~100-200ms per sample |
| Whisper large-v3 | Yes | MPS GPU | ~2-4s per sample (real-time factor ~0.3x) |
| Parselmouth | Yes | CPU (C++ native) | <50ms per sample (all metrics) |
| CREPE | Yes | MPS GPU | ~100ms per 1s audio |
| Resemblyzer | Yes | CPU | ~200ms per sample |
| ECAPA-TDNN | Yes | MPS GPU | ~300ms per sample |

**Total pipeline latency per sample: ~3-5 seconds** (all metrics, single sample)
**Throughput: ~12-20 samples/minute** on M1 Pro

### 9.4 Storage Architecture

```
~/.solishq/voice-calibration/
  config/
    anna.yaml              # Anna's target parameters
    nova.yaml              # Nova's target parameters
    atlas.yaml             # Atlas's target parameters
    corpus/                # Standard Calibration Corpus texts
  results/
    anna/
      calibration-2026-03-30/
        scores.jsonl       # One score card per sample per line
        best.json          # Current best score card
        locked.json        # Locked voice score card (if locked)
        audio/
          sample-001.wav
          sample-002.wav
          ...
    nova/
      ...
    atlas/
      ...
  baselines/
    anna-v1.json           # Locked baseline for regression detection
    nova-v1.json
    atlas-v1.json
  logs/
    calibration.log        # Full calibration run logs
    regression.log         # Regression detection logs
    drift.log              # Production drift monitoring logs
```

### 9.5 CI Integration

**When to run:**

| Trigger | Calibration Mode | Duration |
|---------|-----------------|----------|
| TTS model change | Full Calibration | ~2-4 hours |
| Voice config change | Quick Check (5 texts) | ~5-10 minutes |
| Weekly cron | Regression Test | ~30-60 minutes |
| Continuous (production) | Monitor (1% sample) | Always running |

**CI Pipeline:**
```yaml
# .github/workflows/voice-calibration.yml
voice-regression:
  runs-on: self-hosted  # M1 Pro runner
  trigger: [model-change, weekly-cron]
  steps:
    - run: python -m calibration.regression --voice all --baseline baselines/
    - assert: all hard gates pass
    - assert: composite score >= baseline - 3%
    - notify: slack#voice-quality if any assertion fails
```

### 9.6 Engine Module Structure

```
solishq-voice-calibration/
  src/
    calibration/
      __init__.py
      engine.py            # Main CalibrationEngine class
      analyzer.py          # MetricAnalyzer: runs all metrics
      scorer.py            # ScoreCompiler: computes scores from metrics
      gates.py             # GateChecker: evaluates pass/fail
      comparator.py        # Compares to baseline/best
      config.py            # Loads voice-specific targets
      corpus.py            # Manages calibration corpus

    metrics/
      __init__.py
      pitch.py             # F0, jitter, shimmer via Parselmouth/CREPE
      quality.py           # HNR, H1-H2, CPP, spectral tilt
      mos.py               # UTMOS, NISQA, DNSMOS wrappers
      intelligibility.py   # Whisper + jiwer WER/CER
      speaker.py           # Resemblyzer / ECAPA-TDNN similarity
      temporal.py          # WPM, pause detection, articulation rate
      spectral.py          # MCD, formants, LTAS

    monitor/
      __init__.py
      regression.py        # Regression detection against baselines
      drift.py             # Production drift monitoring
      alerting.py          # Alert dispatch (Slack, email)

    testing/
      __init__.py
      ab_test.py           # A/B test protocol management
      mushra.py            # MUSHRA test generation (webMUSHRA config)
      analysis.py          # Statistical analysis of listener responses

  tests/
    test_pitch.py
    test_quality.py
    test_mos.py
    test_gates.py
    test_scorer.py
    test_integration.py

  configs/
    anna.yaml
    nova.yaml
    atlas.yaml
```

---

## 10. Appendix A: Research Sources and Confidence Levels

### Confidence Level Definitions

| Level | Meaning |
|-------|---------|
| **CONFIRMED** | 3+ independent sources agree. Peer-reviewed research. Reproducible. |
| **LIKELY** | 2 sources agree, or 1 authoritative source (ITU standard, peer review). Minor extrapolation. |
| **UNCERTAIN** | Single source, extrapolated from adjacent domain, or derived from first principles without direct empirical validation. |

### Key Findings by Confidence

#### CONFIRMED

1. **MOS scale 1-5, 4.0+ = near-human.** Sources: ITU-T P.800, Wikipedia MOS, Milvus TTS evaluation guide.

2. **Female conversational F0: 180-210 Hz mean.** Sources: VoiceScience.org (2025), Korean Journal of Phonetics Speech Science (American English corpus), HAL archives (male/female speech study).

3. **Male conversational F0: 100-120 Hz mean.** Sources: VoiceScience.org, ASHA Phonational Frequency study, NMSU acoustic measures.

4. **Optimal speech rate: 150-160 WPM.** Sources: NCVS, University of Missouri study, Lindenwood University psychology journal, Teleprompter.com public speaking research.

5. **UTMOS Pearson r >0.87 with human MOS.** Sources: VoiceMOS Challenge 2024 results, Emergent Mind UTMOS topic, sarulab-speech GitHub.

6. **HNR: 15-25 dB for normal modal voice.** Sources: Praat manual (University of Amsterdam), Phonalyze clinical guide, PubMed HNR aging study.

7. **H1-H2 >8 dB indicates breathy voice.** Sources: ASHA Acoustic Correlates of Breathiness (2 papers), UCLA Keating phonation types lecture, PraatSauce documentation.

8. **PESQ: -0.5 to 4.5 scale.** Sources: ITU-T P.862, Wikipedia PESQ, PyTorch-Metrics documentation.

9. **Speaker similarity: cosine >0.6 = same speaker.** Sources: Amazon Science speaker similarity evaluation, ResearchGate embedding distribution study, Dataroots TTS evaluation.

10. **Pause duration: 150-500ms in natural conversation.** Sources: MDPI Pauses in Speech study, Springer EURASIP pause structure study, PMC dementia speech study.

#### LIKELY

11. **Voice warmth correlates with spectral tilt (H1-H2: 6-9 dB range).** Sources: Acoustic correlates of breathiness (ASHA), Unison vocal EQ chart. Derivation: warmth = slight breathiness = elevated but not extreme H1-H2. Specific "warmth" H1-H2 values extrapolated from breathiness research.

12. **Authority correlates with lower F0 + reduced F0 SD.** Sources: Springer "Voice of Authority" (2019, professionals lower pitch 14-33 Hz), PMC paralinguistic features study. The specific 105 Hz target is derived from lower-end male norms + authority lowering effect.

13. **Atlas pause duration of 420ms.** Sources: General pause research shows 200-500ms range. 420ms is derived from authority research (deliberate speakers pause longer) applied to male speech norms. Not directly measured.

14. **UTMOS latency ~200-500ms on M1 Pro.** Sources: General PyTorch MPS benchmarks. Specific UTMOS timing not directly benchmarked on M1 Pro — extrapolated from model size (wav2vec2 base) and general MPS inference data.

15. **MCD <5.0 dB = good quality.** Sources: CMU Mel-cepstral distortion paper (4-7 dB for audiobook voices), Columbia University TTS MCD reference. Specific threshold extrapolated.

#### UNCERTAIN

16. **Anna F0 mean of exactly 190 Hz.** Derived from: warmth sits between dominance (lower) and brightness (higher) in the 180-210 Hz female range. The exact value 190 Hz is a design decision informed by research, not directly measured as "warmth optimal."

17. **Nova articulation rate of 5.5-6.0 syl/sec.** Sources: General articulation rate research. Nova-specific value is extrapolated from "clarity benefits from faster articulation" principle applied to standard norms (4.5-5.5 syl/sec for conversational speech).

18. **Atlas phrase-final lengthening of 1.3x.** Sources: General prosody research shows final lengthening, but the specific 1.3x multiplier for "authority" is a design parameter, not a directly measured research finding.

19. **Composite score weights (0.25 UTMOS, 0.15 WER, etc.).** These are engineering judgment calls informed by metric reliability hierarchy. They should be validated empirically during initial calibration runs and adjusted based on correlation with human preference.

### Research Sources

- ITU-T P.800 / P.800.1 / P.862 — Subjective and objective speech quality standards
- VoiceMOS Challenge 2024 — State-of-the-art MOS prediction benchmarks
- Sesame AI (Feb 2025) — "Crossing the Uncanny Valley of Conversational Voice"
- VoiceScience.org — Average Speaking Frequencies: F0 Norms by Age, Sex
- Springer "Voice of Authority" (2019) — Professionals Lower Vocal Frequencies
- Frontiers in Psychology (2025) — "How do voice acoustics affect perceived trustworthiness"
- ASHA "Acoustic Correlates of Breathy Vocal Quality" (1994, 1996)
- Microsoft DNS Challenge — DNSMOS metric documentation
- sarulab-speech GitHub — UTMOS and UTMOSv2 implementations
- ScienceDirect — "Deviation from typical organic voices best explains a vocal uncanny valley"
- MDPI Languages — "Occurrence and Duration of Pauses in Relation to Speech Tempo"
- PMC — "How Pause Duration Influences Impressions of English Speech"
- University of Amsterdam Praat Manual — Harmonicity documentation
- Google ViSQOL GitHub — Virtual Speech Quality Objective Listener

---

## Appendix B: Invention Opportunities

Three areas where the current field falls short — opportunities for SolisHQ to invent:

### B.1 Personality-Aware MOS

**Gap:** No existing metric measures whether a voice matches a target personality. UTMOS measures naturalness. NISQA measures signal quality. Neither measures "does this sound warm?" or "does this sound authoritative?"

**Invention:** A Personality MOS (P-MOS) predictor trained on personality-labeled speech. Input: audio + target personality descriptor. Output: 1-5 score for personality match. Training data: collect human ratings of "how warm/clear/authoritative does this sound?" paired with acoustic features.

**Impact:** Replaces the current multi-metric proxy approach (H1-H2 + HNR + F0 = warmth proxy) with a single learned predictor that captures the full perceptual gestalt.

### B.2 Conversational Context-Aware Scoring

**Gap:** All current metrics score isolated utterances. Sesame's research (2025) proves that context is the key gap — a sentence sounds different depending on what came before it. No automated metric captures this.

**Invention:** A context-conditioned quality score that takes the conversation history as input alongside the current utterance. Evaluates whether prosody, pacing, and emotion are contextually appropriate.

### B.3 Micro-Imperfection Injection Engine

**Gap:** The uncanny valley research shows that natural imperfections are essential. But no systematic framework exists for determining which imperfections to inject, at what rate, and in which locations.

**Invention:** A principled imperfection model that places natural disfluencies (breath, micro-pauses, slight pitch resets) based on linguistic structure and conversational context. Not random — linguistically motivated.

---

*Document Hash: Generated 2026-03-30. All thresholds are research-derived with confidence levels documented. Parameters marked UNCERTAIN should be validated empirically during initial calibration and updated via Amendment protocol.*

*SolisHQ — We innovate, invent, then disrupt.*
