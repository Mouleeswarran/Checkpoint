import { BackPlate } from 'SpectaclesUIKit.lspkg/Scripts/BackPlate'
import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button'
import { ScrollWindow } from 'SpectaclesUIKit.lspkg/Scripts/Components/ScrollWindow/ScrollWindow'
import { Dropdown, DropdownOption } from 'SpectaclesUIKit.lspkg/Scripts/Components/Dropdown/Dropdown'
import { TextInputField } from 'SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField'
import { InteractableManipulation } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation'
import { Billboard } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Billboard/Billboard'
import { OpenAI } from 'RemoteServiceGateway.lspkg/HostedExternal/OpenAI'
import { supabaseInsert, supabaseUpdate, supabaseDelete } from '../Backend/SupabaseClient'
import { getTechnicianName } from '../Shared/TechnicianIdentity'
import { releaseSharedMic } from '../Shared/AsrSession'
import { IncrementalTranscript } from '../Shared/IncrementalTranscript'
import { themeButton, themePanel, createPanelSkin, resizePanelSkin, setButtonIcon } from '../Shared/ThemedUI'
import { LoadingSpinner } from '../Shared/LoadingSpinner'
import { COLOR, ButtonTone, PAPER_NOTE_TEXTURE, HEADER_FONT, BUTTON_FONT, BODY_FONT, MIC_ICON } from '../Shared/Theme'

const STOP_ICON = requireAsset('../../Icons/stop_circle.png') as Texture
const DELETE_ICON = requireAsset('../../Icons/delete.png') as Texture
const EDIT_ICON = requireAsset('../../Icons/edit.png') as Texture

export type NoteType = 'plain' | 'info' | 'warning' | 'danger'

const TYPE_LABEL: Record<NoteType, string> = {
  plain: 'NOTE',
  info: 'INFO',
  warning: 'WARNING',
  danger: 'DANGER',
}
// Dark "ink on paper" tones — the note background is a torn legal-pad page
// (PAPER_NOTE_TEXTURE), so type labels/body text read as handwriting, not screen glow.
const INK = new vec4(0.2, 0.15, 0.08, 0.95)
const TYPE_COLOR: Record<NoteType, vec4> = {
  plain: INK,
  info: new vec4(0.1, 0.28, 0.5, 1),
  warning: new vec4(0.55, 0.14, 0.04, 1),
  danger: new vec4(0.6, 0.08, 0.06, 1),
}
// Classic colored-Post-it paper tints, multiplied onto PAPER_NOTE_TEXTURE (see
// createPanelSkin's tint param) so each note type reads as a different-colored note at
// a glance, not just a differently-colored label in the corner.
const TYPE_PAPER_TINT: Record<NoteType, vec4> = {
  plain: new vec4(1.0, 0.93, 0.55, 1),
  info: new vec4(0.55, 0.8, 1.0, 1),
  warning: new vec4(1.0, 0.72, 0.35, 1),
  danger: new vec4(1.0, 0.55, 0.58, 1),
}

const PANEL_W = 16
const PANEL_H = 13.8
const PAD = 1.0
// Height of the masked scroll viewport the body text sits in — matches the old fixed
// ±3.5 static box so the rest of the note's layout (status/controls below) is unchanged.
const BODY_VIEWPORT_H = 7
// English first — lets a note that's been translated for display get switched back to
// its stored original without leaving the dropdown.
const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Mandarin Chinese']

export interface StickyNoteInit {
  type: NoteType
  siteId: string
  isNew: boolean
  noteId?: string
  text?: string
}

// TypeLabel/Body/Status/Mic/Translate/Delete are pre-authored on the StickyNote prefab
// template (Assets/Prefabs/StickyNoteTemplate) — real Transforms editable in that
// prefab's Scene Hierarchy. Every spawned note is an instance of that one prefab
// (NotePlacer.spawnNote/loadExistingNotes call notePrefab.instantiate(...)), so editing
// the template's layout in the editor reshapes every note. This script only wires
// theme/behavior/content onto the existing objects; it never calls createSceneObject/
// createComponent for these. Mic and Translate occupy separate pre-authored positions
// and toggle via `.sceneObject.enabled` (same pattern as NotePlacer's placeHereRow)
// rather than being swapped in/out, since a new note starts in "record" mode and
// switches to "translate" mode permanently once saved.
@component
export class StickyNote extends BaseScriptComponent {
  @input
  typeLabelText!: Text

