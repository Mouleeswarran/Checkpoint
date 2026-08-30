import { COLOR, BODY_FONT } from '../Shared/Theme'

const GPS_ICON = requireAsset('../../Icons/radar.png') as Texture
const imageMaterial = requireAsset('../../Materials/ImageMaterial.mat') as Material

const SPIN_DEG_PER_SEC = 120
const PULSE_SPEED = 3.0
const PULSE_AMOUNT = 0.08
const BASE_SCALE = 2.4
const CONFIRMED_SCALE = 5.0
// Gap below the icon's bottom edge at CONFIRMED_SCALE, so the label never sits inside
// the icon's own footprint — the collision that made the confirmation state a mess
// when the label was at a fixed offset that only cleared the small idle icon size.
const LABEL_GAP = 0.8
const SCALE_ANIM_MS = 450
const HOLD_MS = 1400

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Small top-right "searching" badge for SitePicker — a continuously spinning radar
// glyph (the "unique GPS animation") with a gentle breathing pulse while a location fix
// is pending. When a site is confirmed as the one the technician is standing at,
// showFound() takes over: stops spinning, grows the icon into a prominent centerpiece,
// slides the whole badge from the corner to top-center (so the label has panel-width
// room instead of running off the right edge), and swaps in a "Loading your '<site>'
// site" label — the visual cue that a match was found and the app is about to jump
// straight into that site, no tap needed.
@component
export class GpsIndicator extends BaseScriptComponent {
  @input
  icon!: Image

  @input
  label!: Text

  private spinning = false
  private rotationDeg = 0
  private iconTransform!: Transform
  private rootTransform!: Transform
  private idleLocalPosition!: vec3

  onAwake(): void {
    // Set up synchronously in OnAwake, not OnStartEvent — SitePicker.init() (itself an
    // OnStartEvent handler, on the parent object) calls startSearching() as one of its
    // first actions, and parent OnStartEvents fire before their children's. Waiting for
    // this component's own OnStartEvent left iconTransform unset when that call arrived
    // ("Cannot read property 'setLocalScale' of undefined"). @input fields (icon/label)
    // are already injected by the time OnAwake runs, so nothing here needs to wait.
    this.init()
    this.createEvent('UpdateEvent').bind(() => this.onUpdate())
  }

  private init(): void {
    this.iconTransform = this.icon.sceneObject.getTransform()
    this.rootTransform = this.sceneObject.getTransform()
    this.idleLocalPosition = this.rootTransform.getLocalPosition()

    const mat = imageMaterial.clone()
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
    mat.mainPass.baseTex = GPS_ICON
    mat.mainPass.baseColor = COLOR.amberBright
    this.icon.clearMaterials()
    this.icon.addMaterial(mat)
    this.iconTransform.setLocalScale(new vec3(BASE_SCALE, BASE_SCALE, 1))

    this.label.text = ''
    this.label.depthTest = true
    this.label.font = BODY_FONT
    this.label.size = 34
    ;(this.label as Text & { weight?: number }).weight = 500
    this.label.textFill.color = COLOR.textSecondary
    this.label.horizontalAlignment = HorizontalAlignment.Center
    this.label.verticalAlignment = VerticalAlignment.Center
    this.label.horizontalOverflow = HorizontalOverflow.Wrap
    this.label.verticalOverflow = VerticalOverflow.Overflow
    // Wide enough for the longest realistic confirmation message ("Loading your
    // "Northgate Facility" site") to wrap onto at most two lines once the badge is
    // centered — see showFound(). Positioned to clear CONFIRMED_SCALE's full radius
    // plus LABEL_GAP, computed from the same constants the scale animation uses so a
    // future size change can't silently reintroduce the icon/label overlap.
    this.label.sceneObject.getTransform().setLocalPosition(new vec3(0, -(CONFIRMED_SCALE / 2 + LABEL_GAP), 0.1))
    this.label.layoutRect = Rect.create(-9, 9, -1.5, 1.5)
  }

  startSearching(): void {
    this.spinning = true
    this.iconTransform.setLocalScale(new vec3(BASE_SCALE, BASE_SCALE, 1))
    this.label.text = ''
  }

  stopSearching(): void {
    this.spinning = false
    this.iconTransform.setLocalRotation(quat.fromEulerAngles(0, 0, 0))
    this.iconTransform.setLocalScale(new vec3(BASE_SCALE, BASE_SCALE, 1))
  }

  // Instantly undoes everything showFound() leaves behind — the grown icon, the
  // slid-to-center badge position, and the "Loading your..." label — none of which
  // stopSearching() touches (it only handles the spin/scale from the *searching* state,
  // not the *confirmed* state). Needed because SitePicker.init() (and so this component's
  // own state) only ever runs once; re-showing the panel via "Switch Site" after an
  // earlier auto-select left the confirmation visual stuck on screen with nothing to
  // clear it. No animation — this is a housekeeping reset for a panel becoming visible
  // again, not a live transition the technician is watching happen.
  resetToIdle(): void {
    this.spinning = false
    this.label.text = ''
    this.iconTransform.setLocalRotation(quat.fromEulerAngles(0, 0, 0))
    this.iconTransform.setLocalScale(new vec3(BASE_SCALE, BASE_SCALE, 1))
    this.rootTransform.setLocalPosition(this.idleLocalPosition)
  }

  // Stops the spin, grows the icon into a centerpiece, and shows the "loading your
  // site" text. Resolves once the confirmation has been on screen long enough to read —
  // callers should await this before actually navigating away, so the confirmation is
  // seen rather than instantly replaced by the next panel.
  async showFound(siteName: string): Promise<void> {
    this.spinning = false
    this.label.text = `Loading your "${siteName}" site`

    const startScale = this.iconTransform.getLocalScale().x
    const startPos = this.rootTransform.getLocalPosition()
    // Slides from the corner to horizontally centered (keeping the same y/z, still
    // floating above the panel) — the corner spot only has room for the small idle
    // icon; centering it is what gives the grown icon and its label panel-width space
    // instead of running off the right edge.
    const targetX = 0
    const startTime = getTime()
    await new Promise<void>((resolve) => {
      const ev = this.createEvent('UpdateEvent')
      ev.bind(() => {
        const t = Math.min(1, (getTime() - startTime) / (SCALE_ANIM_MS / 1000))
        const eased = 1 - Math.pow(1 - t, 3)
        const scale = startScale + (CONFIRMED_SCALE - startScale) * eased
        this.iconTransform.setLocalScale(new vec3(scale, scale, 1))
        this.rootTransform.setLocalPosition(
          new vec3(startPos.x + (targetX - startPos.x) * eased, this.idleLocalPosition.y, this.idleLocalPosition.z)
        )
        if (t >= 1) {
          ev.enabled = false
          resolve()
        }
      })
    })

    await wait(HOLD_MS)
  }

  private onUpdate(): void {
    if (!this.spinning) return
    this.rotationDeg = (this.rotationDeg + SPIN_DEG_PER_SEC * getDeltaTime()) % 360
    this.iconTransform.setLocalRotation(quat.fromEulerAngles(0, 0, (-this.rotationDeg * Math.PI) / 180))

    const pulse = 1 + Math.sin(getTime() * PULSE_SPEED) * PULSE_AMOUNT
    this.iconTransform.setLocalScale(new vec3(BASE_SCALE * pulse, BASE_SCALE * pulse, 1))
  }
}
