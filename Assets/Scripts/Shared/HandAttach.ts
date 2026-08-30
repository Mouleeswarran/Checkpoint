import { HandInputData } from 'SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData'
import TrackedHand from 'SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand'

const DEG2RAD = Math.PI / 180

// Keeps this object's own Transform anchored to a hand's palm on real Spectacles
// hardware, oriented to match the wrist so a hand menu reads as physically resting on
// the hand rather than floating independently. Composed onto a hand-menu's own
// SceneObject as a second component (not folded into the menu script itself) so this
// hand-following behavior is reusable for any future hand-attached UI.
//
// Lens Studio Preview has no REAL hand tracking, but — confirmed live, this is not the
// same claim as "isTracked() is false there" — TrackedHand.isTracked() still returns
// true against a fixed idle/rest rig, with getPalmCenter()/wrist.rotation coming back as
// real numbers parked at a meaningless fixed pose nowhere near the camera. isTracked()
// alone is therefore NOT a safe Preview-vs-device check; track() below also gates on
// global.deviceInfoSystem.isEditor() (already used the same way in
// SessionRecorder.startCameraStream()) to force the fallback below in Preview regardless
// of what isTracked() claims. This is a narrower gap than NotePlacer.getPinchPosition()
// relies on for note placement — that one is about a HandInteractor's own `.hand` being
// absent on Preview's MouseInteractor, a real and confirmed absence, not this.
//
// The fallback floats the menu at a fixed position beside the camera's view instead,
// which is what someone testing in the editor actually needs to be able to see and
// reach — not a stand-in meant to visually resemble a hand-worn menu, just a floating,
// always-reachable equivalent for the one platform this can't attach to a real hand on.
//
// Exact on-device facing/offset (palmOffset*) hasn't been tuned against a real hand —
// Preview can't exercise that branch at all — so treat the defaults as a starting point
// to adjust once this runs on a paired Spectacles device, not as a verified fit.
@component
export class HandAttach extends BaseScriptComponent {
  @input
  cameraObject!: SceneObject

  @input
  leftHand: boolean = false

  // cm along the palm's own right/up/forward axes — applied on-device only.
  @input
  palmOffsetRight: number = 0
  @input
  palmOffsetUp: number = 3
  @input
  palmOffsetForward: number = 2

  // cm along the camera's own right/up/forward axes — applied in Preview only (or if a
  // hand isn't currently tracked on-device), floating the menu at the side of the view.
  // Sized against the actual camera FOV, not eyeballed — confirmed live via
  // QueryRuntimeSceneTool that this scene's Camera.fov is 0.6386 rad (~36.6°) and the
  // Preview render is close to a 1:1 aspect ratio, so horizontal and vertical half-view
  // are both roughly `forward * tan(fov/2)`. At forward=38, that's ~12.6cm — right=8 and
  // up=-6 both sit safely inside that, unlike the previous 16/-8/42 (half-view ~13.9cm),
  // which put the menu right at the edge of frame and got clipped almost entirely off
  // one side, confirmed by a live screenshot.
  @input
  editorOffsetRight: number = 8
  @input
  editorOffsetUp: number = -6
  @input
  editorOffsetForward: number = 38

  // Slight rest-at-your-side tilt for the Preview fallback, applied on top of the
  // look-at-camera rotation below — degrees, converted to radians here since this file
  // runs at Lens runtime, not through the Editor API (see AGENTS.md: rotation is degrees
  // in the Editor API but radians at runtime). Roll (Z) removed — not needed once the
  // look-at itself is screen-locked; only a pitch tilt remains.
  @input
  editorTiltPitch: number = -10

  private hand: TrackedHand | null = null
  private updateEvent: SceneEvent | null = null

  // Tracking starts on OnEnableEvent, not unconditionally in onAwake — this object
  // starts enabled by editor default (like every panel in this app), so an onAwake-bound
  // UpdateEvent would begin computing a position on frame 1, before PanelManager has even
  // run and while the camera transform may not be fully settled yet, then get PAUSED the
  // moment PanelManager disables the parent panel a frame later — freezing that one bad
  // early value in place for good, since nothing would ever re-run it. This is the exact
  // same class of bug as Prompt 83's Site Picker GPS-timing fix: the real trigger needs to
  // be "this object actually became visible," not "the Lens booted." OnEnableEvent gives
  // that for free — it fires on every genuine disabled→enabled transition (confirmed
  // already, same project), including the very first time PanelManager ever shows this
  // menu's panel, using a fully current camera/hand transform at that moment. Stopped
  // again on OnDisableEvent — no reason to keep computing a transform for an invisible menu.
  onAwake(): void {
    this.hand = HandInputData.getInstance().getHand(this.leftHand ? 'left' : 'right')
    this.createEvent('OnEnableEvent').bind(() => {
      this.updateEvent = this.createEvent('UpdateEvent')
      this.updateEvent.bind(() => this.track())
    })
    this.createEvent('OnDisableEvent').bind(() => {
      if (this.updateEvent) this.updateEvent.enabled = false
    })
  }

