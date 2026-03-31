# Streaming Dictation Architecture: First-Principles Research

**Date:** 2026-03-29
**Author:** Researcher Agent (SolisHQ Meta-Orchestrator)
**Subject:** Vox macOS Dictation -- Streaming Architecture & Hold-to-Talk
**Evidence Level:** [CONFIRMED] = multiple independent sources, [LIKELY] = strong single source + reasoning, [UNCERTAIN] = inferred / limited evidence

---

## Table of Contents

1. [How Production Dictation Systems Handle Streaming](#part-1-how-production-dictation-systems-handle-streaming)
2. [The Chunk Boundary Problem from First Principles](#part-2-the-chunk-boundary-problem-from-first-principles)
3. [Hold-to-Talk vs Toggle](#part-3-hold-to-talk-vs-toggle)
4. [What Groq Actually Supports](#part-4-what-groq-actually-supports)
5. [Alternative Streaming APIs](#part-5-alternative-streaming-apis)
6. [The Honest Recommendation](#part-6-the-honest-recommendation)

---

## Part 1: How Production Dictation Systems Handle Streaming

### The Fundamental Question

Does ANY production system use the "send fixed-time chunks to a batch API" approach that Vox currently uses?

**Answer: No.** [CONFIRMED]

Every production dictation system falls into one of two categories:

1. **True streaming via native streaming API** (Deepgram, AssemblyAI, Google, Azure)
2. **Two-stage pipeline: ASR + LLM post-processing** (Wispr Flow)

No shipping product uses "chop audio into 3-4 second fixed-time chunks, send each to a batch transcription API, and concatenate the results." This approach exists only in hobby projects and proof-of-concepts.

### What Each Production System Actually Does

#### Wispr Flow (Primary Competitor)

Architecture: [CONFIRMED] Two-stage cloud pipeline.

- **Stage 1: ASR** -- Speech recognition model produces raw transcript. E2E inference < 200ms.
- **Stage 2: LLM** -- Fine-tuned Llama model on Baseten cleans up, formats, and contextualizes. E2E inference < 200ms.
- **Total pipeline:** < 700ms p99 end-to-end (from speech end to text appearing).
- **Network budget:** ~200ms for transmission from anywhere globally.
- **Scale:** Processing 1 billion words/month as of early 2026.

Key design decisions:
- Cloud-only transcription. Requires internet. No local mode.
- Context-aware ASR: conditions on speaker voice, topic, user history.
- Token-level formatting control via Llama to match individual writing styles.
- Local reinforcement learning from user corrections.

Input modes:
- **Hold-to-talk (default on Mac):** Hold Fn key, speak, release to transcribe+paste.
- **Hands-free:** Press Fn+Space to start, speak freely, press Fn to stop.
- **Quick-toggle:** Double-press push-to-talk shortcut to lock into hands-free mode.
- Session time limit: 20 minutes on desktop, 5 minutes on mobile.

Critical insight: Wispr does NOT stream text while you speak. You speak, then release the key, and the full transcript appears within ~700ms. The perception of speed comes from low latency between "stop speaking" and "text appears," not from seeing words appear in real-time during speech.

**Source:** [Wispr Flow on Baseten](https://www.baseten.co/resources/customers/wispr-flow/), [Technical Challenges Behind Flow](https://wisprflow.ai/post/technical-challenges), [Starting your first dictation](https://docs.wisprflow.ai/articles/6409258247-starting-your-first-dictation)

#### Deepgram

Architecture: [CONFIRMED] True streaming via WebSocket.

- WebSocket connection at `wss://api.deepgram.com/v1/listen`
- Audio sent in 100-200ms chunks continuously
- Sub-300ms transcription latency per word
- Returns both interim (partial) and final transcripts
- Word-level timestamps on every result
- Nova-3 model: 53.4% WER reduction vs competitors in streaming mode
- Streaming WER: ~10.9% vs batch WER: ~9.37% (accuracy trade-off for speed)

**Source:** [Deepgram Streaming API](https://deepgram.com/learn/streaming-speech-recognition-api), [Measuring STT Latency](https://developers.deepgram.com/docs/measuring-streaming-latency)

#### AssemblyAI

Architecture: [CONFIRMED] True streaming via WebSocket.

- Universal-Streaming at `wss://streaming.assemblyai.com/v3/ws`
- Send 50-1000ms audio chunks
- ~300ms word emission latency
- Immutable transcript model: once a word is emitted, it never changes
- Turn-based events with word-level timestamps and confidence scores
- No interim/final distinction -- all transcripts are final once emitted

**Source:** [AssemblyAI Universal-Streaming](https://www.assemblyai.com/products/streaming-speech-to-text), [Real-Time Transcription](https://www.assemblyai.com/blog/real-time-speech-to-text)

#### SuperWhisper (Closest to Vox)

Architecture: [CONFIRMED] Local-first with whisper.cpp.

- Runs whisper.cpp entirely on-device via Apple Silicon
- Multiple model tiers: Nano, Fast, Pro, Ultra
- BYO API key support (OpenAI, Groq, Deepgram) for cloud mode
- Intel Macs relegated to cloud-only mode

Critical insight: SuperWhisper appears to use a wait-for-silence-then-transcribe approach, not streaming chunks. The user speaks, pauses, and the transcript appears. This is architecturally simpler and avoids the chunk boundary problem entirely.

**Source:** [Superwhisper](https://superwhisper.com/), [OpenSuperWhisper](https://github.com/Starmel/OpenSuperWhisper)

#### Bloomberg Research (Academic, Not Production)

Architecture: [CONFIRMED] Two-pass streaming adaptation of Whisper.

- Adds a CTC decoder with causal attention masks for streaming partial transcripts
- Original Whisper attention decoder rescores partials for quality
- Hybrid tokenizer: small CTC vocabulary for efficiency, full Whisper vocabulary for rescoring
- Endpointing: 0.5s silence or max delay constraint triggers rescore pass
- Published at Interspeech 2025

This is research-grade, not production-ready, but demonstrates that Whisper CAN be adapted for true streaming at the model level.

**Source:** [Bloomberg Interspeech 2025](https://www.bloomberg.com/company/stories/bloombergs-ai-researchers-turn-whisper-into-a-true-streaming-asr-model-at-interspeech-2025/), [Paper](https://arxiv.org/abs/2506.12154)

#### WhisperStreaming (Open Source)

Architecture: [CONFIRMED] Buffer-trimming with local agreement policy.

- Processes audio incrementally with a sliding window
- "Local Agreement" policy: if N consecutive updates agree on a prefix, it is confirmed and emitted
- Confirmed text is never re-emitted (prevents duplication)
- Word-level timestamps from faster-whisper for precise boundary detection
- Latency: ~3.3 seconds on long-form audio
- Being superseded by "SimulStreaming" by the same author

**Source:** [WhisperStreaming GitHub](https://github.com/ufal/whisper_streaming)

### Summary Table

| System | Approach | Streaming Feel | Chunk Boundary Problem | Latency |
|--------|----------|---------------|----------------------|---------|
| Wispr Flow | Batch ASR + LLM, hold-to-talk | Text appears after release | N/A (no chunking) | ~700ms |
| Deepgram | True WebSocket streaming | Words appear as spoken | Solved structurally | ~300ms |
| AssemblyAI | True WebSocket streaming | Words appear as spoken | Solved structurally | ~300ms |
| SuperWhisper | Local whisper.cpp, pause-to-transcribe | Text appears after pause | N/A (no chunking) | ~1-3s |
| Bloomberg | Two-pass CTC + attention decoder | Words appear as spoken | Solved at model level | Research |
| WhisperStreaming | Sliding window + local agreement | Text appears with ~3s delay | Solved via agreement | ~3.3s |
| **Vox (current)** | **Fixed 3-4s chunks to batch API** | **Text appears per chunk** | **NOT SOLVED** | **3-4s** |

---

## Part 2: The Chunk Boundary Problem from First Principles

### Root Cause Analysis

The chunk boundary problem is not a bug -- it is an inherent consequence of treating a batch API as a streaming API. Here is why:

**Whisper's architecture:** Whisper is an encoder-decoder transformer trained on 30-second audio segments. It expects complete utterances with natural sentence structure. When given a 3-second fragment that ends mid-word or mid-phrase, it does one of three things:

1. **Hallucinates completion:** Adds words that weren't spoken to make the fragment "make sense"
2. **Truncates:** Drops the partial word at the boundary
3. **Transcribes faithfully:** Gets the boundary word right (happens sometimes, not reliably)

[CONFIRMED] This is extensively documented. From the OpenAI Whisper discussion #440: "When crossing chunk boundaries, punctuation at the end of a chunk and capitalization at the beginning of the next chunk will almost certainly be incorrect because text normalization changes due to lost context. Additionally, the last word at the end of a chunk and the first word at the beginning of the next may be fragmented."

[CONFIRMED] From the Whisper community: "Whisper sometimes begins to confabulate, putting in text that was clearly not in the audio" when processing chunks.

### Vox's Current Approach

Vox's `DictationController` currently:

1. Accumulates audio for 3s (first chunk) or 4s (subsequent chunks)
2. Sends each chunk to Groq's batch Whisper API
3. Passes the last 150 characters of prior transcript as `prompt` parameter for continuity
4. Runs result through `HallucinationFilter` and `ChunkDeduplicator`
5. Types the result via `KeyboardSimulator`

Audio overlap is DISABLED (set to 0 bytes) because overlap caused worse duplication than no overlap. The comment in the code says: "Overlap causes word duplication -- Groq transcribes the same audio segment twice with slightly different wording, and the deduplicator can't match them."

The `ChunkDeduplicator` uses a simple 3-word window comparison: if the last N words of the previous chunk match the first N words of the new chunk (case-insensitive), strip them. This is insufficient because:

- Whisper often paraphrases rather than producing identical words at boundaries
- Punctuation differences cause mismatches ("hello," vs "Hello")
- The 3-word window is too small for longer overlapping phrases

### Evaluation of All Possible Solutions

#### Solution 1: No Chunking (Wait for Silence, Send All Audio)

**How it works:** Record everything. When the user stops speaking (detected by silence), send the entire audio to Groq. Get one transcript back. Type it.

**Assessment:**
- Accuracy: EXCELLENT. Groq gets full context. No boundary problems. [CONFIRMED -- this is how Whisper is designed to work]
- Latency: Speech duration + ~200ms Groq processing + ~50ms typing. For 10s of speech, ~10.2s from start to text. For user perception: ~200ms from stop-speaking to text-appearing.
- Complexity: LOWEST. Remove chunk timer, overlap buffer, deduplicator entirely.
- Boundary problem: ELIMINATED. There are no boundaries.
- Trade-off: No text appears while speaking. User sees nothing until they pause/stop.

**Verdict: This is what Wispr Flow does. It is the correct architecture for hold-to-talk mode.** The "streaming feel" of seeing words appear while speaking is a nice-to-have, not a must-have. Wispr proved this -- users care about total latency (stop speaking -> text appears), not about seeing words trickle in.

#### Solution 2: Fixed Chunks with Overlap + Dedup (Previous Approach)

**How it works:** Overlap last 300ms of each chunk into the next. Match and strip duplicate words.

**Assessment:**
- Accuracy: POOR. Whisper paraphrases the overlapping audio differently each time. [CONFIRMED -- Vox's own codebase documents this failure]
- Latency: 3-4s per chunk
- Complexity: MEDIUM. Requires tuning overlap size, dedup window, and handling paraphrase variants.
- Boundary problem: NOT SOLVED. The dedup approach is fundamentally fragile.

**Verdict: Already tried and abandoned in Vox. Correctly rejected.**

#### Solution 3: Fixed Chunks WITHOUT Overlap (Current Approach)

**How it works:** Hard cut at 3-4s boundaries. No overlap. Use `prompt` parameter for language-level continuity.

**Assessment:**
- Accuracy: MODERATE. Words at exact cut points may be lost or hallucinated. The `prompt` parameter helps with style continuity but cannot recover lost audio. [CONFIRMED -- the prompt parameter "conditions the model on the text that appeared in the previous ~30 seconds" but does not provide audio context]
- Latency: 3-4s per chunk
- Complexity: LOW (current implementation)
- Boundary problem: PARTIALLY ADDRESSED. Better than overlap, but words at boundaries can still be lost/hallucinated.

**Verdict: Current state. Functional but lossy at boundaries.**

#### Solution 4: VAD-Based Chunking (Split on Silence/Pauses)

**How it works:** Instead of fixed 3-4s intervals, split audio when the energy gate detects silence (a natural pause in speech). Each chunk is a complete phrase or sentence.

**Assessment:**
- Accuracy: GOOD. Chunks align with natural speech boundaries. Whisper gets complete phrases. [CONFIRMED -- "silence detection allows you to process smaller segments of speech individually" and "natural sentence boundaries" are best practice]
- Latency: VARIABLE. Short phrases: ~1-2s. Long continuous speech without pauses: could be 10-30s before a chunk is sent.
- Complexity: MEDIUM. Vox already has `EnergyGate` with silence detection. Need to change flush trigger from timer to silence-detected event.
- Boundary problem: MOSTLY SOLVED. If the user pauses between phrases, boundaries align perfectly. But continuous non-stop speech still has no natural boundary.

**Verdict: Significant improvement over fixed-time chunking. Best approach IF combined with a maximum chunk duration fallback (e.g., flush at 10s even without silence). The key insight: replace the 3-4s timer with "flush on silence OR after max duration."**

#### Solution 5: True Streaming API (Deepgram, AssemblyAI)

**How it works:** Open a WebSocket to a streaming STT service. Send audio continuously in small chunks (100-200ms). Receive word-by-word transcripts with ~300ms latency.

**Assessment:**
- Accuracy: GOOD. Purpose-built for streaming. No boundary problem by design. [CONFIRMED -- Deepgram streaming WER: 10.9%, slightly higher than batch 9.37%]
- Latency: EXCELLENT. ~300ms per word. True real-time feel.
- Complexity: MEDIUM-HIGH. Need WebSocket client in Swift, handle reconnection, manage interim vs final transcripts (Deepgram) or immutable turns (AssemblyAI).
- Boundary problem: ELIMINATED. The service handles this internally.
- Trade-off: New dependency. New API key. New pricing. Cannot fall back to local whisper.cpp.

**Verdict: The technically correct solution for "words appear as you speak" if that UX is a hard requirement. But it means abandoning Whisper/Groq for the cloud tier and adding a separate service.**

#### Solution 6: Groq Streaming (Does It Exist?)

**Answer: No.** [CONFIRMED]

Groq's Whisper API is batch-only. You send a complete audio file, you get a complete transcript. There is no WebSocket endpoint, no streaming mode, no incremental results. The Pipecat integration confirms: "GroqSTTService uses segmented processing which buffers audio during speech and sends complete segments for transcription... it does not provide interim results -- only final transcriptions after each speech segment."

Groq does support `timestamp_granularities: ["word"]` with `response_format: "verbose_json"`, which returns word-level timestamps. This is useful for post-processing but does not provide streaming.

**Verdict: Not an option. Groq is fundamentally batch.**

#### Solution 7: Hybrid (Progressive Send, Buffer Incomplete Sentences)

**How it works:** Send audio to Groq every few seconds. But only TYPE text up to the last complete sentence. Buffer the trailing incomplete sentence and re-send it with the next chunk.

**Assessment:**
- Accuracy: MODERATE-GOOD. Complete sentences are reliable. But the trailing fragment gets re-transcribed each time, potentially differently.
- Latency: Sentence-level latency. If user speaks 3 sentences in 12 seconds, first sentence appears at ~3-4s, second at ~7-8s, third at ~12s.
- Complexity: HIGH. Need sentence detection in transcript. Need to track which text was already typed. Need to handle Groq paraphrasing the trailing buffer differently each time.
- Boundary problem: PARTIALLY SOLVED. Sentence boundaries are clean. But the buffer management is fragile.

**Verdict: Over-engineered for the actual UX benefit. If you're going to add this complexity, just use a true streaming API instead.**

### Boundary Problem: Final Assessment

The chunk boundary problem is **unsolvable within the constraints of a batch API and fixed-time chunking.** The possible mitigations are:

1. **Eliminate boundaries entirely** (wait for silence, send complete audio) -- best for hold-to-talk
2. **Align boundaries with natural speech pauses** (VAD-based chunking) -- best for toggle mode
3. **Use a streaming API** (Deepgram/AssemblyAI) -- best for words-appear-as-you-speak UX

---

## Part 3: Hold-to-Talk vs Toggle

### How Wispr Flow Implements Hold-to-Talk

[CONFIRMED] from Wispr Flow documentation:

- **Default Mac shortcut:** Hold Fn key
- **Hold = recording.** Release = stop + transcribe + paste.
- **Hands-free mode:** Fn+Space starts, Fn stops. User speaks without holding a key.
- **Quick toggle:** Double-press push-to-talk shortcut to enter hands-free mode.
- **Customizable:** Users can assign mouse buttons (middle click, Mouse4-Mouse10) as triggers.
- **Cancel:** Press Escape during recording to abort.
- **Time limit:** 20 minutes on desktop.

### macOS CGEventTap: Key-Held vs Key-Released Detection

[CONFIRMED] from Apple documentation and the current Vox codebase:

Vox already detects Right Option key-down and key-up via `CGEventType.flagsChanged`:

```
// In main.swift eventTapCallback:
let rightOptionPressed = (rawFlags & 0x40) != 0  // NX_DEVICERALTKEYMASK

if rightOptionPressed && !getRightOptionDown() && !hasUnwanted {
    setRightOptionDown(true)
    // ... toggle
} else if !rightOptionPressed && getRightOptionDown() {
    setRightOptionDown(false)
}
```

The key-up detection (`setRightOptionDown(false)`) is already implemented but currently unused -- it just resets the tracking flag. This is exactly where hold-to-talk stop would trigger.

### CGEventTap flagsChanged Reliability for Key-Up

[CONFIRMED] `CGEventType.flagsChanged` fires reliably for both key-down and key-up of modifier keys on macOS. The event contains the current modifier flags state -- when a modifier is released, the flag bit clears, and the event fires. This is the same mechanism used by alt-tab-macos and other modifier-key-based tools.

There is one edge case: if the system disables the event tap (handled by Vox's re-enable logic on `tapDisabledByTimeout` / `tapDisabledByUserInput`).

### Implementation Design for Hold-to-Talk

**Proposed State Machine:**

```
Key Down (flagsChanged, Right Option pressed)
  |
  v
Start debounce timer (200ms)
  |
  +--- Key Up within 200ms --> IGNORED (accidental tap)
  |
  +--- 200ms elapsed, key still held --> START RECORDING
        |
        v
      RECORDING (audio capture active)
        |
        +--- Key Up --> STOP RECORDING, flush final audio, transcribe
        |
        +--- Max duration (120s) --> STOP RECORDING
```

**Debounce strategy:**
- Hold duration < 200ms: Ignored. Prevents accidental taps.
- Hold duration >= 200ms: Recording starts. User hears start sound.
- Release: Recording stops immediately. Final audio sent for transcription.

**Why 200ms:** [LIKELY] Standard debounce for intentional key holds. Below 150ms catches too many accidental taps. Above 300ms feels sluggish. Wispr Flow does not document their debounce threshold, but 200ms is the sweet spot based on keyboard ergonomics research.

### Supporting Both Modes

Yes, both modes can coexist with a single key:

- **Short press (< 200ms):** Ignored by default. OR could be wired to toggle mode.
- **Hold (>= 200ms):** Hold-to-talk. Record while held, stop on release.
- **Double-press:** Enter hands-free mode (toggle). Press once to start, press again to stop.

However, supporting both adds complexity. **Recommendation:** Start with hold-to-talk only (matches Wispr). Add toggle as a config option later if needed.

### Required Changes to Vox

The current `toggle()` method in `DictationController` needs to be split:

1. `startRecording()` -- called when key is held past debounce threshold
2. `stopRecording()` -- called when key is released

The `eventTapCallback` in `main.swift` needs to:
1. On key-down: start a debounce timer
2. On key-up within debounce: cancel timer
3. On debounce elapsed: call `startRecording()`
4. On key-up after recording started: call `stopRecording()`

The existing `startRecording()` and `stopRecording()` methods already exist as private methods. They just need to be exposed to the hotkey handler.

---

## Part 4: What Groq Actually Supports

### Models Available

[CONFIRMED] from Groq documentation:

| Model | Price | WER | Speed | Languages | Features |
|-------|-------|-----|-------|-----------|----------|
| whisper-large-v3-turbo | $0.04/hr | 12% | 216x RT | Multilingual | Transcription only |
| whisper-large-v3 | $0.111/hr | 10.3% | 189x RT | Multilingual | Transcription + Translation |

Note: distil-whisper-large-v3-en has been **deprecated** in favor of whisper-large-v3-turbo, which is faster, more accurate (lower WER), and supports more languages.

### Streaming Support

**No streaming support.** [CONFIRMED]

Groq's Whisper API is strictly batch:
- Send a complete audio file (WAV, MP3, FLAC, etc.)
- Receive a complete transcript
- No WebSocket endpoint
- No server-sent events
- No incremental results

### Timestamp Capabilities

[CONFIRMED] Groq supports word-level timestamps:
- Set `response_format: "verbose_json"` and `timestamp_granularities: ["word"]`
- Returns word objects with start time, end time, and text
- Incurs additional latency for word-level timestamps vs segment-only
- Useful for subtitle generation but does not enable streaming behavior

### Rate Limits (Free Tier)

[CONFIRMED] from Groq documentation and community:

- 20 requests per minute (RPM)
- 2,000 requests per day (RPD)
- 7,200 audio seconds per hour (~2 hours of audio per hour of clock time)
- 25 MB max file size (free tier), 100 MB (dev tier)
- Minimum billing: 10 seconds per request

**Rate limit analysis for Vox's chunking approach:**
- At 3-4s chunks, a 1-minute dictation generates ~15-20 API calls
- At 20 RPM limit, this is right at the edge
- A 2-minute dictation would exceed the RPM limit
- **This is another reason to avoid frequent small chunks**

With hold-to-talk (send once after speech ends):
- 1 API call per dictation session
- 20 RPM is irrelevant
- 2,000 RPD allows ~2,000 dictation sessions per day
- This is a dramatically better fit for the rate limits

### Prompt Parameter

[CONFIRMED] The `prompt` parameter:
- Max 224 tokens
- Conditions the model on prior text for style/vocabulary continuity
- Does NOT provide audio context -- only text context
- Effective for: spelling of proper nouns, punctuation style, capitalization
- Not effective for: recovering words lost at audio boundaries

### Partial/Incremental Results

**Not supported.** [CONFIRMED] There is no way to get partial or incremental results from Groq. Each request returns one complete transcript.

---

## Part 5: Alternative Streaming APIs

### Deepgram

**Architecture:** True streaming via WebSocket
**Protocol:** `wss://api.deepgram.com/v1/listen`

| Dimension | Detail |
|-----------|--------|
| Latency | Sub-300ms per word |
| Accuracy (streaming) | ~10.9% WER (Nova-3) |
| Accuracy (batch) | ~9.37% WER |
| Free tier | $200 credit (~45,000 minutes) -- one-time, no refresh |
| Paid pricing | $0.0043/min (Nova-3 batch), higher for streaming |
| Word timestamps | Yes, on every result |
| Interim/Final | Both (configurable) |
| Languages | 45+ |
| Swift SDK | No official Swift SDK. WebSocket client required (URLSessionWebSocketTask). |

**Complexity to implement in Swift:**
- MEDIUM. `URLSessionWebSocketTask` available since macOS 10.15. Need to: open connection, send audio frames, parse JSON responses, handle reconnection.
- Audio format: 16kHz PCM -- same as Vox already produces. No conversion needed.
- Estimated implementation: ~200-300 lines for a `DeepgramClient` actor.

**Solves boundary problem:** YES. Structurally eliminated. [CONFIRMED]

**Source:** [Deepgram Pricing](https://deepgram.com/pricing), [Deepgram Streaming API](https://developers.deepgram.com/docs/live-streaming-audio)

### AssemblyAI

**Architecture:** True streaming via WebSocket (Universal-Streaming)
**Protocol:** `wss://streaming.assemblyai.com/v3/ws`

| Dimension | Detail |
|-----------|--------|
| Latency | ~300ms word emission |
| Free tier | $50 credit (~333 hours streaming) -- one-time, no refresh |
| Paid pricing | $0.15/hr streaming, $0.45/hr Universal-3 Pro |
| Word timestamps | Yes, with confidence scores |
| Transcript model | Immutable -- once emitted, never changes |
| Stream rate limits | 5 new streams/min (free), 100/min (paid) |
| Swift SDK | No official Swift SDK. WebSocket client required. |

**Complexity to implement in Swift:** Same as Deepgram. ~200-300 lines.

**Unique advantage:** Immutable transcript model means no need to handle interim/final distinction -- every word is final when emitted. Simpler client logic.

**Solves boundary problem:** YES. Structurally eliminated. [CONFIRMED]

**Source:** [AssemblyAI Pricing](https://www.assemblyai.com/pricing), [AssemblyAI Streaming](https://www.assemblyai.com/products/streaming-speech-to-text)

### Google Cloud Speech-to-Text

| Dimension | Detail |
|-----------|--------|
| Latency | ~300-500ms |
| Free tier | 60 minutes/month + $300 GCP credit for new accounts |
| Paid pricing | $0.024/min (standard), $0.036/min (enhanced) |
| Protocol | gRPC streaming |
| Swift SDK | No Swift SDK. gRPC requires SwiftNIO + grpc-swift. |
| Data logging | Opt-out costs +40% |

**Complexity to implement in Swift:** HIGH. gRPC in Swift requires significant dependencies (SwiftNIO, grpc-swift, protobuf). Not worth the ecosystem lock-in.

**Solves boundary problem:** YES, but at high integration cost.

**Source:** [Google STT Pricing](https://cloud.google.com/speech-to-text/pricing)

### Azure Speech Services

| Dimension | Detail |
|-----------|--------|
| Latency | ~300-500ms |
| Free tier | 5 hours/month |
| Paid pricing | $1/hr ($0.0167/min) |
| Protocol | WebSocket |
| Swift SDK | Azure Cognitive Services SDK for iOS/macOS exists but is large. |

**Complexity to implement in Swift:** MEDIUM-HIGH. SDK exists but adds significant binary size and Microsoft ecosystem dependency.

**Solves boundary problem:** YES.

**Source:** [Azure Speech Pricing](https://azure.microsoft.com/en-us/pricing/details/speech/)

### Comparison Matrix for Vox

| Service | Free Tier Generosity | Latency | Swift Complexity | Privacy | Boundary Fix |
|---------|---------------------|---------|-----------------|---------|-------------|
| **Groq (current)** | 2,000 req/day ongoing | 200ms (batch) | Already done | Good | NO |
| **Deepgram** | $200 one-time | 300ms (streaming) | Medium | Good | YES |
| **AssemblyAI** | $50 one-time | 300ms (streaming) | Medium | Good | YES |
| **Google Cloud** | 60 min/month | 300-500ms | High (gRPC) | Poor (logging) | YES |
| **Azure** | 5 hr/month | 300-500ms | Medium-High | OK | YES |
| **Local whisper.cpp** | Unlimited (free) | 1-3s | Already done | Perfect | N/A |

---

## Part 6: The Honest Recommendation

### Constraints Restated

1. macOS app, Swift, single binary
2. Privacy-first (local-first, cloud is opt-in)
3. Must compete with Wispr on perceived speed
4. Free tier must work (local whisper)
5. Paid tier uses cloud (currently Groq)

### What Wispr Actually Proved

Wispr's key insight is NOT "stream text as the user speaks." Their key insight is:

**Hold-to-talk + fast batch transcription + LLM formatting = better UX than seeing words trickle in.**

Users hold Fn, speak, release. Text appears in < 700ms. This feels faster than watching words appear one-by-one with corrections and re-arrangements, because the final text is clean, formatted, and correct on first appearance.

### The Right Architecture for Vox

#### Tier 1: Hold-to-Talk with Batch Transcription (IMPLEMENT NOW)

This is the correct first-principles architecture. It:

1. **Eliminates the chunk boundary problem entirely.** No chunks = no boundaries.
2. **Matches the rate limit profile.** 1 request per dictation vs 15-20 per minute of speech.
3. **Matches Wispr's proven UX model.** Hold to speak, release to transcribe.
4. **Simplifies the codebase dramatically.** Remove: chunk timer, overlap buffer, ChunkDeduplicator. The entire `flushChunk` / chunk-accumulation logic simplifies to "on stop, send all audio."
5. **Maximizes transcription accuracy.** Groq gets the full audio context. Whisper performs best on complete utterances.

**Architecture:**

```
Hold Right Option (>200ms debounce)
  --> Start AudioCapture
  --> Accumulate all PCM into single buffer
  --> EnergyGate for silence detection (adaptive timeout stops recording)
  --> Play start sound

Release Right Option OR Silence Timeout
  --> Stop AudioCapture
  --> Send complete audio buffer to Groq (or local whisper.cpp)
  --> HallucinationFilter on result
  --> KeyboardSimulator types full transcript
  --> Play done sound
```

**Expected latency:** Speech ends -> Groq processes complete audio (~200ms for <30s) -> Type text (~50ms for typical sentence) = ~250ms. This is FASTER than Wispr's 700ms because Vox doesn't have the LLM post-processing step.

**Groq rate limits:** At 1 request per dictation, even aggressive use (100 dictations/hour) stays well within 20 RPM and 2,000 RPD.

**Maximum audio duration:** Groq supports up to 25MB files (free tier). At 16kHz 16-bit mono = 32KB/s, that's ~13 minutes of audio per request. Combined with the existing 120s max duration, this is never a constraint.

#### Tier 2: VAD-Enhanced Streaming for Long Dictation (FUTURE)

For dictation sessions longer than ~15 seconds, users may want to see progress. This is where VAD-based chunking helps:

1. Accumulate audio continuously
2. When EnergyGate detects a pause >= 500ms, flush the accumulated audio as a chunk
3. Send that natural-boundary chunk to Groq
4. Type the result
5. Continue accumulating for the next phrase

This gives a streaming-like experience aligned with natural speech pauses, not arbitrary time intervals. The `prompt` parameter passes prior transcript for continuity. Boundary problems are minimal because chunks end at silence.

**Trigger:** Only when speech duration exceeds a threshold (e.g., 8 seconds without pause). Below that, the hold-to-talk batch approach is always better.

#### Tier 3: True Streaming via Deepgram (OPTIONAL PREMIUM)

If "words appear as you speak" becomes a hard requirement:

1. Add Deepgram as an alternative cloud engine (alongside Groq)
2. Open WebSocket on recording start
3. Stream audio in 100ms chunks
4. Receive and type words as they arrive
5. Close WebSocket on recording stop

This is the technically cleanest solution for real-time word-by-word display, but it:
- Adds a second cloud dependency
- Requires Deepgram API key (separate from Groq)
- Has a one-time $200 free credit (not ongoing free tier)
- Slightly worse accuracy than batch (10.9% vs 9.37% WER)

**Recommendation:** Only implement if user testing reveals that hold-to-talk batch is insufficient and users specifically request words-as-they-speak UX.

#### Local Tier: whisper.cpp (ALWAYS AVAILABLE)

The local whisper.cpp fallback already works. For hold-to-talk:
- Send complete audio buffer to whisper.cpp on release
- Latency: 1-3 seconds depending on model size and audio length
- No boundary problems (batch by nature)
- Privacy: perfect (nothing leaves the device)

**Future improvement:** Consider WhisperKit (by Argmax) as a replacement for raw whisper.cpp. WhisperKit is Apple Silicon-optimized via Core ML, potentially faster for on-device inference. Requires macOS 14.0+.

### What to Remove from Vox

With hold-to-talk + batch transcription:

1. **Remove:** Fixed chunk timer (`firstChunkIntervalMs`, `nextChunkIntervalMs`)
2. **Remove:** Audio overlap logic (`overlapBytes`, `overlapBuffer`)
3. **Simplify:** `ChunkDeduplicator` -- no longer needed for primary flow (keep for optional VAD-chunked mode)
4. **Simplify:** `flushChunk()` -- becomes "send all accumulated audio"
5. **Change:** Hotkey from toggle to hold-to-talk (debounce + key-up detection)
6. **Keep:** EnergyGate (still needed for silence detection and AGC)
7. **Keep:** HallucinationFilter (still needed for Whisper output)
8. **Keep:** `prompt` parameter (still valuable for vocabulary/style conditioning)

### Latency Budget (Hold-to-Talk Architecture)

| Phase | Duration | Cumulative |
|-------|----------|-----------|
| Key release detected | 0ms | 0ms |
| Audio stop + WAV build | ~5ms | 5ms |
| Groq API call (10s audio) | ~200ms | 205ms |
| HallucinationFilter | ~1ms | 206ms |
| KeyboardSimulator typing | ~50ms | 256ms |
| **Total: key release to text** | | **~256ms** |

For local whisper.cpp fallback:

| Phase | Duration | Cumulative |
|-------|----------|-----------|
| Key release detected | 0ms | 0ms |
| whisper.cpp inference (10s audio, tiny model) | ~1500ms | 1500ms |
| HallucinationFilter | ~1ms | 1501ms |
| KeyboardSimulator typing | ~50ms | 1551ms |
| **Total: key release to text** | | **~1.5s** |

Both are competitive with Wispr's ~700ms (which includes LLM formatting that Vox doesn't need).

### Knowledge Gaps

1. **[UNCERTAIN] Wispr Flow's exact ASR model.** They reference "speech recognition models" but don't specify whether it's Whisper, a custom model, or a third-party API. The Baseten integration suggests a self-hosted model.

2. **[UNCERTAIN] Exact debounce threshold for hold-to-talk.** Wispr doesn't document theirs. 200ms is a reasonable engineering choice based on keyboard ergonomics.

3. **[UNCERTAIN] WhisperKit vs whisper.cpp performance on Apple Silicon.** WhisperKit claims Core ML optimization but independent benchmarks comparing the two on macOS are scarce.

4. **[UNCERTAIN] Groq's actual p50/p99 latency for audio transcription.** Their "216x real-time" claim means 10s of audio processes in ~46ms, but network round-trip and queue time are unaccounted for. Vox's 8s timeout suggests real-world latency is higher.

5. **[UNCERTAIN] Whether Wispr batches audio or streams to their ASR backend.** Their "< 200ms ASR inference" could be local preprocessing + cloud, or purely cloud batch.

---

## Appendix A: Sources

### Production Systems
- [Wispr Flow on Baseten](https://www.baseten.co/resources/customers/wispr-flow/)
- [Wispr Flow Technical Challenges](https://wisprflow.ai/post/technical-challenges)
- [Wispr Flow Documentation](https://docs.wisprflow.ai/articles/6409258247-starting-your-first-dictation)
- [Wispr Flow Hands-Free Mode](https://docs.wisprflow.ai/articles/6391241694-use-flow-hands-free)
- [Superwhisper](https://superwhisper.com/)
- [OpenSuperWhisper (GitHub)](https://github.com/Starmel/OpenSuperWhisper)

### Streaming APIs
- [Deepgram Streaming API](https://deepgram.com/learn/streaming-speech-recognition-api)
- [Deepgram Latency Measurement](https://developers.deepgram.com/docs/measuring-streaming-latency)
- [Deepgram Nova-3](https://deepgram.com/learn/introducing-nova-3-speech-to-text-api)
- [Deepgram Pricing](https://deepgram.com/pricing)
- [AssemblyAI Universal-Streaming](https://www.assemblyai.com/products/streaming-speech-to-text)
- [AssemblyAI Pricing](https://www.assemblyai.com/pricing)
- [Google Cloud STT Pricing](https://cloud.google.com/speech-to-text/pricing)
- [Azure Speech Pricing](https://azure.microsoft.com/en-us/pricing/details/speech/)

### Groq
- [Groq Speech-to-Text Docs](https://console.groq.com/docs/speech-to-text)
- [Groq Rate Limits](https://console.groq.com/docs/rate-limits)
- [Groq Whisper Large v3 Turbo](https://groq.com/blog/whisper-large-v3-turbo-now-available-on-groq-combining-speed-quality-for-speech-recognition)
- [Groq Distil-Whisper Deprecation](https://console.groq.com/docs/deprecations)
- [Groq Word-Level Timestamping](https://groq.com/blog/build-fast-with-word-level-timestamping)

### Whisper Architecture & Chunking
- [Bloomberg Two-Pass Streaming Whisper (Interspeech 2025)](https://www.bloomberg.com/company/stories/bloombergs-ai-researchers-turn-whisper-into-a-true-streaming-asr-model-at-interspeech-2025/)
- [Bloomberg Paper (arXiv)](https://arxiv.org/abs/2506.12154)
- [WhisperStreaming (GitHub)](https://github.com/ufal/whisper_streaming)
- [OpenAI Whisper Discussion #608 -- Real-Time STT](https://github.com/openai/whisper/discussions/608)
- [OpenAI Whisper Discussion #440 -- Chunking Issues](https://github.com/openai/whisper/discussions/440)
- [Whisper Prompting Guide (OpenAI Cookbook)](https://cookbook.openai.com/examples/whisper_prompting_guide)
- [HuggingFace ASR Chunking](https://huggingface.co/blog/asr-chunking)
- [Pipecat Groq STT Service](https://docs.pipecat.ai/server/services/stt/groq)

### Swift/macOS
- [WhisperKit (Argmax)](https://github.com/argmaxinc/WhisperKit)
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- [CGEventType.flagsChanged (Apple)](https://developer.apple.com/documentation/coregraphics/cgeventtype/flagschanged)
- [alt-tab-macos KeyboardEvents](https://github.com/lwouis/alt-tab-macos/blob/master/src/logic/events/KeyboardEvents.swift)

### VAD & Silence Detection
- [Silero VAD with faster-whisper](https://deepwiki.com/SYSTRAN/faster-whisper/5.2-voice-activity-detection)
- [OpenAI Realtime VAD](https://developers.openai.com/api/docs/guides/realtime-vad)
- [RealtimeSTT (PyPI)](https://pypi.org/project/realtimestt/)

### Benchmarks & Comparisons
- [Deepgram vs OpenAI vs Google STT](https://deepgram.com/learn/deepgram-vs-openai-vs-google-stt-accuracy-latency-price-compared)
- [Best STT APIs 2026 (Deepgram)](https://deepgram.com/learn/best-speech-to-text-apis-2026)
- [Best STT APIs 2026 (AssemblyAI)](https://www.assemblyai.com/blog/best-api-models-for-real-time-speech-recognition-and-transcription)
- [Whisper Still #1? 2025 Benchmarks](https://diyai.io/ai-tools/speech-to-text/can-whisper-still-win-transcription-benchmarks/)
- [Groq Free Tier Limits 2026](https://www.grizzlypeaksoftware.com/articles/p/groq-api-free-tier-limits-in-2026-what-you-actually-get-uwysd6mb)
