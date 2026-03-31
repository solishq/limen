# VOX ULTIMATE DESIGN SPECIFICATION

**Version:** 1.0
**Date:** 2026-03-30
**Author:** SolisHQ Design Taste Team (Researcher)
**Status:** DEFINITIVE

---

## Preamble

This document is a complete redesign from zero. Every decision is derived from first principles, informed by the current state of the art in product design (March 2026), and anchored by the thesis that Vox is not a dictation app --- it is the threshold between human thought and digital text, made invisible.

The design was produced after studying: Apple Design Award winners (2025), Linear's design system, Stripe's developer-centric web philosophy, Arc Browser's minimalist identity, Raycast's native macOS polish, Apple's Liquid Glass design language (macOS Tahoe), the competitive macOS dictation landscape (SuperWhisper, WisprFlow, Aqua Voice, Voibe, Spokenly), and 2026 trends in dark mode design, micro-interactions, typography, color psychology, glassmorphism-minimalism hybrids, and premium software branding.

---

# PART 1: BRAND IDENTITY

## 1.1 Name Analysis

**"Vox"** --- Latin for voice.

| Criterion | Score (1-10) | Assessment |
|---|---|---|
| Memorability | 9 | Three letters. One syllable. Primal. Stays in the mouth. |
| Searchability | 6 | Vox Media (vox.com) dominates generic search. "Vox dictation" or "Vox for Mac" resolves clearly. The ".app" TLD could differentiate. |
| Domain availability | 7 | vox.com is taken (media company). voxdictation.com, getvox.app, usevox.app are viable. **vox.sh** is the power move --- developer-friendly, memorable, short. |
| Emotional resonance | 9 | Voice at its root. Ancient. Universal. It does not need to explain itself. |
| Competitive differentiation | 7 | No direct competitor uses "Vox" in the dictation space. Vox Media exists in a different universe (news). Vox (music player for Mac) existed but is discontinued. The name is clean in this category. |
| Cultural weight | 10 | "Vox populi" (voice of the people), "vox humana" (the human voice, an organ stop that mimics human singing). The name carries millennia. |

**Verdict:** Keep "Vox." The name is correct. It does not need to be clever. It needs to be true. Voice. That is the product. That is the name.

**Domain recommendation:** **vox.sh** (primary) --- signals developer credibility, is globally memorable, and avoids collision with Vox Media. Fallback: **getvox.app**.

## 1.2 Logo

### Concept A: "The Threshold"

**Visual description:** Three vertical bars of different heights, arranged in a tight group, forming the silhouette of a soundwave --- but abstracted to read equally as a voice frequency, a bar graph of intelligence, or three entities standing together (Anna, Nova, Atlas). The bars are slightly rounded, with the center bar tallest. The negative space between bars is precise --- 3px at logo scale, creating a sense of togetherness without merging.

**Rationale:** The three bars embody the three voices. They are not waveform lines (too generic) or circular (too abstract). They are vertical, upright, like standing figures. The varying heights represent different frequencies, different personalities, different strengths --- united in one mark. The "threshold" metaphor connects to Limen's thesis: Vox sits at the boundary between human speech and digital text, between thinking and typing.

**Emotional impact:** Stability, plurality, intelligence. It feels architectural --- like columns holding up something important.

**Versatility:** At 16px (favicon), the three bars collapse into a recognizable triplet mark. At 512px (app icon), the proportions and spacing become expressive. Works as a single-color mark on any background. Can be rendered in the primary color, in white, or in contextual voice colors (the left bar is Anna, center is Nova, right is Atlas).

### Concept B: "The Breath"

**Visual description:** A single continuous line that traces a single breath --- rising from silence at the left, peaking in a smooth curve at center, and returning to silence at the right. Not a waveform (too many oscillations). Not a checkmark (too simple). One breath. One arc. The line has variable stroke width --- thinnest at the edges (silence), thickest at the apex (speech). Below the arc, the word "vox" in lowercase, tracked wide.

**Rationale:** Dictation begins with breath. The mark captures the fundamental physical act that precedes every word Vox captures. The variable stroke width is a technical signature --- it references amplitude, the core metric of audio capture.

**Emotional impact:** Grace, ephemerality, naturalness. It feels like inhaling before speaking.

**Versatility:** The single-arc form is distinctly recognizable at any size. At 16px, it reads as a gentle curve above text. At 512px, the stroke weight variation becomes a design feature. Can be animated: the line draws itself left to right in 400ms, mirroring the act of taking a breath.

### Concept C: "The Resonance Ring"

