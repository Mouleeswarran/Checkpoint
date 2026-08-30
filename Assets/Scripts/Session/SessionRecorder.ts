import { BackPlate } from 'SpectaclesUIKit.lspkg/Scripts/BackPlate'
import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button'
import { ScrollWindow } from 'SpectaclesUIKit.lspkg/Scripts/Components/ScrollWindow/ScrollWindow'
import { TextInputArea } from 'SpectaclesUIKit.lspkg/Scripts/Components/TextInputArea/TextInputArea'
import { OverflowMode } from 'SpectaclesUIKit.lspkg/Scripts/Components/TextInput/TextInputConsts'
import Event, { PublicApi } from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { SitePicker } from '../Site/SitePicker'
import { WorkSessionHandMenu } from './WorkSessionHandMenu'
import { supabaseInsert, supabaseUpdate, supabaseUploadBytes } from '../Backend/SupabaseClient'
import { getTechnicianName } from '../Shared/TechnicianIdentity'
import { releaseSharedMic } from '../Shared/AsrSession'
import { IncrementalTranscript } from '../Shared/IncrementalTranscript'
import { ConfirmPopup } from '../Shared/ConfirmPopup'
import { themeButton, themePanel, styleBackButton, setButtonIcon } from '../Shared/ThemedUI'
import { COLOR, HEADER_FONT, BUTTON_FONT, BODY_FONT, BACK_ICON } from '../Shared/Theme'

const EDIT_ICON = requireAsset('../../Icons/edit.png') as Texture

const PANEL_W = 22
// After this many consecutive ASR failures, stop retrying and tell the technician —
// recording (image capture, the session row) keeps running either way, only narration
// transcription stops.
const MAX_LISTEN_RETRIES = 3
// The scrollable transcript view fills the panel's own empty lower half (confirmed live
// — statusText sits at y=-0.8, the panel's bottom edge at y=-9, nothing else down there
// at all) rather than resizing the panel or moving any of its pre-authored siblings.
const TRANSCRIPT_VIEWPORT_Y = -4.5
const TRANSCRIPT_VIEWPORT_H = 6.5
// Narration now saves on a wall-clock timer instead of once per finalized phrase — a
// technician who narrates in many short phrases was writing a Supabase row every few
// seconds; once a minute is still frequent enough that a crash mid-session loses at most
// a minute of narration (the in-memory transcript, and so the live view, never loses
// anything regardless of save cadence — see IncrementalTranscript), while cutting write
// volume dramatically for a long session.
const TRANSCRIPT_SAVE_INTERVAL_S = 60

export interface SessionEnded {
  sessionId: string
  siteId: string
}

// Header/Menu/Record/Capture/Status are pre-authored in the editor scene — real
// Transforms the user can select and drag in the Scene panel. This script only wires
// theme/behavior onto the existing objects; it never calls createSceneObject/
// createComponent for these.
@component
export class SessionRecorder extends BaseScriptComponent {
  @input
  sitePicker!: SitePicker

  @input
  workSessionHandMenu!: WorkSessionHandMenu

  @input
  headerText!: Text

  @input
  menuButton!: Button
  @input
  menuButtonLabel!: Text

  @input
  recordButton!: Button
  @input
  recordButtonLabel!: Text

  @input
  captureButton!: Button
  @input
  captureButtonLabel!: Text

  @input
  statusText!: Text

  // Runtime-created, not pre-authored like the fields above — see buildPanel(). A
  // separate line near the top of the panel for capture-only messages ("Captured image
  // N", "Camera warming up...", "Capture failed"), which used to share statusText with
  // the live transcript caption. Every Capture tap was clobbering whatever narration was
  // showing — the technician would look down mid-sentence and see "Captured image 3"
  // instead of what they were just saying, with no way to tell if narration was even
  // still running underneath it.
  private captureStatusText!: Text

