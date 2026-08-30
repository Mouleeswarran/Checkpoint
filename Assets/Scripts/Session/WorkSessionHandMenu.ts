import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button'
import Event, { PublicApi } from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { themeButton, setButtonIcon } from '../Shared/ThemedUI'
import { ButtonTone, COLOR, BODY_FONT } from '../Shared/Theme'

const RECORD_ICON = requireAsset('../../Icons/circle.png') as Texture
const STOP_ICON = requireAsset('../../Icons/stop_circle.png') as Texture
const CAMERA_ICON = requireAsset('../../Icons/photo_camera.png') as Texture
const AI_ICON = requireAsset('../../Icons/hub.png') as Texture

const BUTTON_SIZE = 2.6
const GAP = 0.8

// Root SceneObject is pre-authored in the editor scene as a child of SessionUI, so its
// enabled state automatically follows the Work Session panel's own — opening/closing
// Work Session opens/closes this menu with it, no separate PanelManager wiring needed.
// A HandAttach component sits alongside this script on the same object (see
// Shared/HandAttach.ts) and owns all the hand-following/editor-fallback positioning;
// this script only builds the three buttons and wires their taps to named events.
// SessionRecorder owns all the actual recording/capture/navigation logic and just
// listens to these — the same Event<T> pattern used everywhere else in this app
// (onBackRequested, onSiteSelected, HistoryPanel's onAskAIRequested, etc.) rather than
// this menu reaching into SessionRecorder directly.
@component
export class WorkSessionHandMenu extends BaseScriptComponent {
  private recordButton!: Button
  private recordIconImage: Image | null = null
  private statusText: Text | null = null

  private _onRecordTapped = new Event<void>()
  get onRecordTapped(): PublicApi<void> {
    return this._onRecordTapped.publicApi()
  }

  private _onCaptureTapped = new Event<void>()
  get onCaptureTapped(): PublicApi<void> {
    return this._onCaptureTapped.publicApi()
  }

  private _onAskAITapped = new Event<void>()
  get onAskAITapped(): PublicApi<void> {
    return this._onAskAITapped.publicApi()
  }

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.buildMenu())
  }

  private buildMenu(): void {
    const spacing = BUTTON_SIZE + GAP

    // Stacked vertically (Y offsets), not in a row — reads more like a menu resting
    // beside the hand/view than a horizontal toolbar, and top-to-bottom keeps the same
    // priority order the row used left-to-right (Record, Capture, Ask AI).
    //
    // Red/circle reads as "tap to record" by the same universal convention as a camera
    // app's shutter — swapped to amber/stop while actually recording (setRecordingState)
    // so it stays visually distinct from its own idle state, not because red specifically
    // means "recording" here.
    const record = this.createIconButton('RecordButton', spacing, 'danger', RECORD_ICON)
    this.recordButton = record.button
    this.recordIconImage = record.icon
    this.recordButton.onTriggerUp.add(() => this._onRecordTapped.invoke())

    const capture = this.createIconButton('CaptureButton', 0, 'teal', CAMERA_ICON)
    capture.button.onTriggerUp.add(() => this._onCaptureTapped.invoke())

    const ai = this.createIconButton('AskAIButton', -spacing, 'amber', AI_ICON)
    ai.button.onTriggerUp.add(() => this._onAskAITapped.invoke())

    // A small floating caption below the three buttons — this menu stays visible and
    // near-hand throughout a work session regardless of where the technician is looking
    // or which panel is currently in front, so capture/record status set here (see
    // setStatus()) is far less likely to be missed than the same text living only on the
    // Work Session panel itself.
    const statusObj = global.scene.createSceneObject('Status')
    statusObj.setParent(this.sceneObject)
    statusObj.getTransform().setLocalPosition(new vec3(0, -spacing - 1.8, 0))
    this.statusText = statusObj.createComponent('Component.Text') as Text
    this.statusText.text = ''
    this.statusText.depthTest = true
    this.statusText.font = BODY_FONT
    this.statusText.size = 30
    ;(this.statusText as Text & { weight?: number }).weight = 500
    this.statusText.textFill.color = COLOR.tealBright
    this.statusText.horizontalAlignment = HorizontalAlignment.Center
    this.statusText.verticalAlignment = VerticalAlignment.Center
    this.statusText.horizontalOverflow = HorizontalOverflow.Wrap
    this.statusText.verticalOverflow = VerticalOverflow.Overflow
    this.statusText.layoutRect = Rect.create(-3.6, 3.6, -1.4, 1.4)
  }

  // Called by SessionRecorder alongside its own panel-side captureStatusText updates —
  // see SessionRecorder.setCaptureStatus() — so every capture/record message shows in
  // both places at once rather than needing two call sites kept in sync by hand.
  setStatus(text: string): void {
    if (this.statusText) this.statusText.text = text
  }

  // Called by SessionRecorder alongside its own recordButtonLabel/statusText updates,
  // right where toggleRecording() already flips isRecording — kept in sync from there
  // rather than this menu tracking recording state independently.
  setRecordingState(isRecording: boolean): void {
    if (!this.recordButton || !this.recordIconImage) return
    themeButton(this.recordButton, isRecording ? 'amber' : 'danger', BUTTON_SIZE / 2)
    const mat = this.recordIconImage.getMaterial(0)
    if (mat) mat.mainPass.baseTex = isRecording ? STOP_ICON : RECORD_ICON
  }

  private createIconButton(name: string, y: number, tone: ButtonTone, icon: Texture): { button: Button; icon: Image } {
    const obj = global.scene.createSceneObject(name)
    obj.setParent(this.sceneObject)
    obj.getTransform().setLocalPosition(new vec3(0, y, 0))
    const btn = obj.createComponent(Button.getTypeName()) as Button
    themeButton(btn, tone, BUTTON_SIZE / 2)
    btn.size = new vec3(BUTTON_SIZE, BUTTON_SIZE, 1)
    const iconImg = setButtonIcon(btn, icon, BUTTON_SIZE * 0.55)
    return { button: btn, icon: iconImg }
  }
}
