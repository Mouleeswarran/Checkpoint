import { Frame } from 'SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame'
import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button'
import Event, { PublicApi } from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { themeButton } from '../Shared/ThemedUI'
import { COLOR, BUTTON_FONT, BODY_FONT } from '../Shared/Theme'
import { LoadingSpinner } from '../Shared/LoadingSpinner'

const PANEL_W = 24
const PANEL_H = 28
const PAD = 1.6

const imageMaterial = requireAsset('../../Materials/ImageMaterial.mat') as Material
const internetModule: InternetModule = require('LensStudio:InternetModule')
const remoteMediaModule: RemoteMediaModule = require('LensStudio:RemoteMediaModule')

// Content/Image/Caption/Nav/Prev/Next/Close are pre-authored in the editor scene as
// direct children of this SceneObject — real Transforms the user can select and drag
// in the Scene panel. Frame.initializeContent() sweeps any pre-existing children of its
// own SceneObject into its internally-managed content node at OnStartEvent (before this
// script's onInitialized runs), preserving their local transforms — so authoring them
// as plain children here works the same as if this script had parented them under
// frame.contentTransform itself. This script only wires theme/behavior/content onto the
// existing objects; it never calls createSceneObject/createComponent for these.
@component
export class ImageViewer extends BaseScriptComponent {
  @input
  image!: Image

  @input
  captionText!: Text

  @input
  prevButton!: Button
  @input
  prevButtonLabel!: Text

  @input
  nextButton!: Button
  @input
  nextButtonLabel!: Text

  @input
  closeButton!: Button
  @input
  closeButtonLabel!: Text

  private frame!: Frame
  private imageMat!: Material
  private urls: string[] = []
  private index = 0
  // Not a definite-assignment field like the others above — genuinely null until
  // frame.onInitialized fires, which (see onAwake()'s self-disable) only happens on the
  // FIRST show(), not before. show() calls loadCurrent() synchronously in that same
  // call, so on that very first open this is still null when loadCurrent() runs — a real
  // bug this exact gap caused: the spinner access threw, aborting loadCurrent() before
  // the actual image request ever fired, leaving the default/placeholder texture on
  // screen with no load ever attempted. Tapping Next then worked because buildUI() had
  // finished by the time that second loadCurrent() call ran.
  private spinner: LoadingSpinner | null = null

  private _onNavigate = new Event<number>()
  get onNavigate(): PublicApi<number> {
    return this._onNavigate.publicApi()
  }

  onAwake(): void {
    this.sceneObject.enabled = false
    this.createEvent('OnStartEvent').bind(() => this.buildUI())
  }

  private buildUI(): void {
    this.frame = this.sceneObject.getComponent(Frame.getTypeName()) as Frame
    this.frame.autoShowHide = false
    this.frame.autoScaleContent = false

    this.frame.onInitialized.add(() => {
      this.frame.innerSize = new vec2(PANEL_W, PANEL_H)

      this.imageMat = imageMaterial.clone()
      this.imageMat.mainPass.depthTest = true
      this.imageMat.mainPass.depthWrite = false
      this.image.clearMaterials()
      this.image.addMaterial(this.imageMat)

      // Same position as the image itself, parented alongside it — created after, so it
      // draws on top per this app's usual "later sibling wins" rule (both this and the
      // image have depthWrite off, so draw order is what actually determines top/bottom).
      // Without this, a slow photo load just sat on whatever texture was already loaded
      // (the previous photo, or nothing at all) with zero indication anything was
      // happening — read as "it just shows the default picture."
      const imgLocalPos = this.image.sceneObject.getTransform().getLocalPosition()
      this.spinner = new LoadingSpinner(this, this.image.sceneObject.getParent(), imgLocalPos, 4)

      this.captionText.text = ''
      this.captionText.depthTest = true
      this.captionText.font = BODY_FONT
      this.captionText.size = 38
      ;(this.captionText as Text & { weight?: number }).weight = 500
      this.captionText.textFill.color = COLOR.textSecondary
      this.captionText.horizontalAlignment = HorizontalAlignment.Center
      this.captionText.verticalAlignment = VerticalAlignment.Center
      this.captionText.horizontalOverflow = HorizontalOverflow.Overflow
      this.captionText.verticalOverflow = VerticalOverflow.Overflow
      const innerW = PANEL_W - PAD * 2
      this.captionText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -1, 1)

      const navW = (innerW - 1.5) / 2
      this.setupNavButton(this.prevButton, this.prevButtonLabel, '< Prev', navW)
      this.prevButton.onTriggerUp.add(() => this.navigate(-1))
      this.setupNavButton(this.nextButton, this.nextButtonLabel, 'Next >', navW)
      this.nextButton.onTriggerUp.add(() => this.navigate(1))

      this.setupNavButton(this.closeButton, this.closeButtonLabel, 'Close', innerW)
      this.closeButton.onTriggerUp.add(() => this.hide())
    })
  }

  private setupNavButton(btn: Button, label: Text, text: string, widthCM: number): void {
    themeButton(btn, 'teal')
    btn.size = new vec3(widthCM, 2.6, 1)
    label.text = text
    label.depthTest = true
    label.font = BUTTON_FONT
    label.size = 38
    ;(label as Text & { weight?: number }).weight = 500
    label.horizontalAlignment = HorizontalAlignment.Center
    label.verticalAlignment = VerticalAlignment.Center
    label.horizontalOverflow = HorizontalOverflow.Overflow
    label.verticalOverflow = VerticalOverflow.Overflow
    label.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.1, 1.1)
  }

  // startIndex is 0-based. Setting `.enabled = true` here means this genuinely opens the
  // viewer regardless of its current state — a caller doesn't need to check whether it's
  // already open first (see HistoryPanel's inline photo-marker buttons, which jump
  // straight to a specific photo even if the viewer was never opened this session).
  show(urls: string[], startIndex: number = 0): void {
    this.urls = urls
    this.index = this.urls.length ? Math.min(Math.max(startIndex, 0), this.urls.length - 1) : 0
    this.sceneObject.enabled = true
    if (this.urls.length === 0) {
      this.captionText.text = 'No photos for this session'
      return
    }
    this.loadCurrent()
  }

  hide(): void {
    this.sceneObject.enabled = false
  }

  private navigate(delta: number): void {
    if (this.urls.length === 0) return
    this.index = (this.index + delta + this.urls.length) % this.urls.length
    this.loadCurrent()
  }

  private loadCurrent(): void {
    this.captionText.text = `Photo ${this.index + 1} of ${this.urls.length}`
    this.spinner?.show()
    const resource = internetModule.makeResourceFromUrl(this.urls[this.index])
    remoteMediaModule.loadResourceAsImageTexture(
      resource,
      (texture: Texture) => {
        this.imageMat.mainPass.baseTex = texture
        this.spinner?.hide()
      },
      (err: string) => {
        print('[ImageViewer] Photo load failed: ' + err)
        this.spinner?.hide()
      }
    )
    this._onNavigate.invoke(this.index + 1)
  }
}
