import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button'
import { RoundedRectangle } from 'SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle'
import { themeButton } from './ThemedUI'
import { COLOR, HEADER_FONT, BUTTON_FONT, BODY_FONT } from './Theme'

// A small in-world "are you sure?" dialog, built entirely at runtime — nothing in this
// app has ever needed a modal before, so there's no prefab to reuse. Its background is a
// RoundedRectangle (SpectaclesUIKit's own standalone Shape, with a public
// size/cornerRadius/backgroundColor — see its own onSizeChanged/set size) rather than a
// BackPlate: every BackPlate in this codebase is pre-authored and only ever reached via
// getComponent() on an existing object, never created fresh at runtime, while
// RoundedRectangle is explicitly designed to be used standalone (Dropdown builds its own
// drawer background the exact same way internally, and this app already reaches that one
// via a cast — this is the same component, just created directly instead).
//
// Centered on whatever panel it's parented to (local (0,0,z)), so every panel's own
// half-width/half-height symmetric layout convention places it in the middle for free.
export class ConfirmPopup {
  private root: SceneObject
  private messageText: Text
  private onConfirmCallback: (() => void) | null = null

  constructor(parent: SceneObject, widthCM: number, localZ: number) {
    this.root = global.scene.createSceneObject('ConfirmPopup')
    this.root.setParent(parent)
    this.root.getTransform().setLocalPosition(new vec3(0, 0, localZ))
    this.root.enabled = false

    const bgObj = global.scene.createSceneObject('ConfirmPopupBg')
    bgObj.setParent(this.root)
    bgObj.getTransform().setLocalPosition(new vec3(0, 0, 0))
    const bg = bgObj.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    bg.size = new vec2(widthCM, 13)
    bg.cornerRadius = 1.0
    bg.backgroundColor = new vec4(0.05, 0.04, 0.03, 0.98)

    const headerObj = global.scene.createSceneObject('ConfirmPopupHeader')
    headerObj.setParent(this.root)
    headerObj.getTransform().setLocalPosition(new vec3(0, 4.0, 0.1))
    const headerText = headerObj.createComponent('Component.Text') as Text
    headerText.text = 'Still in progress'
    headerText.depthTest = true
    headerText.font = HEADER_FONT
    headerText.size = 34
    ;(headerText as Text & { weight?: number }).weight = 700
    headerText.textFill.color = COLOR.dangerBright
    headerText.horizontalAlignment = HorizontalAlignment.Center
    headerText.verticalAlignment = VerticalAlignment.Center
    headerText.horizontalOverflow = HorizontalOverflow.Overflow
    headerText.verticalOverflow = VerticalOverflow.Overflow
    headerText.layoutRect = Rect.create(-widthCM / 2 + 1, widthCM / 2 - 1, -1.2, 1.2)

    const msgObj = global.scene.createSceneObject('ConfirmPopupMessage')
    msgObj.setParent(this.root)
    msgObj.getTransform().setLocalPosition(new vec3(0, 1.0, 0.1))
    this.messageText = msgObj.createComponent('Component.Text') as Text
    this.messageText.text = ''
    this.messageText.depthTest = true
    this.messageText.font = BODY_FONT
    this.messageText.size = 32
    ;(this.messageText as Text & { weight?: number }).weight = 500
    this.messageText.textFill.color = COLOR.textPrimary
    this.messageText.horizontalAlignment = HorizontalAlignment.Center
    this.messageText.verticalAlignment = VerticalAlignment.Center
    this.messageText.horizontalOverflow = HorizontalOverflow.Wrap
    this.messageText.verticalOverflow = VerticalOverflow.Overflow
    this.messageText.layoutRect = Rect.create(-widthCM / 2 + 1.5, widthCM / 2 - 1.5, -2.6, 2.6)

    const btnW = (widthCM - 3) / 2
    const cancelObj = global.scene.createSceneObject('ConfirmPopupCancel')
    cancelObj.setParent(this.root)
    cancelObj.getTransform().setLocalPosition(new vec3(-(btnW / 2 + 0.5), -4.2, 0.1))
    const cancelBtn = cancelObj.createComponent(Button.getTypeName()) as Button
    themeButton(cancelBtn, 'teal')
    cancelBtn.size = new vec3(btnW, 2.8, 1)
    this.addButtonLabel(cancelObj, 'Stay', btnW)
    cancelBtn.onTriggerUp.add(() => this.hide())

    const confirmObj = global.scene.createSceneObject('ConfirmPopupConfirm')
    confirmObj.setParent(this.root)
    confirmObj.getTransform().setLocalPosition(new vec3(btnW / 2 + 0.5, -4.2, 0.1))
    const confirmBtn = confirmObj.createComponent(Button.getTypeName()) as Button
    themeButton(confirmBtn, 'danger')
    confirmBtn.size = new vec3(btnW, 2.8, 1)
    this.addButtonLabel(confirmObj, 'Leave anyway', btnW)
    confirmBtn.onTriggerUp.add(() => {
      const cb = this.onConfirmCallback
      this.hide()
      cb?.()
    })
  }

  private addButtonLabel(btnObj: SceneObject, text: string, widthCM: number): void {
    const labelObj = global.scene.createSceneObject('Label')
    labelObj.setParent(btnObj)
    labelObj.getTransform().setLocalPosition(new vec3(0, 0, 0.95))
    const label = labelObj.createComponent('Component.Text') as Text
    label.text = text
    label.depthTest = true
    label.font = BUTTON_FONT
    label.size = 34
    ;(label as Text & { weight?: number }).weight = 500
    label.horizontalAlignment = HorizontalAlignment.Center
    label.verticalAlignment = VerticalAlignment.Center
    label.horizontalOverflow = HorizontalOverflow.Overflow
    label.verticalOverflow = VerticalOverflow.Overflow
    label.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.1, 1.1)
  }

  show(message: string, onConfirm: () => void): void {
    this.messageText.text = message
    this.onConfirmCallback = onConfirm
    this.root.enabled = true
  }

  private hide(): void {
    this.root.enabled = false
    this.onConfirmCallback = null
  }
}
