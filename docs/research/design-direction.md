# Sentinel: Design Direction

Black, dot-matrix display type, one red, white pills. Motion-first. Stack assumption: Next.js (App Router) + Tailwind. Method note: references were fetched as text, so motion details below are inferred from copy, categories and catalog entries. Anything I could not observe is marked (inferred). land-book.com returned 403.

## 1. Reference extraction (what to steal)

**reelfolio.io**
- *Named motion vocabulary.* Every template is a one-word verb-noun (Comet, Rise, Folio, Viscose) with a one-line choreography description. Steal: name each Sentinel agent's "movement" the same way (Scout = sweep, Auditor = scan-lines, Verdict = stamp). Build: a `motion.ts` registry keyed by name; docs and UI cite the names.
- *Hover-to-preview real output.* Cards play the actual result on hover/click. Steal for Audit explorer rows: hover a past audit and the row expands to replay that agent run (10 s compressed). Build: IntersectionObserver-lazy `<video>`/Lottie-less canvas replay from stored event logs.
- *Render-time badge ("Rendered in 48 seconds").* A small proof-of-speed chip. Steal: "Judged in 11.4s, 5 agents, 212 checks" counter chip under every verdict.
- *Segmented pricing toggle with a highlighted winner column.* Use for x402 pricing: Per-call / Bundle / Streaming, with Sentinel's column outlined in red.

**inspora.design**
- *Single-row category filter + Latest/Featured toggle over a dumb uniform grid.* Content is the interface, chrome is nearly nil. Steal for Audit explorer: one filter row (Verdict: Rug / Risky / Clean, Chain, Agent), a Latest/Most-disputed toggle, and a uniform tile grid. No sidebar.
- *"Updated hourly" micro-line with the subscribe field.* Steal: a live "Last audit 14s ago" line in the nav, ticking.

**land-book.com** (403, not fetched). Known for dense card grids with hover video; no claims made.

**wonderlist.design**
- *Counts as credibility* (127 sites, 1,137 pages). Steal: stat strip with big dot-matrix numerals (tokens judged, rugs caught, agents verified).
- *Category-first taxonomy (SaaS/Portfolio/Agency/Other).* Keep Docs nav to 4 buckets max.

**landdding.com**
- *Browse by colour and tag.* Steal: Audit explorer tag chips by risk reason (honeypot, mint authority, LP unlocked, wash trading), colour-coded only with red intensity, never a second hue.
- *Daily/weekly feed framing.* Steal: "Today's verdicts" feed as the landing secondary section.

**footer.design**
- *Footer types: Typographic, Grid, Dark, Animated.* Steal: giant typographic footer: "SENTINEL" in Doto filling full width, each dot reacting to cursor proximity (dots scale 1 to 1.6 within 120 px). Build: canvas grid or CSS grid of spans with `--d` set from pointer.
- *Footer as final CTA* (see cta.gallery): footer contains the token input again.

**cta.gallery**
- *Categories: Button, Form, Modal, Navigation, Pricing, Newsletter.* Steal two: (a) the **Form CTA** as the hero itself: a white pill input "Paste token address" with a red circular submit; (b) **Navigation CTA**: sticky nav pill that morphs into the input after the hero scrolls out. Build: one shared `<CheckPill>` component with Motion `layoutId` (React) so hero and sticky nav share identity.

**motionin.design**
- *"Copy Prompt" next to each section.* Steal: Docs/MCP page gets "Copy MCP config" and "Copy agent prompt" buttons.
- *Explicit engineering rules:* one raw rAF loop for continuous motion, a tween lib for entrances, reduced-motion fallbacks, pause off-screen and in hidden tabs, cap DPR, expand-to-view from exact element rect. Adopt all as the Sentinel motion contract. Expand-to-view: Agent card to agent detail via FLIP.
- *Cipher (ASCII trading terminal)* is the closest cousin: confirms terminal-style immersive works as a hero.

