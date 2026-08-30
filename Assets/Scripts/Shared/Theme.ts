// Checkpoint's visual identity — a field-service/industrial palette (safety amber +
// electric teal on graphite) instead of SpectaclesUIKit's default gray-blue, so every
// panel in the app reads as one product rather than a stack of generic UI samples.

// Skeuomorphic sticky-note skin — a torn legal-pad page. The app panels previously had
// a matching brushed-metal skin, but it read as wood paneling rather than metal and was
// removed by explicit request; panels are back to a flat tinted background.
export const PAPER_NOTE_TEXTURE = requireAsset('../../Generated Textures/PaperNoteTexture.png') as Texture

// Icon-only controls: Mic buttons show just the microphone glyph (no "Mic" word), and
// every "< Menu" button became a round icon-only back arrow — see setButtonIcon in
// ThemedUI.ts and Prompt 37 in the prompt log.
export const MIC_ICON = requireAsset('../../Icons/mic.png') as Texture
export const BACK_ICON = requireAsset('../../Icons/arrow_back.png') as Texture

// Three-role type system so heading/button/body text each read as a distinct tier
// instead of the panel looking like one undifferentiated font:
//  - HEADER_FONT: Anton, an ultra-bold condensed display face, reserved for panel
//    titles only — the loudest, heaviest voice on screen.
//  - BUTTON_FONT: Big Shoulders (the app's original display face), now scoped to
//    button/control labels — still bold and condensed, but visibly lighter/rounder
//    than Anton so headings and buttons never look identical.
//  - BODY_FONT: Encode Sans Semi Condensed, a technical sans for paragraph-length
//    body/status text, where the display faces above would be fatiguing to read.
//
// `let`, not `const` — FontManager.ts (Assets/Scripts/Shared/FontManager.ts) reassigns
// these from its own Inspector @input fonts, on the single scene object's OnAwake,
// which always completes (across every object) before any panel's OnStart runs its
// buildPanel() and reads these — so every panel picks up an Inspector-swapped font
// without needing its own font wiring. Every read site (`t.font = HEADER_FONT`, etc.)
// must stay a live property read at call time, not a value captured once into a local
// or a cached object literal — see SitePicker.ts's TYPE_SCALE for the one place this
// mattered (it now resolves the concrete Font from a fontRole string per call instead
// of baking a Font reference into the table at module-load time).
export let HEADER_FONT = requireAsset('../../Fonts/Anton.ttf') as Font
export let BUTTON_FONT = requireAsset('../../Fonts/Big Shoulders.ttf') as Font
export let BODY_FONT = requireAsset('../../Fonts/Encode Sans Semi Condensed.ttf') as Font

export function setFonts(header: Font, button: Font, body: Font): void {
  HEADER_FONT = header
  BUTTON_FONT = button
  BODY_FONT = body
}

export const COLOR = {
  panelBg: new vec4(0.07, 0.065, 0.06, 1.0),
  panelBgAlt: new vec4(0.1, 0.09, 0.08, 1.0),

  amber: new vec4(1.0, 0.56, 0.08, 1),
  amberBright: new vec4(1.0, 0.7, 0.28, 1),
  amberDim: new vec4(0.32, 0.19, 0.06, 1),

  teal: new vec4(0.15, 0.82, 0.76, 1),
  tealBright: new vec4(0.4, 0.94, 0.88, 1),
  tealDim: new vec4(0.06, 0.24, 0.22, 1),

  danger: new vec4(0.9, 0.32, 0.28, 1),
  dangerBright: new vec4(1.0, 0.48, 0.42, 1),
  dangerDim: new vec4(0.3, 0.1, 0.08, 1),

  // Not part of the amber/teal/danger tone system — a plain, universally-read
  // "selected/on" green for marking picked items in a list (e.g. multi-select
  // dropdown rows), distinct from any of this app's three brand tones on purpose.
  success: new vec4(0.35, 0.85, 0.45, 1),

  textPrimary: new vec4(1, 1, 1, 0.96),
  textSecondary: new vec4(1, 1, 1, 0.6),
  textMuted: new vec4(1, 1, 1, 0.45),
}

export type ButtonTone = 'amber' | 'teal' | 'danger'

export const TONE: Record<ButtonTone, { base: vec4; bright: vec4; dim: vec4 }> = {
  amber: { base: COLOR.amber, bright: COLOR.amberBright, dim: COLOR.amberDim },
  teal: { base: COLOR.teal, bright: COLOR.tealBright, dim: COLOR.tealDim },
  danger: { base: COLOR.danger, bright: COLOR.dangerBright, dim: COLOR.dangerDim },
}