  private track(): void {
    const t = this.sceneObject.getTransform()

    // TrackedHand.isTracked() is NOT a reliable Preview-vs-device signal on its own —
    // confirmed live: it returns true in Lens Studio Preview against a fixed idle/rest
    // rig (getPalmCenter()/wrist.rotation come back as real numbers, just parked at a
    // meaningless fixed pose, e.g. observed at world (10,-80,0) — nowhere near the
    // camera), not false the way "Preview has no hand tracking" would suggest. That's a
    // narrower claim than it first looks: it's true for the INTERACTOR-level hand data
    // this project already relies on elsewhere (NotePlacer.getPinchPosition() — a
    // HandInteractor's own `.hand` really is absent on Preview's MouseInteractor), but
    // TrackedHand's lower-level isTracked() bridge apparently reports true regardless.
    // global.deviceInfoSystem.isEditor() is the direct, already-proven way this project
    // detects Preview (SessionRecorder.startCameraStream() already uses it for the same
    // reason) — gating on it here, not just isTracked(), is what actually fixes this.
    if (!global.deviceInfoSystem.isEditor() && this.hand && this.hand.isTracked()) {
      const center = this.hand.getPalmCenter()
      if (center) {
        const rot = this.hand.wrist.rotation
        const pos = center
          .add(rot.multiplyVec3(vec3.right()).uniformScale(this.palmOffsetRight))
          .add(rot.multiplyVec3(vec3.up()).uniformScale(this.palmOffsetUp))
          .add(rot.multiplyVec3(vec3.forward()).uniformScale(this.palmOffsetForward))
        t.setWorldPosition(pos)
        t.setWorldRotation(rot)
        return
      }
    }

    // Editor Preview, or a real hand not currently tracked — float at a fixed spot
    // beside the camera instead of on a hand.
    const camT = this.cameraObject.getTransform()
    const camRot = camT.getWorldRotation()
    const camPos = camT.getWorldPosition()
    const pos = camPos
      .add(camRot.multiplyVec3(vec3.right()).uniformScale(this.editorOffsetRight))
      .add(camRot.multiplyVec3(vec3.up()).uniformScale(this.editorOffsetUp))
      .add(camRot.multiplyVec3(vec3.forward()).uniformScale(-this.editorOffsetForward))
    t.setWorldPosition(pos)

    // Facing previously just copied the camera's own rotation — which points the menu's
    // front the SAME direction the camera looks (both "facing" identically), i.e. away
    // from the viewer, not toward them. Every other panel in this app sits at identity
    // rotation with the camera further along +Z, so a readable face at rest points toward
    // +Z (vec3.forward()) — the fix is a real look-at rotation aiming the menu's forward
    // axis back at the camera, not a copy of the camera's own orientation.
    //
    // The look-at's "up" reference is the CAMERA's own current up (camRot.multiplyVec3),
    // not world vec3.up() — confirmed live, on-device, with the fallback wrongly using
    // world-up: three screenshots taken moments apart (looking down at a desk, level, and
    // heavily head-rolled) showed the SAME menu rendering upright-to-the-room in one shot
    // and diamond-rotated ~45° in another, because a world-up-anchored billboard
    // necessarily appears to counter-rotate on screen whenever the viewer's own head
    // rolls — physically correct for a sign bolted to the room, wrong for a UI element
    // that's supposed to read consistently relative to the wearer's current view.
    // Camera-relative up keeps it screen-locked instead: right-side-up to the viewer
    // regardless of how their head is currently oriented.
    const towardCamera = camPos.sub(pos).normalize()
    const camUp = camRot.multiplyVec3(vec3.up())
    const lookRot = quat.lookAt(towardCamera, camUp)
    // A small extra pitch on top of the look-at, so it reads as resting at your side
    // rather than snapped dead level — see editorTiltPitch. Applied in the menu's own
    // local frame after the screen-locked look-at above, so it reads as a consistent
    // "tilted this much relative to your view" regardless of head orientation. No roll
    // (Z) — not needed once the look-at itself is screen-locked.
    const tilt = quat.fromEulerAngles(this.editorTiltPitch * DEG2RAD, 0, 0)
    t.setWorldRotation(lookRot.multiply(tilt))
  }
}
