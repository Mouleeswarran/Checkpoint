import { BackPlate } from 'SpectaclesUIKit.lspkg/Scripts/BackPlate'
import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button'
import Event, { PublicApi } from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { CustomLocationLoader } from '../Site/CustomLocationLoader'
import { StickyNote, NoteType } from './StickyNote'
import { StickyNoteHandMenu } from './StickyNoteHandMenu'
import { supabaseSelect } from '../Backend/SupabaseClient'
import { themeButton, themePanel, styleBackButton } from '../Shared/ThemedUI'
import { COLOR, ButtonTone, HEADER_FONT, BUTTON_FONT, BODY_FONT, BACK_ICON } from '../Shared/Theme'

const TYPE_TONE: Record<NoteType, ButtonTone> = { plain: 'teal', info: 'teal', warning: 'amber', danger: 'danger' }
const PANEL_W = 22
const TYPE_LABELS: Record<NoteType, string> = { plain: 'Plain', info: 'Info', warning: 'Warning', danger: 'Danger' }

interface NoteRow {
  id: string
  type: NoteType
  text_en: string
  anchor_offset: { x: number; y: number; z: number }
}

// SIK unifies input across mouse (Lens Studio Preview) and hand pinch (real device) behind
// one Interactor abstraction, so the same hit-test tracks the pinch point on device and the
// mouse-pointed point in the simulator with no branching. Placement commits directly on a
// pinch/click "trigger start" edge (interactor.isTriggering && !wasTriggering) rather than a
// separate confirm button — but only when that pinch lands in free space, i.e.
// interactor.currentInteractable is null. When it lands ON a UI element (a type button, the
// Cancel button, the menu button) currentInteractable is non-null, so this check naturally
// no-ops and lets that element's own onTriggerUp handle it instead — SIK's InteractionManager
// only ever dispatches TriggerStart/TriggerEnd events to an Interactable, never as a global
// scene event, so a raw free-space pinch has to be read directly off the interactor's own
// trigger state rather than any Interactable-mediated event.
const SIK = require('SpectaclesInteractionKit.lspkg/SIK').SIK
const WorldQueryModuleRef: WorldQueryModule = require('LensStudio:WorldQueryModule')

// Offset pulling a placed note back off the surface it hit, toward whoever placed it.
// Doubles as "the Preview click offset" now (Prompt 70/71) — getPinchPosition() only
// ever returns a real position on-device (Preview's mouse-simulated interactor has no
// hand joints), so this hit-test-plus-pullback branch is what Preview actually exercises
// every time. Bumped from 5 to 20 specifically for that — 5cm was barely perceptible
// pulled off a distant wall, which made "click somewhere" in Preview read as "the note
// lands glued flat to whatever surface you clicked," not offset from the click point.
const HIT_PULLBACK_CM = 20

// Caps how far from the camera a placed note can actually land, regardless of how far
// away the hit surface itself was — HIT_PULLBACK_CM alone only pulls a fixed 20cm off
// whatever was hit, so clicking on a distant wall/table in Preview (the branch this
// always exercises, since there's no real hand/finger data there) could still place a
// note meters away — "too far back" to read or reach. Also used by the no-hit
// camera-forward fallback (was a hardcoded 60), so every Preview placement lands at the
// same comfortable reach no matter which of the three fallback branches actually fires.
const MAX_PLACEMENT_DISTANCE_CM = 45

// Every fixed button (Header/Menu/4 type buttons/Cancel/Status — Place Here is retired,
// see buildPanel) is pre-authored in the editor scene — real Transforms the user can
// select and drag in the Scene panel. This script only wires theme/behavior onto the
// existing objects; it never calls createSceneObject/createComponent for these. Spawned notes are instances
// of the StickyNoteTemplate prefab (Assets/Prefabs/StickyNoteTemplate) rather than
// runtime-built objects — their per-note *content* (text, type, world position) is
// still set at spawn time since it comes from user placement / Supabase, but their
// internal layout is editable on the prefab template like everything else.
@component
export class NotePlacer extends BaseScriptComponent {
  @input
  customLocationLoader!: CustomLocationLoader

  @input
  stickyNoteHandMenu!: StickyNoteHandMenu

  @input
  cameraObject!: SceneObject

  @input
  notePrefab!: ObjectPrefab

  @input
  headerText!: Text

  @input
  menuButton!: Button
  @input
  menuButtonLabel!: Text

