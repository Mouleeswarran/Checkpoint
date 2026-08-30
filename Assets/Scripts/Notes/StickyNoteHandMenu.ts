import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button'
import Event, { PublicApi } from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { NoteType } from './StickyNote'
import { themeButton, setButtonIcon } from '../Shared/ThemedUI'
import { ButtonTone, BUTTON_FONT, COLOR } from '../Shared/Theme'

const PLAIN_ICON = requireAsset('../../Icons/sticky_note_2.png') as Texture
const INFO_ICON = requireAsset('../../Icons/info.png') as Texture
const WARNING_ICON = requireAsset('../../Icons/warning.png') as Texture
const DANGER_ICON = requireAsset('../../Icons/dangerous.png') as Texture

// Same per-type tone convention StickyNote.ts and NotePlacer.ts already use — kept as
// its own small local map rather than importing theirs, matching how each file in this
// app already keeps its own copy of these tiny per-type lookup tables.
const TYPE_TONE: Record<NoteType, ButtonTone> = { plain: 'teal', info: 'teal', warning: 'amber', danger: 'danger' }
const TYPE_ICON: Record<NoteType, Texture> = { plain: PLAIN_ICON, info: INFO_ICON, warning: WARNING_ICON, danger: DANGER_ICON }

const BUTTON_SIZE = 2.6
const GAP = 0.7

// Root SceneObject is pre-authored in the editor scene as a child of NotesUI, so its
// enabled state automatically follows the sticky-note panel's own — opening/closing that
// panel opens/closes this menu with it, no separate PanelManager wiring needed. A
// HandAttach component sits alongside this script on the same object (see
// Shared/HandAttach.ts) and owns all the hand-following/editor-fallback positioning;
// this script only builds a 2x2 grid of the four note-type buttons and fires which type
// was tapped — NotePlacer.armPlacement() (made public specifically for this) owns
// everything about what happens next.
@component
export class StickyNoteHandMenu extends BaseScriptComponent {
  private _onTypeSelected = new Event<NoteType>()
  get onTypeSelected(): PublicApi<NoteType> {
    return this._onTypeSelected.publicApi()
  }

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.buildMenu())
  }

  private buildMenu(): void {
    const spacing = BUTTON_SIZE + GAP
    const positions: Record<NoteType, vec3> = {
      plain: new vec3(-spacing / 2, spacing / 2, 0),
      info: new vec3(spacing / 2, spacing / 2, 0),
      warning: new vec3(-spacing / 2, -spacing / 2, 0),
      danger: new vec3(spacing / 2, -spacing / 2, 0),
    }
    ;(Object.keys(positions) as NoteType[]).forEach((type) => {
      const obj = global.scene.createSceneObject(type + 'Button')
      obj.setParent(this.sceneObject)
      obj.getTransform().setLocalPosition(positions[type])
      const btn = obj.createComponent(Button.getTypeName()) as Button
      themeButton(btn, TYPE_TONE[type], BUTTON_SIZE / 2)
      btn.size = new vec3(BUTTON_SIZE, BUTTON_SIZE, 1)
      setButtonIcon(btn, TYPE_ICON[type], BUTTON_SIZE * 0.55)
      btn.onTriggerUp.add(() => this._onTypeSelected.invoke(type))
    })

    // Sits just above the top row (top row's own center is at +spacing/2, its top edge
    // BUTTON_SIZE/2 above that) with a small clearance gap.
    const topRowY = spacing / 2 + BUTTON_SIZE / 2
    const headingObj = global.scene.createSceneObject('Heading')
    headingObj.setParent(this.sceneObject)
    headingObj.getTransform().setLocalPosition(new vec3(0, topRowY + 1.1, 0))
    const heading = headingObj.createComponent('Component.Text') as Text
    heading.text = 'New Note'
    heading.depthTest = true
    heading.font = BUTTON_FONT
    heading.size = 34
    ;(heading as Text & { weight?: number }).weight = 600
    heading.textFill.color = COLOR.textPrimary
    heading.horizontalAlignment = HorizontalAlignment.Center
    heading.verticalAlignment = VerticalAlignment.Center
    heading.horizontalOverflow = HorizontalOverflow.Overflow
    heading.verticalOverflow = VerticalOverflow.Overflow
    heading.layoutRect = Rect.create(-6, 6, -1, 1)
  }
}