**60fps.design**
- *Taxonomy: Success State, Loading, Stagger, Shimmer, Spring Physics, Sequence.* Steal: the **Success State** and **Loading** families as the verdict and agents-working screens. Shimmer: use as a red sweep over dot-matrix text while pending (mask-position animation).
- *Items named by interaction ("Revolut Splash Intro").* Name Sentinel interactions the same way in code comments.

**iconly.design**
- *Facets by type, category, colour + Saved.* Steal: "Saved/Watchlist" for tokens, persisted in localStorage; star pill toggles with spring.
- *Slug+id detail URLs.* Audit URLs: `/audit/{symbol}-{shortHash}` shareable, OG image auto-generated with the verdict.

**fontinlogo.com**
- *Confidence labels (Verified / Modified / Closest).* Steal for agent output: findings carry a confidence label (Verified on-chain / Inferred / Heuristic). Great honesty signal. Also confirms Press Start 2P and Silkscreen are the common pixel picks, so Doto will look distinctive.

**backgrounds.supply**
- *Collections: ASCII, Nocturne, Portals, animated set.* Steal: a near-black "Nocturne" style background: radial red glow at 4-6% opacity behind the verdict only. ASCII collection: validates ASCII/dot field as hero backdrop. Build in-code (canvas/CSS), do not ship bitmap backgrounds.

**grainient.supply**
- *Noisy/grainy and dither gradient collections.* Steal: dithered red-to-black gradient as the Rug verdict backdrop (ordered Bayer dithering matches dot-matrix identity). Build: SVG `feTurbulence` grain overlay at 6% + CSS `mask` of a radial gradient; or a 4x4 Bayer threshold in a tiny WebGL fragment shader.

**on.design**: fetch returned no usable content ("Design, together"). Nothing claimed.

**v0.app/templates**
- Has a first-party "Agents" category and "AI" and "Dashboards". Competitors include "Skydda AI Sentinel", "JARVIS", "AGENTIC". Steal: differentiate by being proof-first (real audits, Concordium-verified identity) rather than a generic agent-platform look. Use shadcn Dashboard structure for Audit explorer scaffolding only.

**Libraries**
- *kokonutui.com*: 102 components, React + Tailwind + Motion + shadcn, installed as source via `npx shadcn@latest add @kokonutui/<name>`. Directly useful: **Glitch Text, Typing Text, Plucked Text** (Texts), **Magnet Button, Slide to Confirm** (Buttons; slide-to-confirm for paid x402 calls), **AI State Loading, AI Diff Review** (agents working), **Background Paths, Topo/Caustics** (backgrounds), **Action Search Bar** (cmd-K), **Bento Widget Grid** (stat cards). Patterns: spring-based hover, `useMotionValue` + `useTransform` pointer tracking, variants with staggerChildren. Copy source and restyle; do not ship their default palette.
- *anime.js v4* (docs index confirmed): `animate`, Timeline, `stagger` (grid, from, axis, ease, total), ScrollObserver (`onScroll`, sync modes, thresholds), Spring, `splitText` (lines/words/chars), SVG `createDrawable`/`morphTo`/`createMotionPath`, utils (`lerp`, `damp`, `mapRange`, `random`).
- *Motion.dev* (docs confirmed): `animate` with spring, `scroll`, `stagger`; also `inView`, `hover`, `press` in vanilla; layout animations are React/Vue (`layoutId`).

## 2. Page-by-page plan

**Library split rule:** anime.js v4 for choreographed, timeline-heavy, grid/stagger scenes and SVG (hero, check flow, verdict). Motion for interaction, springs, scroll-linked and layout/shared-element (cards, nav, explorer, pricing). Both are small; load per-route.

```js
// anime v4
import { animate, createTimeline, stagger, onScroll, splitText, createDrawable, utils } from 'animejs';
// Motion
import { animate, scroll, inView, hover, press, stagger } from 'motion';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
```