// Per-tone palettes for SpectaclesUIKit's BeveledPrismVisual — the tactile, embossed,
// animated button body (forward pop on hover/press, spinning specular highlight) that
// ships as the kit's own default and reads far more "premium" than a flat rounded
// rect. master0/1/2 are the corner-to-corner face gradient (master0.a: 1 = grey the
// flat face at idle, 0 = keep it coloured on hover/press); accent0-3 are the rim/bevel
// highlight gradient. Shape mirrors SpectaclesUIKit's own PrismPalette.ts — only the
// hues change, swapped for Checkpoint's amber/teal/danger identity instead of Snap's
// violet/mint default.
export interface PrismToneColors {
  master0: vec4
  master1: vec4
  master2: vec4
  accent0: vec4
  accent1: vec4
  accent2: vec4
  accent3: vec4
}

export const PRISM_TONE: Record<ButtonTone, { idle: PrismToneColors; hover: PrismToneColors }> = {
  amber: {
    idle: {
      master0: new vec4(0.32, 0.19, 0.06, 1.0),
      master1: new vec4(0.4, 0.24, 0.08, 1.0),
      master2: new vec4(0.5, 0.3, 0.1, 1.0),
      accent0: new vec4(0.6, 0.6, 0.6, 1.0),
      accent1: new vec4(0.85, 0.55, 0.25, 1.0),
      accent2: new vec4(0.3, 0.15, 0.05, 1.0),
      accent3: new vec4(0.9, 0.7, 0.4, 1.0),
    },
    hover: {
      master0: new vec4(1.0, 0.56, 0.08, 0.0),
      master1: new vec4(1.0, 0.66, 0.2, 1.0),
      master2: new vec4(1.0, 0.75, 0.35, 1.0),
      accent0: new vec4(0.9, 0.9, 0.7, 1.0),
      accent1: new vec4(1.0, 0.85, 0.5, 1.0),
      accent2: new vec4(0.6, 0.35, 0.05, 1.0),
      accent3: new vec4(1.0, 0.92, 0.7, 1.0),
    },
  },
  teal: {
    idle: {
      master0: new vec4(0.06, 0.24, 0.22, 1.0),
      master1: new vec4(0.08, 0.3, 0.28, 1.0),
      master2: new vec4(0.1, 0.36, 0.34, 1.0),
      accent0: new vec4(0.5, 0.6, 0.6, 1.0),
      accent1: new vec4(0.3, 0.6, 0.55, 1.0),
      accent2: new vec4(0.04, 0.2, 0.18, 1.0),
      accent3: new vec4(0.5, 0.75, 0.72, 1.0),
    },
    hover: {
      master0: new vec4(0.15, 0.82, 0.76, 0.0),
      master1: new vec4(0.25, 0.9, 0.84, 1.0),
      master2: new vec4(0.35, 0.96, 0.9, 1.0),
      accent0: new vec4(0.7, 0.95, 0.9, 1.0),
      accent1: new vec4(0.4, 0.94, 0.88, 1.0),
      accent2: new vec4(0.05, 0.4, 0.36, 1.0),
      accent3: new vec4(0.7, 0.98, 0.95, 1.0),
    },
  },
  danger: {
    idle: {
      master0: new vec4(0.3, 0.1, 0.08, 1.0),
      master1: new vec4(0.36, 0.13, 0.1, 1.0),
      master2: new vec4(0.42, 0.16, 0.12, 1.0),
      accent0: new vec4(0.6, 0.5, 0.5, 1.0),
      accent1: new vec4(0.7, 0.3, 0.25, 1.0),
      accent2: new vec4(0.25, 0.06, 0.04, 1.0),
      accent3: new vec4(0.8, 0.5, 0.45, 1.0),
    },
    hover: {
      master0: new vec4(0.9, 0.32, 0.28, 0.0),
      master1: new vec4(1.0, 0.4, 0.35, 1.0),
      master2: new vec4(1.0, 0.5, 0.44, 1.0),
      accent0: new vec4(1.0, 0.8, 0.78, 1.0),
      accent1: new vec4(1.0, 0.48, 0.42, 1.0),
      accent2: new vec4(0.5, 0.12, 0.08, 1.0),
      accent3: new vec4(1.0, 0.75, 0.7, 1.0),
    },
  },
}
