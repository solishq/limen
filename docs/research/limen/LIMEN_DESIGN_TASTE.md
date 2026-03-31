# Limen Design Taste Specification

**Date**: 2026-03-30
**Author**: SolisHQ Researcher (Design Taste Team)
**Status**: DEFINITIVE DESIGN SPECIFICATION
**Classification**: Consequential Weight
**Evidence Level Key**: [CONFIRMED] = multiple sources; [LIKELY] = strong evidence; [DERIVED] = first-principles reasoning

---

## Governing Principle

Every pixel, every word, every color, every moment of interaction a developer has with Limen was designed. Not defaulted. Not inherited. Not accidental. The engineering is built to aerospace precision. The design must match.

Design taste is not decoration. It is the difference between software people use and software people remember. Between something they install and something they tell their colleagues about. Limen's thesis -- that knowledge is belief, not data -- deserves a visual identity as rigorous as its intellectual identity.

---

## Part 1: Brand Identity

### 1.1 Name Analysis: "Limen"

**Etymology**: Latin *limen, liminis* -- "threshold, doorstep, sill; entrance, doorway, approach; beginning, commencement." In psychology and psychophysics, a limen is the sensory threshold at which a stimulus becomes perceivable. The term "subliminal" derives directly from it: *sub* (below) + *limen* (threshold).

[CONFIRMED -- Wiktionary, Dictionary.com, Wikipedia "Limen", etymonline.com, Merriam-Webster "liminal"]

**Evaluation Against Five Criteria**:

| Criterion | Assessment | Score |
|-----------|-----------|-------|
| **Communicates purpose** | The threshold where knowledge becomes belief -- precisely Limen's function | 9/10 |
| **Memorable** | Short (5 letters), two syllables (LY-men or LEE-men), uncommon enough to stick | 8/10 |
| **Searchable** | "limen" returns psychology results, not competitors. "limen ai" or "limen-ai" will dominate quickly | 7/10 |
| **Available** | `limen-ai` on npm (owned). `limen.dev` should be acquired immediately if not held | 8/10 |
| **Phonetically clean** | Works in English, Spanish, French, German. No unfortunate homophones in major languages | 9/10 |

**Verdict**: Limen is an excellent name. It is short, etymologically precise, intellectually rich, and phonetically clean. The name itself encodes the product's thesis: Limen is the threshold where raw information crosses into governed belief. Keep it.

**Pronunciation guide** (for docs and README): "LY-men" (rhymes with "hymen") or "LEE-men" (Latin pronunciation). Both are acceptable. Do not prescribe one.

**Tagline candidates** (ranked):

1. **"Beliefs, not data."** -- Three words. The entire thesis. Use everywhere.
2. **"The threshold where data becomes belief."** -- For contexts that need more explanation.
3. **"Governed knowledge for AI agents."** -- For contexts that need utility, not poetry.

### 1.2 Logo Concepts

The visual must represent the *threshold* -- the liminal space where knowledge transforms into belief. The moment of transition, not the state before or after.

**What the logo must NOT be**:
- A brain (every AI company, overused to meaninglessness)
- A lightbulb (cliche, implies "idea" not "knowledge")
- A database icon (contradicts the thesis -- Limen is not a database)
- A neural network diagram (generic AI, wrong identity)
- Abstract gradient blobs (2020s startup aesthetic, already dated)

**What the logo must communicate**:
- Threshold / boundary / crossing point
- Precision and governance (not chaos or creativity)
- Depth (something worth looking at twice)
- Engineering craft (not marketing polish)

---

#### Concept A: The Threshold Mark

**Description**: Two horizontal planes separated by a precise gap. The upper plane represents raw data -- undifferentiated, flat. The lower plane represents governed belief -- structured, anchored. The gap between them IS the limen -- the threshold of transformation.

**Visual form**: Two parallel horizontal lines of equal length, separated by exactly one line-width of space. The upper line is lighter (data, uncertain). The lower line is the primary color (belief, governed). At small sizes, the gap remains visible -- it never collapses.

**Rendering at various sizes**:
```
Large (64px):   ━━━━━━━━━━━━━━━━━━━━━━━━
                                          (gap = threshold)
                ━━━━━━━━━━━━━━━━━━━━━━━━

Medium (32px):  ━━━━━━━━━━━━━━

                ━━━━━━━━━━━━━━

Favicon (16px): ══
                ══
```

**Rationale**: The simplest possible form that communicates the concept. Two states separated by a boundary. The gap is the product. The mark says: "I am the space between knowing and believing." It works at every size because the gap is proportional, not fixed. It can be rendered in any single color. It works as a favicon, social preview, badge, and foil stamp.

**Weakness**: May be too abstract. Could be mistaken for an equals sign or a pause icon.

---

#### Concept B: The Aperture

**Description**: A circle (representing the boundary of knowledge) with a single precise opening -- a gap in the circle at the top. The opening is the limen: the point where information enters and is transformed by the governance within.

**Visual form**: A circle with approximately 30 degrees missing from the top, creating an aperture. The circle has uniform stroke weight. The gap is clean and precise.

**Rendering**:
```
Large:      ╭──   ──╮
            │       │
            │       │
            ╰───────╯

Favicon:    (C      -- open circle with gap at top
```

**Rationale**: The circle represents completeness, containment, governance. The gap represents openness -- Limen is open source, and knowledge flows in. The aperture controls what enters (governance). It is visually distinctive: no competitor in the AI memory space uses this form. It works as a monogram -- the gap makes it an implied "L" if rotated 90 degrees counterclockwise.

**Strength**: Distinctive, simple, works at all sizes. The gap is the product.

**Weakness**: Could be confused with copyright symbol or power button depending on gap placement.

---

#### Concept C: The Liminal Gate

**Description**: Two vertical pillars (like a doorway or gate) with a single horizontal line across the top -- an architectural threshold. You can see through it. The knowledge on the other side is visible but governed by the structure.