  @input
  bodyText!: Text

  @input
  statusText!: Text

  @input
  micButton!: Button
  @input
  micButtonLabel!: Text

  @input
  translateButton!: Button
  @input
  translateButtonLabel!: Text

  @input
  deleteButton!: Button
  @input
  deleteButtonLabel!: Text

  // A grab ball floating above the paper, pre-authored on the prefab. Its
  // InteractableManipulation targets this note's own root (manipulateRootSceneObject,
  // wired in the editor) with rotation/scale disabled, so pinch-dragging the ball
  // translates the whole note instead of the ball itself.
  @input
  dragHandleCollider!: ColliderComponent
  @input
  dragHandleManipulation!: InteractableManipulation

  private bodyScroll: ScrollWindow | null = null
  private micIconImage: Image | null = null
  private translateSpinner!: LoadingSpinner

  private noteId: string | null = null
  private siteId = ''
  private type: NoteType = 'plain'
  private currentText = ''
  private isListening = false
  private asrModule: AsrModule = require('LensStudio:AsrModule')
  // Grows across pauses instead of resetting on every new phrase — see its own comment
  // for the AsrModule behavior this exists to work around. Never reset while a note is
  // being dictated, only reseeded (via its text setter) after a manual edit, so
  // stopping/restarting the mic mid-note keeps everything said so far.
  private transcript = new IncrementalTranscript()
  private editField!: TextInputField

  init(opts: StickyNoteInit): void {
    this.type = opts.type
    this.siteId = opts.siteId
    this.noteId = opts.noteId ?? null
    this.currentText = opts.text ?? ''
    this.transcript.text = this.currentText

    const backPlate = this.sceneObject.getComponent(BackPlate.getTypeName()) as BackPlate
    themePanel(backPlate, COLOR.panelBgAlt)
    backPlate.size = new vec2(PANEL_W, PANEL_H)
    const skin = createPanelSkin(this.sceneObject, PAPER_NOTE_TEXTURE, TYPE_PAPER_TINT[this.type])
    resizePanelSkin(skin, backPlate.size, 0.5)
    // createPanelSkin appends PanelSkin as the newest child, but Content/Controls are
    // pre-authored and already existed before it — move them to the end now so they
    // render after (on top of) the skin, per Lens Studio's hierarchy-order render rule.
    // setParent to the CURRENT parent is a no-op for sibling order, so detach through
    // null first to force a real re-append. Without this the opaque paper skin (which
    // has depthWrite off, so only draw order — not Z — determines occlusion) paints
    // over the text and hides it.
    const contentNode = this.typeLabelText.sceneObject.getParent()
    const controlsNode = this.micButton.sceneObject.getParent()
    contentNode.setParent(null)
    contentNode.setParent(this.sceneObject)
    controlsNode.setParent(null)
    controlsNode.setParent(this.sceneObject)

    const innerW = PANEL_W - PAD * 2

    this.typeLabelText.text = TYPE_LABEL[this.type]
    this.typeLabelText.depthTest = true
    this.typeLabelText.font = HEADER_FONT
    this.typeLabelText.size = 38
    ;(this.typeLabelText as Text & { weight?: number }).weight = 700
    this.typeLabelText.textFill.color = TYPE_COLOR[this.type]
    this.typeLabelText.horizontalAlignment = HorizontalAlignment.Center
    this.typeLabelText.verticalAlignment = VerticalAlignment.Center
    this.typeLabelText.horizontalOverflow = HorizontalOverflow.Overflow
    this.typeLabelText.verticalOverflow = VerticalOverflow.Overflow
    this.typeLabelText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -1, 1)