**Visual description:** Three concentric incomplete circles (arcs, ~270 degrees each), offset slightly in rotation, creating a subtle turbine or resonance effect. Each arc represents one voice. The innermost arc is the thinnest (a whisper --- Anna's warmth), the middle arc is medium (Nova's clarity), the outer arc is the thickest (Atlas's gravity). The gaps in the arcs are staggered, never aligned, creating visual motion.

**Rationale:** Sound radiates outward from a source. The concentric arcs capture this physics while embedding the three-voice identity. The incomplete circles create dynamism --- they are not closed, not finished, always in motion. This mirrors the product: Vox is always listening, always ready, never done.

**Emotional impact:** Energy, radiation, intelligence expanding outward.

**Versatility:** At 16px, the three arcs compress into a single ring-like mark that reads as a signal/broadcast icon without being generic. At 512px, the weight differentials and rotational offsets become distinctive. Can be animated: each arc pulses outward from center, one after another, in sequence.

### Recommendation

**Concept A: "The Threshold"** is the primary recommendation. Reasons:

1. It is the only concept that reads correctly at every scale without transformation.
2. Three bars are immediately parseable as "three voices" without explanation.
3. It connects to Limen's intellectual thesis (the threshold between human and machine).
4. It is simple enough to stamp on a 16px favicon, distinctive enough for a 512px app icon, and meaningful enough for a billboard.
5. It avoids the visual clich of waveforms, broadcast signals, or microphone icons that every voice product uses.

The Breath (Concept B) is the fallback for marketing materials and hero animations. The Resonance Ring (Concept C) is a motion-design asset, ideal for loading states and app launch animations.

## 1.3 Color System

### First-Principles Derivation

The previous design used warm amber (#E8915A). Starting from zero:

**What must the color communicate?**
- Voice (warmth, human, organic --- not cold/digital)
- Intelligence (depth, not playfulness)
- Trust (stability, not volatility)
- Premium (restraint, not exuberance)
- Future (forward-looking, not nostalgic)

**What must it avoid?**
- Blue (too generic for tech/AI, conflicts with transcribing state, approaches Limen's indigo)
- Purple (directly conflicts with Limen's Deep Indigo #6366F1)
- Green (reads as "success" state, not brand)
- Red (reads as "error" or "recording/danger")
- Orange (too playful, startup-coded)

**Color psychology synthesis:** Amber sits at the intersection of warmth (human voice) and gold (premium, intelligence). It avoids the playfulness of orange and the urgency of red. In a market where every AI product uses blue, purple, or green, amber is distinctive. The research confirms: amber stimulates the mind, promotes well-being, and creates feelings of warmth and security. It is associated with luxury and elegance through its golden tones.

**The re-derivation confirms the previous choice was correct in principle, but the specific value needs refinement for the three-voice system.**

### Primary Palette

The brand does not have one color. It has a triad --- one per voice --- unified by a shared warmth.

| Token | Name | Hex | Usage |
|---|---|---|---|
| `--vox-anna` | Anna Amber | `#D4915A` | Recording state (Anna active), warm brand moments, CTAs |
| `--vox-nova` | Nova Gold | `#C9A84C` | Recording state (Nova active), highlights, accent links |
| `--vox-atlas` | Atlas Bronze | `#8B7355` | Recording state (Atlas active), grounded elements, footers |
| `--vox-brand` | Vox Ember | `#C8875A` | Universal brand color when no specific voice is active |

**Design rationale:** All three voice colors share the warm amber-gold-bronze family. They are siblings, not strangers. Anna is the warmest (more red), Nova is the brightest (more yellow), Atlas is the deepest (more brown). Together they create a rich warm palette that no competitor owns.

### Neutral Palette (Dark Mode Primary)

| Token | Name | Hex | Usage |
|---|---|---|---|
| `--surface-0` | Void | `#0C0C0E` | Page background, deepest layer |
| `--surface-1` | Obsidian | `#141416` | Card backgrounds, primary surfaces |
| `--surface-2` | Graphite | `#1C1C20` | Elevated cards, modals, menus |
| `--surface-3` | Slate | `#252528` | Hover states, active items |
| `--surface-4` | Ash | `#2E2E32` | Borders, dividers, subtle separations |
| `--text-primary` | — | `#EDEDEF` | Primary text, headings |
| `--text-secondary` | — | `#9E9EA4` | Body text, descriptions |
| `--text-tertiary` | — | `#5C5C64` | Captions, muted labels |
| `--text-inverse` | — | `#0C0C0E` | Text on light/accent backgrounds |

**Reasoning:** No pure black (#000000) --- following 2026 dark mode best practice. The surface scale uses warm-neutral undertones (slight warmth in the grays) that harmonize with the amber palette. Each step provides exactly enough contrast for layered UI without visual fatigue.

### Neutral Palette (Light Mode)

| Token | Name | Hex | Usage |
|---|---|---|---|
| `--surface-0` | Cloud | `#FAFAF8` | Page background |
| `--surface-1` | Stone | `#F2F1EE` | Card backgrounds |
| `--surface-2` | Parchment | `#E8E7E3` | Elevated cards |
| `--surface-3` | Linen | `#DDDCD8` | Hover states |
| `--surface-4` | Clay | `#C8C7C3` | Borders, dividers |
| `--text-primary` | — | `#1A1A1C` | Primary text |
| `--text-secondary` | — | `#555558` | Body text |
| `--text-tertiary` | — | `#8E8E92` | Captions |

**Reasoning:** Warm whites. Not cold blue-whites. The light mode feels like parchment, not fluorescence. It matches the warm brand palette.

### Semantic Colors

| Token | Hex (Dark) | Hex (Light) | Usage |
|---|---|---|---|
| `--semantic-success` | `#6EC88B` | `#2D8B50` | Transcription complete, positive states |
| `--semantic-warning` | `#D4A84C` | `#A67B1C` | Approaching limits, non-critical issues |
| `--semantic-error` | `#C46B5A` | `#9E3B2A` | Failures, permission denied |
| `--semantic-info` | `#6B9EC4` | `#3A6B9E` | Informational, transcribing state |

**Reasoning:** Desaturated to 70-80% per dark mode best practice. None of these overlap with the voice colors. Success is green (not Anna's amber), error is desaturated coral (not Nova's gold), info is steel blue (not Atlas's bronze).

### App State Colors (Overlay)

| State | Color Token | Hex | Reasoning |
|---|---|---|---|
| Recording (Anna) | `--vox-anna` | `#D4915A` | Warm amber glow |
| Recording (Nova) | `--vox-nova` | `#C9A84C` | Bright gold glow |
| Recording (Atlas) | `--vox-atlas` | `#8B7355` | Deep bronze glow |
| Transcribing | `--semantic-info` | `#6B9EC4` | Cool blue shimmer (processing) |
| Done | `--semantic-success` | `#6EC88B` | Green flash (completion) |
| Error | `--semantic-error` | `#C46B5A` | Coral (problem) |

This is the critical innovation: **the recording state color changes based on which voice is active.** The user learns to associate color with voice. Over time, they do not need to read "Anna" or "Nova" --- they feel it.

## 1.4 Typography

### Display Font: **Satoshi**

**What it is:** A modern geometric sans-serif by Indian Type Foundry. Variable weight (300-900). Clean, future-forward, with humanist touches that prevent it from feeling robotic.

**Why:** The search confirmed 2026 typography is moving toward expression with warmth. Satoshi achieves this --- it is geometric enough to feel technical and intelligent, but its letterforms have subtle organic curves that feel human. It is the typographic equivalent of Vox's thesis: the boundary between human and machine.

**Where:** Hero headlines, feature titles, voice names (ANNA, NOVA, ATLAS), marketing headers.

**Fallback:** If licensing is a concern, **General Sans** (also by Indian Type Foundry, free for commercial use) achieves 80% of the same effect.

### Body Font: **Inter**

**What it is:** The most widely used UI font in the world. Variable weight, massive x-height, designed for screens.

**Why:** Inter is correct for body text because it is invisible. It does not compete with content. It does not have personality. It is pure readability. For a product that promises to "disappear," the body font should also disappear. Linear uses it. Raycast uses it. Every premium developer tool uses it. Not because they copied each other --- because it is the right answer.

**Where:** All body text, navigation, buttons, form labels, descriptions.

### Code Font: **JetBrains Mono**

**What it is:** Monospace font with increased height for better readability, ligatures for common programming symbols.

**Why:** For MCP configuration snippets, CLI examples, and developer documentation. JetBrains Mono is the standard in developer tooling. Using it signals "we are developers building for developers."

**Where:** Code blocks, terminal examples, MCP config snippets, API docs.

### Voice Name Typography

The three voices each get a distinctive treatment using the display font:

| Voice | Treatment | Rationale |
|---|---|---|
| **Anna** | Satoshi Regular, letter-spacing +2% | Gentle, open, warm. The wider spacing feels like a deep breath. |
| **Nova** | Satoshi Medium, letter-spacing 0% | Crisp, precise, alive. Default tracking feels energetic. |
| **Atlas** | Satoshi Bold, letter-spacing -1% | Dense, grounded, heavy. The tight tracking feels weighty. |

This is subtle. It is not different fonts --- it is different *treatments* of the same font, mirroring how the three voices are different treatments of the same technology.

## 1.5 Sonic Brand

### Voice-Specific Start/Stop Sounds

Each voice gets its own audio signature, composed from the same harmonic series but with different fundamentals:

| Voice | Start Sound | Stop Sound | Harmonic Character |
|---|---|---|---|
| **Anna** | Soft mallet on warm pad, C4 (262Hz) | Gentle release with slight reverb tail | Rich overtones, like a wooden instrument |
| **Nova** | Crystalline ping, G4 (392Hz) | Bright bell decay, short and clear | Clean harmonics, like glass or chime |
| **Atlas** | Low resonant tone, C3 (131Hz) | Deep settled hum, fading to silence | Fundamental-heavy, like a cello pizzicato |

**Design rationale:** The sounds are musically related (C major triad: C-E-G, adjusted to C-G-C across octaves). When heard in sequence, they form harmony. When heard individually, each is recognizable. The user's ear learns which voice is active before their eyes see the overlay.

**Duration:** Start sounds are 180-220ms. Stop sounds are 300-400ms. Short enough to not interrupt. Long enough to register.

**Amplitude:** 40% of system volume. Never jarring. Never inaudible.

### Visual Translation of Sonic Identity

| Element | How Voice Identity Manifests |
|---|---|
| **App icon** | The three bars from the logo can be rendered in voice colors: left bar = Anna (#D4915A), center bar = Nova (#C9A84C), right bar = Atlas (#8B7355). Default icon uses `--vox-brand` (#C8875A) uniformly. |
| **Website** | Each voice gets a character card with waveform visualization unique to their harmonic character. Anna's waveform is smooth and wide. Nova's is sharp and rhythmic. Atlas's is deep and steady. |
| **Overlay pill** | The outer glow color shifts per active voice. Anna = warm amber glow. Nova = bright gold glow. Atlas = deep bronze glow. |
| **Marketing** | Video: three parallel waveforms, color-coded, moving independently but in rhythm. Still: the three-bar logo mark with each bar in its voice color. |

---

# PART 2: WEBSITE

## 2.1 Hero Section

### Headline

**"Your voice. Your words."**

**Rationale:** "Dictation that disappears" is the thesis --- but theses are internal anchors, not headlines. The headline must be about the user, not the product. "Your voice. Your words." says: *what you speak is what you get. No corrections. No reformatting. No fighting with software.* It is a promise of fidelity.

### Subheadline

"Vox turns speech to text on your Mac --- instantly, accurately, privately. Hold a key. Speak. Done."

**Rationale:** Three words: instantly (speed), accurately (quality), privately (trust). Then the three-step flow compressed into one sentence. No jargon. No feature list. Pure clarity.

### Hero Visual

Not a screenshot. Not a mockup. A **living waveform**.

A full-width dark canvas (#0C0C0E) with three animated waveforms --- one for each voice --- rendered in their respective colors. The waveforms are not playing audio. They are breathing --- gentle amplitude oscillations that feel alive but calm. They occupy the middle third of the screen vertically, with the headline text layered above them and the CTAs below.

The waveforms are drawn with SVG paths animated via CSS/JS. Each has a different character:
- Anna's waveform: smooth, wide curves, like a calm ocean
- Nova's waveform: sharper peaks, rhythmic, like a heartbeat
- Atlas's waveform: deep, slow undulations, like earth tremors

When the user hovers over the hero, the waveforms respond subtly --- amplitude increases by 15%, as if the page is listening.

### Primary CTA

**"Download for Mac"** --- white text on `--vox-brand` (#C8875A) background. Rounded rectangle, 48px height, 200px minimum width. On hover: the button glows with a subtle ember aura (box-shadow using brand color at 30% opacity).

### Secondary CTA

**"See how it works"** --- text link in `--text-secondary`, underlined on hover. Scrolls to the demo section.

### Voice Introduction

Below the CTAs, three small badges in a horizontal row:

**Anna** | **Nova** | **Atlas**

Each name in its voice typography treatment, each with a small play button (circle, 24px). Hovering pauses the breathing waveform and activates a 3-second audio sample of that voice reading: "Every word, exactly as you said it."

This is the first encounter with the three voices. It is not explained yet. It is *demonstrated.* The user hears three distinct voices and feels curiosity.

## 2.2 The Story Flow

### Beat 1: The Hook

**What the user sees:** Hero section as described above.
**What they feel:** Intrigue. "Three voices? What is this?"
**What they do:** Scroll down.

### Beat 2: The Problem

**Section title:** "Dictation was never this simple."

**Visual:** Split-screen comparison. Left side: a chaotic mess of a dictation UI with correction popups, formatting panels, mic level meters, progress bars --- the visual noise of every competitor. Right side: an empty screen with one small amber pill at the top. A blinking cursor in a text field. That is it.

**Copy:** "Most dictation apps are built for the screen. Vox is built for the voice. No windows. No buttons. No UI to learn. Just hold Right Option and speak."

**What the user feels:** Relief. "Finally, someone gets it."

### Beat 3: The Solution

**Section title:** "Hold. Speak. Done."

**Visual:** A three-step animation that plays as the user scrolls into view:

1. **Hold** --- A keyboard appears. The Right Option key illuminates amber. The overlay pill appears at the top of a simulated macOS screen. (Duration: 600ms)
2. **Speak** --- The pill's waveform bars animate. A text cursor in the background types words as they are "spoken." The words appear in real-time, flowing like water. (Duration: 2000ms)
3. **Done** --- The pill flashes green. A checkmark springs in. The pill fades away. The text remains. (Duration: 800ms)

**Copy beneath:** "Sub-second latency. Groq-powered Whisper large-v3. Accurate on technical terms, proper nouns, and punctuation. Works everywhere you type."

**What the user feels:** Desire. "I want this right now."

### Beat 4: The Magic (Voice Showcase)

**Section title:** "Three voices. One Vox."

This is the differentiator section. No competitor has named, designed, personality-encoded voice identities. This is where the user understands that Vox is not a utility --- it is a cast.

**Layout:** Three vertical panels, side by side on desktop, stacked on mobile. Each panel is a character card:

**Anna**
- Background gradient: `#D4915A` at 8% opacity fading to transparent
- Waveform visualization: smooth, rolling, organic (SVG animation, 40px tall)
- Tagline: "Warm. Grounded. Trust."
- Description: "Anna speaks with the warmth of a trusted colleague. Clear diction, natural rhythm, and a voice that makes long texts feel effortless."
- Audio sample button: Play circle, 48px, amber border. On click: 6-second sample.
- Voice character indicators: Three small attributes --- "Warmth: High | Pace: Natural | Tone: Conversational"

**Nova**
- Background gradient: `#C9A84C` at 8% opacity
- Waveform: sharper, more rhythmic (SVG animation)
- Tagline: "Clear. Alive. Insight."
- Description: "Nova speaks with crystalline precision. Every word lands exactly where it should. The voice for code reviews, technical docs, and fast dictation."
- Audio sample button: gold border
- Character indicators: "Clarity: High | Pace: Energetic | Tone: Precise"

**Atlas**
- Background gradient: `#8B7355` at 8% opacity
- Waveform: deep, slow, powerful (SVG animation)
- Tagline: "Measured. Deep. Gravity."
- Description: "Atlas speaks with the weight of considered thought. Deliberate pace, resonant depth. The voice for important messages and careful composition."
- Audio sample button: bronze border
- Character indicators: "Depth: High | Pace: Deliberate | Tone: Authoritative"

**Interaction:** When the user hovers over a panel, the waveform responds --- amplitude increases, and a subtle ambient tone plays at -30dB (the harmonic fundamental of that voice). When they click play, the full audio sample plays and the other two panels dim to 40% opacity, spotlighting the active voice.

**What the user feels:** "These are characters, not settings. I want to know them."

### Beat 5: The Proof

**Section title:** "Speed you can feel."

**Visual:** A live metrics display showing three numbers:

- **< 500ms** --- "Average transcription latency"
- **99.2%** --- "Word accuracy on natural speech"
- **100%** --- "Privacy. Audio never leaves your Mac unless you choose cloud."

Below the metrics, a simple testimonial strip with 3-5 quotes from real users (once available). Format: quote text, attribution (name, role), no photos (premium restraint --- let the words speak).

**What the user feels:** Trust. Data, not marketing.

### Beat 6: The AI Angle (For Developers)

**Section title:** "Built for agents."

**Visual:** A dark code block with syntax-highlighted JSON showing the MCP server configuration:

```json
{
  "mcpServers": {
    "vox": {
      "command": "vox",
      "args": ["--mcp"]
    }
  }
}
```

**Copy:** "Vox exposes dictation as an MCP tool. Your AI agents can listen, transcribe, and respond using the same three voices. Three lines of config. Full voice-in, voice-out for Claude, GPT, or any MCP-compatible agent."

Below: a bento grid (3 cards) showing MCP capabilities:
- **Voice Input** --- "Agents can listen to the user through Vox"
- **Voice Output** --- "Agents can speak through Anna, Nova, or Atlas"
- **Voice Identity** --- "Each agent can have its own voice persona"

**What the user feels:** "This is not just a dictation app. This is infrastructure."

### Beat 7: The Privacy Promise

**Section title:** "Your voice stays on your Mac."

**Visual:** A simple diagram. A Mac icon on the left. A dotted line leading to the right, where a cloud icon sits behind a lock icon. The dotted line is labeled "Only with Pro (opt-in)." Below the Mac: "Free tier: everything on-device. Local Whisper. No network. No telemetry."

**Copy:** "Vox Free processes audio entirely on your Mac using local Whisper models. No data leaves your device. Ever. Vox Pro uses Groq's cloud for faster, more accurate transcription --- but only when you choose to enable it."

**What the user feels:** "These people respect my privacy."

### Beat 8: Pricing

**Section title:** "Simple pricing. No tricks."

**Layout:** Two cards, side by side.

**Vox Free**
- Price: "$0 / forever"
- Features:
  - Local Whisper transcription
  - Hold-to-talk dictation
  - All three voices (output)
  - Works offline
  - No account required
- CTA: "Download"

**Vox Pro**
- Price: "$8 / month"
- Badge: "Recommended" in brand color
- Features:
  - Everything in Free, plus:
  - Groq Whisper large-v3 (cloud)
  - Sub-500ms latency
  - MCP server mode for AI agents
  - Priority support
  - Custom vocabulary
- CTA: "Start free trial" (7 days)

**Design:** Cards on `--surface-1` background. Free card has a subtle border. Pro card has a `--vox-brand` gradient top border (2px). No feature comparison tables. No "most popular" banners. No dark patterns. Just two honest options.

**What the user feels:** "$8/month for this? That is absurdly fair."

### Beat 9: The Close

**Section title:** None. Just the moment.

**Visual:** The three waveforms from the hero, but now they are converging --- moving toward center, their colors blending into the unified `--vox-brand` ember. Below them:

**Headline:** "The last dictation app you will ever need."
**CTA:** "Download for Mac" --- larger button, full brand color, centered.

**Footer:** Minimal. Logo (three bars, brand color). Links: Privacy, Terms, GitHub, Twitter/X, Contact. Copyright.

**What the user feels:** Conviction. Download.

## 2.3 Animations and Interactions

### Scroll-Triggered Animations

| Section | Animation | Trigger | Duration |
|---|---|---|---|
| Hero waveforms | Breathing amplitude oscillation | Page load | Continuous |
| Problem split-screen | Left side slides in from left, right slides from right, meeting at center | 30% visible | 600ms, ease-out |
| Solution 3-step | Sequential: key illuminates, pill appears, text types, checkmark springs | 50% visible | 3400ms total |
| Voice cards | Stagger fade-up: first card, then 120ms delay, second, 120ms, third | 40% visible | 400ms each |
| Metrics | Number count-up animation from 0 to final value | 60% visible | 1200ms |
| Code block | Typewriter effect, line by line | 50% visible | 800ms |
| Pricing cards | Scale from 0.96 to 1.0 + opacity 0 to 1 | 40% visible | 300ms, 100ms stagger |
| Close waveforms | Converge to center + color blend | 30% visible | 2000ms |

### Hover States

| Element | Hover Effect | Duration |
|---|---|---|
| Primary CTA | Glow aura (box-shadow: 0 0 24px brand-color/30%) | 200ms ease |
| Secondary CTA | Underline slides in from left | 200ms ease |
| Voice cards | Card lifts 2px (translateY), shadow deepens, waveform amplitude +15% | 250ms ease-out |
| Voice play button | Scale 1.0 to 1.08, border brightens | 150ms ease |
| Nav links | Color shifts from text-secondary to text-primary | 150ms ease |
| Code block | Subtle top-left gradient glow in brand-color/5% | 300ms ease |

### Page Transitions

No page transitions. The entire site is a single page. Smooth scroll with `scroll-behavior: smooth` and `scroll-padding-top: 80px` (for fixed nav clearance). Navigation links are anchor jumps, not route changes.

### Loading States

A single loading state: the three-bar logo mark animating --- each bar pulses in sequence (left, center, right), with a 120ms delay between each, in brand color. The entire animation loop is 900ms. This is the only loading indicator across the entire brand.

### Micro-Interactions

| Interaction | Description | Purpose |
|---|---|---|
| Copy code button | On click: button text changes from "Copy" to "Copied" with a check icon, reverts after 2s | Confirmation without modal |
| Voice sample play | On play: waveform begins animating in real-time to the audio. On pause: waveform freezes mid-state | Audio-visual synchronization creates presence |
| Download button | On click: button briefly shows a download arrow animation (300ms), then redirects | Satisfying download initiation |
| Scroll indicator | Subtle downward-pointing chevron below hero, pulses slowly (2s cycle), disappears after first scroll | Invites exploration without being desperate |
| Nav appearance | Fixed nav starts transparent, gains surface-1 background + bottom border after 100px scroll | Clean hero, structured navigation once scrolling |

### Parallax

**No parallax.** Rationale: Parallax creates a sense of depth that conflicts with Vox's design thesis of disappearance and flatness. The product is about removing visual clutter. Parallax adds visual complexity. Instead, elements use scroll-triggered opacity and position changes that feel like natural emergence, not layered depth.

## 2.4 Mobile Responsive

### Mobile Hero

The three waveforms stack vertically instead of horizontally, each at 30% viewport height. The headline and subheadline center-align. The CTA stack changes: "Download for Mac" becomes "Get Vox for Mac" (acknowledging they are on mobile) with a secondary "Learn more" that scrolls down.

Below the CTA, a small note: "Vox is a macOS app. Visit this page on your Mac to download." This is honest. It does not pretend the app works on mobile.

### Mobile Navigation

Hamburger menu (three horizontal bars --- which, by design coincidence, echo the logo). Drawer slides in from right, full viewport height, `--surface-1` background. Links stacked vertically with 56px touch targets. Close button top-right (X icon, 44px).

### Mobile Voice Showcase

Voice cards stack vertically with full width. Each card includes the waveform visualization (simplified: 3 bars instead of full SVG waveform, animated). Audio sample buttons are 56px touch target circles. The three cards are separated by 24px gaps.

### Mobile Pricing

Cards stack vertically. Pro card appears first (recommended). Full-width. No horizontal comparison layout. Each card has its own CTA.

## 2.5 Dark Mode as Default

The website loads in dark mode by default. A toggle is available in the navigation (sun/moon icon, 32px) for users who prefer light. The preference is stored in `localStorage` and respected via `prefers-color-scheme` media query as fallback.

**Dark mode aesthetic:** The page should feel like a recording studio at night. The surfaces are warm-dark (not cold-dark). The accent colors glow against the darkness like indicator lights on equipment. The three voice waveforms shimmer like aurora against a night sky.

**Light mode:** Clean, warm whites. The voice colors become slightly deeper/more saturated to maintain contrast. The overall feel shifts from "studio" to "sunlit office."

---

# PART 3: APP EXPERIENCE

## 3.1 Overlay States with Voice Identity

### Core Innovation: Voice-Aware Overlay

The overlay pill now communicates which voice is active through color, not text. The pill shape, size, and animation behavior remain consistent --- only the color language changes.

### Recording (Anna Active)

- **Glow color:** `#D4915A` (Anna Amber)
- **Bar color:** `#D4915A`
- **Tint overlay:** `#D4915A` at 8% opacity
- **Glow breathing:** 15-25% opacity over 2.5 seconds (unchanged)
- **Sound:** Anna's start sound (warm mallet, C4)
- **Feel:** Like sitting by a fire. Warm, safe, trusted.

### Recording (Nova Active)

- **Glow color:** `#C9A84C` (Nova Gold)
- **Bar color:** `#C9A84C`
- **Tint overlay:** `#C9A84C` at 8% opacity
- **Glow breathing:** Same timing, brighter oscillation (18-30% opacity) --- Nova is more alive
- **Sound:** Nova's start sound (crystalline ping, G4)
- **Feel:** Like sunlight through glass. Bright, precise, energizing.

### Recording (Atlas Active)

- **Glow color:** `#8B7355` (Atlas Bronze)
- **Bar color:** `#8B7355`
- **Tint overlay:** `#8B7355` at 8% opacity
- **Glow breathing:** Slower oscillation (12-20% opacity, 3.0 second period) --- Atlas is measured
- **Sound:** Atlas's start sound (low resonant tone, C3)
- **Feel:** Like standing on solid ground. Deep, deliberate, important.

### Transcribing (Universal)

- **Color:** `#6B9EC4` (semantic info)
- **Animation:** Shimmer (unchanged)
- **Reasoning:** Transcription is a machine operation, not a voice identity moment. It should feel neutral and computational.

### Done (Universal)

- **Color:** `#6EC88B` (semantic success)
- **Animation:** Spring checkmark (unchanged)
- **Reasoning:** Completion is completion, regardless of voice.

### Error (Universal)

- **Color:** `#C46B5A` (semantic error)
- **Animation:** Shake + expand (unchanged)
- **Reasoning:** Errors are errors. No voice personality here.

### Voice Indicator on Pill

A small element at the right side of the pill during recording: a 6px diameter circle in the active voice color, with the first letter of the voice name (A, N, or A) in 8px Satoshi Bold, centered within a 16px circle. This is optional and can be disabled in settings. It sits inside the pill, 8px from the right edge, vertically centered.

This indicator is invisible during transcribing, done, and error states. It only appears during recording.

## 3.2 Menu Bar

### Icon Design

The menu bar icon is a single SF Symbol with dynamic color:

| State | Symbol | Color |
|---|---|---|
| Idle | `mic` | System secondary label color |
| Recording (Anna) | `mic.fill` | `#D4915A` |
| Recording (Nova) | `mic.fill` | `#C9A84C` |
| Recording (Atlas) | `mic.fill` | `#8B7355` |
| Transcribing | `ellipsis.circle` | `#6B9EC4` |
| Done | `checkmark.circle.fill` | `#6EC88B` |
| Error | `exclamationmark.triangle.fill` | `#C46B5A` |

### Dropdown Menu (Redesigned)

```
+----------------------------------+
|  Vox                    Pro      |
|  Status: Ready                   |
+----------------------------------+
|  Voice: Anna            >        |
|    > Anna   (warm)               |
|    > Nova   (clear)              |
|    > Atlas  (measured)           |
+----------------------------------+
|  Session Stats                   |
|    Dictations today:  14         |
|    Words today:       2,847      |
|    Avg latency:       340ms      |
+----------------------------------+
|  Hotkey: Right Option (hold)     |
+----------------------------------+
|  AI Agent Setup...               |
|  Settings...                     |
+----------------------------------+
|  Quit Vox                    Q   |
+----------------------------------+
```

**Voice selector:** Clicking "Voice: Anna" expands a submenu showing all three voices with their one-word descriptor. The active voice has a checkmark. Selecting a voice changes the default immediately --- the next dictation uses that voice.

**Session stats:** Lightweight telemetry stored locally only. Words count, dictation count, average latency. Resets daily. Provides a sense of productive usage.

**AI Agent Setup:** Opens a panel (or sheet) with the MCP configuration JSON, a "Copy to clipboard" button, and a link to documentation. Only visible for Pro users.

**Settings:** Opens the Settings window (see Part 4).

## 3.3 Sounds per Voice

**Recommendation:** Voice-specific sounds, as designed in Section 1.5.

**Rationale:** The sonic differentiation reinforces the visual differentiation. If the user has their eyes on their work (as they should --- dictation that disappears), the start sound alone tells them which voice is active. This is functional, not decorative. It is an audio affordance.

**Setting:** "Voice-specific sounds" toggle in Settings. Default: ON. If OFF, a single universal sound plays (the Anna mallet sound, which is the warmest and most neutral of the three).

---

# PART 4: DOWNLOAD AND ONBOARDING

## 4.1 Download Experience

### Download Page (vox.sh/download)

Not a separate page. The pricing section CTA triggers a direct `.dmg` download. The browser's native download indicator is sufficient. No custom download progress UI.

After download begins, the page scrolls to a "Getting Started" section that was hidden before:

**Step 1:** Open the downloaded Vox.dmg
**Step 2:** Drag Vox to Applications
**Step 3:** Launch Vox from Applications or Spotlight

Each step has a simple illustration (macOS-native style, line art in brand color on dark background). No screenshots --- illustrations are timeless and do not break when macOS updates its UI.

### System Requirements

- macOS 14.0 (Sonoma) or later
- Apple Silicon (M1 or later) --- for local Whisper model inference
- 500MB disk space (includes base Whisper model)
- Microphone access
- Accessibility permission (for keyboard simulation)

Displayed in a small, collapsed section at the bottom of the download area. Expandable on click. Not prominent --- most Mac users meet these requirements.

## 4.2 First-Run Experience

### Permission Grants

When the user launches Vox for the first time, they encounter two macOS permission dialogs. Vox does not build custom permission screens. It uses the system dialogs because:

1. Custom screens add UI. Vox removes UI.
2. System dialogs are trusted. Custom screens are suspicious.
3. Users already know how to interact with macOS permission dialogs.

However, before each system dialog fires, a small overlay pill appears at the top of the screen with contextual guidance:

**Before Microphone dialog:**
Pill text: "Vox needs microphone access to hear you"
Color: `--vox-brand`
Duration: 2 seconds, then the system dialog appears

**Before Accessibility dialog:**
Pill text: "Vox needs accessibility access to type for you"
Color: `--vox-brand`
Duration: 2 seconds, then the system dialog appears

This is minimal. Two sentences. No modals. No multi-step wizards. The overlay pill *is* the onboarding UI.

### Voice Selection

After permissions are granted, a single floating panel appears (similar to Spotlight, centered on screen, 400px wide, 240px tall):

```
+------------------------------------------+
|                                          |
|       Choose your voice.                 |
|                                          |
|    [ Anna ]  [ Nova ]  [ Atlas ]         |
|     warm      clear     measured         |
|                                          |
|    Each button plays a 3-second          |
|    audio sample on click.                |
|                                          |
|              [ Continue ]                |
|                                          |
+------------------------------------------+
```

**Design:** Dark background (`--surface-2`), rounded corners (12px), subtle shadow. The three voice buttons are pill-shaped, colored with their respective voice color at 15% opacity, with the voice name in white. Clicking a button:
1. Plays the 3-second sample
2. Highlights the button (full voice color background, dark text)
3. The other two buttons dim

The "Continue" button is disabled until a voice is selected. Once clicked, the panel fades out (300ms) and Vox is ready.

**No tutorial.** The user already knows what Vox does --- they downloaded it because the website told them. The product should work immediately. The only discovery moment is learning the hotkey, which is communicated by:

### First Dictation Prompt

After voice selection, a small pill appears at the top of the screen:

"Hold Right Option to dictate" --- in `--text-secondary`, displayed for 5 seconds, then fades.

That is the entire tutorial. One sentence. If the user does not try it immediately, the pill appears again the next time they launch Vox, and disappears permanently after the first successful dictation.

### The "Wow" Moment

The first time the user holds Right Option and speaks, and their words appear --- instantly, accurately, in the app they are using --- that is the wow moment. No artificial wow is needed. The product *is* the wow moment. Designing an artificial first-use delight (confetti, animations, congratulations) would undermine the thesis of disappearance.

The only acknowledgment: the done state (green checkmark, spring animation, 950ms) and the "Pop" sound. This tells the user: "It worked. It is done." Then it vanishes.

## 4.3 Settings

### Settings Window

A native macOS Settings window (NSWindow with toolbar segmented control, following Tahoe/Liquid Glass conventions):

**General**
- Default voice: Anna / Nova / Atlas (segmented control)
- Hotkey: Right Option (read-only for now, with note: "Custom hotkeys coming soon")
- Launch at login: toggle
- Show overlay: toggle (if someone wants audio-only with no visual)

**Audio**
- Transcription: Local (free) / Cloud (Pro)
- Whisper model: base.en / small.en (local only)
- Custom vocabulary: Edit... (opens vocabulary.txt in TextEdit)
- AGC (Automatic Gain Control): toggle + target level slider

**AI Agents** (Pro only)
- MCP Server: enabled/disabled toggle
- Configuration: read-only code block with copy button
- Connection status: "Connected" / "No agent connected"
- Documentation: "Learn more" link

**Account** (Pro only)
- Email, subscription status
- Manage subscription (link to Stripe customer portal)
- Sign out

**About**
- Version number
- "Check for updates"
- License: Apache 2.0
- Credits: "Built by SolisHQ"

---

# PART 5: MARKETING MATERIALS

## 5.1 Social Preview Image (1200x630)

**Composition:**
- Background: `--surface-0` (#0C0C0E)
- Center: The three-bar logo mark, large (200px tall), each bar in its voice color
- Below logo: "Vox" in Satoshi Bold, 48px, `--text-primary`
- Below name: "Your voice. Your words." in Inter Regular, 20px, `--text-secondary`
- Bottom-left corner: "vox.sh" in Inter, 14px, `--text-tertiary`
- Bottom-right corner: "macOS" in Inter, 14px, with Apple logo icon

**Style:** No gradients. No effects. Just the mark, the name, the tagline, on darkness. Restraint is the entire message.

## 5.2 Product Hunt Assets

### Thumbnail (240x240)
The three-bar logo mark on `--surface-0`, centered, 120px tall, bars in voice colors. No text. The mark speaks.

### Gallery Images (8)
1. Hero: Three waveforms on dark background with "Your voice. Your words." headline
2. The Overlay: Screenshot of Vox pill in recording state, floating above a real macOS workspace
3. The Three Voices: Anna, Nova, Atlas character cards
4. Speed: The metrics display (< 500ms, 99.2%, 100%)
5. Privacy: Mac icon with lock, "Your voice stays on your Mac"
6. For Developers: MCP config code block
7. Pricing: The two pricing cards
8. The Logo: Three bars, full color, on dark background --- brand moment

### Tagline (60 chars)
"Hold a key. Speak. Your words appear. Vox for Mac." (51 chars)

### Description (260 chars)
"Three AI voices. Sub-500ms transcription. Privacy-first. Vox is macOS dictation that disappears --- hold Right Option, speak, your words appear where you type. Local Whisper free, Groq cloud Pro. MCP for AI agents." (216 chars)

## 5.3 App Store / DMG Assets

### App Icon (1024x1024)

The three-bar logo mark rendered as a macOS app icon:

- Background: Rounded squircle (standard macOS icon shape), filled with a subtle gradient from `--surface-1` (#141416) at top to `--surface-0` (#0C0C0E) at bottom
- Three bars: Centered vertically and horizontally, heights proportional to the logo spec, each bar rendered with a vertical gradient of its voice color (lighter at top, slightly darker at bottom, creating a subtle 3D effect without breaking flatness)
- Bars: Left = Anna (#D4915A), Center = Nova (#C9A84C), Right = Atlas (#8B7355)
- No text. No microphone glyph. Just the three bars.

At 16px (Dock tiny mode), the three bars remain distinctly visible as a triplet mark. At 1024px, the color gradients and spacing become a design feature.

### DMG Background

When the user opens the DMG:
- Background: Dark (`--surface-0`) with the three waveforms at 5% opacity as subtle texture
- Left: Vox.app icon
- Right: Applications folder alias
- Arrow: A single horizontal arrow in `--text-tertiary` pointing right
- Bottom: "Drag to install" in Inter, 13px, `--text-tertiary`

Clean. Fast. No branding overload. The DMG is a means, not a destination.

---

# PART 6: THREE WOW MOMENTS

## 6.1 The First Wow (Within 30 Seconds)

**What they see:** They hold Right Option for the first time. The pill appears --- a small, glowing amber capsule at the top of their screen. They speak a sentence. They release the key. The pill flashes green, springs a checkmark, and vanishes. They look at their text field. Their words are there. Every word. Punctuated correctly. No corrections needed.

**What they feel:** "That is all? It just... works?" Disbelief that it is this simple. Relief that they did not have to learn anything. Delight at the speed.

**What they do:** They try again immediately. Longer sentence this time. Works again. They start smiling.

**Design contribution:** The 120ms appear animation and the spring checkmark create the physical sensation of responsiveness. The sub-second latency creates the psychological sensation of magic. The overlay vanishing creates the emotional sensation of respect --- the app did its job and got out of the way.

## 6.2 The Daily Wow (After a Week)

**What they see:** They glance at the menu bar stats. "Words today: 3,200." They realize they have been dictating entire emails, Slack messages, document sections --- without consciously thinking about it. Vox has become invisible. They do not "use Vox." They just speak and words appear.

**What they feel:** A quiet recognition that their relationship with text input has changed. Typing feels slow now. Dictation feels like thinking aloud and having their thoughts captured perfectly.

**What they do:** Nothing dramatic. They just keep using it. The daily wow is the absence of friction. It is negative-space delight --- the wow of nothing going wrong, ever, for days.

**Design contribution:** The session stats provide the quantitative mirror. Without them, the user would not notice the magnitude of the habit. "3,200 words" makes the invisible visible for one moment.

## 6.3 The Share Wow (The Viral Moment)

**What they see:** They are on a video call or screen-sharing. They need to type something. Instead of typing, they hold Right Option and speak. Their colleagues see the amber pill appear, the waveform dance, and text flow into the field. Someone says "What is that?"

**What they feel:** Pride of discovery. The feeling of showing someone a secret weapon.

**What they do:** They say "It is called Vox." They share the link. vox.sh. Three characters (after the protocol). Memorable. Easy to type in a chat.

**Design contribution:** The overlay pill is the viral mechanic. It is the only visible element of Vox, and it is designed to be beautiful enough that when someone else sees it, they ask about it. The amber glow, the waveform bars, the spring checkmark --- these are designed to be screenshot-worthy. The fact that the pill is *on top of other apps* means it is visible during screen-sharing without the user needing to show the Vox app itself.

---

# PART 7: DESIGN SYSTEM SPECIFICATION

## 7.1 Color Tokens

### Brand Colors

| Token | Hex | RGB | Usage |
|---|---|---|---|
| `brand-anna` | `#D4915A` | 212, 145, 90 | Anna voice, primary warm accent |
| `brand-nova` | `#C9A84C` | 201, 168, 76 | Nova voice, bright accent |
| `brand-atlas` | `#8B7355` | 139, 115, 85 | Atlas voice, grounded accent |
| `brand-ember` | `#C8875A` | 200, 135, 90 | Universal brand, voice-neutral |

### Surface Colors (Dark)

| Token | Hex | Usage |
|---|---|---|
| `surface-0` | `#0C0C0E` | Background |
| `surface-1` | `#141416` | Cards |
| `surface-2` | `#1C1C20` | Elevated |
| `surface-3` | `#252528` | Hover |
| `surface-4` | `#2E2E32` | Borders |

### Surface Colors (Light)

| Token | Hex | Usage |
|---|---|---|
| `surface-0` | `#FAFAF8` | Background |
| `surface-1` | `#F2F1EE` | Cards |
| `surface-2` | `#E8E7E3` | Elevated |
| `surface-3` | `#DDDCD8` | Hover |
| `surface-4` | `#C8C7C3` | Borders |

### Text Colors

| Token | Dark | Light | Usage |
|---|---|---|---|
| `text-primary` | `#EDEDEF` | `#1A1A1C` | Headings, primary content |
| `text-secondary` | `#9E9EA4` | `#555558` | Body, descriptions |
| `text-tertiary` | `#5C5C64` | `#8E8E92` | Captions, muted |
| `text-inverse` | `#0C0C0E` | `#FAFAF8` | On colored backgrounds |

### Semantic Colors

| Token | Dark | Light | Usage |
|---|---|---|---|
| `semantic-success` | `#6EC88B` | `#2D8B50` | Complete, positive |
| `semantic-warning` | `#D4A84C` | `#A67B1C` | Caution |
| `semantic-error` | `#C46B5A` | `#9E3B2A` | Failure |
| `semantic-info` | `#6B9EC4` | `#3A6B9E` | Processing, info |

## 7.2 Typography Scale

Base: 16px. Scale ratio: 1.25 (Major Third).

| Token | Size | Weight | Line Height | Letter Spacing | Font | Usage |
|---|---|---|---|---|---|---|
| `display-xl` | 56px | Bold (700) | 1.1 | -1.5% | Satoshi | Hero headline |
| `display-lg` | 44px | Bold (700) | 1.15 | -1% | Satoshi | Section titles |
| `display-md` | 36px | SemiBold (600) | 1.2 | -0.5% | Satoshi | Sub-section titles |
| `display-sm` | 28px | SemiBold (600) | 1.25 | 0% | Satoshi | Feature headers |
| `heading-lg` | 22px | SemiBold (600) | 1.3 | 0% | Inter | Card titles |
| `heading-md` | 18px | Medium (500) | 1.35 | 0% | Inter | Subsection |
| `body-lg` | 18px | Regular (400) | 1.6 | 0% | Inter | Lead paragraphs |
| `body-md` | 16px | Regular (400) | 1.6 | 0% | Inter | Body text |
| `body-sm` | 14px | Regular (400) | 1.5 | 0.1% | Inter | Secondary text |
| `caption` | 12px | Medium (500) | 1.4 | 0.5% | Inter | Labels, captions |
| `code` | 14px | Regular (400) | 1.6 | 0% | JetBrains Mono | Code blocks |
| `code-sm` | 12px | Regular (400) | 1.5 | 0% | JetBrains Mono | Inline code |

## 7.3 Spacing Scale

Base unit: 4px. 8px grid system.

| Token | Value | Usage |
|---|---|---|
| `space-1` | 4px | Tight gaps (between icon and label) |
| `space-2` | 8px | Component internal padding |
| `space-3` | 12px | Small gaps between related elements |
| `space-4` | 16px | Standard gap between elements |
| `space-5` | 20px | Medium gap |
| `space-6` | 24px | Card internal padding, section sub-gaps |
| `space-8` | 32px | Gap between cards |
| `space-10` | 40px | Section internal spacing |
| `space-12` | 48px | Large section spacing |
| `space-16` | 64px | Section separators |
| `space-20` | 80px | Major section boundaries |
| `space-24` | 96px | Hero-to-content gap |
| `space-32` | 128px | Top-of-page to hero |

## 7.4 Border Radius Scale

| Token | Value | Usage |
|---|---|---|
| `radius-sm` | 4px | Badges, small chips |
| `radius-md` | 8px | Buttons, inputs, small cards |
| `radius-lg` | 12px | Cards, panels, modals |
| `radius-xl` | 16px | Large cards, feature sections |
| `radius-pill` | 9999px | Pills, toggle buttons, CTAs |
| `radius-circle` | 50% | Avatars, play buttons |

## 7.5 Shadow Scale

| Token | Value (Dark Mode) | Value (Light Mode) | Usage |
|---|---|---|---|
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.3)` | `0 1px 2px rgba(0,0,0,0.08)` | Subtle lift |
| `shadow-md` | `0 4px 8px rgba(0,0,0,0.4)` | `0 4px 8px rgba(0,0,0,0.12)` | Cards |
| `shadow-lg` | `0 8px 24px rgba(0,0,0,0.5)` | `0 8px 24px rgba(0,0,0,0.16)` | Modals, overlays |
| `shadow-glow-anna` | `0 0 20px rgba(212,145,90,0.25)` | `0 0 20px rgba(212,145,90,0.15)` | Anna accent glow |
| `shadow-glow-nova` | `0 0 20px rgba(201,168,76,0.25)` | `0 0 20px rgba(201,168,76,0.15)` | Nova accent glow |
| `shadow-glow-atlas` | `0 0 20px rgba(139,115,85,0.25)` | `0 0 20px rgba(139,115,85,0.15)` | Atlas accent glow |
| `shadow-glow-brand` | `0 0 24px rgba(200,135,90,0.30)` | `0 0 24px rgba(200,135,90,0.18)` | CTA hover glow |

## 7.6 Animation Curves and Durations

| Token | Value | Usage |
|---|---|---|
| `ease-default` | `cubic-bezier(0.25, 0.1, 0.25, 1.0)` | General transitions |
| `ease-in` | `cubic-bezier(0.42, 0, 1.0, 1.0)` | Exit animations |
| `ease-out` | `cubic-bezier(0, 0, 0.58, 1.0)` | Enter animations |
| `ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1.0)` | Bouncy elements (checkmark) |
| `duration-instant` | `100ms` | State toggles |
| `duration-fast` | `150ms` | Hover states |
| `duration-normal` | `250ms` | Standard transitions |
| `duration-slow` | `400ms` | Fade out, dismissals |
| `duration-emphasis` | `600ms` | Scroll-triggered entries |

### Motion Principles

1. **Enter fast, exit slow.** Elements appear at `duration-fast` or `duration-normal`. They exit at `duration-slow`. This creates a sense that the product is eager to serve and reluctant to leave.

2. **Scale enters, opacity exits.** Elements scale up from 96-98% on entry (creating a feeling of expansion). They fade out on exit without scaling (creating a feeling of gentle dissolution).

3. **Stagger, do not simultaneous.** When multiple elements enter, they stagger with 80-120ms delays. This creates a sense of sequence and intentionality. Simultaneous appearance feels like a page load. Staggered appearance feels like choreography.

4. **Audio and visual must be synchronous.** The start sound and the pill appearance happen on the same frame. The stop sound and the checkmark spring happen on the same frame. Desynchronization breaks the illusion of a unified product.

## 7.7 Icon Style Guide

**System:** SF Symbols (macOS native). All icons are SF Symbols with no custom icon assets, unless the specific glyph does not exist in SF Symbols.

**Weight:** Medium (500) default. SemiBold (600) for emphasis. Regular (400) for muted contexts.

**Size:** 16px default. 20px for primary actions. 24px for hero elements. 32px+ only in marketing materials.

**Color:** Icons follow the text color token of their context. Active/interactive icons use voice colors or brand color.

**Custom icons:** Only the three-bar logo mark is custom. Everything else uses SF Symbols.

## 7.8 Component Specifications

### Button --- Primary

- Height: 44px (touch) / 40px (mouse)
- Padding: 16px horizontal
- Background: `brand-ember` (#C8875A)
- Text: `text-inverse`, Inter Medium 15px
- Border-radius: `radius-pill`
- Hover: `shadow-glow-brand`, background lightens 8%
- Active: Background darkens 12%, scale 0.98 for 100ms
- Disabled: opacity 0.4, no hover effect, cursor not-allowed

### Button --- Secondary

- Height: 44px / 40px
- Padding: 16px horizontal
- Background: transparent
- Border: 1px solid `surface-4`
- Text: `text-primary`, Inter Medium 15px
- Border-radius: `radius-pill`
- Hover: Background `surface-2`, border lightens
- Active: Background `surface-3`

### Button --- Ghost

- Height: 40px
- Padding: 12px horizontal
- Background: transparent
- Text: `text-secondary`, Inter Regular 15px
- Border-radius: `radius-md`
- Hover: text `text-primary`, underline
- Active: text `text-primary`

### Card

- Background: `surface-1`
- Border: 1px solid `surface-4`
- Border-radius: `radius-lg`
- Padding: `space-6`
- Shadow: `shadow-md`
- Hover (interactive cards): translateY(-2px), shadow-lg, transition `duration-normal`

### Input

- Height: 44px
- Background: `surface-0`
- Border: 1px solid `surface-4`
- Border-radius: `radius-md`
- Padding: 12px horizontal
- Text: `text-primary`, Inter Regular 15px
- Placeholder: `text-tertiary`
- Focus: border `brand-ember`, shadow `0 0 0 3px brand-ember/15%`

### Badge

- Height: 24px
- Padding: 4px 8px
- Background: token-specific at 15% opacity
- Text: token color, Inter Medium 12px
- Border-radius: `radius-sm`
- Variants: anna (amber), nova (gold), atlas (bronze), success, warning, error, info, neutral

### Toggle

- Width: 44px, Height: 24px
- Off: `surface-3` track, `surface-1` thumb
- On: `brand-ember` track, white thumb
- Transition: `duration-normal`, `ease-default`
- Thumb: 20px circle, 2px inset from track edge

## 7.9 Illustration Style

**Approach:** Line art. Single-weight strokes (1.5px at native resolution). Brand color for primary elements, `text-tertiary` for secondary.

**No photography.** Vox is an invisible product. Showing it in use requires showing a person in front of a computer, which is the least interesting image in technology. Instead, abstract illustrations communicate concepts: a keyboard with one glowing key. A waveform transforming into text. Three vertical bars emanating concentric rings.

**No 3D renders.** No faux-materiality. The product is pure software. The illustrations should feel like the product: flat, clean, warm, intentional.

**No AI-generated art.** Every illustration is hand-crafted (or can be specified to a precision that a human illustrator executes exactly). SolisHQ builds AI infrastructure. Using generic AI art in marketing undermines the positioning.

## 7.10 Photography Style

**Not applicable.** See above. No photography in the brand. If photography is ever needed (press kit, blog posts), the rules are:

- Natural lighting only
- Warm color temperature (5000-5500K)
- Shallow depth of field
- Subject: hands, screens, workspaces --- never faces (Vox is about the user's voice, not their identity)
- Desaturated to match the warm-neutral palette

---

# APPENDIX A: COMPETITIVE DIFFERENTIATION SUMMARY

| Competitor | Strength | Vox Advantage |
|---|---|---|
| Apple Dictation | Built-in, free, Apple Intelligence | Vox has voice identities, MCP integration, and superior accuracy via Groq Whisper |
| SuperWhisper | Local Whisper, good accuracy | Vox has three named voices, cloud+local hybrid, MCP for agents |
| WisprFlow | Fast, everywhere you type | Vox has voice identities, MCP agent integration, privacy-first architecture |
| Aqua Voice | Polished prose output | Vox preserves original speech (fidelity, not transformation), three voices |
| Voibe | AI writing + offline | Vox is pure dictation (not writing tool), three voice identities, MCP |
| Spokenly | Free, offline, 100+ languages | Vox has premium voice identities, MCP, Groq cloud option |

**No competitor has:**
1. Named, designed voice identities with distinct personalities
2. MCP server mode for AI agent integration
3. A visual identity system that communicates voice through color

These three differentiators define Vox's competitive moat.

---

# APPENDIX B: IMPLEMENTATION PRIORITIES

For the engineering team:

| Priority | Element | Effort | Impact |
|---|---|---|---|
| **P0** | Voice-aware overlay colors (per active voice) | Small (VoxDesignSystem.swift changes) | Core differentiator visible to every user |
| **P0** | Three-bar logo mark (design + implementation) | Medium (icon design + asset generation) | Brand identity foundation |
| **P0** | Website hero + story flow | Large (full web build) | Conversion funnel |
| **P1** | Voice-specific sounds | Medium (audio design + VoxSoundEngine.swift) | Sonic identity |
| **P1** | Menu bar voice selector | Small (VoxMenuBar.swift dropdown) | Daily voice switching |
| **P1** | Voice selection onboarding | Medium (new UI panel) | First-run experience |
| **P2** | Session stats in menu bar | Small (VoxMetrics.swift + menu display) | Daily wow moment |
| **P2** | Website voice showcase with audio | Large (web audio + animation) | Conversion differentiator |
| **P3** | DMG custom background | Small (asset creation) | Polish |
| **P3** | Social preview + Product Hunt assets | Medium (design production) | Launch readiness |

---

# APPENDIX C: DESIGN SYSTEM FILE STRUCTURE

```
vox-design/
  tokens/
    colors.json          # All color tokens, dark + light
    typography.json      # Font specs, sizes, weights
    spacing.json         # Spacing scale
    shadows.json         # Shadow definitions
    animation.json       # Curves, durations
    radii.json           # Border radius scale
  components/
    button.md            # Button specs + states
    card.md              # Card specs + states
    input.md             # Input specs + states
    badge.md             # Badge variants
    toggle.md            # Toggle specs
    overlay-pill.md      # Floating pill overlay spec
  brand/
    logo/
      vox-logo-mark.svg  # Three-bar mark
      vox-logo-full.svg  # Mark + wordmark
      vox-logo-mono.svg  # Single-color version
    icons/
      app-icon-1024.png  # macOS app icon
      favicon-16.png     # Favicon
      favicon-32.png     # Favicon 2x
    marketing/
      social-preview-1200x630.png
      ph-thumbnail-240x240.png
      ph-gallery/        # 8 Product Hunt gallery images
  voices/
    anna/
      waveform.svg       # Anna's waveform visualization
      start.wav          # Start sound
      stop.wav           # Stop sound
      sample.wav         # 6-second voice sample
    nova/
      waveform.svg
      start.wav
      stop.wav
      sample.wav
    atlas/
      waveform.svg
      start.wav
      stop.wav
      sample.wav
```

---

*This document is the definitive design specification for Vox. Every pixel, every interaction, every color, every sound is intentional. Nothing is decorative. Everything serves the thesis: dictation that disappears.*

*Vox is not the best dictation app. Vox is the last dictation app.*

*SolisHQ --- We innovate, invent, then disrupt.*
