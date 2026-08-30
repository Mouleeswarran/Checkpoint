const SPINNER_ICON = requireAsset('../../Icons/progress_activity.png') as Texture
const imageMaterial = requireAsset('../../Materials/ImageMaterial.mat') as Material
// Degrees per frame — a fixed per-frame step rather than a delta-time-scaled one, same
// simplicity every other purely-visual per-frame effect in this codebase already uses
// (see HandAttach's own per-frame tracking); a spinner reads fine at whatever frame rate
// this runs at without needing precise timing.
const ROTATION_STEP_DEG = 6

// A small rotating "loading" icon, created fresh under `parent`. Not a @component of its
// own — every other custom TS component in this app is pre-authored via VirtualScene
// (never created purely at runtime via createComponent on a custom class, an unproven
// pattern here), so this is instead a plain helper class driven by the CALLING script's
// own createEvent('UpdateEvent') — avoids that risk entirely, and needs no scene wiring
// to add to any panel: `new LoadingSpinner(this, someParent, position, size)`.
//
// Runs its rotation check every frame for the lifetime of the owning script (an early
// `if (!enabled) return`, not an OnEnable/OnDisable-gated event) — negligible cost, and
// sidesteps the exact enable/disable-timing class of bug this session already hit twice
// (Prompt 83, Prompt 92) by never depending on enable-transition timing at all.
export class LoadingSpinner {
  private obj: SceneObject

  constructor(owner: BaseScriptComponent, parent: SceneObject, localPosition: vec3, sizeCM: number) {
    this.obj = global.scene.createSceneObject('LoadingSpinner')
    this.obj.setParent(parent)
    this.obj.getTransform().setLocalPosition(localPosition)
    this.obj.getTransform().setLocalScale(new vec3(sizeCM, sizeCM, 1))

    const image = this.obj.createComponent('Component.Image') as Image
    const mat = imageMaterial.clone()
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
    mat.mainPass.baseTex = SPINNER_ICON
    image.clearMaterials()
    image.addMaterial(mat)

    this.obj.enabled = false
    owner.createEvent('UpdateEvent').bind(() => this.spin())
  }

  private spin(): void {
    if (!this.obj.enabled) return
    const t = this.obj.getTransform()
    const delta = quat.angleAxis(ROTATION_STEP_DEG * (Math.PI / 180), vec3.forward())
    t.setLocalRotation(t.getLocalRotation().multiply(delta))
  }

  show(): void {
    this.obj.enabled = true
  }

  hide(): void {
    this.obj.enabled = false
  }
}