  @input
  plainButton!: Button
  @input
  plainButtonLabel!: Text
  @input
  infoButton!: Button
  @input
  infoButtonLabel!: Text
  @input
  warningButton!: Button
  @input
  warningButtonLabel!: Text
  @input
  dangerButton!: Button
  @input
  dangerButtonLabel!: Text

  @input
  placeHereRow!: SceneObject
  @input
  placeHereButton!: Button
  @input
  placeHereButtonLabel!: Text
  @input
  cancelButton!: Button
  @input
  cancelButtonLabel!: Text

  @input
  statusText!: Text

  private currentSiteId: string | null = null
  private currentContentNode: SceneObject | null = null
  private siteUnavailableName: string | null = null
  // Keyed by site_id, not by contentNode — several demo sites share the one real scanned
  // Custom Location (see CustomLocationLoader's Location Mappings), so the same
  // contentNode can end up holding more than one site's notes as children over the
  // course of a session. Doubles as the "have we already loaded this site" check
  // loadedSiteIds used to be, and lets a previously-visited site's notes be hidden
  // (not re-fetched) instead of duplicated when switching back to it.
  private noteObjectsBySite = new Map<string, SceneObject[]>()
  private spawnCount = 0

  private hitTestSession: HitTestSession | null = null
  private armedType: NoteType | null = null
  private lastHitPosition: vec3 | null = null

