# YuTheme v2 · the whole theme, portable

Read this first when YuTheme has to land in something new: a website, an app, a platform, a CLI, a mobile screen, a slide, a chart. It is the theme as a SYSTEM (principles, colour, surfaces, type, shape, motion, components, UX), independent of any stack. The files that implement it:

| File | What | Use when |
|---|---|---|
| `assets/yutheme-kit.css` | Complete standalone stylesheet: tokens (AMOLED, graphite, app-only daylight), base, components, every effect, reduced motion | Any web stack. Replaces `preset.css` + `yutheme-v2.css`, never loaded with them |
| `assets/yutheme-tokens.json` | The same tokens + motion numbers as data | Stacks without CSS: React Native, Flutter, SwiftUI, Compose, Qt, terminal themes, chart libraries, image/slide generation |
| `assets/kit-preview.html` | Living specimen of the kit (open next to the CSS) | Checking a port, showing Yuri options |
| `references/mockups/yutheme-2.0-surfaces-effects/` | The approved design mockup (Tokens.dc.html + its runtime) | The visual ground truth for surfaces, accents, effects and components |
| `assets/yutheme-v2.css` | Overlay on top of v1 `preset.css` | Only for products still on v1 `preset.css` (e.g. the website before migration) |

Where numbers disagree, `tokens.md` wins, then the kit, then this page.

## 1. Principles (what makes it YuTheme)

1. **Black is the canvas.** AMOLED `#000` with near-black warm surfaces. Nothing big is grey.
2. **Structure from light lines, not shadows.** 0.5px warm-ivory borders plus a 1px top highlight (`--yu-highlight`). Shadows only on floating layers.
3. **Warm, not neutral.** Every neutral leans ivory (`#f4f1e8` text, `rgb(232,228,216)` borders). Never pure white on black.
4. **Colour means something.** Gold = action (and one accent word). Cyan = link/info. Green = success/live. Purple = agent/AI. Red = danger. Amber = warning. Nothing is coloured for decoration.
5. **Quiet by default, alive where it matters.** A small named effect set (shimmer, sheen, pulse, rise, glow, lift, skeleton, pop-in, caret) with pauses and budgets. Everything stops under reduced motion.
6. **Geist, calm hierarchy.** Light display weights with tight tracking, 400 body, 500 UI, Geist Mono for data, dates, ids and hints.
7. **Honest UX.** Loading looks like the result, errors say what failed, deferred changes say when they apply, secrets stay masked, destructive actions name their consequence.

## 2. Colour

**Surface ladder (AMOLED / graphite):** canvas `#000000` / `#262624` · surface-window `#0b0b0a` / `#2b2a27` · editor `#10100f` (lifted) / `#222220` (sunk) · titlebar-input `#121211` / `#30302e` · hover `#141413` / `#353431` · raised-popover `#151514` / `#30302e` · chip `#1a1a18` / `#353431` · active `#1f1f1d` / `#3a3935`.

**Text:** strong `#fffdf7` · primary `#f4f1e8` · secondary `#b3ad9f` (AMOLED) / `#b8b2a4` (graphite) · tertiary `#8e887c` / `#9a9488` · inverse `#15130f`.

**Accents:** gold `#d6a84f` (hover `#e0b760`) · cyan `#64d2ff` · green `#31d158` · purple `#bf5af2` (soft text `#d9a8f5`) · red `#ff6961` · amber `#f0b35a` · blue `#4daafc`. Tinted backgrounds are the colour at 14% alpha with the text in the colour.

**Special-purpose:** chart marks `#b8862b` (hover `#d6a84f`), validated for AMOLED, graphite and daylight, never the action token. Syntax: keyword `#d9a8f5`, string `#8fd6a0`, number/attr `#e8c07a`, function `#7fdcff`, type `#f0b35a`, comment `#7d786c` italic, punctuation `#9a9488`.

**Variants:** AMOLED is the brand. Graphite is opt-in (`data-theme="yu-graphite"`). **Daylight (`yu-daylight`) exists only for apps people use all day, as a user preference**, never for the brand, sites, marketing or social: accents are darkened there (gold `#b8862b`, cyan `#0a7fbf`, green `#1f9d48`, purple `#9b3fd1`, red `#d9433b`) to keep 4.5:1.

**Accent presets (apps only):** a user may swap the ACTION colour (`data-accent="blue|green|violet|coral"`); semantic colours never change and chart gold stays fixed.

## 3. Type, shape, spacing

- Geist 400/500 (display 400 with `-0.03em`, line-height 1.08), Geist Mono 400/500. Hero `clamp(32px,4vw,52px)`; app page titles 30px; section titles 13px/500; body 14-15px/1.65; labels 11px mono uppercase `0.08em` tertiary; buttons 13-14px/500.
- Radius: 4 (compact) · 8 (controls) · 12 (inputs, buttons, list cards) · 14 (windows, cards, code blocks) · 16 (popovers) · 20 (panels, big feature cards) · pill for chips and switches.
- Controls: 36px default, 30 small, 42 large; touch targets ≥ 44px on phones.
- Rhythm: 4px grid; card padding 16-24; section gap 28-40; page gutter 16 (phone) to 24+.

