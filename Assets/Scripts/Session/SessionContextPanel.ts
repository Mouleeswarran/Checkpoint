import { BackPlate } from 'SpectaclesUIKit.lspkg/Scripts/BackPlate'
import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button'
import { Dropdown, DropdownOption } from 'SpectaclesUIKit.lspkg/Scripts/Components/Dropdown/Dropdown'
import { ElementContent } from 'SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent'
import { TextInputField } from 'SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField'
import { OpenAI } from 'RemoteServiceGateway.lspkg/HostedExternal/OpenAI'
import Event, { PublicApi } from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { SitePicker } from '../Site/SitePicker'
import { supabaseSelect } from '../Backend/SupabaseClient'
import { releaseSharedMic } from '../Shared/AsrSession'
import { IncrementalTranscript } from '../Shared/IncrementalTranscript'
import { ConfirmPopup } from '../Shared/ConfirmPopup'
import { LoadingSpinner } from '../Shared/LoadingSpinner'
import { themeButton, themePanel, styleBackButton, setButtonIcon } from '../Shared/ThemedUI'
import { COLOR, HEADER_FONT, BUTTON_FONT, BODY_FONT, MIC_ICON, BACK_ICON } from '../Shared/Theme'

const STOP_ICON = requireAsset('../../Icons/stop_circle.png') as Texture
const CAMERA_ICON = requireAsset('../../Icons/photo_camera.png') as Texture
// Same icon as every other "Ask AI" control in the app (HistoryPanel's AI button,
// WorkSessionHandMenu's AskAIButton) — was smart_toy.png, a one-off that didn't match.
const SEND_ICON = requireAsset('../../Icons/hub.png') as Texture
const EDIT_ICON = requireAsset('../../Icons/edit.png') as Texture

const PANEL_W = 26
// +6 over the original 34 — one extra full row for the new Notes dropdown, plus a bit
// more clearance at the bottom (see buildPanel()'s own comment on controlsRowY) that the
// original layout was missing entirely: captureStatusText's own text block reached
// slightly past the panel's bottom edge before, just not enough to be obviously wrong on
// screen.
const PANEL_H = 40

interface VersionRow {
  version_number: number
  summary_text: string
  equipment_mentioned: string[]
  parts_changed: string[]
  session_id: string
  created_at: string
}

interface NoteRow {
  id: string
  type: string
  text_en: string
}

// Header/Menu/ContextStatus/AskMic/QuestionText/AnswerText are pre-authored in the
// editor scene — this script still only wires theme/behavior onto those, but now also
// repositions several of them at runtime (mic moved much further down the panel, per
// explicit request) and adds new elements (both version-selector dropdowns, the camera
// button, its own status caption) the same way HistoryPanel's AI button/tabs and
// SessionRecorder's captureStatusText were added — built at runtime, no new scene wiring.
@component
export class SessionContextPanel extends BaseScriptComponent {
  @input
  sitePicker!: SitePicker

  @input
  headerText!: Text

  @input
  menuButton!: Button
  @input
  menuButtonLabel!: Text

  @input
  contextStatusText!: Text

  @input
  micButton!: Button
  @input
  micButtonLabel!: Text

  @input
  questionText!: Text

  @input
  answerText!: Text

  // Set the moment a site is selected, kept for every reopen after — see init()'s
  // OnEnableEvent handler, the same fix HistoryPanel already needed for the identical
  // reason (loadContext() otherwise only ever fired from the original site-selection
  // event, never again just because this panel becomes visible again).
  private currentSiteId: string | null = null
  private versions: VersionRow[] = []
  private notes: NoteRow[] = []
  // Keyed by session_id — populated lazily, only for sessions actually selected in the
  // transcript dropdown, not fetched upfront for every version.
  private transcriptCache = new Map<string, string>()
  private contextText = ''
  private isListening = false
  private answerSpinner!: LoadingSpinner
  private micIconImage: Image | null = null

  private summaryDropdown!: Dropdown
  private summaryButtonLabel!: Text
  private transcriptDropdown!: Dropdown
  private transcriptButtonLabel!: Text
  private notesDropdown!: Dropdown
  private notesButtonLabel!: Text
  // Tracks every pool-recycled item row this session has bound, per dropdown, keyed by
  // the row's own Button identity (stable across rebinds — the pool recycles the same
  // Button objects for different data as the list scrolls, see setupMultiDropdown's own
  // comment). Lets recolorDropdownItems() repaint every currently-bound row on any
  // selection change without needing private access to Dropdown's own pool internals.
  private dropdownItemBindings = new Map<Dropdown, Map<Button, { content: ElementContent; dataIdx: number }>>()

  private captureStatusText!: Text
  // Base64 JPEG of the last capture, attached to the NEXT question only — cleared once
  // that question is sent, matching "added with the voice prompt" (one photo per ask,
  // not a persistent attachment).
  private pendingImageBase64: string | null = null

  private sendButton!: Button
  private sendIconImage: Image | null = null
  // Set by stopListening() once dictation finishes, cleared by sendPendingQuestion() once
  // actually sent (or by startListening() if a new dictation starts before the last one
  // was sent) — sending is now a deliberate tap, not automatic on mic-stop.
  private pendingQuestion = ''
  // Reset on every startListening() (see its own comment) — each mic tap is a new
  // question, not a continuation of the last one.
  private transcript = new IncrementalTranscript()
  private editField!: TextInputField
  private confirmPopup!: ConfirmPopup

  private asrModule: AsrModule = require('LensStudio:AsrModule')
  private cameraModule: CameraModule = require('LensStudio:CameraModule')
  private cameraTexture: Texture | null = null