  // Grows across the WHOLE recording session (not reset per phrase, and not reset on
  // mic error/retry — only on a brand new Start) — see its own class comment for why a
  // flat `this.text = e.text` would silently drop everything said before a pause.
  private transcript = new IncrementalTranscript()
  private transcriptText!: Text
  private transcriptScroll!: ScrollWindow
  // TextInputArea, not TextInputField — a single-line field horizontally-scrolls to
  // follow the caret, which makes it near-impossible to find a specific word in a long
  // narration (you can only ever see a few characters of context around the caret). This
  // wraps into paragraphs exactly like the read-only transcript view above it, and
  // auto-scrolls to keep the caret visible as you tap/drag through it — same native
  // system-keyboard cursor placement and pinch-drag selection as before, just readable.
  private editField!: TextInputArea
  private editButton!: Button
  // Snapshot of the transcript text taken the moment Edit is opened — compared against
  // the field's text on close so a close with no actual change skips persistTranscript()
  // entirely instead of writing an identical row to Supabase every time.
  private editOriginalText = ''
  // One consolidated `session_captures` row per recording session — inserted once on
  // the first save, then upserted (never a second row) as narration grows or gets
  // manually edited. Was previously one INSERT per finalized phrase; consolidated per
  // explicit request so a manual edit has exactly one row to reconcile with instead of
  // needing to decide how it interacts with N already-written ones.
  private transcriptRowId: string | null = null
  // Drives the once-a-minute save while recording — see TRANSCRIPT_SAVE_INTERVAL_S's own
  // comment. Created once and reused across recordings; toggleRecording() calls reset()
  // to (re)start the chain on Start and cancel() to stop it on Stop.
  private transcriptSaveTimer: DelayedCallbackEvent | null = null
  private confirmPopup!: ConfirmPopup

  private currentSiteId: string | null = null
  private sessionId: string | null = null
  private isRecording = false
  private isListening = false
  private captureCount = 0
  // Consecutive ASR failures since the last successful transcript — startListeningLoop()
  // used to retry immediately and unconditionally on any error, which for a persistent
  // failure (mic permissions, a stuck prior ASR session, no internet) meant a silent,
  // instant, infinite retry loop: "Recording... narrate your work" stayed on screen the
  // whole time with no indication anything was wrong. Capped and surfaced now.
  private listenErrorStreak = 0

  private asrModule: AsrModule = require('LensStudio:AsrModule')
  private cameraModule: CameraModule = require('LensStudio:CameraModule')
  private cameraTexture: Texture | null = null

  private _onSessionEnded = new Event<SessionEnded>()
  get onSessionEnded(): PublicApi<SessionEnded> {
    return this._onSessionEnded.publicApi()
  }

  private _onBackRequested = new Event<void>()
  get onBackRequested(): PublicApi<void> {
    return this._onBackRequested.publicApi()
  }

