import { BackPlate } from 'SpectaclesUIKit.lspkg/Scripts/BackPlate'
import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button'
import { TextInputField } from 'SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField'
import Event, { PublicApi } from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { setTechnicianName, hasTechnicianName, getTechnicianName } from './TechnicianIdentity'
import { themeButton, themePanel, createLogo } from './ThemedUI'
import { COLOR, HEADER_FONT, BUTTON_FONT, BODY_FONT } from './Theme'

const PANEL_W = 22
const PANEL_H = 16

// Structure (Content/Header/NameInput/Save/ButtonLabel) is pre-authored in the editor
// scene, not built at runtime — every position below is a real Transform the user can
// select and drag in the Scene panel. This script only wires behavior/content onto the
// existing objects; it never calls createSceneObject/createComponent for these.
@component
export class NameEntryPanel extends BaseScriptComponent {
  @input
  welcomeText!: Text

  @input
  headerText!: Text

  @input
  inputField!: TextInputField

  @input
  saveButton!: Button

  @input
  saveButtonLabel!: Text

  private _onSaved = new Event<void>()
  get onSaved(): PublicApi<void> {
    return this._onSaved.publicApi()
  }

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init())
  }

  private init(): void {
    const backPlate = this.sceneObject.getComponent(BackPlate.getTypeName()) as BackPlate
    themePanel(backPlate, COLOR.panelBg)
    backPlate.size = new vec2(PANEL_W, PANEL_H)

    // Extra clearance beyond the default margin — welcomeText already floats just above
    // this panel (see below); the logo needs to sit clear above that, not overlap it.
    createLogo(this.sceneObject, PANEL_H / 2 + 1.8)

    const innerW = PANEL_W - 3.2

    // Floats above the panel, only ever seen on a technician's very first launch
    // (PanelManager only shows this panel when no name is stored yet) — a one-line
    // explanation of why they're being asked, since the bare "Your name" header alone
    // doesn't say what app this is or why it needs a name.
    this.welcomeText.text = "Welcome to Checkpoint — let's get you set up"
    this.welcomeText.depthTest = true
    this.welcomeText.font = BODY_FONT
    this.welcomeText.size = 36
    ;(this.welcomeText as Text & { weight?: number }).weight = 500
    this.welcomeText.textFill.color = COLOR.textSecondary
    this.welcomeText.horizontalAlignment = HorizontalAlignment.Center
    this.welcomeText.verticalAlignment = VerticalAlignment.Center
    this.welcomeText.horizontalOverflow = HorizontalOverflow.Overflow
    this.welcomeText.verticalOverflow = VerticalOverflow.Overflow
    this.welcomeText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -1, 1)

    this.headerText.text = 'Your name'
    this.headerText.depthTest = true
    this.headerText.font = HEADER_FONT
    this.headerText.size = 41
    ;(this.headerText as Text & { weight?: number }).weight = 700
    this.headerText.horizontalAlignment = HorizontalAlignment.Center
    this.headerText.verticalAlignment = VerticalAlignment.Center
    this.headerText.horizontalOverflow = HorizontalOverflow.Overflow
    this.headerText.verticalOverflow = VerticalOverflow.Overflow
    this.headerText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -2, 2)

    this.inputField.size = new vec3(innerW, 3.2, 1)
    // Pre-fill on a re-open (e.g. "Not you? Change" from Site Picker) so the field
    // shows what's currently stored rather than making the user retype it from scratch.
    this.inputField.text = hasTechnicianName() ? getTechnicianName() : ''

    themeButton(this.saveButton, 'amber')
    this.saveButton.size = new vec3(innerW, 3.2, 1)
    this.saveButtonLabel.text = 'Save'
    this.saveButtonLabel.depthTest = true
    this.saveButtonLabel.font = BUTTON_FONT
    this.saveButtonLabel.size = 39
    ;(this.saveButtonLabel as Text & { weight?: number }).weight = 500
    this.saveButtonLabel.horizontalAlignment = HorizontalAlignment.Center
    this.saveButtonLabel.verticalAlignment = VerticalAlignment.Center
    this.saveButtonLabel.horizontalOverflow = HorizontalOverflow.Overflow
    this.saveButtonLabel.verticalOverflow = VerticalOverflow.Overflow
    this.saveButtonLabel.layoutRect = Rect.create(-innerW / 2, innerW / 2, -1.2, 1.2)

    this.saveButton.onTriggerUp.add(() => {
      setTechnicianName(this.inputField.text || 'Technician')
      this.sceneObject.enabled = false
      this._onSaved.invoke()
    })
  }
}