  private _onBackRequested = new Event<void>()
  get onBackRequested(): PublicApi<void> {
    return this._onBackRequested.publicApi()
  }

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init())
  }

  private init(): void {
    this.sitePicker.onSiteSelected.add((selection) => {
      this.currentSiteId = selection.siteId
      this.loadContext(selection.siteId)
    })
    this.buildPanel()
    // Ending a Work Session (which stores a new summary version) and going straight to
    // Ask AI from Main Menu showed whatever context existed back when the site was
    // originally picked, missing the one just created — same bug, same fix as
    // HistoryPanel's own loadVersions(): re-fetch on every reopen, not just the first
    // time a site is chosen, so this stays in sync with data created elsewhere in the
    // app since the panel was last shown.
    this.createEvent('OnEnableEvent').bind(() => {
      if (this.currentSiteId) this.loadContext(this.currentSiteId)
    })
  }

  // Fetches EVERY version for the site (not just the latest, per the request for a
  // multi-select picker) plus every sticky note on the site — notes stay physically
  // anchored wherever they're placed in the world, only their text content gets pulled
  // into the AI's context here, nothing about them moves. Defaults to the latest summary
  // version AND every note selected (matching the old "everything included" behavior),
  // so asking a question works immediately without the technician having to pick
  // anything first — narrowing either list down is opt-out, not opt-in.
  private async loadContext(siteId: string): Promise<void> {
    this.contextStatusText.text = 'Loading site history...'
    this.transcriptCache.clear()

    const [versionsResult, notesResult] = await Promise.all([
      // limit=5 — matches setupMultiDropdown's own maxVisibleItems exactly, not an
      // arbitrary number. Root cause confirmed live via the actual engine log, not
      // guessed: on a real site with many recorded sessions (29, in the exact case that
      // surfaced this), the Summary dropdown's drawer rendered well past its own masked
      // viewport, visually colliding with the Notes row/status text/buttons below it —
      // `RunAndCollectLogsTool` caught the real cause mid-repro: "DropdownScroll :
      // Maximum of 8 masking components." Lens Studio hard-caps simultaneous
      // MaskingComponents scene-wide (sticky note bodies, the site list, every open
      // dropdown's own scroll mask all compete for that same budget); once a dropdown's
      // item count exceeds maxVisibleItems it needs a masked, scrollable drawer and
      // claims one more of those 8 slots, and this scene was already claiming enough of
      // them elsewhere to blow the ceiling. At dataItems.length <= maxVisibleItems the
      // drawer never enables scrolling at all (`scrollWindow.vertical` only turns on
      // above that count) and needs no mask, freeing that slot rather than fighting for
      // it. Verified fixed live: capped to 5, the same 29-version site's Summary drawer
      // now renders as five clean rows with no collision. Also a reasonable product
      // choice on its own — Ask AI context realistically wants recent history, not
      // every version a site has ever had.
      supabaseSelect<VersionRow>(
        'summaries',
        `select=version_number,summary_text,equipment_mentioned,parts_changed,session_id,created_at&site_id=eq.${siteId}&order=version_number.desc&limit=5`
      ),
      // deleted=eq.false — the previous version of this query had no such filter, so a
      // deleted note's text was still silently reaching the AI's context forever.
      // limit=5 for the same reason as the summaries query above.
      supabaseSelect<NoteRow>('notes', `select=id,type,text_en&site_id=eq.${siteId}&deleted=eq.false&order=created_at.desc&limit=5`),
    ])

    if (versionsResult.error) {
      print('[SessionContextPanel] Failed to load versions: ' + versionsResult.error)
      this.contextStatusText.text = 'Could not load history'
      return
    }
    this.versions = versionsResult.data ?? []
    this.notes = (notesResult.data ?? []).filter((n) => n.text_en?.trim().length > 0)

    const labels = this.versions.map((v) => new DropdownOption(`v${v.version_number} — ${this.formatDate(v.created_at)}`))
    this.summaryDropdown.setData(labels)
    this.transcriptDropdown.setData(labels)
    this.summaryDropdown.clearSelection()
    this.transcriptDropdown.clearSelection()

    const noteLabels = this.notes.map((n) => new DropdownOption(this.noteLabel(n)))
    this.notesDropdown.setData(noteLabels)
    this.notesDropdown.clearSelection()
    // Select-all-by-default — each call only adds to the existing multi-selection (see
    // Dropdown.selectDataAt's own doc comment), so this is the correct way to pre-check
    // every item, not just the first.
    for (let i = 0; i < this.notes.length; i++) this.notesDropdown.selectDataAt(i)

    if (this.versions.length === 0) {
      this.contextText = ''
      await this.rebuildContext()
      return
    }
    this.summaryDropdown.selectDataAt(0)
    await this.rebuildContext()
  }

  private formatDate(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleDateString ? d.toDateString() : iso
  }

  // Truncated single-line label for a note's dropdown row — the full text still goes
  // into the AI context untruncated (see rebuildContext()); this is display-only.
  private noteLabel(n: NoteRow): string {
    const NOTE_LABEL_MAX = 30
    const text = n.text_en.length > NOTE_LABEL_MAX ? n.text_en.slice(0, NOTE_LABEL_MAX) + '…' : n.text_en
    return `(${n.type}) ${text}`
  }

  // Re-run whenever any of the three dropdowns' selection changes. Only fetches a
  // transcript the FIRST time its version is selected (cached after that) — picking
  // summaries or notes doesn't touch the network at all, since that text is already in
  // `versions`/`notes`.
  private async rebuildContext(): Promise<void> {
    const summaryIdx = this.summaryDropdown.getSelectedIndices()
    const transcriptIdx = this.transcriptDropdown.getSelectedIndices()
    const noteIdx = this.notesDropdown.getSelectedIndices()

    for (const i of transcriptIdx) {
      const v = this.versions[i]
      if (v && !this.transcriptCache.has(v.session_id)) {
        this.transcriptCache.set(v.session_id, await this.loadTranscriptFor(v.session_id))
      }
    }

    const summaryParts = summaryIdx
      .map((i) => this.versions[i])
      .filter(Boolean)
      .map((v) => {
        const equipment = v.equipment_mentioned?.length ? ` Equipment: ${v.equipment_mentioned.join(', ')}.` : ''
        const parts = v.parts_changed?.length ? ` Parts changed: ${v.parts_changed.join(', ')}.` : ''
        return `[Summary v${v.version_number}] ${v.summary_text}${equipment}${parts}`
      })
    const transcriptParts = transcriptIdx
      .map((i) => this.versions[i])
      .filter(Boolean)
      .map((v) => `[Raw narration v${v.version_number}] ${this.transcriptCache.get(v.session_id) || '(no narration recorded)'}`)
    const selectedNoteTexts = noteIdx
      .map((i) => this.notes[i])
      .filter(Boolean)
      .map((n) => `(${n.type}) ${n.text_en}`)
    const noteParts = selectedNoteTexts.length ? [`[Sticky notes currently on site]\n${selectedNoteTexts.join('\n')}`] : []

    this.contextText = [...summaryParts, ...transcriptParts, ...noteParts].join('\n\n')
    this.updateContextStatus()
  }

  private updateContextStatus(): void {
    const summaryCount = this.summaryDropdown.getSelectedIndices().length
    const transcriptCount = this.transcriptDropdown.getSelectedIndices().length
    const noteCount = this.notesDropdown.getSelectedIndices().length
    this.summaryButtonLabel.text = summaryCount > 0 ? `Summary (${summaryCount}) ▾` : 'Summary ▾'
    this.transcriptButtonLabel.text = transcriptCount > 0 ? `Transcript (${transcriptCount}) ▾` : 'Transcript ▾'
    this.notesButtonLabel.text =
      noteCount > 0 ? `Notes (${noteCount}/${this.notes.length}) ▾` : this.notes.length > 0 ? `Notes (0/${this.notes.length}) ▾` : 'Notes ▾'

    const parts: string[] = []
    if (summaryCount) parts.push(`${summaryCount} summar${summaryCount === 1 ? 'y' : 'ies'}`)
    if (transcriptCount) parts.push(`${transcriptCount} transcript${transcriptCount === 1 ? '' : 's'}`)
    // Reflects the SELECTED count, not the total on site — this line is the one place
    // the technician can see at a glance how much of what's physically on site is
    // actually going to the AI right now.
    if (noteCount) parts.push(`${noteCount} note${noteCount === 1 ? '' : 's'}`)
    this.contextStatusText.text = parts.length ? `Context: ${parts.join(', ')}` : 'No context selected — pick a version or note above'
  }

  private async loadTranscriptFor(sessionId: string): Promise<string> {
    const { data, error } = await supabaseSelect<{ text_content: string }>(
      'session_captures',
      `select=text_content&session_id=eq.${sessionId}&kind=eq.transcript_chunk&order=captured_at.asc`
    )
    if (error) {
      print('[SessionContextPanel] Failed to load transcript: ' + error)
      return ''
    }
    return (data ?? []).map((r) => r.text_content).filter(Boolean).join(' ')
  }

  private buildPanel(): void {
    const backPlate = this.sceneObject.getComponent(BackPlate.getTypeName()) as BackPlate
    themePanel(backPlate, COLOR.panelBg)
    backPlate.size = new vec2(PANEL_W, PANEL_H)

    const innerW = PANEL_W - 3.2
    const half = PANEL_H / 2
    // Floats above the panel's own top edge, same convention as every other panel's
    // header/back row in this app.
    const chromeRowY = half + 2.0
    const versionRowYBase = half - 2.0
    // The new Notes dropdown gets its own full-width row just below Summary/Transcript.
    const notesRowYBase = versionRowYBase - 3.2
    const contextStatusYBase = notesRowYBase - 3.3
    // question/answer/controls stay anchored to the UNSHIFTED base positions — only the
    // selector row (Summary/Transcript/Notes) and the context status text move, per
    // explicit request, not the rest of the panel.
    const questionY = contextStatusYBase - 4.5
    const answerY = questionY - 9.0
    // The selector row sat right under the header with barely any breathing room, and
    // the whole block (dropdowns + status text) reads better with a bit more room above
    // it — shifted down as one unit, which also eats into the otherwise-empty gap above
    // questionY rather than leaving it dead space.
    const SELECTOR_SHIFT_DOWN = 2.0
    const versionRowY = versionRowYBase - SELECTOR_SHIFT_DOWN
    const notesRowY = notesRowYBase - SELECTOR_SHIFT_DOWN
    const contextStatusY = contextStatusYBase - SELECTOR_SHIFT_DOWN
    // Mic moved dramatically lower — was at a fixed y=1 near the panel's vertical
    // center, now sits near the bottom edge instead, per the explicit request.
    // +5.0 (not the original +3.5) — the extra 1.5cm is what actually keeps
    // captureStatusText's own text block (see buildControlsRow) inside the panel's
    // bottom edge; the previous margin was thin enough that it technically overflowed.
    const controlsRowY = -half + 5.0
    const controlsCaptionY = controlsRowY - 2.3

    this.headerText.sceneObject.getTransform().setLocalPosition(new vec3(0, chromeRowY, 0))
    this.headerText.text = 'Ask AI'
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

    this.buildVersionDropdowns(innerW, versionRowY)
    this.buildNotesDropdown(innerW, notesRowY)

    this.contextStatusText.sceneObject.getTransform().setLocalPosition(new vec3(0, contextStatusY, 0))
    this.styleWrappedText(this.contextStatusText, 'Select a site to load history', 0.6, 3)

    this.questionText.sceneObject.getTransform().setLocalPosition(new vec3(0, questionY, 0))
    this.styleWrappedText(this.questionText, '', 0.55, 2.2)
    this.buildQuestionEditControl(innerW, questionY)

    this.answerText.sceneObject.getTransform().setLocalPosition(new vec3(0, answerY, 0))
    this.styleWrappedText(this.answerText, '', 1.0, 4.0)

    const answerLocalPos = this.answerText.sceneObject.getTransform().getLocalPosition()
    this.answerSpinner = new LoadingSpinner(
      this,
      this.answerText.sceneObject.getParent(),
      new vec3(answerLocalPos.x, answerLocalPos.y + 3.5, answerLocalPos.z),
      2.0
    )

    this.buildControlsRow(controlsRowY, controlsCaptionY)

    // Centered on the panel itself, pushed well forward so it draws in front of
    // everything else here, including the version dropdowns' own drawerRenderOrder.
    this.confirmPopup = new ConfirmPopup(this.sceneObject, innerW - 3, 5)
  }

  // Mic left listening (or a transcribed-but-unsent question left sitting) used to just
  // keep running silently in the background if the technician tapped back — no warning,
  // and the mic stayed globally claimed the whole time (see AsrSession.ts), which could
  // block StickyNote's or Work Session's own mic if tapped while away. Now: nothing at
  // risk, back works instantly same as before; otherwise a confirm popup explains what
  // leaving will discard before it happens.
  private handleBackTapped(): void {
    const atRisk = this.isListening || this.pendingQuestion.trim().length > 0 || this.transcript.text.trim().length > 0
    if (!atRisk) {
      this._onBackRequested.invoke()
      return
    }
    this.confirmPopup.show(
      this.isListening
        ? 'Still listening — leaving will stop the mic and discard this question.'
        : "You have a question that hasn't been sent yet. Leaving will discard it.",
      () => this.discardAndLeave()
    )
  }

  // Deliberately NOT stopListening() — that preserves the transcript into pendingQuestion
  // so the Ask AI button can send it later, which is exactly the opposite of "discard"
  // here. This stops the mic (if any) and wipes every piece of in-progress state instead.
  private discardAndLeave(): void {
    if (this.isListening) {
      this.isListening = false
      themeButton(this.micButton, 'amber', 1.6)
      this.setMicIcon(MIC_ICON)
      this.asrModule.stopTranscribing().catch(() => {})
    }
    this.transcript.reset()
    this.pendingQuestion = ''
    this.questionText.text = ''
    this.pendingImageBase64 = null
    this.captureStatusText.text = ''
    this.updateSendButtonState()
    this._onBackRequested.invoke()
  }

  // Three side-by-side, icon-only circular buttons (Speak / Photo / Ask AI) near the
  // bottom of the panel — icon-only matches the compact-control convention already used
  // elsewhere in this app (StickyNote's Mic/Delete, the hand menus). Stopping the mic no
  // longer auto-sends the question (see stopListening()) — the technician can review
  // what was transcribed, optionally attach a photo, then explicitly tap Ask AI, so a
  // question is only ever sent on a deliberate action.
  private buildControlsRow(rowY: number, captionY: number): void {
    // 6.0cm center spacing against 3.2cm buttons leaves a real ~2.8cm gap between each
    // pair — wider than the 5.5cm/2.3cm gap already proven sufficient for the two-button
    // row (a tighter 3.6cm spacing there once cross-triggered the neighboring button on
    // an imprecise pinch), extra margin here since a third button sits between the other
    // two.
    const spacing = 6.0

    this.micButton.sceneObject.getTransform().setLocalPosition(new vec3(-spacing, rowY, 0))
    themeButton(this.micButton, 'amber', 1.6)
    this.micButton.size = new vec3(3.2, 3.2, 1)
    this.micButtonLabel.text = ''
    this.micIconImage = setButtonIcon(this.micButton, MIC_ICON, 1.8)
    // Tap-to-toggle — matches StickyNote's and SessionRecorder's mic buttons, both
    // already converted from press-and-hold to this exact pattern. This one was the
    // last remaining onTriggerDown/onTriggerUp (hold-to-talk) mic in the app, and it's
    // the direct cause of both reported symptoms: SIK's onTriggerUp only reliably fires
    // when the release lands back on the same interactable — a release that drifts off
    // it (an easy thing to do while also trying to speak) never reaches stopListening()
    // at all, leaving isListening stuck true forever ("kept on saying recording", no way
    // to stop it). And even when it worked, a hold only captures speech for exactly as
    // long as the button stays physically pressed, which is an awkward, easy-to-cut-off
    // way to dictate a full question ("doesn't transcribe what I'm saying"). Two
    // independent taps (start, then stop) has neither failure mode.
    this.micButton.onTriggerUp.add(() => {
      if (this.isListening) this.stopListening()
      else this.startListening()
    })
    this.addCaption('Speak', new vec3(-spacing, captionY, 0))

    const captureObj = global.scene.createSceneObject('CaptureButton')
    captureObj.setParent(this.micButton.sceneObject.getParent())
    captureObj.getTransform().setLocalPosition(new vec3(0, rowY, 0))
    const captureButton = captureObj.createComponent(Button.getTypeName()) as Button
    themeButton(captureButton, 'teal', 1.6)
    captureButton.size = new vec3(3.2, 3.2, 1)
    setButtonIcon(captureButton, CAMERA_ICON, 1.8)
    captureButton.onTriggerUp.add(() => this.captureForPrompt())
    this.addCaption('Photo', new vec3(0, captionY, 0))

    const sendObj = global.scene.createSceneObject('SendButton')
    sendObj.setParent(this.micButton.sceneObject.getParent())
    sendObj.getTransform().setLocalPosition(new vec3(spacing, rowY, 0))
    this.sendButton = sendObj.createComponent(Button.getTypeName()) as Button
    themeButton(this.sendButton, 'amber', 1.6)
    this.sendButton.size = new vec3(3.2, 3.2, 1)
    this.sendIconImage = setButtonIcon(this.sendButton, SEND_ICON, 1.8)
    this.sendButton.onTriggerUp.add(() => this.sendPendingQuestion())
    this.addCaption('Ask AI', new vec3(spacing, captionY, 0))
    // Starts dimmed — nothing has been dictated yet, matches updateSendButtonState()'s
    // own idle/pending contrast.
    this.updateSendButtonState()

    const captureStatusObj = global.scene.createSceneObject('CaptureStatus')
    captureStatusObj.setParent(this.micButton.sceneObject.getParent())
    // 1.5cm below the captions, not 2.4 — the panel's bottom edge sits only ~2.0cm below
    // controlsCaptionY (see buildPanel()'s own layout math), and the previous 2.4cm drop
    // rendered this text below the panel's visible bounds entirely, over the background
    // behind it instead of on the panel itself — exactly the kind of placement that reads
    // as "easy to miss" since it no longer looks like part of the UI at all.
    captureStatusObj.getTransform().setLocalPosition(new vec3(0, captionY - 1.5, 0))
    this.captureStatusText = captureStatusObj.createComponent('Component.Text') as Text
    this.styleWrappedText(this.captureStatusText, '', 0.55, 1.2)
  }

  // A small icon button above the question text lets the technician fix ASR mistakes by
  // hand before sending — opens a TextInputField pre-filled with the current question
  // and calls its public editMode(true), which requests Spectacles' own system keyboard
  // (the exact mechanism NameEntryPanel's "Your name" field already uses). That system
  // keyboard owns cursor placement and text selection natively; nothing here reimplements
  // any of that.
  private buildQuestionEditControl(innerW: number, questionY: number): void {
    const editObj = global.scene.createSceneObject('QuestionEditButton')
    editObj.setParent(this.questionText.sceneObject.getParent())
    editObj.getTransform().setLocalPosition(new vec3(innerW / 2 - 1.2, questionY + 2.2, 0.5))
    const editButton = editObj.createComponent(Button.getTypeName()) as Button
    themeButton(editButton, 'teal', 1.2)
    editButton.size = new vec3(2.4, 2.4, 1)
    setButtonIcon(editButton, EDIT_ICON, 1.3)

    const editFieldObj = global.scene.createSceneObject('QuestionEditField')
    editFieldObj.setParent(this.questionText.sceneObject.getParent())
    editFieldObj.getTransform().setLocalPosition(new vec3(0, questionY, 0.3))
    this.editField = editFieldObj.createComponent(TextInputField.getTypeName()) as TextInputField
    this.editField.size = new vec3(innerW, 2.6, 1)
    // Hidden until Edit is tapped — replaces questionText while active rather than
    // sitting alongside it (both showing at once would just be two copies of the text).
    this.editField.sceneObject.enabled = false

    editButton.onTriggerUp.add(() => {
      // Editing works on whatever's currently on screen, whether that's a stopped
      // dictation (pendingQuestion) or the raw transcript.text mid-listen — either way,
      // questionText.text already holds it.
      this.editField.text = this.questionText.text
      this.editField.sceneObject.enabled = true
      this.questionText.sceneObject.enabled = false
      this.editField.editMode(true)
    })

    this.editField.onEditMode.add((editing) => {
      if (editing) return
      const edited = this.editField.text
      this.questionText.text = edited
      this.questionText.sceneObject.enabled = true
      this.editField.sceneObject.enabled = false
      // Reseeded, not left alone — if the technician resumes dictating after editing,
      // the next phrase should append onto their correction, not onto whatever the
      // transcript held before it (see IncrementalTranscript's own text setter comment).
      this.transcript.text = edited
      // An edit after stopping the mic is the whole point of this control — keep
      // pendingQuestion (and so the Ask AI button's armed state) in sync with it.
      if (this.pendingQuestion.trim().length > 0) {
        this.pendingQuestion = edited
        this.updateSendButtonState()
      }
    })
  }

  private updateSendButtonState(): void {
    if (!this.sendIconImage) return
    const mat = this.sendIconImage.getMaterial(0)
    if (!mat) return
    const hasQuestion = this.pendingQuestion.trim().length > 0
    // Dim, not hidden — a stable 3-button layout is easier to target than one that
    // reflows, and a dimmed icon still reads clearly as "nothing to send yet" without an
    // extra disabled-state color needing its own theme entry (only amber/teal/danger
    // exist — see Theme.ts's ButtonTone).
    mat.mainPass.baseColor = hasQuestion ? new vec4(1, 1, 1, 1) : new vec4(1, 1, 1, 0.35)
  }

  private addCaption(text: string, localPos: vec3): void {
    const obj = global.scene.createSceneObject('Caption')
    obj.setParent(this.micButton.sceneObject.getParent())
    obj.getTransform().setLocalPosition(localPos)
    const t = obj.createComponent('Component.Text') as Text
    t.text = text
    t.depthTest = true
    t.font = BUTTON_FONT
    t.size = 30
    ;(t as Text & { weight?: number }).weight = 600
    t.textFill.color = COLOR.textSecondary
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-2.5, 2.5, -0.9, 0.9)
  }

  // Both dropdowns share the same underlying version list (a summary version and its
  // session's raw narration are always the same session, just two different
  // representations of it) but track their OWN independent selection — asking for the
  // summary of v15 and the transcript of v12 at once is a real, intended use case.
  private buildVersionDropdowns(innerW: number, rowY: number): void {
    const gap = 0.8
    const dropdownW = (innerW - gap) / 2

    // Z pushed to 2.5 (was 1.5, same depth as the Notes row below) — Summary/Transcript
    // sit directly above Notes, and their drawers expand DOWNWARD over it when opened;
    // at equal Z the open drawer and the still-visible Notes trigger competed for the
    // same depth, reading as a visual collision. Sitting further forward, plus the
    // explicit drawerRenderOrder below (render order is the actual authority here — Z
    // depth alone is easy to get subtly wrong with perspective), guarantees the open
    // drawer always draws in front of Notes rather than the two fighting for it.
    const summaryTriggerObj = global.scene.createSceneObject('SummaryDropdownButton')
    summaryTriggerObj.setParent(this.sceneObject)
    summaryTriggerObj.getTransform().setLocalPosition(new vec3(-(dropdownW / 2 + gap / 2), rowY, 2.5))
    const summaryTrigger = summaryTriggerObj.createComponent(Button.getTypeName()) as Button
    themeButton(summaryTrigger, 'teal')
    summaryTrigger.size = new vec3(dropdownW, 2.4, 1)
    const summaryLabelObj = global.scene.createSceneObject('SummaryDropdownLabel')
    summaryLabelObj.setParent(summaryTriggerObj)
    summaryLabelObj.getTransform().setLocalPosition(new vec3(0, 0, 0.95))
    this.summaryButtonLabel = summaryLabelObj.createComponent('Component.Text') as Text
    this.styleButtonLabel(this.summaryButtonLabel, 'Summary ▾', dropdownW - 0.6)
    this.summaryDropdown = this.setupMultiDropdown(summaryTrigger)
    this.summaryDropdown.drawerRenderOrder = 5
    this.summaryDropdown.onSelectionChanged.add(() => this.rebuildContext())

    const transcriptTriggerObj = global.scene.createSceneObject('TranscriptDropdownButton')
    transcriptTriggerObj.setParent(this.sceneObject)
    transcriptTriggerObj.getTransform().setLocalPosition(new vec3(dropdownW / 2 + gap / 2, rowY, 2.5))
    const transcriptTrigger = transcriptTriggerObj.createComponent(Button.getTypeName()) as Button
    themeButton(transcriptTrigger, 'teal')
    transcriptTrigger.size = new vec3(dropdownW, 2.4, 1)
    const transcriptLabelObj = global.scene.createSceneObject('TranscriptDropdownLabel')
    transcriptLabelObj.setParent(transcriptTriggerObj)
    transcriptLabelObj.getTransform().setLocalPosition(new vec3(0, 0, 0.95))
    this.transcriptButtonLabel = transcriptLabelObj.createComponent('Component.Text') as Text
    this.styleButtonLabel(this.transcriptButtonLabel, 'Transcript ▾', dropdownW - 0.6)
    this.transcriptDropdown = this.setupMultiDropdown(transcriptTrigger)
    this.transcriptDropdown.drawerRenderOrder = 5
    this.transcriptDropdown.onSelectionChanged.add(() => this.rebuildContext())
  }

  // Full-width, not split like Summary/Transcript — note labels are already truncated
  // (see noteLabel()) and a site can plausibly have far more notes than versions, so the
  // extra room here matters more than it does for the version pickers.
  private buildNotesDropdown(innerW: number, rowY: number): void {
    const notesTriggerObj = global.scene.createSceneObject('NotesDropdownButton')
    notesTriggerObj.setParent(this.sceneObject)
    notesTriggerObj.getTransform().setLocalPosition(new vec3(0, rowY, 1.5))
    const notesTrigger = notesTriggerObj.createComponent(Button.getTypeName()) as Button
    themeButton(notesTrigger, 'amber')
    notesTrigger.size = new vec3(innerW, 2.4, 1)
    const notesLabelObj = global.scene.createSceneObject('NotesDropdownLabel')
    notesLabelObj.setParent(notesTriggerObj)
    notesLabelObj.getTransform().setLocalPosition(new vec3(0, 0, 0.95))
    this.notesButtonLabel = notesLabelObj.createComponent('Component.Text') as Text
    this.styleButtonLabel(this.notesButtonLabel, 'Notes ▾', innerW - 0.6)
    this.notesDropdown = this.setupMultiDropdown(notesTrigger, COLOR.amberDim)
    // Notes' own drawer expands downward over the context status text and the
    // mic/photo/Ask AI row below it — same collision class as Summary/Transcript over
    // Notes, given a render order too so it draws cleanly on top of that content instead
    // of fighting with it. Lower than Summary/Transcript's 5 purely so there's a
    // deterministic winner in the (unlikely but possible) case more than one drawer is
    // open at once; not meaningful otherwise.
    this.notesDropdown.drawerRenderOrder = 3
    this.notesDropdown.onSelectionChanged.add(() => this.rebuildContext())
  }

  private setupMultiDropdown(topButton: Button, dimColor: vec4 = COLOR.tealDim): Dropdown {
    const dropdown = topButton.sceneObject.createComponent(Dropdown.getTypeName()) as Dropdown
    dropdown.customTrigger = true
    dropdown.topButton = topButton
    dropdown.hasTriggerBackground = false
    dropdown.selectionMode = 'multi'
    // Left open across multiple taps — closing after every single pick would defeat the
    // point of a multi-select list; the technician closes it themselves once done.
    dropdown.collapseOnSelect = false
    dropdown.itemHeight = 2.6
    dropdown.maxVisibleItems = 5
    dropdown.expandUp = false
    dropdown.parentHandlesAnchor = true
    dropdown.startExpanded = false
    // Default drawer background is a near-transparent stock gray — unreadable against
    // this panel, the exact bug already found and fixed on HistoryPanel's own version
    // dropdown; applying the same fix here from the start instead of waiting to hit it
    // again. No public setter exists for this (same situation themePanel() already
    // documents for BackPlate), so this reaches the same private `bgRect` field via the
    // same cast used there.
    const dropdownBg = (dropdown as unknown as { bgRect?: { backgroundColor: vec4 } }).bgRect
    if (dropdownBg) dropdownBg.backgroundColor = dimColor

    // Marks selected rows in green so a multi-selection is actually visible at a glance —
    // pool mode's stock item buttons show no selected-vs-unselected visual difference on
    // their own (the toggle state exists internally, but nothing paints it). `onBindItem`
    // is Dropdown's own public hook, fired every time a pool row gets (re)bound to a data
    // index — including on scroll, since pool buttons are a small recycled set, not one
    // real button per row — so this both colors newly-visible rows immediately AND keeps
    // dropdownItemBindings current for recolorDropdownItems() to use after a tap.
    const bindings = new Map<Button, { content: ElementContent; dataIdx: number }>()
    this.dropdownItemBindings.set(dropdown, bindings)
    dropdown.onBindItem = (button, _item, dataIdx) => {
      const content = button.sceneObject.getComponent(ElementContent.getTypeName()) as ElementContent
      if (!content) return
      bindings.set(button, { content, dataIdx })
      this.colorDropdownItem(content, dropdown.getSelectedIndices().includes(dataIdx))
    }
    dropdown.onSelectionChanged.add(() => this.recolorDropdownItems(dropdown))

    return dropdown
  }

  private colorDropdownItem(content: ElementContent, selected: boolean): void {
    const c = content as unknown as { _useTextColorOverride: boolean; _textColorOverride: vec4 }
    c._useTextColorOverride = selected
    c._textColorOverride = COLOR.success
    content.markColorsDirty()
  }

  // Re-paints every currently pool-bound row of one dropdown after its selection
  // changes (a tap toggling one row on/off doesn't rebind anything, so onBindItem alone
  // wouldn't see it) — only touches rows this session has actually seen bound at least
  // once, which is exactly the set that can currently be on screen.
  private recolorDropdownItems(dropdown: Dropdown): void {
    const bindings = this.dropdownItemBindings.get(dropdown)
    if (!bindings) return
    const selected = new Set(dropdown.getSelectedIndices())
    bindings.forEach(({ content, dataIdx }) => this.colorDropdownItem(content, selected.has(dataIdx)))
  }

  private styleButtonLabel(t: Text, text: string, widthCM: number): void {
    t.text = text
    t.depthTest = true
    t.font = BUTTON_FONT
    t.size = 34
    ;(t as Text & { weight?: number }).weight = 500
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.1, 1.1)
  }

  private styleWrappedText(t: Text, initial: string, opacity: number, halfHeight: number): void {
    t.text = initial
    t.depthTest = true
    t.font = BODY_FONT
    t.size = 38
    ;(t as Text & { weight?: number }).weight = 500
    t.textFill.color = new vec4(1, 1, 1, opacity)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Wrap
    t.verticalOverflow = VerticalOverflow.Overflow
    const innerW = PANEL_W - 3.2
    t.layoutRect = Rect.create(-innerW / 2, innerW / 2, -halfHeight, halfHeight)
  }

  private setMicIcon(tex: Texture): void {
    if (!this.micIconImage) return
    const mat = this.micIconImage.getMaterial(0)
    if (mat) mat.mainPass.baseTex = tex
  }

  private async startListening(): Promise<void> {
    if (this.isListening) return
    this.isListening = true
    this.questionText.text = 'Listening... (tap mic to stop)'
    themeButton(this.micButton, 'danger', 1.6)
    this.setMicIcon(STOP_ICON)
    // A fresh dictation replaces whatever was pending before — leaving an old unsent
    // question live (Ask AI still lit up, but from a question that's no longer on
    // screen) would send the wrong text if tapped after this new one finishes.
    this.pendingQuestion = ''
    this.updateSendButtonState()
    // Each mic tap starts a genuinely new question, unlike StickyNote's transcript
    // (which spans the whole life of one note) — reset here, not just reseeded.
    this.transcript.reset()

    // One global AsrModule means one transcription session app-wide — see AsrSession.ts.
    // Calling startTranscribing() while another panel's session is still live fails with
    // InternalError, so release the shared mic before claiming it.
    await releaseSharedMic(this, 'SessionContextPanel')
    if (!this.isListening) return

    const opts = AsrModule.AsrTranscriptionOptions.create()
    opts.silenceUntilTerminationMs = 1500
    opts.mode = AsrModule.AsrMode.HighAccuracy

    opts.onTranscriptionUpdateEvent.add((e: AsrModule.TranscriptionUpdateEvent) => {
      this.questionText.text = this.transcript.update(e)
    })
    opts.onTranscriptionErrorEvent.add((code: AsrModule.AsrStatusCode) => {
      print('[SessionContextPanel] ASR error: ' + code)
      this.isListening = false
      themeButton(this.micButton, 'amber', 1.6)
      this.setMicIcon(MIC_ICON)
    })

    try {
      this.asrModule.startTranscribing(opts)
    } catch (err) {
      print('[SessionContextPanel] ASR start exception: ' + err)
      this.isListening = false
      themeButton(this.micButton, 'amber', 1.6)
      this.setMicIcon(MIC_ICON)
    }
  }

  // Stopping the mic no longer sends the question automatically — it only finalizes the
  // transcript and arms the Ask AI button, so the technician can review what was heard
  // (and still attach a photo) before actually sending anything.
  private stopListening(): void {
    if (!this.isListening) return
    this.isListening = false
    themeButton(this.micButton, 'amber', 1.6)
    this.setMicIcon(MIC_ICON)
    const question = this.transcript.text
    // Show exactly what will be asked — without this, questionText stays frozen on
    // "Listening... (tap mic to stop)" whenever stop lands before a fresh partial
    // transcript update happens to arrive, which reads as if nothing was heard.
    if (question.trim().length > 0) {
      this.questionText.text = question
      this.pendingQuestion = question
      this.updateSendButtonState()
    }
    // Not awaited — nothing downstream depends on this settling, and releaseSharedMic's
    // own comment already covers why stopTranscribing() can reject or never settle when
    // called redundantly; a bare .catch keeps that from surfacing as a console warning.
    this.asrModule.stopTranscribing().catch(() => {})
  }

  private sendPendingQuestion(): void {
    const question = this.pendingQuestion.trim()
    if (!question) return
    this.pendingQuestion = ''
    // Also reset here, not just in discardAndLeave() — handleBackTapped()'s atRisk check
    // reads this.transcript.text directly, and nothing else ever cleared it once a
    // question was actually sent (only discarding one did). Left alone, it kept the
    // "you have an unsent question" back-navigation warning firing forever after the
    // very first successful ask, even with a fresh AI answer already on screen and
    // nothing left that leaving would actually lose.
    this.transcript.reset()
    this.updateSendButtonState()
    this.askQuestion(question)
  }

  // requestImage() (a fresh still-image request) is device-only and always fails in
  // Preview — the same limitation SessionRecorder's own capture already works around,
  // see its own comment. Reused verbatim: the continuous requestCamera() stream runs
  // in-editor too, so this reads a live frame off that instead of requesting a new one.
  private startCameraStream(): void {
    if (this.cameraTexture) return
    const req = CameraModule.createCameraRequest()
    req.cameraId = global.deviceInfoSystem.isEditor() ? CameraModule.CameraId.Default_Color : CameraModule.CameraId.Right_Color
    this.cameraTexture = this.cameraModule.requestCamera(req)
    const provider = this.cameraTexture.control as CameraTextureProvider
    provider.onNewFrame.add(() => {
      // Keep the stream warm; captureForPrompt() reads the texture on demand.
    })
  }

  // Captures a photo and holds it (as base64) to attach to the NEXT question asked —
  // "added with the voice prompt," not uploaded or stored anywhere on its own.
  private captureForPrompt(): void {
    if (!this.cameraTexture) {
      this.startCameraStream()
      this.captureStatusText.text = 'Camera warming up — tap again in a moment'
      return
    }
    Base64.encodeTextureAsync(
      this.cameraTexture,
      (b64: string) => {
        this.pendingImageBase64 = b64
        this.captureStatusText.text = 'Photo attached — ask your question'
      },
      () => {
        print('[SessionContextPanel] Photo capture failed')
        this.captureStatusText.text = 'Capture failed'
      },
      CompressionQuality.IntermediateQuality,
      EncodingType.Jpg
    )
  }

  private async askQuestion(question: string): Promise<void> {
    this.answerText.text = 'Thinking...'
    this.answerSpinner.show()
    const attachedImage = this.pendingImageBase64
    // One-shot: cleared here, before the request even completes, so a photo taken for
    // THIS question can't accidentally linger and get attached to a later one too.
    this.pendingImageBase64 = null
    if (attachedImage) this.captureStatusText.text = ''
    try {
      const userContent = attachedImage
        ? [
            { type: 'text' as const, text: question },
            { type: 'image_url' as const, image_url: { url: 'data:image/jpeg;base64,' + attachedImage } },
          ]
        : question
      const response = await OpenAI.chatCompletions({
        model: 'gpt-4.1-nano',
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant for a field technician. Answer questions about this job site using only the following prior-session context (summaries, raw narration, and sticky notes may all be present) and, if a photo was attached to this question, what it shows. If the context does not cover the question, say so plainly.\n\nContext: ' +
              (this.contextText || 'No prior session context is available for this site.'),
          },
          { role: 'user', content: userContent },
        ],
        temperature: 0.3,
      })
      this.answerText.text = response.choices[0].message.content as string
    } catch (err) {
      print('[SessionContextPanel] Ask AI failed: ' + err)
      this.answerText.text = 'Could not get an answer'
    } finally {
      this.answerSpinner.hide()
    }
  }
}