### 2.1 Landing hero (live swarm)
- **Layout:** full-viewport black. Top-left wordmark, centre pill nav, top-right white "Check a token" pill. Center: Doto headline "IS IT A RUG?" (clamp 64-220 px). Under it the CheckPill input. Behind: swarm canvas, ~900 dots (grid 2px dots at 24px pitch) plus 5 agent nodes (white 6px with red 1px ring). Bottom: stat strip + "Verified by Concordium" pill.
- **Choreography:** (1) 0-0.9 s: dot grid fades in by distance from centre (`stagger({from:'center', grid:[cols,rows]})`, 20 ms steps, `outExpo`). (2) 0.5-1.6 s: headline reveal with *dot-matrix reveal*. (3) 1.2 s: 5 agents emerge and orbit on a rAF loop (sin/cos with per-agent phase); they drift toward the input when it is focused (*swarm converge*). (4) Idle: random dots flicker red at 1 per 400 ms, 1 s decay. Pointer repels dots within 140 px (spring-back).
- **Library:** anime.js for intro timeline + stagger grid; one raw rAF canvas loop for the swarm (per motionin.design contract). Motion `scroll()` to fade swarm to 20% as hero exits.
- **Why:** anime's grid stagger from centre is the cheapest way to get the "powering up" display look.

### 2.2 Check a token (input, agents working, verdict)
- **Layout:** one stage, three states in the same frame, no route change. A) input pill centred. B) 5 horizontal "agent lanes" (monospace log lines, progress dot-bar each) around a central converging node. C) Verdict: giant Doto word (RUG / RISKY / CLEAN), score, 5 agent signature chips, evidence list, "Verified by Concordium" attestation row, Share + Re-run pills.
- **Choreography:** A to B (700 ms): input pill morphs into a thin top bar (*pill morph*, Motion `layoutId`), lanes stagger in 80 ms apart from the left, `outExpo`. In B, each lane streams text via typing at 28 ms/char; progress as dot-bar filling with `steps()`. Findings pop as small white pills sliding up 12 px. B to C (1.4 s): lanes collapse toward centre (*swarm converge*), 120 ms hold on a black frame, then *verdict stamp*.
- **Library:** Motion for the pill morph and AnimatePresence between states (shared layout is its strength); anime.js timeline for converge + stamp (many targets, precise sequencing). Wire both off one state machine (`idle | running | verdict`) so they cannot desync.
- **Rule:** never fake the wait. Minimum 2.5 s of choreography even if cached, but show the real timings in the chip.

### 2.3 Agent cards (Verified by Concordium badge)
- **Layout:** 5 cards in a bento (2/3 + 1/3 rows). Each: Doto glyph/number, role, live stat (checks/day), badge pill bottom-left: white pill, red dot, "Verified by Concordium", with a hover tooltip showing the credential hash and proof date.
- **Choreography:** on enter (`inView`, 30% margin) cards rise 24 px with 70 ms stagger, 0.7 s, `outExpo`. Hover: spring tilt (±4 deg, stiffness 220, damping 22), spotlight radial following the cursor, badge dot pulses once. Click: expand-to-view via layout animation to the detail panel (FLIP from exact rect, 0.55 s, `inOutQuart`).
- **Library:** Motion (hover, press, layoutId, inView). Anime would need manual FLIP.

### 2.4 Audit explorer
- **Layout:** inspora-style: one filter row (verdict, chain, agent, time) + Latest/Most-disputed toggle, then a uniform tile grid (4 col) of mini verdict tiles: token, big Doto verdict, tiny 24-bar sparkline of risk. Cmd-K search (Kokonut Action Search Bar).
- **Choreography:** filter change reflows tiles with layout animation (spring, bounce 0.15). New live audit inserts at top with *dot-matrix reveal* and pushes the others down. Row/tile hover replays the run; click expands to the audit page with shared-element transition.
- **Library:** Motion (`LayoutGroup`, `AnimatePresence popLayout`). Virtualise past 200 items; animate only visible.

