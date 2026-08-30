import { NameEntryPanel } from './NameEntryPanel'
import { hasTechnicianName } from './TechnicianIdentity'
import { SitePicker } from '../Site/SitePicker'
import { NotePlacer } from '../Notes/NotePlacer'
import { SessionRecorder } from '../Session/SessionRecorder'
import { HistoryPanel } from '../Session/HistoryPanel'
import { SessionContextPanel } from '../Session/SessionContextPanel'
import { MainMenu } from './MainMenu'

// Central gate keeping the app's top-level windows mutually exclusive — only one of
// Name / Site / Menu / Notes / Session / History / Ask AI is enabled at a time, so
// windows "pop up one by one" instead of every panel floating in view simultaneously.
//
// Deliberately NOT part of this exclusive set: sticky notes (each is anchored to a real
// physical spot in the world — several must stay visible together, that's the point) and
// ImageViewer (an intentional overlay that pops up ON TOP of History, not a replacement
// for it — see Prompt 28 in the prompt log).
type PanelKey = 'name' | 'site' | 'menu' | 'notes' | 'session' | 'history' | 'ask'

@component
export class PanelManager extends BaseScriptComponent {
  @input
  nameEntryPanel!: NameEntryPanel

  @input
  sitePicker!: SitePicker

  @input
  mainMenu!: MainMenu

  @input
  notePlacer!: NotePlacer

  @input
  sessionRecorder!: SessionRecorder

  @input
  historyPanel!: HistoryPanel

  @input
  sessionContextPanel!: SessionContextPanel

  // Used once, at boot, to bring the whole flat-panel menu scene in front of wherever
  // the technician is actually standing/facing — see placeMenuInFrontOfUser().
  @input
  cameraObject!: SceneObject

  // Anything else that should move with the group but isn't one of the mutually
  // exclusive panels above (e.g. ImageViewerUI, which floats beside HistoryUI at its
  // own authored offset) — wire in the Inspector.
  @input
  @allowUndefined
  extraRoots: SceneObject[] = []

  private hasChosenSite = false

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init())
  }

  private init(): void {
    // Deferred, not called inline here — confirmed live: DeviceTracking's camera pose
    // isn't necessarily settled yet on the very first frame (same class of timing gap
    // HandAttach's own comment already flags for this exact camera — "the camera
    // transform may not be fully settled yet"). Calling placeMenuInFrontOfUser()
    // synchronously in this same OnStartEvent tick placed the menu relative to whatever
    // stale/default pose the camera had before tracking delivered its first real update,
    // not the technician's actual position — reproduced live, the menu landed nowhere
    // near where the camera ended up moments later. A short real delay gives tracking a
    // frame or several to settle first.
    const placeMenu = this.createEvent('DelayedCallbackEvent')
    placeMenu.bind(() => this.placeMenuInFrontOfUser())
    placeMenu.reset(0.2)

    this.nameEntryPanel.onSaved.add(() => this.show('site'))
    this.sitePicker.onSiteSelected.add(() => {
      this.hasChosenSite = true
      this.show('menu')
    })
    this.sitePicker.onBackRequested.add(() => this.show('menu'))
    this.sitePicker.onChangeNameRequested.add(() => this.show('name'))
    this.mainMenu.onNavigate.add((target) => this.show(target))
    this.notePlacer.onBackRequested.add(() => this.show('menu'))
    this.sessionRecorder.onBackRequested.add(() => this.show('menu'))
    this.sessionRecorder.onAskAIRequested.add(() => this.show('ask'))
    this.historyPanel.onBackRequested.add(() => this.show('menu'))
    this.historyPanel.onAskAIRequested.add(() => this.show('ask'))
    this.sessionContextPanel.onBackRequested.add(() => this.show('menu'))

    // A name persisted on-device (see TechnicianIdentity) means this is a returning
    // technician on the same Specs — skip straight to site selection instead of
    // asking them to re-type their name on every launch.
    this.show(hasTechnicianName() ? 'site' : 'name')
  }

  // Every top-level panel (NameUI, UI/SitePicker, MenuUI, NotesUI, SessionUI, HistoryUI,
  // AskAIUI, plus ImageViewerUI via extraRoots) is authored as a scene-root SceneObject
  // at a fixed world position — e.g. (0, 0, -110), on the assumption the camera starts
  // at the world origin facing -Z, matching Lens Studio's default Camera Object rest
  // pose. That assumption doesn't hold in practice: on-device, DeviceTracking's world
  // origin is wherever tracking happened to initialize, not necessarily where or which
  // way the technician is actually facing when they first look at the menu; in Preview,
  // a long session's camera can drift far from the origin entirely (confirmed live —
  // one query mid-session read back a camera world position over 9000 units from
  // origin). Either way, a fixed (0,0,-110) menu can end up anywhere from "slightly
  // off-center" to "nowhere near the technician's actual view."
  //
  // Run once, at boot, before any panel is ever shown — not continuously (that would be
  // HandAttach's job, and would make a whole flat menu scene drift/wobble with head
  // movement, which is disorienting for something meant to sit still once placed).
  // Treats each panel's CURRENT (authored) world position/rotation as if it were
  // expressed relative to a camera sitting at identity at the origin — exactly the
  // scenario these panels were actually authored under — and re-expresses that same
  // relative offset against the camera's REAL current world pose instead, the same
  // math HandAttach's own editor-fallback branch uses for a single object, just applied
  // once here to the whole group so every panel keeps its relative position to the
  // others (the group moves and turns together as one rigid arrangement).
  private placeMenuInFrontOfUser(): void {
    const camT = this.cameraObject.getTransform()
    const camPos = camT.getWorldPosition()
    const camRot = camT.getWorldRotation()

    const roots = [
      this.nameEntryPanel.sceneObject,
      this.sitePicker.sceneObject,
      this.mainMenu.sceneObject,
      this.notePlacer.sceneObject,
      this.sessionRecorder.sceneObject,
      this.historyPanel.sceneObject,
      this.sessionContextPanel.sceneObject,
      ...this.extraRoots,
    ]

    for (const obj of roots) {
      const t = obj.getTransform()
      const authoredPos = t.getWorldPosition()
      const authoredRot = t.getWorldRotation()
      t.setWorldPosition(camPos.add(camRot.multiplyVec3(authoredPos)))
      t.setWorldRotation(camRot.multiply(authoredRot))
    }
  }

  private show(key: PanelKey): void {
    this.nameEntryPanel.sceneObject.enabled = key === 'name'
    this.sitePicker.sceneObject.enabled = key === 'site'
    // Starts the GPS search/site-load exactly when Site Picker is actually about to be
    // shown, not whenever the Lens happened to boot — see beginSearch()'s own comment for
    // why that distinction matters. Guarded internally to run only once ever, so this is
    // a harmless no-op on every later "Switch Site" reopen.
    if (key === 'site') this.sitePicker.beginSearch()
    this.mainMenu.sceneObject.enabled = key === 'menu'
    this.notePlacer.sceneObject.enabled = key === 'notes'
    this.sessionRecorder.sceneObject.enabled = key === 'session'
    this.historyPanel.sceneObject.enabled = key === 'history'
    this.sessionContextPanel.sceneObject.enabled = key === 'ask'
    this.sitePicker.setBackVisible(key === 'site' && this.hasChosenSite)
  }
}