**Visual form**: The letter Pi (uppercase) rendered in geometric strokes. Two vertical lines connected by one horizontal line at the top. Clean, architectural, proportioned.

**Rendering**:
```
Large:      ┌─────────┐
            │         │
            │         │
            │         │

Favicon:    ╥
            ║ ║
```

**Rationale**: An architectural threshold is the original meaning of *limen*. This is the most literal interpretation: a gate, a doorway, a frame through which knowledge passes and is transformed. The form is architectural, which communicates engineering precision. It is also the Greek letter Pi (roughly), which connects to mathematical rigor. It pairs well with the monospace aesthetic of developer tools.

**Strength**: Most literal interpretation of "threshold." Architectural = engineering. Distinctive in the space. Works in monospace contexts (ASCII art, terminal, code comments).

**Weakness**: Could be mistaken for the Pi symbol, which has mathematical associations that may confuse.

---

**Recommendation**: **Concept B -- The Aperture.** It is the most distinctive, the most scalable, and the most meaningful. The circle represents the completeness of Limen's governance. The gap represents the threshold -- the point of transformation. It works at favicon size. It works as a social preview. It can be rendered in a single color or in the brand palette. It pairs with the SolisHQ Sun Seal without conflicting (circle family, different intent).

The design team should render all three and present to Femi for final selection.

### 1.3 Color Palette

Limen needs its own visual identity, distinct from SolisHQ's gold-and-void palette. The SolisHQ brand is dark, warm gold, and authoritative. Limen's brand should be:

- **Cognitive**: evoking thought, precision, depth
- **Trustworthy**: governance, security, reliability
- **Technical**: engineering craft, not marketing glow
- **Open**: community, accessibility, transparency (it is Apache 2.0)
- **Distinct**: immediately recognizable as "not SolisHQ but related"

**The color**: Deep indigo-blue. Not corporate blue (IBM, Facebook). Not electric blue (neon, gaming). A dark, saturated indigo that communicates depth, intelligence, and the twilight space between knowing and not-knowing. This is the color of the liminal moment before dawn -- the threshold between dark and light.

[DERIVED -- From research on dark mode palettes for developer documentation, cognitive load reduction, and the specific associations of indigo in color psychology: introspection, wisdom, governance]

#### Dark Mode (Primary)

| Token | Name | Hex | RGB | Usage |
|-------|------|-----|-----|-------|
| `limen-void` | Void | `#0B0E17` | 11, 14, 23 | Deepest background, page canvas |
| `limen-surface` | Surface | `#111827` | 17, 24, 39 | Cards, panels, code blocks |
| `limen-raised` | Raised | `#1E293B` | 30, 41, 59 | Hover states, elevated cards |
| `limen-elevated` | Elevated | `#293548` | 41, 53, 72 | Dialogs, popovers, tooltips |
| `limen-primary` | Indigo | `#6366F1` | 99, 102, 241 | Primary accent, links, active states |
| `limen-primary-light` | Light Indigo | `#818CF8` | 129, 140, 248 | Hover on primary, secondary emphasis |
| `limen-primary-subtle` | Subtle Indigo | `rgba(99,102,241,0.08)` | -- | Background tints, selection |
| `limen-secondary` | Teal | `#14B8A6` | 20, 184, 166 | Success, healthy, created |
| `limen-warning` | Amber | `#F59E0B` | 245, 158, 11 | Warnings, stale, degraded |
| `limen-danger` | Rose | `#F43F5E` | 244, 63, 94 | Errors, unhealthy, failures |
| `limen-text` | Text Primary | `#F1F5F9` | 241, 245, 249 | Headings, primary content |
| `limen-text-secondary` | Text Secondary | `#94A3B8` | 148, 163, 184 | Body text, descriptions |
| `limen-text-tertiary` | Text Tertiary | `#64748B` | 100, 116, 139 | Labels, metadata, timestamps |
| `limen-border` | Border | `rgba(241,245,249,0.06)` | -- | Dividers, card borders |

#### Light Mode

| Token | Name | Hex | Usage |
|-------|------|-----|-------|
| `limen-void` | Paper | `#FAFBFE` | Page background |
| `limen-surface` | Surface | `#FFFFFF` | Cards, panels |
| `limen-raised` | Raised | `#F1F5F9` | Hover states |
| `limen-elevated` | Elevated | `#E2E8F0` | Dialogs |
| `limen-primary` | Indigo | `#4F46E5` | Primary accent (darkened for contrast) |
| `limen-primary-light` | Light Indigo | `#6366F1` | Secondary emphasis |
| `limen-secondary` | Teal | `#0D9488` | Success states |
| `limen-warning` | Amber | `#D97706` | Warnings |
| `limen-danger` | Rose | `#E11D48` | Errors |
| `limen-text` | Text Primary | `#0F172A` | Headings |
| `limen-text-secondary` | Text Secondary | `#475569` | Body text |
| `limen-text-tertiary` | Text Tertiary | `#94A3B8` | Metadata |
| `limen-border` | Border | `rgba(15,23,42,0.08)` | Dividers |

#### Terminal Color Palette

These map to the Interface Design spec's symbol vocabulary:

| Semantic | Dark Terminal | Light Terminal | Mapping |
|----------|-------------|---------------|---------|
| Identifiers (subjects, predicates) | Cyan `#5DE5D5` | Teal `#0D9488` | Claim URNs, predicates |
| Success | Green `#50FA7B` | Green `#16A34A` | Created, healthy |
| Warning | Yellow `#F1FA8C` | Amber `#D97706` | Stale, degraded |
| Error | Red `#FF5555` | Rose `#E11D48` | Failures |
| Metadata | Dim `#6272A4` | Gray `#94A3B8` | Timestamps, durations |
| Relationships | Magenta `#FF79C6` | Purple `#7C3AED` | Supports, contradicts |
| Primary content | White (default) | Black (default) | Values |
| Emphasis | Bold (weight) | Bold (weight) | Headers |