### 2.5 Pricing for agents (x402)
- **Layout:** segmented pill toggle: Per-call / Bundle / Streaming. Three columns, Sentinel's recommended outlined red. Live code panel: `HTTP 402` response and `X-PAYMENT` retry, with price in USDC per call. A "try a paid call" Slide to Confirm.
- **Choreography:** toggle thumb slides with spring (stiffness 500, damping 38); prices count up by digit roll using dot-matrix digits (*dot-matrix reveal* per digit, 40 ms stagger). The 402 code panel types the request, flashes a red `402`, then flips to green-free white `200` (no second accent; use white).
- **Library:** Motion for toggle/hover; anime.js `splitText` for the typed code and digit roll timeline.

### 2.6 Docs / MCP
- **Layout:** left rail nav (Doto section numbers 01-06), centre content, right "On this page". Hero card: MCP config snippet with *Copy MCP config* pill and a tool list (`check_token`, `get_audit`, `list_agents`, `verify_agent`).
- **Choreography:** restraint. Sidebar active indicator is a sliding 2 px red bar (spring). Code blocks fade-in line by line (20 ms stagger, once). Copy button: pill morphs to "Copied" with a 2-frame dot flash.
- **Library:** Motion only (small). Do not load anime.js on this route.

## 3. Motion system

```css
:root{
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out-quart: cubic-bezier(0.76, 0, 0.24, 1);
  --ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-snap: cubic-bezier(0.2, 0.9, 0.1, 1.0);
}
```
anime.js names: `outExpo`, `inOutQuart`, `outQuint`. Motion: pass the cubic-bezier arrays or `{type:'spring'}`.

| Name | Duration | Curve | Recipe |
|---|---|---|---|
| **Dot-matrix reveal** | 0.9 s total, 18 ms per char | `outExpo` | Text split to chars (`splitText({chars:true})`). Each char starts `opacity:0`, `filter:blur(6px)`, `translateY(0.15em)`, and the Doto `ROND` axis from 100 to 0 if variable (dots go from round to crisp). Stagger 18 ms `from:'first'`. Finish with one 60 ms red flash on the last char. |
| **Swarm converge** | 1.4 s | `inOutQuart`, 0.5 s overshoot-free | All agent nodes lerp to centroid; trails drawn as fading dots (`damp(a,b,6,dt)` per frame). Dot grid contracts 4% toward centre. |
| **Verdict stamp** | 0.42 s | spring (stiffness 520, damping 24, mass 0.9) | Word scales 1.6 to 1, opacity 0 to 1 in first 80 ms, a 2-frame white screen flash (6% opacity), 120 ms camera shake (2 px, 3 cycles) only for RUG. Haptic `navigator.vibrate(30)` on mobile. |
| **Pill morph** | 0.7 s | spring (bounce 0.2, duration 0.6) | Shared layout between hero input, nav and top bar. Width/radius animate; the label crossfades 150 ms. |
| **Scan sweep** | 1.6 s loop, linear | `linear` | 1 px red line with 40 px gradient tail traversing a card/lane; `mix-blend-mode:screen`; pauses off-screen. |
| **Rise-in** | 0.7 s, stagger 70 ms | `outExpo` | `translateY(24px)` to 0, opacity 0 to 1. Default for all cards and sections. |
| **Tick** | 0.12 s | `snap` | Hover, press and toggle micro feedback: scale 0.97 press, 1.02 hover. |

Defaults: reduced-motion mode swaps every transition above for a 150 ms opacity fade and freezes the swarm. Pause rAF on `document.hidden` and off-screen. Cap canvas DPR at 2.

```js
// Dot-matrix reveal (anime v4)
const { chars } = splitText('.hero-h', { chars: true });
animate(chars, {
  opacity: [0, 1], y: ['0.15em', 0], filter: ['blur(6px)', 'blur(0px)'],
  duration: 900, ease: 'outExpo', delay: stagger(18),
});
// Verdict stamp (Motion)
animate('.verdict', { scale: [1.6, 1], opacity: [0, 1] },
  { type: 'spring', stiffness: 520, damping: 24, mass: 0.9 });
// Rise-in on view (Motion)
inView('.card', (el) => { animate(el, { opacity: [0,1], y: [24,0] }, { duration: .7, ease: [0.16,1,0.3,1] }); });
```