  // Fired by the hand menu's Ask AI button — mirrors HistoryPanel's own onAskAIRequested
  // (already wired in PanelManager to show('ask')), so tapping it jumps straight to the
  // Ask AI panel instead of needing to back out to Main Menu first.
  private _onAskAIRequested = new Event<void>()
  get onAskAIRequested(): PublicApi<void> {
    return this._onAskAIRequested.publicApi()
  }

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init())
  }

  private init(): void {
    this.sitePicker.onSiteSelected.add((selection) => {
      this.currentSiteId = selection.siteId
    })
    this.buildPanel()

    // Hand menu mirrors this panel's own Record/Capture buttons plus a new Ask AI
    // shortcut — it's a child of this panel's own SceneObject (see WorkSessionHandMenu's
    // own comment), so it opens/closes with this panel for free. Fires named events only;
    // this script still owns every bit of the actual logic.
    this.workSessionHandMenu.onRecordTapped.add(() => this.toggleRecording())
    this.workSessionHandMenu.onCaptureTapped.add(() => this.captureImage())
    this.workSessionHandMenu.onAskAITapped.add(() => this._onAskAIRequested.invoke())
  }

  private buildPanel(): void {
    const backPlate = this.sceneObject.getComponent(BackPlate.getTypeName()) as BackPlate
    themePanel(backPlate, COLOR.panelBg)
    backPlate.size = new vec2(PANEL_W, 18)

    const innerW = PANEL_W - 3.2

    this.headerText.text = 'Work Session'
    this.headerText.depthTest = true
    this.headerText.font = HEADER_FONT
    this.headerText.size = 41
    ;(this.headerText as Text & { weight?: number }).weight = 700
    this.headerText.horizontalAlignment = HorizontalAlignment.Center
    this.headerText.verticalAlignment = VerticalAlignment.Center
    this.headerText.horizontalOverflow = HorizontalOverflow.Overflow
    this.headerText.verticalOverflow = VerticalOverflow.Overflow
    this.headerText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -2, 2)

    styleBackButton(this.menuButton, this.menuButtonLabel, BACK_ICON)
    this.menuButton.onTriggerUp.add(() => this.handleBackTapped())

    const w = (innerW - 1.0) / 2
    themeButton(this.recordButton, 'danger')
    this.recordButton.size = new vec3(w, 3.0, 1)
    this.styleLabel(this.recordButtonLabel, 'Start', w - 0.5)
    this.recordButton.onTriggerUp.add(() => this.toggleRecording())

    themeButton(this.captureButton, 'teal')
    this.captureButton.size = new vec3(w, 3.0, 1)
    this.styleLabel(this.captureButtonLabel, 'Capture', w - 0.5)
    this.captureButton.onTriggerUp.add(() => this.captureImage())

    this.statusText.text = 'Not recording'
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

    // Sits between the header (~10.2) and the Record/Capture row (2.4) — plenty of clear
    // space there already, confirmed by querying the panel's actual authored layout
    // rather than guessing. Parented under the same Content node the header/buttons live
    // in, matching their coordinate space.
    const contentNode = this.headerText.sceneObject.getParent()
    const captureStatusObj = global.scene.createSceneObject('CaptureStatus')
    captureStatusObj.setParent(contentNode)
    captureStatusObj.getTransform().setLocalPosition(new vec3(0, 6.3, 0))
    this.captureStatusText = captureStatusObj.createComponent('Component.Text') as Text
    this.captureStatusText.text = ''
    this.captureStatusText.depthTest = true
    this.captureStatusText.font = BODY_FONT
    this.captureStatusText.size = 34
    ;(this.captureStatusText as Text & { weight?: number }).weight = 500
    // Teal, not the neutral gray statusText uses — a distinct color reinforces that this
    // is a separate, secondary line rather than a continuation of the narration caption.
    this.captureStatusText.textFill.color = COLOR.tealBright
    this.captureStatusText.horizontalAlignment = HorizontalAlignment.Center
    this.captureStatusText.verticalAlignment = VerticalAlignment.Center
    this.captureStatusText.horizontalOverflow = HorizontalOverflow.Overflow
    this.captureStatusText.verticalOverflow = VerticalOverflow.Overflow
    this.captureStatusText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -1, 1)

    this.buildTranscriptView(innerW, contentNode)

    // Centered on the panel itself (not contentNode), pushed well forward so it always
    // draws in front of everything else here, including TranscriptEditButton/Field.
    this.confirmPopup = new ConfirmPopup(this.sceneObject, innerW - 1, 4)
  }

  // Recording (or leftover narration text) used to just keep running silently in the
  // background if the technician tapped back mid-session — no warning, no way to tell
  // without navigating back to check. Now: nothing at risk, back works instantly same as
  // before; otherwise a confirm popup explains what leaving will do before it happens.
  private handleBackTapped(): void {
    const atRisk = this.isRecording || this.transcript.text.trim().length > 0
    if (!atRisk) {
      this._onBackRequested.invoke()
      return
    }
    this.confirmPopup.show(
      this.isRecording
        ? 'Recording is still running. Leaving will stop and save the session, and clear this view.'
        : "This session's narration hasn't been cleared yet. Leaving will discard it from this view.",
      () => {
        if (this.isRecording) {
          // clearAfterStop:true — the transcript still needs to survive long enough for
          // the stop's own final persistTranscript() to upload it; clearing it here first
          // would upload an empty row. toggleRecording() clears it itself once that save
          // actually completes. See toggleRecording()'s own comment.
          this.toggleRecording(true)
        } else {
          // Already stopped — any save from the last Stop or Edit has long since
          // completed, so it's safe to clear immediately.
          this.transcript.reset()
          this.transcriptRowId = null
          this.updateTranscriptDisplay()
        }
        this._onBackRequested.invoke()
      }
    )
  }

  // A scrollable, multi-line view of the WHOLE session's narration so far, filling the
  // panel's own otherwise-empty lower half (see TRANSCRIPT_VIEWPORT_Y/H's own comment).
  // statusText above it goes back to being purely a state line ("Recording...", "Session
  // saved", etc.) — the live transcript used to share that one-line field, truncated to
  // its last ~60 characters; this shows everything, and scrolls.
  private buildTranscriptView(innerW: number, contentNode: SceneObject): void {
    // ScrollWindow resets its OWN SceneObject's local position to (0,0,0) the instant
    // the component is created — confirmed scene-wide, not just here (every ScrollWindow
    // in this project, including StickyNote's own BodyScrollWindow, sits at local
    // (0,0,0) regardless of what's set beforehand). A separate wrapping anchor object
    // carries the real position instead; the ScrollWindow lives inside it at (0,0,0),
    // which is exactly what it wants anyway.
    const anchorObj = global.scene.createSceneObject('TranscriptScrollAnchor')
    anchorObj.setParent(contentNode)
    anchorObj.getTransform().setLocalPosition(new vec3(0, TRANSCRIPT_VIEWPORT_Y, 0))
    const windowObj = global.scene.createSceneObject('TranscriptScrollWindow')
    windowObj.setParent(anchorObj)
    this.transcriptScroll = windowObj.createComponent(ScrollWindow.getTypeName()) as ScrollWindow
    this.transcriptScroll.vertical = true
    this.transcriptScroll.horizontal = false
    this.transcriptScroll.windowSize = new vec2(innerW, TRANSCRIPT_VIEWPORT_H)

    const textObj = global.scene.createSceneObject('TranscriptText')
    textObj.setParent(windowObj)
    textObj.getTransform().setLocalPosition(new vec3(0, 0, 0.05))
    this.transcriptText = textObj.createComponent('Component.Text') as Text
    this.transcriptText.text = 'Tap Start to begin narrating'
    this.transcriptText.depthTest = true
    this.transcriptText.font = BODY_FONT
    this.transcriptText.size = 34
    ;(this.transcriptText as Text & { weight?: number }).weight = 500
    this.transcriptText.textFill.color = new vec4(1, 1, 1, 0.75)
    this.transcriptText.horizontalAlignment = HorizontalAlignment.Center
    // Top-anchored + Wrap/Overflow, same convention as StickyNote's own scrollable body
    // text — the block lays out its full real height regardless of the viewport, and the
    // ScrollWindow's mask (not this bound) does the actual visual clipping.
    this.transcriptText.verticalAlignment = VerticalAlignment.Top
    this.transcriptText.horizontalOverflow = HorizontalOverflow.Wrap
    this.transcriptText.verticalOverflow = VerticalOverflow.Overflow
    this.transcriptText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -60, TRANSCRIPT_VIEWPORT_H / 2)

    // Top-right corner of the panel, mirroring menuButton's own top-left corner spot
    // (authored at local (-8.9, 11.1)) — was floating mid-panel above the transcript
    // viewport instead, per explicit request to move it up to the corner.
    const editObj = global.scene.createSceneObject('TranscriptEditButton')
    editObj.setParent(contentNode)
    editObj.getTransform().setLocalPosition(new vec3(8.9, 11.1, 0.5))
    this.editButton = editObj.createComponent(Button.getTypeName()) as Button
    themeButton(this.editButton, 'teal', 1.2)
    this.editButton.size = new vec3(2.4, 2.4, 1)
    setButtonIcon(this.editButton, EDIT_ICON, 1.3)
    // Editing a live, still-growing transcript mid-recording no longer makes sense now
    // that Edit only ever appears once a session is stopped — toggleRecording() hides it
    // for the duration of a recording and shows it again once one ends.

    // Same footprint as the read-only transcript viewport (not a thin single-line strip)
    // so editing shows as much surrounding paragraph as reading does.
    const editFieldObj = global.scene.createSceneObject('TranscriptEditField')
    editFieldObj.setParent(contentNode)
    editFieldObj.getTransform().setLocalPosition(new vec3(0, TRANSCRIPT_VIEWPORT_Y, 0.3))
    this.editField = editFieldObj.createComponent(TextInputArea.getTypeName()) as TextInputArea
    this.editField.size = new vec3(innerW, TRANSCRIPT_VIEWPORT_H, 1)
    // TextInputArea's own default font size (96) is meant for a single short line, not a
    // paragraph — left unset it dwarfed the read-only transcript view's 34, showing only a
    // handful of words at a time. Matched to it here for a consistent reading size instead.
    this.editField.fontSize = 34
    this.editField.fontFamily = BODY_FONT
    this.editField.overflowMode = OverflowMode.Scroll

    // Left enabled here (not disabled immediately) on purpose — confirmed live: a
    // TextInputArea/TextInputField built with createComponent() only finishes its own
    // initialize() (which sets up the interactableStateMachine editMode() needs) once its
    // SceneObject has actually been enabled for at least one full OnStartEvent pass. This
    // object starts disabled-until-editing by design (so it doesn't sit on top of the
    // read-only ScrollWindow eating its pinches), but if it had NEVER been enabled even
    // once before the very first Edit tap, that tap's own enable+editMode(true) call
    // reliably crashed with "Cannot set property 'toggle' of undefined" — reproduced live,
    // and NOT fixed by deferring editMode() a further frame with a zero-second
    // DelayedCallbackEvent, so the enable and the first real OnStartEvent pass genuinely
    // need to land in different, non-adjacent frames. Warming it up once here, at panel
    // build time, and only disabling it after a real (if short) delay guarantees that pass
    // has already happened by the time the technician could possibly reach the Edit
    // button — normal navigation into this panel takes far longer than 0.3s regardless.
    const warmupDone = this.createEvent('DelayedCallbackEvent')
    warmupDone.bind(() => {
      this.editField.sceneObject.enabled = false
    })
    warmupDone.reset(0.3)

    // Separate, later deferral than the warm-up above — this one is about isPlaceholder,
    // not initialize(). Setting `.text` only updates `_text` synchronously; the
    // `isPlaceholder` flag editMode() actually checks is only recomputed by a batched
    // LateUpdateEvent flush. Calling editMode(true) before that flush has run means it
    // reads the STALE (still-placeholder) flag and wipes `_text` back to "" right before
    // requesting the keyboard — reproduced live as the Edit panel opening empty despite
    // the transcript having real text. Confirmed live that a zero-second
    // DelayedCallbackEvent alone does NOT reliably fix this (still empty after several
    // real seconds) — a disabled component's own bound LateUpdateEvent does not appear to
    // actually flush while the component is disabled, even after its `.enabled` flag was
    // set true, so setting `.text` while the field was still disabled left that flush
    // permanently missed for this cycle. Reordered so the field is enabled FIRST (already
    // active when `.text` arms the flush), with editMode() still deferred a short real
    // delay as a second safety margin.
    const enterEditMode = this.createEvent('DelayedCallbackEvent')
    enterEditMode.bind(() => this.editField.editMode(true))

    this.editButton.onTriggerUp.add(() => {
      this.editOriginalText = this.transcript.text
      this.editField.sceneObject.enabled = true
      this.editField.text = this.transcript.text
      windowObj.enabled = false
      enterEditMode.reset(0.05)
    })
    this.editField.onEditMode.add((editing) => {
      if (editing) return
      const changed = this.editField.text !== this.editOriginalText
      // Overwrite, not reseed-and-append — the transcript is only ever editable once the
      // session is stopped now, so there's no still-growing live text to reconcile with.
      this.transcript.text = this.editField.text
      this.updateTranscriptDisplay()
      this.editField.sceneObject.enabled = false
      windowObj.enabled = true
      // Skip the round-trip entirely when nothing actually changed — closing Edit without
      // touching anything shouldn't write an identical row to Supabase.
      if (changed) this.persistTranscript()
    })

    // Without this, the placeholder text set above sits at its raw unmasked layout
    // position instead of the scroll-managed one updateTranscriptDisplay() computes —
    // it rendered up near the Record/Capture row instead of down in its own viewport
    // until this ran once. Same fix as StickyNote's own init() calling its scroll-extent
    // updater immediately after building the ScrollWindow, not just on later updates.
    this.updateTranscriptDisplay()
  }

  // Re-measures the transcript's real rendered height and grows the ScrollWindow's
  // content to match (same technique as StickyNote's updateBodyScrollExtent — see its
  // own comment for the anchor-math reasoning), then scrolls to the BOTTOM rather than
  // the top: unlike a note, this view is showing text that's actively still growing, so
  // the technician needs to see what was just said, not scroll back to the beginning
  // every time a new phrase lands.
  private updateTranscriptDisplay(): void {
    if (!this.transcriptScroll) return
    this.transcriptText.text = this.transcript.text || 'Tap Start to begin narrating'
    const measured = this.transcriptText.getBoundingBox().getSize().y
    const contentH = Math.max(TRANSCRIPT_VIEWPORT_H, measured + 0.4)
    this.transcriptScroll.scrollDimensions = new vec2(-1, contentH)
    const localY = (contentH - TRANSCRIPT_VIEWPORT_H) / 2
    this.transcriptText.sceneObject.getTransform().setLocalPosition(new vec3(0, localY, 0.05))
    // ScrollWindow's own normalized range is -1 (bottom) to 1 (top) — (0, 0) is actually
    // the MIDDLE of the scrollable content, not the bottom, despite what this used to
    // assume. That's why new narration kept landing out of view instead of tracking down
    // with it; (0, -1) is the actual bottom.
    this.transcriptScroll.scrollPositionNormalized = new vec2(0, -1)
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

  // clearAfterStop — only ever true when Stop is being triggered as part of leaving the
  // panel (handleBackTapped's confirm callback). A plain Stop-button tap leaves the
  // transcript on screen so the technician can review or edit it; the text only actually
  // clears once they go back or start a new recording, per explicit request.
  private toggleRecording(clearAfterStop: boolean = false): void {
    if (!this.isRecording) {
      if (!this.currentSiteId) {
        this.statusText.text = 'Select a site first'
        return
      }
      this.captureCount = 0
      this.listenErrorStreak = 0
      this.isRecording = true
      this.recordButtonLabel.text = 'Stop'
      this.workSessionHandMenu.setRecordingState(true)
      this.statusText.text = 'Recording... narrate your work'
      this.setCaptureStatus('')
      // Edit only makes sense once a session is stopped — hidden for the duration of a
      // recording so it doesn't invite editing text that's still actively growing.
      this.editButton.sceneObject.enabled = false
      // A brand new session starts a brand new transcript and a brand new row to save
      // it to — reusing the last session's transcriptRowId would silently overwrite a
      // previous, already-ended session's narration. This is also the only other place
      // (besides leaving the panel) the on-screen transcript ever actually clears.
      this.transcript.reset()
      this.transcriptRowId = null
      this.updateTranscriptDisplay()
      // Claim the mic first, create the session row alongside it — the row is only
      // needed once a transcript chunk actually arrives, so nothing is gained by making
      // narration wait on the network round-trip.
      this.startNarration()
      this.createSession()
      this.startTranscriptSaveTimer()
    } else {
      this.isRecording = false
      // Must be cleared here — the transcription session now runs unbroken for the whole
      // recording rather than being re-armed per phrase, so nothing else resets this.
      // Left set, startNarration()'s guard would silently refuse to open the mic for
      // every subsequent session.
      this.isListening = false
      this.recordButtonLabel.text = 'Start'
      this.workSessionHandMenu.setRecordingState(false)
      this.statusText.text = 'Ending session...'
      // Shown again immediately, not gated on the async save below completing — there's
      // nothing unsafe about opening Edit while the last save is still in flight, since
      // persistTranscript() always upserts the one row rather than racing to create two.
      this.editButton.sceneObject.enabled = true
      this.transcriptSaveTimer?.cancel()
      this.asrModule.stopTranscribing().then(async () => {
        // One last save on Stop — the periodic timer covers everything up to its last
        // tick, but the technician could easily have said something in the final seconds
        // since then; without this, that trailing bit is only ever in the live view, and
        // is lost on the next session's transcript.reset().
        await this.persistTranscript()
        if (this.sessionId) {
          await supabaseUpdate('sessions', `id=eq.${this.sessionId}`, { ended_at: new Date().toISOString() })
          this.statusText.text = 'Session saved'
          this._onSessionEnded.invoke({ sessionId: this.sessionId, siteId: this.currentSiteId as string })
        }
        if (clearAfterStop) {
          this.transcript.reset()
          this.transcriptRowId = null
          this.updateTranscriptDisplay()
        }
      })
    }
  }

  // Fires persistTranscript() once every TRANSCRIPT_SAVE_INTERVAL_S while recording,
  // independent of how often ASR phrases finalize — see that constant's own comment.
  // Guards on isRecording rather than relying solely on toggleRecording()'s cancel() so a
  // tick that was already in flight when Stop was tapped doesn't reschedule itself.
  private startTranscriptSaveTimer(): void {
    if (!this.transcriptSaveTimer) {
      this.transcriptSaveTimer = this.createEvent('DelayedCallbackEvent')
      this.transcriptSaveTimer.bind(() => {
        if (!this.isRecording) return
        this.persistTranscript()
        this.transcriptSaveTimer!.reset(TRANSCRIPT_SAVE_INTERVAL_S)
      })
    }
    this.transcriptSaveTimer.reset(TRANSCRIPT_SAVE_INTERVAL_S)
  }

  // Runs alongside ASR startup, not before it — see toggleRecording(). A failed insert
  // here rolls back the recording state and stops whatever ASR already started.
  private async createSession(): Promise<void> {
    const { data, error } = await supabaseInsert<{ id: string }>('sessions', {
      site_id: this.currentSiteId,
      technician_name: getTechnicianName(),
    })
    if (error || !data || data.length === 0) {
      this.statusText.text = 'Could not start session'
      print('[SessionRecorder] start session failed: ' + error)
      this.isRecording = false
      this.recordButtonLabel.text = 'Start'
      this.workSessionHandMenu.setRecordingState(false)
      this.editButton.sceneObject.enabled = true
      this.isListening = false
      this.asrModule.stopTranscribing()
      this.transcriptSaveTimer?.cancel()
      return
    }
    this.sessionId = data[0].id
  }

  // Opens ONE transcription session for the whole recording. This used to re-arm
  // transcription after every finalized phrase ("startListeningLoop"), which was the
  // actual cause of the persistent `ASR error: 1` (AsrStatusCode.InternalError):
  //
  //  - AsrModule's own documented behavior is that after `isFinal: true`, "a new phrase
  //    begins automatically" — the session stays open and keeps transcribing on its own.
  //    Calling startTranscribing() again to "re-arm" therefore starts a second session on
  //    top of a live one, which fails with InternalError.
  //  - `require('LensStudio:AsrModule')` returns a single global module, so there is
  //    exactly ONE transcription session across the entire Lens — StickyNote,
  //    SessionContextPanel and this panel all share it. A note dictated earlier that never
  //    got explicitly stopped leaves that one session live, so even this panel's FIRST
  //    startTranscribing() call lands on an already-active session and fails the same way.
  //
  // StickyNote's mic — the path that always worked — starts exactly one session and never
  // re-arms, which is the behavior replicated here. stopTranscribing() is awaited first to
  // guarantee the shared mic is actually free, whoever used it last.
  private async startNarration(): Promise<void> {
    if (!this.isRecording || this.isListening) return
    this.isListening = true

    // Released with a timeout rather than a bare `await`: stopTranscribing() resolves
    // promptly when a session is actually live, but there is no guarantee it ever settles
    // when nothing is transcribing — and a promise that never settles here would silently
    // skip startTranscribing() entirely, producing a recording that shows no error and
    // also never transcribes. Whichever finishes first, startup proceeds.
    print('[SessionRecorder] releasing shared mic...')
    await releaseSharedMic(this, 'SessionRecorder')
    // Stop may have been tapped while the above was settling.
    if (!this.isRecording) {
      this.isListening = false
      return
    }

    const opts = AsrModule.AsrTranscriptionOptions.create()
    opts.silenceUntilTerminationMs = 2000
    opts.mode = AsrModule.AsrMode.HighAccuracy

    opts.onTranscriptionUpdateEvent.add((e: AsrModule.TranscriptionUpdateEvent) => {
      // Any update at all — interim or final — is proof ASR is actually working, so a
      // transient error earlier in the session doesn't count against the retry cap below.
      this.listenErrorStreak = 0
      // Finals only — interim updates fire several times a second and carry the whole
      // accumulated phrase each time, which buries everything else in the log.
      if (e.isFinal) print('[SessionRecorder] transcript chunk: "' + e.text + '"')
      // Echo the live transcript back to the panel. Without this the panel sat on
      // "Recording... narrate your work" for the entire session whether ASR was working
      // perfectly or not running at all — there was no way to tell the two apart, and no
      // feedback that speech was being picked up. Grows across the whole session now
      // (see IncrementalTranscript) and shows in full in the scrollable transcript view
      // below statusText, not truncated to a one-line tail the way it used to be.
      //
      // Not persisted here — saving used to happen on every finalized phrase, which for
      // narration in many short phrases meant a Supabase write every few seconds. Persist
      // is now purely time-driven (see transcriptSaveTimer / TRANSCRIPT_SAVE_INTERVAL_S),
      // independent of how often phrases finalize.
      this.transcript.update(e)
      this.updateTranscriptDisplay()
    })
    opts.onTranscriptionErrorEvent.add((code: AsrModule.AsrStatusCode) => {
      print('[SessionRecorder] ASR error: ' + code)
      this.isListening = false
      if (!this.isRecording) return
      this.listenErrorStreak++
      if (this.listenErrorStreak > MAX_LISTEN_RETRIES) {
        // Stop retrying — a persistent failure (mic permission, no internet) would
        // otherwise retry instantly and silently forever, with "Recording... narrate your
        // work" still on screen the whole time as if nothing were wrong. The session
        // itself (image capture, ended_at on Stop) keeps working — only narration stops.
        this.statusText.text = 'Narration unavailable (mic error ' + code + ') — recording continues without transcript'
        return
      }
      this.startNarration()
    })

    try {
      print('[SessionRecorder] calling startTranscribing')
      this.asrModule.startTranscribing(opts)
      print('[SessionRecorder] startTranscribing returned — listening')
    } catch (err) {
      print('[SessionRecorder] ASR start exception: ' + err)
      this.isListening = false
    }
  }

  // Inserts the ONE transcript row for this session on the first finalized phrase, then
  // upserts it (same row, never a second one) every time narration grows or gets
  // manually edited via TranscriptEditButton — see transcriptRowId's own comment for why
  // this replaced the old one-row-per-phrase model.
  private async persistTranscript(): Promise<void> {
    if (!this.sessionId) return
    const text = this.transcript.text
    if (!text.trim()) return
    if (!this.transcriptRowId) {
      const { data, error } = await supabaseInsert<{ id: string }>('session_captures', {
        session_id: this.sessionId,
        kind: 'transcript_chunk',
        text_content: text,
      })
      if (error || !data || data.length === 0) {
        print('[SessionRecorder] Failed to create transcript row: ' + error)
        return
      }
      this.transcriptRowId = data[0].id
    } else {
      const { error } = await supabaseUpdate('session_captures', `id=eq.${this.transcriptRowId}`, { text_content: text })
      if (error) print('[SessionRecorder] Failed to update transcript row: ' + error)
    }
  }

  // requestImage() (a fresh still-image request) is device-only and always fails
  // in Lens Studio Preview ("Image request not supported"). The continuous camera
  // stream via requestCamera() runs in-editor too, so a live capture button reads
  // a snapshot off that running stream instead of requesting a new still image.
  //
  // Started lazily now — on the first Capture tap, not eagerly alongside ASR at
  // recording start. Sticky notes' mic-only dictation (ASR + Supabase, no camera) works
  // fine in Preview, but this panel additionally starting a continuous camera stream in
  // the same breath as ASR reliably broke narration before it ever got going (Prompt 75).
  // Deferring the camera to only actually start when a photo is first requested keeps
  // ASR's startup clear of it — narration works for a session that never captures a
  // photo, and a session that does only risks a hiccup around the capture itself, not a
  // total loss of narration from the first second.
  private startCameraStream(): void {
    if (this.cameraTexture) return
    const req = CameraModule.createCameraRequest()
    req.cameraId = global.deviceInfoSystem.isEditor() ? CameraModule.CameraId.Default_Color : CameraModule.CameraId.Right_Color
    this.cameraTexture = this.cameraModule.requestCamera(req)
    const provider = this.cameraTexture.control as CameraTextureProvider
    provider.onNewFrame.add(() => {
      // Keep the stream warm; capture reads the texture on demand below.
    })
  }

  // Mirrors every capture-status message onto WorkSessionHandMenu's own floating caption
  // as well as this panel's captureStatusText — the hand menu stays visible and near-hand
  // for the whole session regardless of where the technician is looking, so a message
  // that only lived on the panel (as this one used to) was easy to miss entirely.
  private setCaptureStatus(text: string): void {
    this.captureStatusText.text = text
    this.workSessionHandMenu.setStatus(text)
  }

  private captureImage(): void {
    if (!this.isRecording || !this.sessionId) {
      this.setCaptureStatus('Start recording first')
      return
    }
    if (!this.cameraTexture) {
      // First tap starts the stream (see startCameraStream()'s comment for why it isn't
      // already running) — the texture needs at least one real frame before there's
      // anything to capture, so this tap just warms it up rather than capturing yet.
      this.startCameraStream()
      this.setCaptureStatus('Camera warming up — tap Capture again in a moment')
      return
    }
    Base64.encodeTextureAsync(
      this.cameraTexture,
      async (b64: string) => {
        const bytes = Base64.decode(b64)

        this.captureCount++
        const path = `${this.sessionId}/${this.captureCount}.jpg`
        const { error } = await supabaseUploadBytes('session-captures', path, bytes, 'image/jpeg')
        if (error) {
          print('[SessionRecorder] Image upload failed: ' + error)
          this.setCaptureStatus('Capture failed')
          return
        }
        await supabaseInsert('session_captures', {
          session_id: this.sessionId,
          kind: 'image',
          storage_path: path,
        })
        this.setCaptureStatus('Captured image ' + this.captureCount)
      },
      () => {
        print('[SessionRecorder] Image encode failed')
        this.setCaptureStatus('Capture failed')
      },
      CompressionQuality.IntermediateQuality,
      EncodingType.Jpg
    )
  }
}
