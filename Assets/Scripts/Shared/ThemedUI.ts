import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button'
import { BackPlate } from 'SpectaclesUIKit.lspkg/Scripts/BackPlate'
import { BeveledPrismVisual, BeveledPrismVisualParameters } from 'SpectaclesUIKit.lspkg/Scripts/Visuals/BeveledPrism/BeveledPrismVisual'
import { ButtonTone, PRISM_TONE, PrismToneColors, TONE, COLOR, HEADER_FONT } from './Theme'

const LOGO_ICON = requireAsset('../../Icons/target.png') as Texture

// One-shot geometry shared by every Checkpoint button — matches SpectaclesUIKit's own
// Prism style defaults (see BeveledPrismButtonParameters.ts) rather than inventing new
// numbers, since that curve is exactly what reads as "tactile" rather than "flat".
const BEVEL_RADIUS = 0.0625
const CORNER_RADIUS = 0.4

function prismState(colors: PrismToneColors, extrusion: number, matcapRotation: number) {
  return { prismColors: colors, extrusion, matcapRotation }
}

// Applies Checkpoint's theme to a Button using SpectaclesUIKit's BeveledPrismVisual —
// the tactile, embossed 3D button body (forward pop on hover/press, spinning specular
// matcap highlight that tracks the interactor across the face) that ships as the kit's
// own default. A flat RoundedRectangleVisual was used here previously; it read as
// generic and, being 2D, let real-world passthrough bleed through the translucent
// fill. The prism body is opaque and physically deep, which fixes both at once.
export function themeButton(button: Button, tone: ButtonTone, cornerRadius: number = CORNER_RADIUS): void {
  const p = PRISM_TONE[tone]
  const style: Partial<BeveledPrismVisualParameters> = {
    default: { ...prismState(p.idle, 0, 0), bevelRadius: BEVEL_RADIUS, cornerRadius },
    hovered: prismState(p.hover, 0.3, 0),
    triggered: prismState(p.hover, 0.1, -20),
    toggledDefault: prismState(p.hover, 0, -10),
    toggledHovered: prismState(p.hover, 0.3, -10),
    toggledTriggered: prismState(p.hover, 0.1, -30),
    inactive: prismState(p.idle, 0, 0),
  }
  button.visual = new BeveledPrismVisual({ sceneObject: button.sceneObject, style })
}

interface PanelRoundedRectangle {
  gradient: boolean
  backgroundColor: vec4
  border: boolean
  borderSize: number
  borderColor: vec4
  borderType: 'Color' | 'Gradient'
}

// Border thickness for the accent rim every panel gets — thin enough to read as a frame
// line, not a thick colored band eating into panel content.
const PANEL_BORDER_SIZE = 0.18

// Tints a BackPlate's background and gives it a themed accent-color inset border, using
// its internal RoundedRectangle — no public color setter exists on BackPlate (only a
// named `style` preset), so this reaches the same internal component the official
// custom-visual examples reach via `as any`. RoundedRectangle also supports a background
// gradient and a texture background, but neither is used here: gradient's own color
// stops are Inspector-input-only (no public setter — see RoundedRectangle.ts), so it
// can't be configured for a panel built entirely at runtime like these are, and the
// texture path was already confirmed inert in this environment (see createPanelSkin's
// own comment) — the border, by contrast, is fully runtime-settable and is what gives
// every panel its "designed", on-brand look instead of a flat, borderless rectangle.
export function themePanel(backPlate: BackPlate, bg: vec4, accent: ButtonTone = 'amber'): void {
  const rr = (backPlate as unknown as { roundedRectangle?: PanelRoundedRectangle }).roundedRectangle
  if (!rr) return
  rr.gradient = false
  rr.backgroundColor = bg
  rr.border = true
  rr.borderSize = PANEL_BORDER_SIZE
  rr.borderType = 'Color'
  const accentColor = TONE[accent].bright
  rr.borderColor = new vec4(accentColor.x, accentColor.y, accentColor.z, 0.9)
}

const imageMaterial = requireAsset('../../Materials/ImageMaterial.mat') as Material

// A skeuomorphic "skin" layered over a flat panel — RoundedRectangle's own background-
// texture fields (useTexture/texture/textureMode/textureWrap) proved inert in this
// environment even with an obviously-wrong debug texture (confirmed empirically before
// falling back to this), so panels get their material look from a plain Image plane
// instead: the same mechanism already verified working for photo display in
// ImageViewer/HistoryPanel. Sits between the BackPlate (z=0) and Content (z=0.6) so
// text/buttons always render on top. Inset by insetCM so its square corners stay
// hidden inside the panel's rounded corner curve rather than poking past it.
// tint multiplies the texture's own color (white = untouched) — used to give sticky
// notes their per-type "colored paper" look (classic Post-it yellow/blue/orange/pink)
// without needing separate texture assets per type.
export function createPanelSkin(root: SceneObject, texture: Texture, tint: vec4 = new vec4(1, 1, 1, 1)): Image {
  const so = global.scene.createSceneObject('PanelSkin')
  so.setParent(root)
  so.getTransform().setLocalPosition(new vec3(0, 0, 0.3))
  const img = so.createComponent('Component.Image') as Image
  const mat = imageMaterial.clone()
  mat.mainPass.depthTest = true
  mat.mainPass.depthWrite = false
  mat.mainPass.baseTex = texture
  mat.mainPass.baseColor = tint
  img.clearMaterials()
  img.addMaterial(mat)
  return img
}