  private _onBackRequested = new Event<void>()
  get onBackRequested(): PublicApi<void> {
    return this._onBackRequested.publicApi()
  }

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init())
  }

  private init(): void {
    this.buildPanel()

    const options = HitTestSessionOptions.create()
    options.filter = true
    this.hitTestSession = WorldQueryModuleRef.createHitTestSessionWithOptions(options)
    this.hitTestSession.start()

    this.createEvent('UpdateEvent').bind(() => this.onUpdate())

    // Hand menu mirrors the same 4 type buttons already on this panel (see buildPanel's
    // setupTypeButton calls) so a technician can arm a note type without reaching for the
    // floating panel at all — it's a child of this panel's own SceneObject (see
    // StickyNoteHandMenu's own comment), so it opens/closes with this panel for free.
    this.stickyNoteHandMenu.onTypeSelected.add((type) => this.armPlacement(type))

    this.customLocationLoader.onLocationActivated.add((activation) => {
      this.siteUnavailableName = null
      this.currentSiteId = activation.siteId
      this.currentContentNode = activation.contentNode
      this.spawnCount = 0

      // Hide every OTHER site's notes before showing this one's — without this, two
      // sites sharing the same physical Custom Location (see the field comment above)
      // show a mixed pile of both sites' notes the moment the second one is opened,
      // since they're siblings under the very same contentNode and nothing ever
      // removed the first site's when the second's got added.
      for (const [siteId, objs] of this.noteObjectsBySite) {
        if (siteId === activation.siteId) continue
        for (const obj of objs) {
          if (!isNull(obj)) obj.enabled = false
        }
      }

      const mine = this.noteObjectsBySite.get(activation.siteId)
      if (mine) {
        for (const obj of mine) {
          if (!isNull(obj)) obj.enabled = true
        }
      } else {
        this.noteObjectsBySite.set(activation.siteId, [])
        this.loadExistingNotes(activation.siteId, activation.contentNode)
      }
    })

    // A site can be selected but have no scanned Custom Location yet (not onboarded) —
    // without this, armPlacement()'s "Select a site first" fires even though a site
    // *was* picked, which reads as a bug rather than what it actually is.
    this.customLocationLoader.onLocationUnavailable.add((info) => {
      this.currentSiteId = null
      this.currentContentNode = null
      this.siteUnavailableName = info.siteName
    })
  }

  // Continuously tracks where the current interactor (mouse ray in Preview, pinch ray on
  // device) is pointing while a note type is armed, via WorldQuery surface hit-testing, and
  // commits placement the instant a pinch starts in free space (see the SIK require comment
  // above for why this is read off raw interactor trigger state rather than an event).
  private onUpdate(): void {
    if (!this.armedType) return
    const interactor = SIK.InteractionManager.getTargetingInteractors().shift()
    if (!interactor || !interactor.isActive() || !interactor.isTargeting()) {
      this.lastHitPosition = null
      return
    }
    this.hitTestSession?.hitTest(interactor.startPoint, interactor.endPoint, (result: WorldQueryHitTestResult | null) => {
      this.lastHitPosition = result ? result.position : null
    })

    // Commits on any free-space pinch, not only one that lands on a real surface —
    // commitPlacement() already falls back to a point camera-forward of the user when
    // there's no hand pinch point or hit position (open air, no scanned mesh under the
    // ray, or Preview with no room mesh at all), so requiring a hit here would make
    // placement silently do nothing in exactly those cases instead of placing the note
    // in front of the user.
    if (interactor.isTriggering && !interactor.wasTriggering && !interactor.currentInteractable) {
      this.commitPlacement(interactor)
    }
  }

  // The actual join point of index finger and thumb, not the surface a pinch ray happens
  // to be pointing at — a note should appear right where the technician's fingers are,
  // like they physically stuck it there, not projected onto whatever wall/object was
  // behind their hand. Only real HandInteractors (on-device pinch) expose joint data;
  // Preview's mouse-simulated interactor has none, so this returns null there and
  // commitPlacement() falls through to the existing hit-test/camera-forward behavior.
  private getPinchPosition(interactor: unknown): vec3 | null {
    const hand = (interactor as { hand?: { thumbTip?: { position: vec3 }; indexTip?: { position: vec3 } } })?.hand
    if (!hand?.thumbTip || !hand?.indexTip) return null
    return hand.thumbTip.position.add(hand.indexTip.position).uniformScale(0.5)
  }

  private commitPlacement(interactor: unknown): void {
    if (!this.armedType) return
    const type = this.armedType
    const camTransform = this.cameraObject.getTransform()

    let worldPos: vec3
    const pinchPos = this.getPinchPosition(interactor)
    if (pinchPos) {
      worldPos = pinchPos
    } else if (this.lastHitPosition) {
      const camPos = camTransform.getWorldPosition()
      const towardCamera = camPos.sub(this.lastHitPosition).normalize()
      const pulled = this.lastHitPosition.add(towardCamera.uniformScale(HIT_PULLBACK_CM))
      // Still too far even after the pullback (a distant wall/table) — clamp to the max
      // reach along the same ray instead of leaving it wherever the pullback landed.
      worldPos =
        camPos.distance(pulled) > MAX_PLACEMENT_DISTANCE_CM
          ? camPos.sub(towardCamera.uniformScale(MAX_PLACEMENT_DISTANCE_CM))
          : pulled
    } else {
      const forward = camTransform.getWorldRotation().multiplyVec3(vec3.forward())
      worldPos = camTransform.getWorldPosition().add(forward.uniformScale(-MAX_PLACEMENT_DISTANCE_CM))
    }
    this.spawnNote(type, worldPos)
    this.cancelPlacement()
  }

  private cancelPlacement(): void {
    this.armedType = null
    this.lastHitPosition = null
    this.placeHereRow.enabled = false
    this.statusText.text = ''
  }

  private buildPanel(): void {
    const backPlate = this.sceneObject.getComponent(BackPlate.getTypeName()) as BackPlate
    themePanel(backPlate, COLOR.panelBg)
    backPlate.size = new vec2(PANEL_W, 28)

    this.headerText.text = 'Add Sticky Note'
    this.headerText.depthTest = true
    this.headerText.font = HEADER_FONT
    this.headerText.size = 41
    ;(this.headerText as Text & { weight?: number }).weight = 700
    this.headerText.horizontalAlignment = HorizontalAlignment.Center
    this.headerText.verticalAlignment = VerticalAlignment.Center
    this.headerText.horizontalOverflow = HorizontalOverflow.Overflow
    this.headerText.verticalOverflow = VerticalOverflow.Overflow
    const innerW = PANEL_W - 3.2
    this.headerText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -2, 2)

    styleBackButton(this.menuButton, this.menuButtonLabel, BACK_ICON)
    this.menuButton.onTriggerUp.add(() => this._onBackRequested.invoke())

    const w = (PANEL_W - 3.2 - 1.0) / 2
    this.setupTypeButton(this.plainButton, this.plainButtonLabel, 'plain', w)
    this.setupTypeButton(this.infoButton, this.infoButtonLabel, 'info', w)
    this.setupTypeButton(this.warningButton, this.warningButtonLabel, 'warning', w)
    this.setupTypeButton(this.dangerButton, this.dangerButtonLabel, 'danger', w)

    // Placement now commits on a free-space pinch (see onUpdate) instead of a "Place
    // Here" button tap, so that button is retired — permanently hidden rather than
    // removed, since its @input is still wired in the editor scene. Cancel is the only
    // remaining control in the row, re-centered onto the middle of the panel.
    this.placeHereButton.sceneObject.enabled = false

    themeButton(this.cancelButton, 'teal')
    this.cancelButton.size = new vec3(w * 2 + 1.0, 3.0, 1)
    this.styleLabel(this.cancelButtonLabel, 'Cancel', w * 2 + 0.5)
    this.cancelButton.onTriggerUp.add(() => this.cancelPlacement())

    this.placeHereRow.enabled = false

    this.statusText.text = ''
    this.statusText.depthTest = true
    this.statusText.font = BODY_FONT
    this.statusText.size = 38
    ;(this.statusText as Text & { weight?: number }).weight = 500
    this.statusText.textFill.color = new vec4(1, 1, 1, 0.55)
    this.statusText.horizontalAlignment = HorizontalAlignment.Center
    this.statusText.verticalAlignment = VerticalAlignment.Center
    this.statusText.horizontalOverflow = HorizontalOverflow.Overflow
    this.statusText.verticalOverflow = VerticalOverflow.Overflow
    this.statusText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -1, 1)
  }

  private setupTypeButton(btn: Button, label: Text, type: NoteType, widthCM: number): void {
    themeButton(btn, TYPE_TONE[type])
    btn.size = new vec3(widthCM, 3.0, 1)
    this.styleLabel(label, '+ ' + TYPE_LABELS[type], widthCM - 0.5)
    btn.onTriggerUp.add(() => this.armPlacement(type))
  }

  private styleLabel(t: Text, text: string, widthCM: number): void {
    t.text = text
    t.depthTest = true
    t.font = BUTTON_FONT
    t.size = 39
    ;(t as Text & { weight?: number }).weight = 500
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.2, 1.2)
  }

  // Public — called both by this panel's own type buttons (setupTypeButton) and by
  // StickyNoteHandMenu's onTypeSelected, per the request that the hand menu should arm
  // placement the same way the floating panel's own buttons already do, not duplicate
  // this logic.
  armPlacement(type: NoteType): void {
    if (!this.currentSiteId || !this.currentContentNode) {
      this.statusText.text = this.siteUnavailableName
        ? `"${this.siteUnavailableName}" isn't set up for notes yet — it needs a Custom Location scan`
        : 'Select a site first'
      return
    }
    this.armedType = type
    this.lastHitPosition = null
    this.placeHereRow.enabled = true
    this.statusText.text = `Point at a spot and pinch to place your ${TYPE_LABELS[type].toLowerCase()} note`
  }

  private spawnNote(type: NoteType, worldPos: vec3): void {
    if (!this.currentSiteId || !this.currentContentNode) return
    this.spawnCount++
    const noteObj = this.notePrefab.instantiate(this.currentContentNode)
    noteObj.getTransform().setWorldPosition(worldPos)
    const note = noteObj.getComponent(StickyNote.getTypeName()) as StickyNote
    note.init({ type, siteId: this.currentSiteId, isNew: true })
    this.trackNoteObject(this.currentSiteId, noteObj)
  }

  private trackNoteObject(siteId: string, noteObj: SceneObject): void {
    const list = this.noteObjectsBySite.get(siteId)
    if (list) list.push(noteObj)
    else this.noteObjectsBySite.set(siteId, [noteObj])
  }

  private async loadExistingNotes(siteId: string, contentNode: SceneObject): Promise<void> {
    const { data, error } = await supabaseSelect<NoteRow>(
      'notes',
      `select=id,type,text_en,anchor_offset&site_id=eq.${siteId}&deleted=eq.false`
    )
    if (error) {
      print('[NotePlacer] Failed to load notes: ' + error)
      return
    }
    for (const row of data ?? []) {
      const noteObj = this.notePrefab.instantiate(contentNode)
      noteObj
        .getTransform()
        .setLocalPosition(new vec3(row.anchor_offset.x, row.anchor_offset.y, row.anchor_offset.z))
      const note = noteObj.getComponent(StickyNote.getTypeName()) as StickyNote
      note.init({ type: row.type, siteId, isNew: false, noteId: row.id, text: row.text_en })
      this.trackNoteObject(siteId, noteObj)
    }
  }
}