## 4. Motion

Interaction `160ms cubic-bezier(0.2,0,0,1)`. Lift 250ms, 3px, fill steps up, one light sweep. Entrance 0.9s, 12px + 6px blur, 100ms stagger, once. Pop-in 160ms. Shimmers 3.6s neutral / 6s gold / 2.8s agent, each resting from 65% of the cycle. Skeleton 1.4s linear. Pulse 2.4s. Sheen 5s linear. Glow breathes 9s. Caret 1.1s steps. Full rules and budgets: `effects.md`.

## 5. Components (names in the kit)

Card `.yu-card` · floating layer `.yu-pop` · buttons `.yu-btn` + `-primary | -secondary | -tonal | -ghost | -danger` + `--sm | --lg | --icon` · link `.yu-link` · field `.yu-input` · switch `.yu-switch` · segmented `.yu-segmented` · chips `.yu-chip` + `-accent | -success | -warning | -danger | -agent | -info` · dot `.yu-dot` · stat `.yu-stat` · list `.yu-list` · toast `.yu-toast` · prose `.yu-prose` · code `.yu-codeblock` + syntax classes (`hljs-*` and `tok-*`) · chart bar `.yu-bar` · labels `.label-mono`.

One primary (gold) cluster per view. Selection is chip fill + highlight, not gold. Badges always carry a word, never colour alone.

## 6. By product type

- **Website / portfolio / landing:** AMOLED only. Editorial layout (`layout-composition.md`), one gold shimmer word, one focal glow, entrance on the hero only, cards with lift, `cta-link` arrows. No light mode.
- **App / tool / chat / admin:** the kit + `app-surfaces.md` (six-layer ladder, chat and settings patterns, portal overlays, toasts top-right, no native form widgets). Graphite and daylight may be offered in Settings > Appearance.
- **Platform / dashboard / data-heavy:** `data-dense-operations.md` + chart rules in `app-surfaces.md` (validated chart gold, table view, y axis sized to labels, approx. money labelled).
- **CLI / terminal / TUI:** map from `yutheme-tokens.json`: background `#000`, foreground `#f4f1e8`, dim `#8e887c`, bold gold for the primary action/prompt, cyan links/paths, green ok, red errors, purple for agent output; no animation except a spinner in tertiary.
- **Mobile (native):** same tokens from JSON; 44pt targets; system fonts may replace Geist only if Geist cannot be bundled; haptics instead of hover lift; honour OS reduced motion.
- **Docs, slides, images, social:** AMOLED canvas, ivory text, one gold word, Geist; charts with chart gold; no effects in static media except a single glow.

## 7. By stack

- **Plain HTML/CSS, Astro, server templates:** link `yutheme-kit.css`, use the classes directly.
- **Tailwind v4:** import the kit, then expose tokens: `@theme inline { --color-canvas: var(--yu-bg-canvas); --color-surface: var(--yu-bg-surface); --color-chip: var(--yu-bg-chip); --color-accent: var(--action-primary); --color-text-primary: var(--text-primary); ... }`. Make hairlines win over Tailwind's 1px utilities with an unlayered `.border { border-width: 0.5px }`, and keep kit components in `@layer components` so utilities can override them.
- **shadcn/ui:** use the HSL bridge in `tokens.md` (`--background`, `--card`, `--popover`, `--border`...) mapped from the kit variables.
- **React / Vue / Svelte:** the classes are framework-free. JS animation libraries must honour reduced motion themselves. Render menus, sheets, dialogs and toasts in a portal to `<body>` (see `app-surfaces.md`).
- **Native / non-CSS:** read `yutheme-tokens.json`; keep token names as identifiers so a grep finds the same concept everywhere.
- **Charts (any library):** single series `#b8862b` / hover `#d6a84f`, hairline grid in `--border-subtle`, labels in tertiary text, tooltip on the raised layer. Multi-series: run the dataviz validator; do not reuse semantic colours as series colours.

## 8. Porting checklist

1. Load Geist + Geist Mono locally.
2. Load the kit (or the JSON) and set `data-theme` on the root only when a variant is chosen.
3. Map existing components to kit classes; keep the product's layout (theme, not redesign).
4. Replace native selects/checkboxes/alerts in apps.
5. Apply effects within budget; verify reduced motion shows solid text and no blur.
6. Compare against `kit-preview.html` and the mockup side by side at 375 / 768 / 1440.
7. Computed values: canvas `#000000`, surface `#0b0b0a`, text `#f4f1e8`, action `#d6a84f`, window radius 14px.