    this.bodyText.text = this.currentText || (opts.isNew ? 'Tap mic to record...' : '')
    this.bodyText.depthTest = true
    this.bodyText.font = BODY_FONT
    this.bodyText.size = 39
    ;(this.bodyText as Text & { weight?: number }).weight = 500
    this.bodyText.textFill.color = INK
    this.bodyText.horizontalAlignment = HorizontalAlignment.Center
    // Top-anchored, not centered — the block starts at the viewport's top edge and
    // grows downward as text is added, which is what a scrollable text area needs
    // (a centered block would grow in both directions and drift out of the mask).
    this.bodyText.verticalAlignment = VerticalAlignment.Top
    this.bodyText.horizontalOverflow = HorizontalOverflow.Wrap
    // Vertically unbounded (Overflow + a tall layoutRect) — wrapping is governed by the
    // width bound only, so the text lays out its full real height regardless of the
    // viewport; the ScrollWindow's mask (not this bound) does the actual visual clipping.
    this.bodyText.verticalOverflow = VerticalOverflow.Overflow
    this.bodyText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -60, BODY_VIEWPORT_H / 2)

    // Wraps bodyText in a masked, draggable ScrollWindow viewport so notes longer than
    // the visible box scroll instead of spilling past the paper (see Prompt 48). Reuses
    // bodyText's own pre-authored local position for the wrapper, then recenters bodyText
    // to (0,0) inside it — keeps this independent of whatever position the prefab author
    // gave the Text object, no hardcoded coordinates needed.
    //
    // The position goes on a separate BodyScrollAnchor, not on BodyScrollWindow itself —
    // creating a ScrollWindow component resets its OWN SceneObject's local position to
    // (0,0,0) (confirmed scene-wide: every ScrollWindow in this project does this,
    // StickyNoteTemplate's own instance included), so setting it beforehand here was
    // silently discarded. setupEditControl() below reads this same anchor's position.
    const bodyParent = this.bodyText.sceneObject.getParent()
    const bodyLocalPos = this.bodyText.sceneObject.getTransform().getLocalPosition()
    const bodyAnchor = global.scene.createSceneObject('BodyScrollAnchor')
    bodyAnchor.setParent(bodyParent)
    bodyAnchor.getTransform().setLocalPosition(bodyLocalPos)
    const bodyWindow = global.scene.createSceneObject('BodyScrollWindow')
    bodyWindow.setParent(bodyAnchor)
    this.bodyText.sceneObject.setParent(bodyWindow)
    this.bodyText.sceneObject.getTransform().setLocalPosition(new vec3(0, 0, 0.05))
    this.bodyScroll = bodyWindow.createComponent(ScrollWindow.getTypeName()) as ScrollWindow
    this.bodyScroll.vertical = true
    this.bodyScroll.horizontal = false
    this.bodyScroll.windowSize = new vec2(innerW, BODY_VIEWPORT_H)
    this.updateBodyScrollExtent()

    this.statusText.text = ''
    this.statusText.depthTest = true
    this.statusText.font = BODY_FONT
    this.statusText.size = 38
    ;(this.statusText as Text & { weight?: number }).weight = 500
    this.statusText.textFill.color = new vec4(INK.x, INK.y, INK.z, 0.65)
    this.statusText.horizontalAlignment = HorizontalAlignment.Center
    this.statusText.verticalAlignment = VerticalAlignment.Center
    this.statusText.horizontalOverflow = HorizontalOverflow.Overflow
    this.statusText.verticalOverflow = VerticalOverflow.Overflow
    this.statusText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -1, 1)

    // Mic is icon-only (a round symbol, not the word "Mic") — shrunk to a compact
    // circle since it no longer needs room for text; a BeveledPrismVisual with
    // cornerRadius == size/2 renders as a true circle (see styleBackButton). Single
    // click starts recording, a second click stops it — matching the tap-to-toggle
    // pattern of NameEntryPanel's built-in TextInputField mic (see Prompt 48) rather
    // than the old press-and-hold. The icon and button tone swap (amber mic → red
    // stop) while listening as the visual "recording" cue.
    themeButton(this.micButton, 'amber', 1.2)
    this.micButton.size = new vec3(2.4, 2.4, 1)
    this.micButtonLabel.text = ''
    this.micIconImage = setButtonIcon(this.micButton, MIC_ICON, 1.4)
    this.micButton.onTriggerUp.add(() => {
      if (this.isListening) this.stopListening()
      else this.startListening()
    })

    this.setupTranslateDropdown()

    // Delete is icon-only, matching Mic/Back — a small danger-toned round trash icon
    // instead of a text label (see Prompt 48).
    themeButton(this.deleteButton, 'danger', 1.2)
    this.deleteButton.size = new vec3(2.4, 2.4, 1)
    this.deleteButtonLabel.text = ''
    setButtonIcon(this.deleteButton, DELETE_ICON, 1.4)
    this.deleteButton.onTriggerUp.add(() => this.deleteNote())

    this.setupEditControl(innerW)

    // A new note starts in "record" mode (Mic visible); a note loaded from Supabase
    // already has content, so it starts in "translate" mode (Mic never shown). Saving
    // a new note flips this permanently — see saveNote().
    this.micButton.sceneObject.enabled = opts.isNew
    this.translateButton.sceneObject.enabled = !opts.isNew

    // Radius matches the drag handle's authored sphere mesh + its 1.4x scale so the
    // hit target lines up with what's visually drawn.
    const handleShape = Shape.createSphereShape() as SphereShape
    handleShape.radius = 0.5
    this.dragHandleCollider.shape = handleShape

    // The prefab's Billboard component used to face the camera continuously, all the
    // time — turns each note into something that never settles, which reads as noisy
    // once several are placed around a site. Only look-at-camera at spawn (once, so the
    // note is legible wherever it lands) and while actively being dragged (so repositioning
    // it stays legible mid-move); frozen at whatever orientation it last had the rest of
    // the time.
    const billboard = this.sceneObject.getComponent(Billboard.getTypeName()) as Billboard | null
    if (billboard) {
      billboard.resetToLookAtCamera()
      billboard.enabled = false
      this.dragHandleManipulation.onManipulationStart.add(() => {
        billboard.enabled = true
      })
      this.dragHandleManipulation.onManipulationEnd.add(() => {
        billboard.enabled = false
      })
    }
    this.dragHandleManipulation.onManipulationEnd.add(() => this.persistPosition())

    // getBoundingBox() right after setting .text (above, same frame) can read back
    // stale/zero layout before the Text component has actually laid out the glyphs —
    // a harmless no-op for a short placeholder, but would under-measure a long note
    // loaded from Supabase. One deferred re-measure next tick, once layout has
    // definitely settled, closes that gap for loaded notes with real content.
    const remeasure = this.createEvent('DelayedCallbackEvent')
    remeasure.bind(() => this.updateBodyScrollExtent())
    remeasure.reset(0)
  }

  // Only a note that's already been saved has a row to update — an unsaved note's
  // position is captured fresh in saveNote() once it's first recorded, so dragging
  // it beforehand needs nothing persisted yet.
  private async persistPosition(): Promise<void> {
    if (!this.noteId) return
    const localPos = this.sceneObject.getTransform().getLocalPosition()
    const { error } = await supabaseUpdate('notes', `id=eq.${this.noteId}`, {
      anchor_offset: { x: localPos.x, y: localPos.y, z: localPos.z },
    })
    if (error) print('[StickyNote] Failed to persist dragged position: ' + error)
  }

  private async persistEditedText(): Promise<void> {
    if (!this.noteId) return
    this.statusText.text = 'Saving edit...'
    const { error } = await supabaseUpdate('notes', `id=eq.${this.noteId}`, { text_en: this.currentText })
    this.statusText.text = error ? 'Save failed' : 'Saved'
    if (error) print('[StickyNote] Failed to persist edited text: ' + error)
  }

  // Translate now opens a real dropdown of popular languages instead of cycling through
  // LANGUAGES on every tap (see Prompt 48) — attaches SpectaclesUIKit's own Dropdown
  // component directly onto the translateButton's SceneObject, wired with customTrigger
  // so it drives open/closed off our existing themed button rather than generating its
  // own generic one. Pool mode (setData) needs no per-language scene objects.
  private setupTranslateDropdown(): void {
    this.setupSmallButton(this.translateButton, this.translateButtonLabel, 'Translate ▾', 10.9, 'teal')

    // Just to the right of the button, at its own height — shown for the duration of the
    // translate() LLM call, which previously gave no feedback beyond the small status
    // line beneath the note (easy to miss while looking at the button itself).
    const btnLocalPos = this.translateButton.sceneObject.getTransform().getLocalPosition()
    this.translateSpinner = new LoadingSpinner(
      this,
      this.translateButton.sceneObject.getParent(),
      new vec3(btnLocalPos.x + 10.9 / 2 + 1.2, btnLocalPos.y, btnLocalPos.z),
      1.6
    )

    const dropdown = this.translateButton.sceneObject.createComponent(Dropdown.getTypeName()) as Dropdown
    dropdown.customTrigger = true
    dropdown.topButton = this.translateButton
    dropdown.hasTriggerBackground = false
    dropdown.selectionMode = 'single'
    dropdown.collapseOnSelect = true
    dropdown.itemHeight = 2.6
    dropdown.maxVisibleItems = LANGUAGES.length
    // Opens upward — translateButton sits low in the note, and an downward drawer
    // would have nowhere to go before running off the bottom of the panel.
    dropdown.expandUp = true
    // Without this, Dropdown shifts its own sceneObject (translateButton, since Dropdown
    // lives on that same object) to keep an "anchor edge" fixed as the drawer grows —
    // meant for a parent layout container (e.g. ElementGroup) to manage; nothing here
    // does that, so left at its default this would read as the whole button sliding as
    // the language list opens/closes (see the same fix in HistoryPanel's version
    // dropdown, Prompt 68, where this exact symptom got reported).
    dropdown.parentHandlesAnchor = true
    dropdown.startExpanded = false
    dropdown.setData(LANGUAGES.map((lang) => new DropdownOption(lang)))
    dropdown.onItemTapped.add(({ index }) => {
      if (index < 0 || index >= LANGUAGES.length) return
      this.translate(LANGUAGES[index])
    })
  }

  // A small icon button in the note's top-right corner (same spot regardless of which
  // of Mic/Translate happens to be showing below) that lets the technician fix ASR
  // mistakes by hand. Opens a TextInputField pre-filled with the note's current text —
  // tapping it calls the field's own public editMode(true), which requests Spectacles'
  // system keyboard the exact same way NameEntryPanel's "Your name" field already does.
  // That system keyboard is what actually owns cursor placement and text selection
  // (drag handles, tap-to-position, etc.) — nothing here reimplements any of that; this
  // component only supplies the starting text and reads back the final edited string.
  private setupEditControl(innerW: number): void {
    const typeLabelParent = this.typeLabelText.sceneObject.getParent()
    const typeLabelLocalPos = this.typeLabelText.sceneObject.getTransform().getLocalPosition()
    const editObj = global.scene.createSceneObject('EditButton')
    editObj.setParent(typeLabelParent)
    editObj.getTransform().setLocalPosition(new vec3(innerW / 2 - 1.2, typeLabelLocalPos.y, 0.5))
    const editButton = editObj.createComponent(Button.getTypeName()) as Button
    themeButton(editButton, 'teal', 1.2)
    editButton.size = new vec3(2.4, 2.4, 1)
    setButtonIcon(editButton, EDIT_ICON, 1.3)

    // Parented under the SAME BodyScrollAnchor the body's ScrollWindow lives under (see
    // that anchor's own comment) — bodyWindow itself always sits at local (0,0,0) inside
    // it, so (0,0,0.3) here lands this field at exactly the body's own position, one
    // step in front of it. When editing, this field replaces the scrollable body view
    // rather than sitting alongside it (both showing at once would just be two copies of
    // the same text).
    if (!this.bodyScroll) return
    const bodyWindowObj = this.bodyScroll.sceneObject
    const bodyAnchorObj = bodyWindowObj.getParent()
    const editFieldObj = global.scene.createSceneObject('EditField')
    editFieldObj.setParent(bodyAnchorObj)
    editFieldObj.getTransform().setLocalPosition(new vec3(0, 0, 0.3))
    this.editField = editFieldObj.createComponent(TextInputField.getTypeName()) as TextInputField
    this.editField.size = new vec3(innerW, 2.6, 1)
    // Hidden until Edit is tapped — a field sitting empty/unfocused over the note's own
    // body text would read as a second, blank text box.
    this.editField.sceneObject.enabled = false

    editButton.onTriggerUp.add(() => {
      this.editField.text = this.currentText
      this.editField.sceneObject.enabled = true
      bodyWindowObj.enabled = false
      this.editField.editMode(true)
    })

    // Fires false when the technician dismisses the keyboard (return key or tapping
    // away) — the field's own .text getter has whatever they left it as.
    this.editField.onEditMode.add((editing) => {
      if (editing) return
      this.currentText = this.editField.text
      // Reseeded, not reset — the NEXT phrase spoken should append onto this edit, not
      // onto whatever the transcript held before it (see IncrementalTranscript's own
      // text setter comment).
      this.transcript.text = this.currentText
      this.bodyText.text = this.currentText
      this.updateBodyScrollExtent()
      this.editField.sceneObject.enabled = false
      bodyWindowObj.enabled = true
      // A note not yet saved (still mid-dictation) has nothing to persist to yet —
      // saveNote() covers it once the mic is stopped. An already-saved note has no
      // other path that ever touches text_en (translate() is explicitly display-only),
      // so this is the only place a correction to an existing note reaches Supabase.
      if (this.noteId) this.persistEditedText()
    })
  }

  // Re-measures the wrapped body text's real rendered height (getBoundingBox reflects
  // the actual layout after wrapping at innerW, unlike estimating from character count)
  // and grows the ScrollWindow's content to match, so text longer than BODY_VIEWPORT_H
  // scrolls instead of spilling past the note.
  //
  // ScrollWindow's topEdge/bottomEdge (and so scrollPositionNormalized) assume content is
  // laid out symmetrically around the wrapper's own local origin — spanning
  // ±scrollDimensions.y/2 — the same convention SitePicker's site rows use
  // (`y = scrollH/2 - ROW_H/2 - i*...`). bodyText's own layoutRect top bound is a FIXED
  // +BODY_VIEWPORT_H/2 relative to itself (needed so wrapping/top-alignment work at all),
  // which only lines up with that assumption when content exactly fills the viewport. As
  // soon as content grows past it, that fixed anchor drifts away from the true
  // ±contentH/2 the scroll math expects — exactly the reported bug (dead space scrolled
  // up, unreachable bottom scrolled down, growing with how much text overflows). Fixed by
  // repositioning bodyText's own local Y each time so its fixed top-of-layoutRect anchor
  // (BODY_VIEWPORT_H/2 above bodyText's own origin) lands at contentH/2 — i.e. exactly
  // where a properly-centered content block's top edge would be.
  //
  // Always resets to the top rather than preserving whatever position the last scroll or
  // drag left it at — the default view of a note should always be its beginning.
  private updateBodyScrollExtent(): void {
    if (!this.bodyScroll) return
    const measured = this.bodyText.getBoundingBox().getSize().y
    const contentH = Math.max(BODY_VIEWPORT_H, measured + 0.4)
    this.bodyScroll.scrollDimensions = new vec2(-1, contentH)
    const bodyLocalY = (contentH - BODY_VIEWPORT_H) / 2
    this.bodyText.sceneObject.getTransform().setLocalPosition(new vec3(0, bodyLocalY, 0.05))
    this.bodyScroll.scrollPositionNormalized = new vec2(0, 1)
  }

  private setupSmallButton(btn: Button, label: Text, text: string, widthCM: number, tone: ButtonTone): void {
    themeButton(btn, tone)
    btn.size = new vec3(widthCM, 2.4, 1)
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

  private setMicIcon(tex: Texture): void {
    if (!this.micIconImage) return
    const mat = this.micIconImage.getMaterial(0)
    if (mat) mat.mainPass.baseTex = tex
  }

  private async startListening(): Promise<void> {
    if (this.isListening) return
    this.isListening = true
    this.statusText.text = 'Listening... (tap mic to stop)'
    themeButton(this.micButton, 'danger', 1.2)
    this.setMicIcon(STOP_ICON)
    print('[StickyNote] ASR start')

    // One global AsrModule means one transcription session shared by every mic in this
    // app (this note, other notes, Ask AI, Work Session narration) — see AsrSession.ts.
    // Dictating into one note and walking away without tapping stop used to leave that
    // session open and break the next mic tapped anywhere in the app.
    await releaseSharedMic(this, 'StickyNote')
    if (!this.isListening) return

    const opts = AsrModule.AsrTranscriptionOptions.create()
    opts.silenceUntilTerminationMs = 1500
    opts.mode = AsrModule.AsrMode.HighAccuracy

    opts.onTranscriptionUpdateEvent.add((e: AsrModule.TranscriptionUpdateEvent) => {
      this.currentText = this.transcript.update(e)
      this.bodyText.text = this.currentText
      this.updateBodyScrollExtent()
      print('[StickyNote] ASR partial="' + e.text + '" final=' + e.isFinal)
    })
    opts.onTranscriptionErrorEvent.add((code: AsrModule.AsrStatusCode) => {
      print('[StickyNote] ASR error code=' + code)
      this.statusText.text = 'ASR error: ' + code
      this.isListening = false
      themeButton(this.micButton, 'amber', 1.2)
      this.setMicIcon(MIC_ICON)
    })

    try {
      this.asrModule.startTranscribing(opts)
    } catch (err) {
      print('[StickyNote] ASR start exception: ' + err)
      this.isListening = false
      themeButton(this.micButton, 'amber', 1.2)
      this.setMicIcon(MIC_ICON)
    }
  }

  private stopListening(): void {
    if (!this.isListening) return
    this.isListening = false
    themeButton(this.micButton, 'amber', 1.2)
    this.setMicIcon(MIC_ICON)
    this.asrModule.stopTranscribing().then(() => {
      print('[StickyNote] ASR stopped')
      this.statusText.text = 'Saving...'
      this.saveNote()
    })
  }

  private async saveNote(): Promise<void> {
    if (!this.currentText.trim()) {
      this.statusText.text = 'No speech captured'
      return
    }
    const localPos = this.sceneObject.getTransform().getLocalPosition()
    const { data, error } = await supabaseInsert<{ id: string }>('notes', {
      site_id: this.siteId,
      type: this.type,
      text_en: this.currentText,
      anchor_offset: { x: localPos.x, y: localPos.y, z: localPos.z },
      created_by: getTechnicianName(),
    })
    if (error || !data || data.length === 0) {
      print('[StickyNote] Save failed: ' + error)
      this.statusText.text = 'Save failed'
      return
    }
    this.noteId = data[0].id
    this.statusText.text = 'Saved'
    // Swap the mic control for the translate control now that the note has content.
    this.micButton.sceneObject.enabled = false
    this.translateButton.sceneObject.enabled = true
  }

  private async deleteNote(): Promise<void> {
    if (this.noteId) {
      // Hard delete, not the old deleted=true soft-delete — requires the DELETE RLS
      // policy from supabase/migrations/0003_notes_delete_policy.sql. If that migration
      // hasn't been run yet, this comes back permission-denied and the row survives in
      // Supabase even though it disappears from this Lens session; logged, not surfaced
      // to statusText since the note object is destroyed right after either way.
      const { error } = await supabaseDelete('notes', `id=eq.${this.noteId}`)
      if (error) print('[StickyNote] Delete failed: ' + error)
    }
    this.sceneObject.destroy()
  }

  private async translate(language: string): Promise<void> {
    this.statusText.text = 'Translating to ' + language + '...'
    this.translateSpinner.show()
    try {
      // Was previously "translate FROM English" (and English itself skipped the LLM
      // entirely, just echoing currentText back) — but AsrModule has no language
      // parameter to pin transcription to a specific language (its deprecated
      // predecessor, VoiceML.ListeningOptions.languageCode, is explicitly documented as
      // no longer supported and points back to AsrModule, which has nothing equivalent),
      // and the `text_en` column name is aspirational, not enforced — a technician
      // speaking Spanish/etc. produces a transcript that's genuinely in that language,
      // not mislabeled English. So this can no longer assume the stored text is English:
      // every option, including English, now asks the model to detect the actual source
      // language first and translate from that, so "Translate to English" on a non-English
      // transcript does real work instead of just echoing the untranslated text back.
      const response = await OpenAI.chatCompletions({
        model: 'gpt-4.1-nano',
        messages: [
          {
            role: 'system',
            content: `The field note below may be written in any language, regardless of what its labeling implies. Detect its actual language, then translate it to ${language}. If it is already in ${language}, return it unchanged. Reply with only the translated text, no quotes, no extra commentary.`,
          },
          { role: 'user', content: this.currentText },
        ],
        temperature: 0.2,
      })
      const translated = response.choices[0].message.content as string
      this.bodyText.text = translated
      this.updateBodyScrollExtent()
      this.statusText.text = 'Translated to ' + language + ' (display only)'
    } catch (err) {
      print('[StickyNote] Translate failed: ' + err)
      this.statusText.text = 'Translate failed'
    } finally {
      this.translateSpinner.hide()
    }
  }
}