## 4. Type and colour tokens

**Display: Doto (Google Fonts, variable: `wght` 100-900, `ROND` 0-100).** It is the only genuine dot-matrix family on Google Fonts, so a "sibling" would have to be a pixel font (Silkscreen, Press Start 2P, Micro 5), which reads as retro-gaming rather than instrument display. Recommendation: **reuse Doto, differentiate by configuration** so CARPET and Sentinel feel like one family but not twins: Sentinel uses `ROND 0` (square, forensic dots), weight 800-900 for verdicts, 500 for numerals; check what CARPET sets and take the opposite end of `ROND`. (I could not verify CARPET's settings from here.)

**Text: Geist.** **Mono: Geist Mono** (same designer, matched metrics, used for logs/code/hashes).

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Doto:wght,ROND@100..900,0..100&family=Geist:wght@300..700&family=Geist+Mono:wght@400..600&display=swap" rel="stylesheet">
```
With `next/font/google` prefer `Doto({ axes:['ROND'], variable:'--font-display' })` to self-host.

```css
:root{
  --bg:#000; --bg-1:#0A0A0A; --bg-2:#111; --line:#1F1F1F; --line-2:#2E2E2E;
  --fg:#FFF; --fg-2:#B8B8B8; --fg-3:#7A7A7A; --fg-4:#4A4A4A;
  --red:#FF2A2A; --red-hi:#FF5A4D; --red-lo:#7A0F0F; --red-glow:rgba(255,42,42,.14);
  --pill-bg:#FFF; --pill-fg:#000;
  --font-display:'Doto',monospace; --font-text:'Geist',system-ui; --font-mono:'Geist Mono',ui-monospace;
}
```
Rules: red is the only hue and means danger or the single primary action; verdict CLEAN is white on black, RISKY is outlined red, RUG is solid red fill. Never green. White pills: 40 px high, 999 radius, Geist 500 14 px. Type scale (Doto): 12vw hero, 6vw h2, 32 px stat numerals; Geist 16/24 body.

## 5. Ten micro-interactions

1. **Input paste detect:** pasting an address triggers a 120 ms dot-scan across the pill and auto-identifies chain (chip appears with Tick).
2. **Magnet CTA pills:** primary pill pulls toward the cursor within 80 px (max 8 px, Kokonut Magnet Button pattern), springs back.
3. **Dot-field cursor:** the background dots within 140 px of the cursor scale and glow white; trailing 200 ms.
4. **Live ticker nav chip:** "Last verdict 14 s ago" counts up in dot-matrix digits that roll individually.
5. **Agent heartbeat:** each agent card has a 1 px red dot pulsing at its real check rate (faster when busy).
6. **Slide to Confirm for paid calls:** the x402 demo uses a drag thumb; release under 90% springs back; success stamps `200`.
7. **Verdict stamp with sound-off haptics:** the stamp from the system plus an optional 40 ms low click (off by default, toggle in nav).
8. **Copy morph:** every copy button morphs pill width to "Copied" and back, 1.2 s, with a 2-frame dot flash.
9. **Giant footer dots:** the SENTINEL typographic footer reacts to the cursor; on click, dots scatter and reform (700 ms).
10. **Shimmer on pending:** pending text shows a red-tinted mask sweep (Scan sweep); on resolve it snaps to white with a 60 ms brightness flash. Plus: `prefers-reduced-motion` honored, and `View Transitions` between audit tile and detail where supported.

## Build order
Tokens + fonts, motion.ts (names above), CheckPill + state machine, hero canvas, verdict stamp, agent cards, explorer, pricing, docs. Ship the check-to-verdict flow first: it is what judges will test.