**Why not SolisHQ gold?** Limen is a product, not the company. It needs its own color language so developers identify it independently. The SolisHQ gold appears only in the footer attribution "Built by SolisHQ" and in the SolisHQ logo mark. Limen's indigo is its own identity.

**Why indigo?** Three reasons:
1. Indigo sits between blue (trust, technology) and violet (wisdom, depth). It is the color of the threshold between the known and the unknown.
2. It is not used by any competitor in the AI memory space. Mem0 uses green/teal. Zep uses purple. Letta uses blue. Cognee uses orange/warm. Indigo is unclaimed territory.
3. It pairs with teal (success) and amber (warning) without clashing, creating a full semantic palette from one hue family.

### 1.4 Typography

The typography must communicate: "This was built by engineers who care about craft." Not a marketing site. Not a startup landing page. An engineering artifact.

#### Code Font: JetBrains Mono

**For**: Terminal output, code examples, CLI, monospace contexts
**Weight**: 400 (Regular), 700 (Bold) for emphasis
**Why**: Purpose-built for developers. 139 programming ligatures. Increased x-height for terminal readability. Open source (OFL-1.1). Already specified in SolisHQ brand system. The standard in 2026 developer tooling.
**Alternative**: Geist Mono (Vercel's font) -- more minimal, slightly geometric. Use if JetBrains Mono feels too heavy for a given context.

[CONFIRMED -- JetBrains Mono widely used in developer tooling, Geist Mono gaining adoption via Vercel ecosystem]

#### Heading Font: Space Grotesk

**For**: README headings, documentation titles, marketing (if any)
**Weights**: 600 (SemiBold) for headings, 700 (Bold) for display
**Why**: Already specified in SolisHQ brand system. Geometric, clean, technical without being cold. The tight tracking (-0.025em) gives headings density and authority. Pairs cleanly with both JetBrains Mono and Inter.

#### Body Font: Inter

**For**: Documentation body text, README body, long-form content
**Weight**: 400 (Regular), 500 (Medium) for emphasis
**Why**: Already specified in SolisHQ brand system. Optimized for screen readability. Geometric rationality pairs with Space Grotesk headings. The world's most-used UI typeface -- developers already have it cached.

#### Type Scale (Documentation Site)

```css
--limen-display:   clamp(2.5rem, 1.5rem + 5vw, 4rem);    /* Hero, landing */
--limen-h1:        clamp(1.875rem, 1.5rem + 2vw, 2.5rem); /* Page title */
--limen-h2:        clamp(1.5rem, 1.25rem + 1vw, 1.875rem); /* Section */
--limen-h3:        1.25rem;                                 /* Subsection */
--limen-body:      1rem (16px);                             /* Body text */
--limen-small:     0.875rem (14px);                         /* Captions, meta */
--limen-code:      0.9375rem (15px);                        /* Code blocks */
```

### 1.5 Voice and Tone

Limen speaks like the engineer who built it: precise, confident, occasionally dry, never breathless. It explains complex ideas by building them from simple parts, never by drowning them in jargon.

#### Limen's Voice Attributes

| Attribute | What It Means | Example |
|-----------|--------------|---------|
| **Precise** | Every word earns its place. No filler. | "Every claim has a confidence score" not "We leverage advanced scoring mechanisms" |
| **Grounded** | Claims are backed by evidence or examples | "Limen stores 1,247 claims in 4.2 MB" not "Limen scales effortlessly" |
| **Candid** | Honest about limitations | "Limen does not do semantic search yet" not silence about missing features |
| **Warm-technical** | Technical accuracy with human cadence | "When you retract a belief, everything derived from it gets flagged" |
| **Confident, not arrogant** | States capabilities, does not disparage competitors | "No competitor offers audit trails" not "competitors are primitive" |

#### Words Limen Uses

- **Believes** (not "stores") -- when describing what agents know
- **Confidence** (not "score" alone) -- always paired with what it measures
- **Governed** (not "managed") -- implies authority and structure
- **Asserts** / **Retracts** (not "adds" / "deletes") -- epistemic operations
- **Evidence** (not "source" alone) -- formal provenance
- **Threshold** (not "boundary" alone) -- when referencing the product's essence
- **Engine** (not "platform" / "framework" / "library") -- the identity word

#### Words Limen Avoids

- "Leverage" -- corporate filler
- "Ecosystem" -- vague, used by every tool
- "Revolutionary" / "Groundbreaking" -- let the engineering speak
- "AI-powered" -- Limen is not powered by AI; AI is powered by Limen
- "Magic" / "Automagically" -- governance is the opposite of magic; it is explicit
- "Simple" (as a marketing claim) -- show simplicity in the code example; don't claim it
- "Just" (minimizing) -- "just add..." diminishes the engineering

#### How Limen Explains Complex Concepts

**Pattern**: Concrete first, abstract second. Show the code, then explain the concept.

**Wrong order**: "Limen implements AGM belief revision theory, which formalizes three operations on belief sets. Here is how you use it..."

**Right order**: "When you retract a belief, everything derived from it gets flagged automatically. This is AGM belief revision -- the same formal framework philosophers have used since 1985, now running on your laptop in SQLite."

The code example always comes before the theory. The developer decides if they want the theory. Most will not. The ones who do will be rewarded with genuine intellectual depth, not hand-waving.

---

## Part 2: README Design

The README is the single most important design artifact Limen has. It is the first thing every developer sees. It has approximately 8 seconds to convince someone to keep reading.

### 2.1 Design Principles for the README

1. **The first 5 lines determine everything.** If a developer scrolls past line 5, they will never come back.
2. **Code before words.** A working code example communicates more than any paragraph.
3. **The comparison creates the "aha."** When a developer sees what Limen has that nobody else does, they screenshot that table.
4. **White space is a design element.** Dense READMEs are unreadable. Every section needs breathing room.
5. **150 lines maximum.** The README is an invitation, not a manual.

### 2.2 Badge Design

Badges appear after the logo, centered. Order matters -- left to right communicates priority:

```
[npm version] [CI status] [License: Apache 2.0] [Dependencies: 1] [Tests: 3,200+]
```

**Why this order**: Version proves it ships. CI proves it works. License proves it is open. Dependencies proves it is light. Tests proves it is rigorous. Each badge answers a progressively deeper question.

**Custom badges to create**:
- `Dependencies: 1` -- custom shield badge, green. This is Limen's most shocking stat.
- `Tests: 3,200+` -- custom shield badge, green. This signals engineering seriousness.
- `Beliefs, not data` -- custom conceptual badge in indigo. Optional but distinctive.

### 2.3 The Complete README

The Interface Design spec (Part 7) already contains a fully designed README. The design decisions documented there are correct. The key structural innovations:

1. **Hero**: Logo + "Knowledge engine for AI agents." + "Store, recall, connect, and govern knowledge. One dependency. SQLite-powered."
2. **Quickstart**: "3 Lines to Remember" -- `remember` / `recall` in the first code block
3. **Governance reveal**: "What Runs Underneath" -- the invisible governance layer explained
4. **Comparison table**: Mem0 vs Zep vs Limen -- governance, audit, dependencies
5. **MCP config**: Copy-paste JSON for Claude Code integration
6. **Architecture**: ASCII diagram (not an image -- images break)
7. **Footer**: Latin etymology, one line

**One critical addition**: A **social preview image** (Open Graph). When someone pastes a Limen GitHub link in Slack, Discord, or Twitter, the preview image appears. This image must be:

- 1280x640px (GitHub standard)
- Dark background (limen-void `#0B0E17`)
- The Limen logo centered
- "Governed Knowledge Engine for AI Agents" in Space Grotesk
- "Beliefs, not data." in smaller text below
- The indigo-to-teal gradient as a subtle accent line

This image is the single most-shared visual artifact of the project. It must be beautiful.

### 2.4 Code Example Design

Code examples are a design surface. They communicate taste.

**Rules for code examples**:
1. **Syntax highlighting is mandatory.** Use TypeScript for all examples (the primary language).
2. **Comments explain intent, not mechanics.** `// Store knowledge` not `// call the remember function`
3. **Variable names tell a story.** `user:alice`, `project:atlas`, `decision.database` -- not `user1`, `item`, `data`
4. **Output comments show real results.** `// => [{ subject: 'user:alice', ... }]` not `// returns an array`
5. **Whitespace groups logical operations.** Blank line between store/recall/connect sections.
6. **No imports in quickstart.** Show `import` once in the first example, then omit in subsequent snippets.

---

## Part 3: Documentation Site

### 3.1 Site Architecture

```
limen.dev/
  /                          Landing page (hero, quickstart, features, comparison)
  /docs                      Documentation home
  /docs/quickstart           Install -> remember -> recall in 2 minutes
  /docs/concepts/            What are claims? Subjects? Predicates? Confidence?
  /docs/concepts/beliefs     The belief model explained
  /docs/concepts/governance  Audit, RBAC, encryption
  /docs/concepts/relationships  Supports, contradicts, supersedes, derived_from
  /docs/guides/              How-to guides
  /docs/guides/chatbot-memory    Add memory to any chatbot
  /docs/guides/agent-learning    Agents that learn from experience
  /docs/guides/decision-tracking Record and audit agent decisions
  /docs/guides/migration-mem0    Moving from Mem0
  /docs/api/                 API reference
  /docs/api/remember-recall  Convenience API
  /docs/api/claims           Full claim protocol
  /docs/api/search           FTS5 and vector search
  /docs/api/mcp              MCP server tools
  /docs/cli                  CLI reference
  /docs/errors               Error code reference (LMN-xxxx)
  /docs/troubleshooting      Common problems and fixes
  /blog                      Release notes, technical deep dives
  /blog/thesis               "Your AI Doesn't Know What It Knows" (the thesis as a blog post)
```

### 3.2 Visual Design

**Framework**: Use a static site generator (Astro, Next.js, or Docusaurus with custom theme). The site must be:
- Fast (< 1s FCP)
- Dark mode by default, light mode available
- Mobile responsive
- Searchable (cmd+k)

**Layout**:
- Left sidebar: Navigation (collapsible sections)
- Center: Content (max 720px prose width)
- Right sidebar: Table of contents (sticky, highlights current section)
- This is the Stripe/Tailwind/Vercel standard layout because it works

**Code blocks**:
- Dark background regardless of site mode (`limen-surface` on light mode, `limen-void` on dark)
- Copy button (top right, appears on hover)
- Language label (top left: `typescript`, `bash`, `json`)
- Line numbers for blocks > 5 lines
- Syntax highlighting: Shiki with a custom Limen theme based on the color palette
- File name tab when showing file-scoped code

**What makes it exceed Stripe/Tailwind**:
1. **Interactive claim explorer**: On the concepts page, an interactive widget where you can type a subject/predicate and see how claims are stored, related, and recalled. Not a playground -- a visualization.
2. **"What just happened" blocks**: After every code example, a collapsible block showing what the governance layer did. "That `remember()` call triggered: RBAC check, audit entry, encryption, tenant isolation."
3. **Confidence slider**: On the search/recall pages, a slider that lets you adjust `minConfidence` and see how results change in real time.

### 3.3 Search Experience

- `Cmd+K` opens search overlay (Algolia DocSearch or Pagefind for static)
- Searches across docs, API reference, error codes, and blog
- Error codes are first-class search targets: typing "LMN-2004" shows the error page immediately
- Recent searches remembered in localStorage

### 3.4 Reference: What Makes the Gold Standards Great

**Stripe Docs**: Content density. Every page answers one question. Code examples are copy-paste-run. The sidebar never has more than two nesting levels. Language selector persists across pages.

**Tailwind Docs**: Searchability. The search is so good that developers use it as their primary navigation. Every utility class has a complete, self-contained page. Dark mode is default because developers prefer it.

**Vercel Docs**: Speed. Pages load in under 300ms. The layout is generous with whitespace. Code blocks use their own font (Geist Mono). Tabs for different frameworks (Next.js, SvelteKit, etc.).

**Where Limen can exceed all three**: None of them explain *why* their system works the way it does. They document *what* and *how*. Limen documents *why* -- because the *why* (the epistemological thesis) is the differentiation. Every concept page should end with a "Why it works this way" section linking to the intellectual genealogy.

---

## Part 4: npm Package Page

The npm page is a developer's second touchpoint after the README (or first, if they found Limen through npm search).

### 4.1 Package Description

```
Governed knowledge engine for AI agents. Store beliefs with confidence, evidence chains, and lifecycle governance. SQLite-powered, zero-config, single dependency.
```

140 characters. Hits every search term a developer might use. "Governed" differentiates. "Knowledge engine" identifies. "AI agents" scopes. "SQLite-powered" and "single dependency" are the shock stats.

### 4.2 Keywords

```json
[
  "knowledge", "memory", "agent-memory", "ai-memory",
  "knowledge-graph", "knowledge-engine", "beliefs",
  "governance", "audit", "audit-trail",
  "remember", "recall", "claims",
  "evidence", "provenance", "confidence",
  "local-first", "sqlite", "embedded",
  "mcp", "model-context-protocol",
  "ai", "llm", "agent"
]
```

### 4.3 npm README Rendering

npm strips some GitHub markdown features. Design for constraints:
- No centered text (npm renders left-aligned)
- No raw HTML (npm strips it)
- Badges still work (shield.io URLs)
- Code blocks render well
- Tables render, but with less styling

The README should degrade gracefully: GitHub version has centered logo and badges; npm version shows them left-aligned, still readable.

---

## Part 5: GitHub Repository Design

### 5.1 Repository Description (About)

```
Governed knowledge engine for AI agents. Beliefs, not data. One dependency.
```

Under 100 characters. GitHub truncates at ~350 chars in search results, but the shorter it is, the more impact per word.

### 5.2 Topics/Tags

```
ai, agent-memory, knowledge-engine, knowledge-graph, governance,
sqlite, typescript, mcp, beliefs, audit-trail, local-first
```

Order matters -- GitHub shows the first ~5 prominently.

### 5.3 Social Preview Image

Already specified in Part 2. Generate and upload as the repository's social preview under Settings > General > Social Preview.

### 5.4 Issue Templates

Create `.github/ISSUE_TEMPLATE/`:

**bug_report.yml**:
```yaml
name: Bug Report
description: Something is not working as expected
labels: [bug]
body:
  - type: input
    id: version
    attributes:
      label: Limen version
      placeholder: "1.3.0"
    validations:
      required: true
  - type: textarea
    id: description
    attributes:
      label: What happened?
      description: A clear description of the bug.
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: What did you expect?
  - type: textarea
    id: reproduce
    attributes:
      label: Steps to reproduce
      description: Minimal code example or steps.
    validations:
      required: true
  - type: input
    id: node-version
    attributes:
      label: Node.js version
      placeholder: "22.0.0"
  - type: input
    id: os
    attributes:
      label: Operating system
      placeholder: "macOS 15, Ubuntu 24.04, Windows 11"
```

**feature_request.yml**:
```yaml
name: Feature Request
description: Suggest a new capability
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem does this solve?
      description: Describe the use case, not the solution.
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: Proposed solution
      description: How would this work from a developer's perspective?
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
```

### 5.5 PR Template

`.github/pull_request_template.md`:

```markdown
## What

<!-- One sentence: what does this change? -->

## Why

<!-- What problem does this solve? Link to issue if applicable. -->

## How

<!-- Brief description of the approach. -->

## Checklist

- [ ] Tests added for new functionality
- [ ] Existing tests pass (`npm test`)
- [ ] Types are correct (`npm run typecheck`)
- [ ] CHANGELOG updated (if user-facing)
```

### 5.6 Discussion Categories

Enable GitHub Discussions with:
- **General**: Questions, conversation
- **Ideas**: Feature brainstorming
- **Show and Tell**: Projects built with Limen
- **Q&A**: Technical questions (mark answers)

### 5.7 Contributing Guide

`CONTRIBUTING.md` -- keep it short:

1. Fork and clone
2. `npm install` + `npm test` to verify setup
3. Create a branch from `main`
4. Write tests first, then implement
5. Ensure `npm test` passes
6. Submit PR with the template filled out

No CLA. Apache 2.0 covers it. Lower the barrier to contribution.

### 5.8 Code of Conduct

Use the Contributor Covenant 2.1. Standard, recognized, uncontroversial.

---

## Part 6: CLI Visual Design

The Interface Design spec defined the command grammar, color semantics, and symbol vocabulary. This section elevates the CLI from functional to beautiful.

### 6.1 The CLI Personality

The CLI is **calm and confident**. It does not shout. It does not celebrate with excessive output. It reports what happened, precisely, and gets out of the way.

**Feel**: Like a well-tuned instrument panel. Every indicator is visible. Nothing blinks unnecessarily. The absence of noise IS the design.

**Speed**: Every command that touches only local SQLite should complete in under 100ms. Users should never see a spinner for local operations. Speed itself is a design element -- it communicates engineering quality.

### 6.2 Terminal Color Implementation

The Interface Design spec specified hex values. Map to terminal implementation:

```typescript
// Color palette for chalk
const colors = {
  // Semantic
  success:    chalk.hex('#50FA7B'),    // Green
  warning:    chalk.hex('#F1FA8C'),    // Yellow
  error:      chalk.hex('#FF5555'),    // Red
  info:       chalk.hex('#5DE5D5'),    // Cyan

  // Structural
  identifier: chalk.hex('#5DE5D5'),    // Cyan -- subjects, predicates
  value:      chalk.white,              // White -- claim values
  meta:       chalk.hex('#6272A4'),    // Dim gray -- timestamps, durations
  relation:   chalk.hex('#FF79C6'),    // Magenta -- relationship types

  // Emphasis
  header:     chalk.bold,               // Bold -- section headers
  count:      chalk.hex('#BD93F9'),    // Light purple -- numbers, counts
};
```

### 6.3 Box Drawing and Structure

Use Unicode box-drawing characters (U+2500 block) for structure. No ASCII art approximations.

```
Thin horizontal:  ─  (U+2500)
Thick horizontal: ━  (U+2501)
Thin vertical:    │  (U+2502)
Corner TL:        ┌  (U+250C)
Corner TR:        ┐  (U+2510)
Corner BL:        └  (U+2514)
Corner BR:        ┘  (U+2518)
Tee right:        ├  (U+251C)
Tee down:         ┬  (U+252C)
```

Use sparingly. The dotted fill pattern (`..`) from the Interface Design spec (e.g., `decision.database .......... "Chose PostgreSQL"`) is more readable than box characters for long lists.

### 6.4 Loading and Progress

- Operations < 200ms: No loading indicator. Silence is confidence.
- Operations 200ms-2s: A single dot animation (`.`, `..`, `...`). Calm.
- Operations > 2s: `ora` spinner with descriptive text. `Searching 12,450 claims...`
- Operations with progress: Counted progress. `Claims  1,247 / 1,247  done`

No percentage bars. No ASCII progress bars. Counted progress (X of Y) is more honest and more useful.

### 6.5 Output Spacing

Every command output follows this spacing pattern:

```
                                          <-- blank line before output
  [symbol] [Title]                        <-- header with 2-space indent
                                          <-- blank line
    [key]       [value]                   <-- content with 4-space indent
    [key]       [value]                   <-- aligned values
                                          <-- blank line
    [tip or next action]                  <-- contextual guidance
                                          <-- blank line after output
```

The 2-space indent for headers and 4-space indent for content creates a visual hierarchy without box characters. This is the Vercel CLI pattern -- minimal chrome, maximum clarity.

---

## Part 7: Error Message Aesthetics

The Interface Design spec defined the error anatomy (`x LMN-NNNN: Title` + detail + fix + docs). This section focuses on making errors beautiful.

### 7.1 Error Visual Hierarchy

```
  x LMN-2004: Invalid subject format          <-- Red x, Bold code, White title

    Subject "user preferences" does not        <-- Dim text (detail)
    match URN format.
    Expected: entity:<type>:<id>               <-- Dim text with cyan highlights

    Examples:                                  <-- Dim header
      entity:user:alice                        <-- Cyan (valid examples)
      entity:project:atlas
      entity:config:production

    Fix: limen remember --subject              <-- Green (actionable fix)
         "entity:user:preferences"
         "prefers dark mode"
    Docs: https://limen.dev/errors/LMN-2004    <-- Dim (reference)
```

**Color logic**:
- **Red**: The problem indicator (`x` symbol)
- **Bold white**: The error code and title (what went wrong)
- **Dim gray**: The explanation (context)
- **Cyan**: Technical values, URNs, predicates (identifiers)
- **Green**: The fix (what to do)
- **Dim gray**: Documentation link (reference)

This creates a **problem -> context -> solution** visual flow. The developer's eye goes red -> white -> green: "Something broke, here is what, here is the fix."

### 7.2 Errors in Different Contexts

**TTY (interactive terminal)**:
Full color, full formatting as shown above.

**Piped to file (no TTY)**:
Strip ANSI codes. Output plain text with the same structure:

```
ERROR LMN-2004: Invalid subject format

  Subject "user preferences" does not match URN format.
  Expected: entity:<type>:<id>

  Fix: limen remember --subject "entity:user:preferences" "prefers dark mode"
  Docs: https://limen.dev/errors/LMN-2004
```

**JSON mode (--json)**:
```json
{
  "error": "LMN-2004",
  "title": "Invalid subject format",
  "detail": "Subject \"user preferences\" does not match URN format. Expected: entity:<type>:<id>",
  "fix": "limen remember --subject \"entity:user:preferences\" \"prefers dark mode\"",
  "docs": "https://limen.dev/errors/LMN-2004"
}
```

**MCP context (LLM reading)**:
```
Error LMN-2004: Invalid subject format. Subject "user preferences" does not match URN format entity:<type>:<id>. Suggestion: Use limen_remember with subject "entity:user:preferences".

{"error": "LMN-2004", "code": "INVALID_SUBJECT_FORMAT", ...}
```

### 7.3 Error Design Non-Negotiables

1. **Every error has a code.** Developers will google `LMN-2004`. Make it findable.
2. **Every error has a fix.** If the fix is a command, it is copy-pasteable.
3. **Errors never expose internals.** No SQL, no stack traces, no file paths from the engine.
4. **Warning errors use amber, not red.** Stale data is a warning (amber `!`). Data integrity failure is an error (red `x`). The color communicates severity before the text is read.
5. **Errors are concise.** Three sections maximum: title, detail, fix. If it takes more than 10 lines, the error is too complex and should link to documentation.

---

## Part 8: The Wow Moments

Three specific moments where a developer thinks "this is from the future" and screenshots it.

### Wow Moment 1: `limen status`

**What they see**:

```
  Limen v1.3.0

    Status      healthy

    Knowledge
      Claims       1,247 active    12 retracted
      Freshness    98% current     2% stale (>30d)
      Connections  483 relationships

    Storage
      Database     ~/.limen/data/limen.db
      Size         4.2 MB
      Migrations   27/27 applied

    Subsystems
      Kernel        healthy
      Claims        healthy
      Working Mem   healthy
      Orchestration healthy
      Governance    healthy
```

**What they feel**: "This thing knows itself." It is not just a database that stores data. It has a concept of its own health. It knows how fresh its knowledge is. It tracks its own relationships. It reports on its own subsystems like a spacecraft reporting telemetry.

**What they do next**: They screenshot the terminal and post it to their team's Slack. The freshness percentage and relationship count are the lines that catch people's eyes. "Wait, it tracks how stale its own knowledge is?"

**Design details that make this work**:
- The word "healthy" appears in green, creating a visual column of green on the right
- "1,247 active" and "12 retracted" are on the same line -- one green, one dim
- "98% current" is green; "2% stale" is yellow with `!`
- The subsystem list is vertically aligned, creating a status board feel
- Total output is 17 lines -- fits in a single terminal view

### Wow Moment 2: `limen graph`

**What they see**:

```
  Knowledge Graph                          28 nodes    34 edges

  entity:project:atlas
  +-- decision.database .................. "Chose PostgreSQL" (0.95)
  |   +-- supports
  |   |   +-- finding.performance ........ "P99 < 50ms" (0.80)
  |   +-- contradicted_by
  |       +-- warning.scaling ............ "Pool exhaustion" (0.70)
  +-- decision.cache .................... "Chose Redis" (0.90)
  |   +-- supports
  |       +-- decision.database
  +-- decision.auth ..................... "JWT + refresh" (0.85)

  entity:user:alice
  +-- preference.theme .................. "dark mode" (0.80)
  +-- preference.food ................... "hates cilantro" (0.90)

  Clusters: 3    Orphans: 0    Max depth: 3
```

**What they feel**: "My agent has a knowledge graph and I can see it." Most developers have never seen their agent's knowledge visualized. They store facts in key-value stores and hope for the best. This is the first time they see the *structure* of what their agent knows -- the supports, the contradictions, the clusters.

**What they do next**: They add more knowledge just to see the graph grow. They intentionally create contradictions to see the `contradicted_by` relationship appear. They run `limen graph --subject "entity:project:atlas" --depth 3` to explore. They are now playing with epistemic infrastructure. They are hooked.

**Design details that make this work**:
- The dotted-fill alignment (`..`) creates visual columns without rigid tables
- Confidence scores (`0.95`, `0.80`) are inline, not hidden
- Relationship types (`supports`, `contradicted_by`) are in magenta, visually distinct
- The footer (`Clusters: 3, Orphans: 0, Max depth: 3`) is graph analytics in the terminal
- The tree structure uses standard box-drawing characters that render everywhere

### Wow Moment 3: The Error That Helps

**What they see**:

```
  x LMN-4001: Governance protection active

    Cannot supersede claim clm_8f2a.
    Subject "entity:hardban:001" matches protected prefix "entity:hardban:*".

    Protected claims cannot be superseded through normal operations.
    This is a governance safeguard, not a bug.

    Fix: If this claim genuinely needs updating, use an admin-level session:
         limen session open --trust admin
         Or contact your governance administrator.
    Docs: https://limen.dev/errors/LMN-4001
```

**What they feel**: "Wait -- it blocked me because of governance? And it told me why? And it told me how to fix it?" Every developer has experienced the nightmare error: a cryptic message, no context, no fix. This is the opposite. The error explains:
1. What went wrong (governance blocked the operation)
2. Why it was blocked (protected prefix match)
3. That this is by design (not a bug)
4. How to fix it (admin session or governance admin)
5. Where to learn more (docs link)

**What they do next**: They realize that the governance layer is not just marketing -- it actually works. It protects knowledge from accidental mutation. They screenshot the error because they have never seen an error message this helpful. They think: "If the errors are this good, what else is this good?"

**Design details that make this work**:
- "This is a governance safeguard, not a bug." -- This single sentence changes the developer's emotional response from frustration to understanding
- The fix includes a concrete command, not a vague suggestion
- The docs link means they can go deeper if they want
- The red `x` and bold error code are scannable even in a wall of terminal output

---

## Part 9: Design System Summary

### The Design Token Sheet

```
IDENTITY
  Name:          Limen
  Pronunciation: LY-men or LEE-men
  Tagline:       Beliefs, not data.
  Identity:      Governed knowledge engine for AI agents.
  Etymology:     Latin for "threshold" -- sensory boundary in psychology

COLORS (Dark Mode Primary)
  Void:          #0B0E17
  Surface:       #111827
  Primary:       #6366F1 (Indigo)
  Secondary:     #14B8A6 (Teal)
  Warning:       #F59E0B (Amber)
  Danger:        #F43F5E (Rose)
  Text:          #F1F5F9
  Text-2:        #94A3B8
  Text-3:        #64748B

TYPOGRAPHY
  Headings:      Space Grotesk 600/700
  Body:          Inter 400/500
  Code:          JetBrains Mono 400/700
  Alt Code:      Geist Mono 400

TERMINAL SYMBOLS
  Created:       +  (green)
  Removed:       -  (red)
  Modified:      *  (yellow)
  Query:         ?  (cyan)
  Warning:       !  (yellow)
  Error:         x  (red)
  Active:        >  (green)
  Relationship:  |  (magenta)
  Count:         #  (purple)
  No emoji. Ever.

CLI PERSONALITY
  Calm. Confident. Fast. Silent when possible.
  Never celebrate. Never apologize. Report and exit.

ERROR PERSONALITY
  Helpful. Specific. Actionable.
  Always: code, context, fix, docs link.
  Never: "An error occurred." Never: stack traces.

VOICE
  Precise. Grounded. Warm-technical. Candid.
  "Believes" not "stores." "Governed" not "managed."
  "Engine" not "platform." Code before theory.
```

---

## Part 10: Implementation Priority

### Week 1 (Immediate -- Zero Dependencies)

1. **Social preview image**: Design and upload to GitHub. Highest visual impact per effort.
2. **Repository description**: Update to "Governed knowledge engine for AI agents. Beliefs, not data. One dependency."
3. **Topics/tags**: Add the specified topic list.
4. **Issue templates**: Create `.github/ISSUE_TEMPLATE/` with bug and feature templates.
5. **PR template**: Create `.github/pull_request_template.md`.
6. **CONTRIBUTING.md**: Short, clear, low-barrier.

### Week 2-3 (With v1.3.0)

7. **README rewrite**: Ship the designed README from the Interface Design spec.
8. **npm package.json**: Update description and keywords.
9. **CLI color palette**: Implement the terminal color system with chalk.
10. **Error formatting**: Add LMN-xxxx codes and formatted error output.
11. **Custom badges**: Create Dependencies:1 and Tests:3200+ shield badges.

### Month 2 (With v1.4.0)

12. **Documentation site scaffolding**: Choose framework, implement dark theme, deploy to limen.dev.
13. **Logo**: Commission rendering of three concepts, select with Femi.
14. **Brand guide PDF**: Compile this spec into a distributable brand guide.

### Month 3-6 (With v2.0.0)

15. **Full documentation site**: All pages, search, interactive elements.
16. **Blog**: Launch with thesis post and release announcement.
17. **Discussion categories**: Enable GitHub Discussions.

---

## Appendix A: Competitive Brand Audit

| Product | Visual Identity | Impression |
|---------|----------------|------------|
| **Mem0** | Green/teal palette, rounded friendly logo, "The Memory Layer for AI" | Approachable, consumer-friendly, not serious |
| **Zep** | Purple gradient, abstract mark, "The Memory Foundation for AI" | Enterprise, polished, cold |
| **Letta** | Blue, minimal, "Build Stateful AI Agents" | Technical, clean, generic |
| **Cognee** | Orange/warm, brain-adjacent icon, "AI Memory Infrastructure" | Academic, approachable, cluttered |
| **Engram** | Minimal, monochrome, varies by fork | No consistent brand, fragmented |

**Limen's opportunity**: None of these brands communicate *governance* or *intellectual depth*. They all look like AI startups. Limen should look like engineering infrastructure -- closer to SQLite's understated authority than to any of these. The indigo palette, the architectural logo, the precise typography -- these communicate "this was built by people who think about knowledge the way philosophers do."

## Appendix B: The Screenshot Test

Every design decision should pass the Screenshot Test: "If a developer screenshots this and posts it on Twitter/Slack/Discord, does it make Limen look good?"

Apply to:
- `limen status` output
- `limen graph` output
- Error messages
- README comparison table
- Social preview image
- Documentation site hero

If any of these would look mediocre in a screenshot, redesign.

## Appendix C: What We Do Not Copy

1. **We do not copy Vercel's gradient meshes.** Those are beautiful but they are Vercel. Limen's aesthetic is starker -- precision, not atmosphere.
2. **We do not copy Linear's app design.** Linear is a product app. Limen is infrastructure. The design language is different.
3. **We do not copy Stripe's documentation layout verbatim.** We learn from its information architecture but create our own visual language.
4. **We do not use AI-generated art.** Every visual element is intentional and hand-crafted (or precisely specified for a designer to craft). AI-generated images signal "we didn't care enough to design this."

---

## Appendix D: Sources and Evidence Chain

### Brand and Design Research
- [Awesome README](https://github.com/matiassingers/awesome-readme) -- curated README examples
- [10 GitHub README Examples That Get Stars](https://blog.beautifulmarkdown.com/10-github-readme-examples-that-get-stars) -- README design patterns
- [Designing for the Command Line Interface](https://yannglt.com/writing/designing-for-command-line-interface) -- CLI design principles
- [UX Patterns for CLI Tools](https://lucasfcosta.com/2022/06/01/ux-patterns-cli-tools.html) -- CLI UX research
- [Command Line Interface Guidelines](https://clig.dev/) -- human-first CLI principles
- [Dark Mode Color Palettes](https://colorhero.io/blog/dark-mode-color-palettes-2025) -- dark mode design research

### Typography
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) -- developer font specification
- [Geist by Vercel](https://vercel.com/font) -- modern developer typography
- [Best Coding Fonts 2026](https://www.etienneaubertbonn.com/coding-fonts/) -- font comparison

### Name and Etymology
- [Limen -- Wikipedia](https://en.wikipedia.org/wiki/Limen) -- psychology definition
- [Liminal and Subliminal Etymology](https://www.johndcook.com/blog/2019/06/03/liminal-and-subliminal/) -- Latin roots
- [Liminality -- Wikipedia](https://en.wikipedia.org/wiki/Liminality) -- threshold concept
- [Liminal Design: A Conceptual Framework](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1043170/full) -- design for transcendence

### Design Systems
- [Stripe Documentation](https://docs.stripe.com/) -- gold standard for developer docs
- [Tailwind CSS Documentation](https://tailwindcss.com/docs) -- searchability benchmark
- [Apple Dark Mode Guidelines](https://developer.apple.com/design/human-interface-guidelines/dark-mode) -- dark mode best practices
- [Google: Writing Helpful Error Messages](https://developers.google.com/tech-writing/error-messages) -- error design

### Existing Limen Documentation
- `~/SolisHQ/Docs/LIMEN_THESIS.md` -- intellectual anchor
- `~/SolisHQ/Docs/LIMEN_INTERFACE_DESIGN.md` -- CLI and error design spec
- `~/SolisHQ/Docs/LIMEN_DEVELOPER_EXPERIENCE_SPEC.md` -- DX findings
- `~/SolisHQ/Docs/LIMEN_RELEASE_STRATEGY.md` -- what ships when
- `~/SolisHQ/Docs/LIMEN_COMPLETE_FEATURE_SPEC.md` -- full feature set
- `~/SolisHQ/Brand/BRAND_SPECIFICATION.md` -- SolisHQ brand identity

---

*Every interface a developer touches was designed. Not defaulted. Not accidental.*
*Limen -- the threshold where engineering meets beauty.*

*SolisHQ -- We innovate, invent, then disrupt.*