export function resizePanelSkin(img: Image, size: vec2, insetCM: number = 1.2): void {
  const w = Math.max(0.1, size.x - insetCM * 2)
  const h = Math.max(0.1, size.y - insetCM * 2)
  img.sceneObject.getTransform().setLocalScale(new vec3(w, h, 1))
}

// Icon-only buttons (Mic, round Back) show a symbol instead of a word — SpectaclesUIKit's
// Button has no icon slot of its own (ElementContent exists in the kit but pulls in
// ThemeService/FlexLayout machinery this project doesn't otherwise use), so this reuses
// the same plain Image-plane technique as createPanelSkin: a small child object layered
// just above the button's beveled face. Sits at a lower z (0.2) than the panel skin
// (0.3) since buttons already render above the skin via Content/Controls re-append.
// Every panel's old full-width "< Menu" button becomes a small round icon-only back
// button, positioned by the caller (typically top-left, floating above the panel).
// widthCM sets both the button's diameter and the round-shape corner radius (see
// themeButton's cornerRadius param) — a BeveledPrismVisual with cornerRadius ==
// size/2 renders as a true circle.
export function styleBackButton(button: Button, label: Text, icon: Texture, widthCM: number = 3.2): void {
  themeButton(button, 'teal', widthCM / 2)
  button.size = new vec3(widthCM, widthCM, 1)
  label.text = ''
  setButtonIcon(button, icon, widthCM * 0.5)
}

export function setButtonIcon(button: Button, icon: Texture, sizeCM: number): Image {
  const so = global.scene.createSceneObject(button.sceneObject.name + 'Icon')
  so.setParent(button.sceneObject)
  // BeveledPrismVisual's opaque body sits ~0.5cm deep at rest (size.z=1, half-depth
  // 0.5) and pops forward another 0.3cm on hover/press — an icon at a shallower z
  // renders inside/behind the solid prism and disappears, same failure mode as button
  // labels (see BUTTON_LABEL_Z in SitePicker.ts). 0.95 clears the worst case.
  so.getTransform().setLocalPosition(new vec3(0, 0, 0.95))
  so.getTransform().setLocalScale(new vec3(sizeCM, sizeCM, 1))
  const img = so.createComponent('Component.Image') as Image
  const mat = imageMaterial.clone()
  mat.mainPass.depthTest = true
  mat.mainPass.depthWrite = false
  mat.mainPass.baseTex = icon
  img.clearMaterials()
  img.addMaterial(mat)
  return img
}

// The Checkpoint wordmark — a "target" glyph (Material Symbols has no literal checkpoint/
// waypoint icon; a bullseye reads as "the precise point you're checking" and ties into
// the app's own Custom-Location/GPS precision theme) beside "CHECKPOINT" in HEADER_FONT.
// Floats just above the panel's own top edge, the same convention already used for the
// round back button and the GPS badge, rather than being squeezed inside the panel and
// needing every panel's height/content re-laid-out to make room for it.
//
// showWordmark=false gives just the icon, centered — for Main Menu, whose own header
// already reads "Checkpoint" at flagship size; a second "CHECKPOINT" wordmark directly
// above it would just repeat the same word twice, so it gets the icon alone as a crest
// above the title instead of the full icon+wordmark lockup.
//
// marginAboveTop is the gap above the panel's own top edge — 3.6 default suits panels
// whose own header sits close to their top edge (Name Entry, and previously Site Picker).
// Main Menu's header sits much deeper inside its (much taller) panel, so a fixed 3.6
// margin left an ugly dead gap between the icon and "Checkpoint" below it — Main Menu
// passes a much smaller value instead, to sit close above its own header like a crest,
// not stranded far above it.
export function createLogo(
  root: SceneObject,
  panelHalfHeight: number,
  showWordmark: boolean = true,
  marginAboveTop: number = 3.6
): void {
  const y = panelHalfHeight + marginAboveTop

  const group = global.scene.createSceneObject('CheckpointLogo')
  group.setParent(root)
  group.getTransform().setLocalPosition(new vec3(0, y, 0.5))

  const iconObj = global.scene.createSceneObject('LogoIcon')
  iconObj.setParent(group)
  // Tight enough to read as one mark instead of two floating pieces — the icon's right
  // edge (x + half its own scale) sits barely clear of the wordmark's own left bound.
  iconObj.getTransform().setLocalPosition(new vec3(showWordmark ? -4.1 : 0, 0, 0))
  iconObj.getTransform().setLocalScale(new vec3(2.9, 2.9, 1))
  const img = iconObj.createComponent('Component.Image') as Image
  const mat = imageMaterial.clone()
  mat.mainPass.depthTest = true
  mat.mainPass.depthWrite = false
  mat.mainPass.baseTex = LOGO_ICON
  mat.mainPass.baseColor = COLOR.amberBright
  img.clearMaterials()
  img.addMaterial(mat)

  if (!showWordmark) return

  const wordObj = global.scene.createSceneObject('LogoWordmark')
  wordObj.setParent(group)
  wordObj.getTransform().setLocalPosition(new vec3(0, 0, 0))
  const t = wordObj.createComponent('Component.Text') as Text
  t.text = 'CHECKPOINT'
  t.depthTest = true
  t.font = HEADER_FONT
  t.size = 62
  ;(t as Text & { weight?: number }).weight = 700
  t.textFill.color = COLOR.amberBright
  t.horizontalAlignment = HorizontalAlignment.Left
  t.verticalAlignment = VerticalAlignment.Center
  t.horizontalOverflow = HorizontalOverflow.Overflow
  t.verticalOverflow = VerticalOverflow.Overflow
  t.layoutRect = Rect.create(-2.5, 14, -1.7, 1.7)
}
