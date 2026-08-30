import { BackPlate } from 'SpectaclesUIKit.lspkg/Scripts/BackPlate'
import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button'
import Event, { PublicApi } from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { themeButton, themePanel, createLogo } from './ThemedUI'
import { COLOR, ButtonTone, HEADER_FONT, BUTTON_FONT } from './Theme'

export type MenuTarget = 'site' | 'notes' | 'session' | 'history' | 'ask'

const PANEL_W = 26.0
const PANEL_H = 35.2

// Three-tier hierarchy instead of one uniform grid, so the two things a technician
// actually *does* on site (record a note, record a session) read as the obviously
// primary actions, the two things they *review* (past versions, ask a question about
// them) read as secondary, and the one pure-navigation action (switch site — rarely
// touched once a site is picked) reads as a minor utility tucked at the bottom.
// Corner radius and label size scale with tile size (same ~0.2 ratio and label-to-tile
// proportion as the original uniform tiles) so bigger tiles don't just get scaled up
// blurrily — they keep the same "squircle" character at every size.
type TileTier = 'hero' | 'medium' | 'utility'
const TIER: Record<TileTier, { size: number; cornerRadius: number; labelSize: number }> = {
  hero: { size: 10.8, cornerRadius: 2.16, labelSize: 44 },
  medium: { size: 8.2, cornerRadius: 1.64, labelSize: 38 },
  utility: { size: 5.5, cornerRadius: 1.1, labelSize: 32 },
}

interface TileConfig {
  target: MenuTarget
  label: string
  tone: ButtonTone
  tier: TileTier
}

// Central hub — a tiered grid of square tiles (hero/medium/utility, see TileTier)
// instead of a stack of full-width bars or one uniform grid, so importance reads
// visually: primary actions are biggest and highest, secondary review actions are
// smaller and centered below them, and the one pure-navigation action is smallest and
// at the bottom. No metal skin here — kept flat, per explicit feedback that the panel
// skin behind a wall of buttons read as too busy for this screen.
//
// Structure (Content/Header/tiles/labels) is pre-authored in the editor scene, not
// built at runtime — every tile position is a real Transform the user can select and
// drag in the Scene panel. This script only wires theme/behavior onto the existing
// objects; it never calls createSceneObject/createComponent for these.
@component
export class MainMenu extends BaseScriptComponent {
  @input
  headerText!: Text

  @input
  notesTile!: Button
  @input
  notesTileLabel!: Text

  @input
  sessionTile!: Button
  @input
  sessionTileLabel!: Text

  @input
  historyTile!: Button
  @input
  historyTileLabel!: Text

  @input
  askTile!: Button
  @input
  askTileLabel!: Text

  @input
  siteTile!: Button
  @input
  siteTileLabel!: Text

  private _onNavigate = new Event<MenuTarget>()
  get onNavigate(): PublicApi<MenuTarget> {
    return this._onNavigate.publicApi()
  }

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.buildPanel())
  }

  private buildPanel(): void {
    const backPlate = this.sceneObject.getComponent(BackPlate.getTypeName()) as BackPlate
    themePanel(backPlate, COLOR.panelBg)
    backPlate.size = new vec2(PANEL_W, PANEL_H)
    // Icon only, not the full icon+wordmark lockup — the header right below already
    // reads "Checkpoint" at flagship size (see createLogo's own comment). Tight margin
    // (0.3, not the 3.6 default) — this panel's header sits well below its own top edge,
    // and the default margin left a wide dead gap between the icon and "Checkpoint".
    createLogo(this.sceneObject, PANEL_H / 2, false, 0.3)

    this.headerText.text = 'Checkpoint'
    this.headerText.depthTest = true
    this.headerText.font = HEADER_FONT
    // Bigger than every other panel's header (41) — this is the app's home/hub screen,
    // so its title reads as the flagship title rather than matching the sub-panels it
    // leads to.
    this.headerText.size = 60
    ;(this.headerText as Text & { weight?: number }).weight = 700
    this.headerText.textFill.color = COLOR.amberBright
    this.headerText.horizontalAlignment = HorizontalAlignment.Center
    this.headerText.verticalAlignment = VerticalAlignment.Center
    this.headerText.horizontalOverflow = HorizontalOverflow.Overflow
    this.headerText.verticalOverflow = VerticalOverflow.Overflow
    const innerW = PANEL_W - 3.2
    this.headerText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -3, 3)

    // Hero row (top, biggest): the two actions a technician performs on site.
    this.setupTile(this.notesTile, this.notesTileLabel, { target: 'notes', label: 'Sticky\nNotes', tone: 'amber', tier: 'hero' })
    this.setupTile(this.sessionTile, this.sessionTileLabel, {
      target: 'session',
      label: 'Work\nSession',
      tone: 'danger',
      tier: 'hero',
    })
    // Medium row (middle): reviewing/querying what's already recorded — secondary to
    // actually recording it.
    this.setupTile(this.historyTile, this.historyTileLabel, {
      target: 'history',
      label: 'Version\nHistory',
      tone: 'teal',
      tier: 'medium',
    })
    this.setupTile(this.askTile, this.askTileLabel, { target: 'ask', label: 'Ask AI', tone: 'amber', tier: 'medium' })
    // Utility (bottom, smallest): pure navigation, touched rarely once a site is picked.
    this.setupTile(this.siteTile, this.siteTileLabel, { target: 'site', label: 'Switch\nSite', tone: 'teal', tier: 'utility' })
  }

  private setupTile(btn: Button, label: Text, item: TileConfig): void {
    const { size, cornerRadius, labelSize } = TIER[item.tier]
    themeButton(btn, item.tone, cornerRadius)
    btn.size = new vec3(size, size, 1)

    label.text = item.label
    label.depthTest = true
    label.font = BUTTON_FONT
    label.size = labelSize
    ;(label as Text & { weight?: number }).weight = 600
    label.horizontalAlignment = HorizontalAlignment.Center
    label.verticalAlignment = VerticalAlignment.Center
    label.horizontalOverflow = HorizontalOverflow.Overflow
    label.verticalOverflow = VerticalOverflow.Overflow
    const half = size / 2 - 0.4
    label.layoutRect = Rect.create(-half, half, -half, half)

    btn.onTriggerUp.add(() => this._onNavigate.invoke(item.target))
  }
}
