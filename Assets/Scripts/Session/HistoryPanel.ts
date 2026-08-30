import { BackPlate } from 'SpectaclesUIKit.lspkg/Scripts/BackPlate'
import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button'
import { Dropdown, DropdownOption } from 'SpectaclesUIKit.lspkg/Scripts/Components/Dropdown/Dropdown'
import Event, { PublicApi } from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { SitePicker } from '../Site/SitePicker'
import { supabaseSelect, supabasePublicUrl } from '../Backend/SupabaseClient'
import { ImageViewer } from './ImageViewer'
import { themeButton, themePanel, styleBackButton, setButtonIcon, createPanelSkin, resizePanelSkin } from '../Shared/ThemedUI'
import { COLOR, HEADER_FONT, BUTTON_FONT, BODY_FONT, BACK_ICON } from '../Shared/Theme'

// "Pin" here means a paperclip holding the page, not a map/push pin — the first two
// picks (Material Symbols "pin", then "pin_drop") were both location-marker shapes and
// wrong for this. "attach_file" is the standard paperclip glyph.
const PIN_ICON = requireAsset('../../Icons/attach_file.png') as Texture
// A central node with radiating connections — reads as "linked atoms" and doubles as a
// generic AI/network glyph, replacing the earlier robot-head icon.
const AI_ICON = requireAsset('../../Icons/hub.png') as Texture
// Tiny in-line "open this photo" button rendered next to each "(N)" marker in the
// summary text — see renderPageMarkers().
const PHOTO_LINK_ICON = requireAsset('../../Icons/photo_camera.png') as Texture
// A clean, plain white paper texture generated specifically for this report — NOT
// StickyNote's PAPER_NOTE_TEXTURE, which is a yellowed, torn legal-pad skin meant for
// sticky notes and rendered visibly yellow here even under a light tint. This is its own
// asset: soft grain, no discoloration, no tears.
const REPORT_PAPER_TEXTURE = requireAsset('../../Generated Textures/CleanPaperTexture.png') as Texture

// Dark "ink on paper" tone, matching StickyNote's own paper-texture convention — once the
// panel got the actual paper skin below, the previous near-white text became too low
// contrast against it.
const INK = new vec4(0.22, 0.17, 0.1, 0.95)

const PANEL_W = 26
// Taller than a bare fit around the text — this is meant to read as an actual sheet of
// paper (with the skin below), not just a tight text-measurement box, so it carries
// real margin above/below the content the way a printed page would.
const PANEL_H = 24
const PAD = 1.6
const ROW_H = 2.6
const MAX_PHOTOS = 6
// Per-page text budget — a page's rendered height must fit within this, checked live via
// Text.getBoundingBox() during pagination (see paginate()), not estimated from length.
const DETAIL_WINDOW_H = 18
// Diameter of each inline "(N)" photo-marker button — deliberately much smaller than any
// other button in the app (StickyNote's icon-only Mic/Delete are 2.4cm); this one sits
// directly beside a couple of small text characters, not on its own row.
const MARKER_BUTTON_SIZE = 1.3
// Gap between a marker's own highlighted text rect and the button placed beside it.
const MARKER_BUTTON_GAP = 0.2
// Reserves real, visible blank room after every "(N)" marker for the button to occupy —
// without this the button had nowhere to sit that wasn't on top of either the marker
// itself or the next word, regardless of how precisely it was positioned. Must survive
// paginate()'s word-splitting intact — see that function's own comment for why it no
// longer collapses whitespace runs down to one space per rebuild.
const MARKER_PADDING = '       '

interface SummaryRow {
  version_number: number
  summary_text: string
  equipment_mentioned: string[]
  parts_changed: string[]
  created_at: string
  session_id: string
  // Embedded via PostgREST's foreign-key expansion (summaries.session_id ->
  // sessions.id) rather than a second round-trip per version — singular object, not an
  // array, since this side of the relationship is many-summaries-to-one-session.
  sessions: { technician_name: string | null } | null
}

interface CaptureRow {
  storage_path: string
}

interface TimelineRow {
  kind: 'image' | 'transcript_chunk'
  text_content: string | null
}

// Menu/Header/VersionLabel/PrevVersion/NextVersion/DetailText/ViewPhotos are pre-authored
// in the editor scene — real Transforms the user can select and drag in the Scene panel.
// This script only wires theme/behavior/content onto the existing objects; it never calls
// createSceneObject/createComponent for these. The Prev/Next nav row was previously laid
// out with FlexLayout for two children — now fixed hand-placed positions instead, since
// the row's child count never changes and this keeps it draggable like everything else.
@component
export class HistoryPanel extends BaseScriptComponent {
  @input
  sitePicker!: SitePicker

  @input
  imageViewer!: ImageViewer

  @input
  menuButton!: Button
  @input
  menuButtonLabel!: Text

  @input
  headerText!: Text

  @input
  versionLabel!: Text

  // Decorative paperclip pinned to the paper's corner — pre-authored so its exact
  // position/rotation can be dragged to look right in the Scene panel instead of guessed
  // in code (see buildPanel()).
  @input
  reportPaperclip!: Image

  @input
  prevButton!: Button
  @input
  prevButtonLabel!: Text

  @input
  nextButton!: Button
  @input
  nextButtonLabel!: Text

  @input
  detailText!: Text

  @input
  photosButton!: Button
  @input
  photosButtonLabel!: Text

  private versions: SummaryRow[] = []
  private versionIndex = 0
  private currentSiteId: string | null = null
  private currentSessionId: string | null = null
  // The AI summary, and (lazily, on first tap of the Transcript tab) the session's raw
  // narrated speech — both for the CURRENT version, each split into page-sized chunks
  // (see paginate()). null means "not fetched yet for this version" (see setViewMode()),
  // distinct from an empty array (fetched, but nothing was said).
  private summaryPages: string[] = []
  private transcriptPages: string[] | null = null
  private viewMode: 'summary' | 'transcript' = 'summary'
  // The pages actually on screen right now — mirrors summaryPages or transcriptPages
  // depending on viewMode; every other method (navigatePage, jumpToMarker, showPage)
  // just reads this, so they don't need to know which mode is active.
  private pages: string[] = []
  private pageIndex = 0
  private summaryTabButton!: Button
  private transcriptTabButton!: Button
  // Byline for the CURRENT version, not part of the paginated page content — set once
  // per version in showVersion(), unlike everything else here which changes per page.
  // Kept out of the paginated text entirely rather than appended as its own page: the
  // DETAIL_WINDOW_H fit-budget/pagination machinery is already fragile enough (see
  // paginate()'s own comment on the getBoundingBox() rate limit) without giving it a
  // reason to reflow every time a version is opened.
  private authorText!: Text
  private versionDropdown!: Dropdown
  private versionButtonLabel!: Text
  // Pool of reusable inline "(N)" photo-marker buttons — see renderPageMarkers(). Sized
  // for MAX_PHOTOS since a page can never reference more distinct photos than a session
  // actually captured.
  private markerButtons: { obj: SceneObject; state: { photoNumber: number } }[] = []

  private _onBackRequested = new Event<void>()
  get onBackRequested(): PublicApi<void> {
    return this._onBackRequested.publicApi()
  }

  // Small "AI" button on the report — jumps straight to the Ask AI panel instead of
  // making the technician back out to Main Menu first.
  private _onAskAIRequested = new Event<void>()
  get onAskAIRequested(): PublicApi<void> {
    return this._onAskAIRequested.publicApi()
  }

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init())
  }

  private init(): void {
    this.buildPanel()
    this.sitePicker.onSiteSelected.add((selection) => {
      this.currentSiteId = selection.siteId
      this.loadVersions(selection.siteId)
    })
    // ImageViewer already fires the 1-based photo number on every navigation (Prev/Next,
    // or the initial show()) — jump the report to whichever page references that photo's
    // "(N)" marker, so flipping through images and flipping through pages stay in sync.
    this.imageViewer.onNavigate.add((photoNumber) => this.jumpToMarker(photoNumber))
    // loadVersions() above only ever fires from a fresh site SELECTION — it never re-runs
    // just because this panel becomes visible again. That meant ending a Work Session
    // (which stores a brand-new version via SessionSummarizer) and going straight to
    // Version History from Main Menu showed whatever versions existed back when the site
    // was originally picked, missing the one just created. Re-fetching on every reopen —
    // not just the first time a site is chosen — keeps this in sync with data created
    // elsewhere in the app since the panel was last shown.
    this.createEvent('OnEnableEvent').bind(() => {
      if (this.currentSiteId) this.loadVersions(this.currentSiteId)
    })
  }

  private async loadVersions(siteId: string): Promise<void> {
    this.setDetailText('Loading history...')
    const { data, error } = await supabaseSelect<SummaryRow>(
      'summaries',
      `select=version_number,summary_text,equipment_mentioned,parts_changed,created_at,session_id,sessions(technician_name)&site_id=eq.${siteId}&order=version_number.desc`
    )
    if (error) {
      print('[HistoryPanel] Failed to load versions: ' + error)
      this.setDetailText('Could not load history')
      return
    }
    this.versions = data ?? []
    this.versionDropdown.setData(
      this.versions.map((v) => new DropdownOption(`v${v.version_number} — ${this.formatDate(v.created_at)}`))
    )
    if (this.versions.length === 0) {
      this.versionButtonLabel.text = 'No versions'
      this.setDetailText('No session history yet for this site')
      return
    }
    this.versionIndex = 0
    this.showVersion()
  }

  // Called from the version dropdown's onItemTapped — index matches this.versions
  // directly since setData() above is built from that same array, in the same order.
  private selectVersion(index: number): void {
    if (index < 0 || index >= this.versions.length) return
    this.versionIndex = index
    this.showVersion()
  }

  private async showVersion(): Promise<void> {
    const row = this.versions[this.versionIndex]
    const requestedIndex = this.versionIndex
    this.versionButtonLabel.text = `v${row.version_number} ▾`
    this.currentSessionId = row.session_id
    const author = row.sessions?.technician_name?.trim()
    this.authorText.text = author ? `— ${author}` : ''
    this.transcriptPages = null
    this.viewMode = 'summary'
    this.updateModeTabs()
    this.setDetailText('Loading...')
    const pages = await this.buildPages(row)
    // The technician may have picked a different version while this was paginating —
    // don't clobber that newer selection with a stale result.
    if (this.versionIndex !== requestedIndex) return
    this.summaryPages = pages
    this.pages = this.summaryPages
    this.pageIndex = 0
    this.showPage()
  }

  // Switches between the AI summary and this version's raw narrated transcript — the two
  // were discussed early on as both worth keeping (the summary for a quick read, the raw
  // narration for when the exact wording matters), but nothing in the UI ever exposed the
  // raw side; session_captures held it, unread, from the moment SessionSummarizer
  // consumed it into a summary and nothing else. Transcript pages are fetched once per
  // version and cached (transcriptPages), not re-fetched on every tab switch.
  private async setViewMode(mode: 'summary' | 'transcript'): Promise<void> {
    if (this.viewMode === mode) return
    this.viewMode = mode
    this.pageIndex = 0
    this.updateModeTabs()

    if (mode === 'summary') {
      this.pages = this.summaryPages
      this.showPage()
      return
    }

    if (this.transcriptPages) {
      this.pages = this.transcriptPages
      this.showPage()
      return
    }

    this.pages = ['Loading transcript...']
    this.showPage()
    const sessionIdAtRequest = this.currentSessionId
    const loaded = await this.loadTranscript()
    // The technician may have switched versions (or tabs) while this was in flight —
    // don't clobber whatever's on screen now with a stale result for a session that's no
    // longer the one being viewed.
    if (this.currentSessionId !== sessionIdAtRequest || this.viewMode !== 'transcript') return
    this.transcriptPages = loaded
    this.pages = loaded
    this.pageIndex = 0
    this.showPage()
  }

  // Interleaves "(N)" photo markers into the raw narration at the exact chronological
  // point each photo was captured — SessionSummarizer already does the equivalent for the
  // AI summary (its own "[Photo N captured here]" markers, numbered the same way: a
  // straight count of `kind=image` rows in captured_at order), so reusing that numbering
  // here means photo N means the same photo in both views. Literal "(N)" — the same
  // format the AI writes into the summary — is what lets renderPageMarkers() light up a
  // real tappable button here too, with no separate rendering path needed.
  private async loadTranscript(): Promise<string[]> {
    if (!this.currentSessionId) return ['No transcript available']
    const { data, error } = await supabaseSelect<TimelineRow>(
      'session_captures',
      `select=kind,text_content&session_id=eq.${this.currentSessionId}&order=captured_at.asc`
    )
    if (error) {
      print('[HistoryPanel] Failed to load transcript: ' + error)
      return ['Could not load transcript']
    }
    const rows = data ?? []
    const parts: string[] = []
    let photoNumber = 0
    for (const row of rows) {
      if (row.kind === 'transcript_chunk' && row.text_content) {
        parts.push(row.text_content)
      } else if (row.kind === 'image') {
        photoNumber++
        parts.push(`(${photoNumber})${MARKER_PADDING}`)
      }
    }
    const hasNarration = rows.some((row) => row.kind === 'transcript_chunk' && row.text_content)
    if (!hasNarration) return ['No narration was recorded during this session']
    return this.paginate(parts.join(' '))
  }

  private updateModeTabs(): void {
    themeButton(this.summaryTabButton, this.viewMode === 'summary' ? 'amber' : 'teal')
    themeButton(this.transcriptTabButton, this.viewMode === 'transcript' ? 'amber' : 'teal')
  }

  // Splits the version's summary/equipment/parts into pages that each fit
  // DETAIL_WINDOW_H — equipment and parts always start their own fresh page (a cleaner
  // read than letting them run on from wherever the summary prose happened to end).
  private async buildPages(row: SummaryRow): Promise<string[]> {
    const pages: string[] = []
    // The AI writes "(N)" markers directly into summary_text with no reserved room after
    // them (it has no reason to know a button will sit there) — pad them here, the same
    // way loadTranscript() bakes MARKER_PADDING in at the source for its own markers.
    pages.push(...(await this.paginate(row.summary_text.replace(/\((\d+)\)/g, `($1)${MARKER_PADDING}`))))
    if (row.equipment_mentioned?.length) {
      pages.push(...(await this.paginate(`Equipment: ${row.equipment_mentioned.join(', ')}`)))
    }
    if (row.parts_changed?.length) {
      pages.push(...(await this.paginate(`Parts changed: ${row.parts_changed.join(', ')}`)))
    }
    return pages.length ? pages : ['No summary available']
  }

  // Measures the REAL rendered height via Text.getBoundingBox() (same technique used for
  // StickyNote's scrollable body — see Prompt 48) rather than estimating from character
  // count, since wrapped line count depends on the font and the panel's actual width.
  // getBoundingBox() (a host function) turned out to have a per-frame call-rate limit —
  // confirmed live, twice: the original word-by-word version hit "Per frame rate limit
  // exceeded for this function" on a long summary, and yielding every 10 words (the
  // first attempt at fixing that) *still* hit it — whatever the real limit is, it's
  // lower than that.
  //
  // Rewritten around two changes instead of just a smaller yield interval: (1) binary
  // search for how many words fit on each page, needing roughly log2(words-per-page)
  // measurements instead of one per word — far fewer calls overall for the same text;
  // (2) yields after literally every single measurement via a real UpdateEvent tick
  // (not a 0-second DelayedCallbackEvent, which evidently doesn't reliably cross an
  // actual rendered-frame boundary the way this rate limit is counted), so at most one
  // getBoundingBox() call ever happens per frame, regardless of what the limit actually
  // is. Slower in wall-clock terms (each page now takes a handful of frames instead of
  // being instant) but that's invisible against "Loading..." already showing, and it
  // can't overrun the limit no matter how long a summary gets.
  private async paginate(text: string): Promise<string[]> {
    if (text.trim() === '') return []
    // Split on a single literal space, not `/\s+/` — and keep empty tokens rather than
    // filtering them out. A run of N consecutive spaces becomes N-1 empty strings between
    // real words, which `.join(' ')` below reconstructs exactly the same way it was split
    // (`['a','','b'].join(' ')` is `'a  b'`, two spaces). The old whitespace-collapsing
    // split normalized MARKER_PADDING's reserved gap after every "(N)" marker straight
    // back down to a single space every time a page got rebuilt — the actual visible
    // cause of the photo-marker button overlapping the word right after it, not a
    // positioning bug in renderPageMarkers() at all.
    const words = text.split(' ')
    const pages: string[] = []
    let start = 0
    while (start < words.length) {
      const remaining = words.length - start
      let lo = 1
      let hi = remaining
      while (lo < hi) {
        const mid = lo + Math.ceil((hi - lo) / 2)
        const fits = await this.measureFits(words, start, mid)
        if (fits) lo = mid
        else hi = mid - 1
      }
      // Math.max(1, lo) guarantees forward progress even in the pathological case where
      // a single word alone doesn't fit — without it, a page could measure 0 words and
      // `start` would never advance, looping forever.
      const count = Math.max(1, lo)
      pages.push(words.slice(start, start + count).join(' '))
      start += count
    }
    return pages
  }

  // One measurement: does this many words (from `start`) fit within DETAIL_WINDOW_H?
  // Always yields a real frame afterward — see paginate()'s own comment for why.
  private async measureFits(words: string[], start: number, count: number): Promise<boolean> {
    this.detailText.text = words.slice(start, start + count).join(' ')
    const h = this.detailText.getBoundingBox().getSize().y
    await this.waitOneFrame()
    return h <= DETAIL_WINDOW_H
  }

  // A real rendered-frame boundary — an UpdateEvent tick — not a 0-second
  // DelayedCallbackEvent, which paginate()'s history shows doesn't reliably count as
  // "the next frame" for whatever enforces the getBoundingBox() rate limit.
  private waitOneFrame(): Promise<void> {
    return new Promise((resolve) => {
      const ev = this.createEvent('UpdateEvent')
      ev.bind(() => {
        ev.enabled = false
        resolve()
      })
    })
  }

  // Prev/Next now flips PAGES within the current version — version switching moved to
  // the dropdown (see selectVersion()), freeing this row up for the thing a report reader
  // actually flips through most: pages.
  private navigatePage(delta: number): void {
    if (this.pages.length === 0) return
    this.pageIndex = (this.pageIndex + delta + this.pages.length) % this.pages.length
    this.showPage()
  }

  private showPage(): void {
    const page = this.pages[this.pageIndex] ?? ''
    const counter = this.pages.length > 1 ? `Page ${this.pageIndex + 1} of ${this.pages.length}\n\n` : ''
    this.setDetailText(counter + page)
    this.renderPageMarkers(counter, page)
  }

  // Places a tiny tappable camera icon directly beside every "(N)" reference on the page
  // currently on screen — tapping one opens that exact photo in the Image Viewer, even if
  // the viewer isn't currently open (see ImageViewer.show()). Runs for both tabs:
  // loadTranscript() now interleaves the same literal "(N)" markers into the raw
  // narration (at the exact chronological point each photo was captured), not just the
  // AI summary — so this needs no per-mode branching, a marker found here is real either
  // way.
  //
  // Text.getBoundingBox()/getHighlightRects() both take an optional character range and
  // return it in the SAME local-space coordinates as the Text component's own layoutRect
  // — confirmed directly in Support/StudioLib.d.ts — so a marker's on-screen position can
  // be measured exactly rather than estimated.
  //
  // Reading getHighlightRects() back in the SAME synchronous tick as setDetailText() (as
  // this used to) is exactly the mistake StickyNote.init() already has a standing comment
  // about for getBoundingBox(): "right after setting .text (above, same frame) can read
  // back stale/zero layout before the Text component has actually laid out the glyphs."
  // That's the layout-dependent Text APIs generally, not something specific to
  // getBoundingBox() — and it explains the live-reported symptom exactly: one marker on a
  // page landing correctly while another, on the SAME page, visibly overlapped the words
  // after it — inconsistent per-marker error is what stale internal glyph layout looks
  // like, not a math bug (the position formula itself is the same for every marker).
  // Yielding one real frame first (waitOneFrame() — the same UpdateEvent-based helper
  // paginate() already relies on, not a 0-second DelayedCallbackEvent, which this file's
  // own history shows doesn't reliably count as "the next frame" for this engine) gives
  // layout a chance to actually settle to the just-assigned text before it's measured.
  private async renderPageMarkers(counter: string, page: string): Promise<void> {
    this.markerButtons.forEach((m) => (m.obj.enabled = false))

    const markerRegex = /\((\d+)\)/g
    const matches: RegExpExecArray[] = []
    let match: RegExpExecArray | null
    while ((match = markerRegex.exec(page)) !== null) matches.push(match)
    if (matches.length === 0) return

    await this.waitOneFrame()

    let used = 0
    for (const m of matches) {
      const photoNumber = parseInt(m[1], 10)
      const start = counter.length + m.index
      const end = start + m[0].length
      const rects = this.detailText.getHighlightRects(start, end)
      if (rects.length === 0) continue
      const rect = rects[0]
      const center = rect.getCenter()
      const halfW = rect.getSize().x / 2

      const entry = this.getOrCreateMarkerButton(used)
      entry.state.photoNumber = photoNumber
      entry.obj.getTransform().setLocalPosition(
        new vec3(center.x + halfW + MARKER_BUTTON_GAP + MARKER_BUTTON_SIZE / 2, center.y, 0.15)
      )
      entry.obj.enabled = true
      used++
    }
  }

  private getOrCreateMarkerButton(i: number): { obj: SceneObject; state: { photoNumber: number } } {
    if (this.markerButtons[i]) return this.markerButtons[i]
    // Parented directly under detailText's own SceneObject — that's the same node
    // getHighlightRects()'s coordinates are relative to, so a rect's center can be used
    // as a local position here with no extra offset math. detailText already renders on
    // top of the paper skin (see buildPanel()'s Content re-append), so a plain child of
    // it inherits that same correct draw order automatically.
    const obj = global.scene.createSceneObject('PhotoMarkerButton' + i)
    obj.setParent(this.detailText.sceneObject)
    const btn = obj.createComponent(Button.getTypeName()) as Button
    themeButton(btn, 'teal', MARKER_BUTTON_SIZE / 2)
    btn.size = new vec3(MARKER_BUTTON_SIZE, MARKER_BUTTON_SIZE, 1)
    setButtonIcon(btn, PHOTO_LINK_ICON, MARKER_BUTTON_SIZE * 0.62)
    const state = { photoNumber: 0 }
    // Bound once, reads `state.photoNumber` at tap time — reused buttons just get their
    // state mutated on the next renderPageMarkers() call rather than being torn down and
    // rebuilt (or accumulating duplicate listeners) every time a page changes.
    btn.onTriggerUp.add(() => this.openImageAtMarker(state.photoNumber))
    const entry = { obj, state }
    this.markerButtons[i] = entry
    return entry
  }

  private formatDate(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleDateString ? d.toDateString() : iso
  }

  private setDetailText(text: string): void {
    this.detailText.text = text
  }

  // photoNumber is 1-based (matches the "(1)", "(2)" markers — both the AI's own
  // annotation in the summary, and now the same literal markers loadTranscript()
  // interleaves into the raw narration). Finds whichever page contains that marker and
  // flips straight to it — the point of keeping images linked to the report instead of
  // them being two unrelated views of the same session. Still always lands on the
  // Summary tab specifically (switching back to it if Transcript happened to be open) —
  // a deliberate choice, not a limitation: the summary is the shorter, curated read, so
  // it's the more useful place to land when jumping in from a photo, even though the
  // transcript would also contain a valid match now.
  private jumpToMarker(photoNumber: number): void {
    const markerPattern = new RegExp(`\\([^)]*\\b${photoNumber}\\b[^)]*\\)`)
    const idx = this.summaryPages.findIndex((p) => p.includes(`(${photoNumber})`) || markerPattern.test(p))
    if (idx === -1) {
      print(`[HistoryPanel] No (${photoNumber}) reference found in the current summary`)
      return
    }
    this.viewMode = 'summary'
    this.pages = this.summaryPages
    this.pageIndex = idx
    this.updateModeTabs()
    this.showPage()
  }

  private async viewPhotos(): Promise<void> {
    const urls = await this.loadSessionPhotoUrls()
    if (urls) this.imageViewer.show(urls)
  }

  // photoNumber is 1-based, matching the "(N)" markers — see renderPageMarkers(). Opens
  // the Image Viewer directly at that photo, regardless of whether it was already open.
  private async openImageAtMarker(photoNumber: number): Promise<void> {
    const urls = await this.loadSessionPhotoUrls()
    if (urls) this.imageViewer.show(urls, photoNumber - 1)
  }

  private async loadSessionPhotoUrls(): Promise<string[] | null> {
    if (!this.currentSessionId) return null
    const { data, error } = await supabaseSelect<CaptureRow>(
      'session_captures',
      `select=storage_path&session_id=eq.${this.currentSessionId}&kind=eq.image&order=captured_at.asc&limit=${MAX_PHOTOS}`
    )
    if (error) {
      print('[HistoryPanel] Failed to load photos: ' + error)
      return null
    }
    return (data ?? []).map((row) => supabasePublicUrl('session-captures', row.storage_path))
  }

  private buildPanel(): void {
    const backPlate = this.sceneObject.getComponent(BackPlate.getTypeName()) as BackPlate
    themePanel(backPlate, COLOR.panelBg)
    // Shrunk from 32 to just fit the page itself (detailText's own DETAIL_WINDOW_H, plus
    // padding) — this panel now IS the page. Everything else (heading, version selector,
    // AI button, page nav, View Photos) moved outside its bounds, floating above/below,
    // the same convention already used for back buttons and logos elsewhere in the app.
    backPlate.size = new vec2(PANEL_W, PANEL_H)

    // Actual paper texture — REPORT_PAPER_TEXTURE, a plain white paper generated
    // specifically for this panel (not StickyNote's yellowed PAPER_NOTE_TEXTURE, which
    // stayed visibly yellow here even under a light tint — a different asset was needed,
    // not just a different tint). Toned down slightly from the raw texture's own
    // brightness (a light warm-gray multiply, not pure white) so it reads as paper rather
    // than a glowing white card. createPanelSkin appends the skin as the newest child,
    // but Content already existed before it — re-parenting through null forces it to the
    // end of the sibling list so it renders after (on top of) the skin, matching the same
    // fix StickyNote needed for the same reason (the skin is opaque with depthWrite off,
    // so only draw order — not Z — determines what's on top).
    const skin = createPanelSkin(this.sceneObject, REPORT_PAPER_TEXTURE, new vec4(0.88, 0.87, 0.84, 1))
    resizePanelSkin(skin, backPlate.size, 0.3)
    const contentNode = this.detailText.sceneObject.getParent()
    contentNode.setParent(null)
    contentNode.setParent(this.sceneObject)
    // reportPaperclip is pre-authored too, so it's an *earlier* sibling than the skin
    // the instant the skin gets created above — same re-append needed, or it renders
    // behind the opaque skin and disappears.
    this.reportPaperclip.sceneObject.setParent(null)
    this.reportPaperclip.sceneObject.setParent(this.sceneObject)

    const innerW = PANEL_W - PAD * 2
    // Row shared by the header, version dropdown, and AI button — floats above the
    // panel's own top edge. Computed from PANEL_H rather than hardcoded so it can't drift
    // back out of sync with the panel and start colliding again if PANEL_H ever changes
    // (exactly what happened between Prompt 63 and this one: the panel grew from 16 to
    // 24 but this row stayed at its old fixed Y, so it ended up overlapping the new,
    // taller panel instead of floating above it).
    const chromeRowY = PANEL_H / 2 + 3.2

    styleBackButton(this.menuButton, this.menuButtonLabel, BACK_ICON)
    this.menuButton.onTriggerUp.add(() => this._onBackRequested.invoke())

    this.headerText.sceneObject.getTransform().setLocalPosition(new vec3(0, chromeRowY, 0))
    this.headerText.text = 'Version History'
    this.headerText.depthTest = true
    this.headerText.font = HEADER_FONT
    this.headerText.size = 41
    ;(this.headerText as Text & { weight?: number }).weight = 700
    this.headerText.textFill.color = COLOR.amberBright
    this.headerText.horizontalAlignment = HorizontalAlignment.Center
    this.headerText.verticalAlignment = VerticalAlignment.Center
    this.headerText.horizontalOverflow = HorizontalOverflow.Overflow
    this.headerText.verticalOverflow = VerticalOverflow.Overflow
    // Right bound pulled in (not the full innerW) — the version button + AI button sit
    // on this same row, top-right (see below); a full-width centered title would run
    // into them.
    this.headerText.layoutRect = Rect.create(-innerW / 2, innerW / 2 - 7.5, -2, 2)

    // The old centered "Version N of M — date" label is retired — version display/
    // selection moved to the button+dropdown on the right (below), and the page counter
    // now lives inline in detailText (see showPage()). Left disabled rather than deleted,
    // in case a future layout wants a dedicated left-aligned label again.
    this.versionLabel.sceneObject.enabled = false

    // Paperclip — purely decorative, top-left corner, giving the report the "clipped
    // sheet of paper" look. A pre-authored SceneObject (reportPaperclip), not created/
    // positioned at runtime like before — getting the clip to visually grip the corner
    // is a fiddly by-eye judgment call, better done by dragging it in the Scene panel
    // than guessing coordinates in code. This only wires the texture/tint/material.
    const pinMat = (requireAsset('../../Materials/ImageMaterial.mat') as Material).clone()
    pinMat.mainPass.depthTest = true
    pinMat.mainPass.depthWrite = false
    pinMat.mainPass.baseTex = PIN_ICON
    // Bright, cool-toned silver for a "shining" polished-metal read — not the amber/
    // danger accent tones, a paperclip's own color isn't part of the brand palette, and
    // the amber border already carries the accent here. This is a flat unlit material
    // (no specular/lighting response), so true shine isn't achievable — pushing the tint
    // brighter and cooler than a flat mid-gray is what reads as "polished" rather than
    // "dull metal" within that constraint.
    pinMat.mainPass.baseColor = new vec4(0.95, 0.96, 0.99, 1)
    this.reportPaperclip.clearMaterials()
    this.reportPaperclip.addMaterial(pinMat)

    // Version selector (dropdown) + small AI button, top-right — replaces the old
    // centered version label. Both are created at runtime (same pattern as StickyNote's
    // Translate dropdown) rather than pre-authored, since neither existed on this panel
    // before. A visible gap (GAP) separates the two — they used to sit flush against
    // each other with zero space in between.
    const GAP = 0.9
    const aiButtonObj = global.scene.createSceneObject('AskAIButton')
    aiButtonObj.setParent(this.sceneObject)
    aiButtonObj.getTransform().setLocalPosition(new vec3(innerW / 2 - 1.3, chromeRowY, 0))
    const aiButton = aiButtonObj.createComponent(Button.getTypeName()) as Button
    themeButton(aiButton, 'amber', 1.1)
    aiButton.size = new vec3(2.2, 2.2, 1)
    setButtonIcon(aiButton, AI_ICON, 1.3)
    aiButton.onTriggerUp.add(() => this._onAskAIRequested.invoke())

    // "AI" caption below the icon — a bare icon with no label reads ambiguous; this spells
    // out what the button does without needing a wide, full-word button like Translate's.
    const aiLabelObj = global.scene.createSceneObject('AskAIButtonLabel')
    aiLabelObj.setParent(aiButtonObj)
    aiLabelObj.getTransform().setLocalPosition(new vec3(0, -2.0, 0.95))
    const aiLabel = aiLabelObj.createComponent('Component.Text') as Text
    aiLabel.text = 'AI'
    aiLabel.depthTest = true
    aiLabel.font = BUTTON_FONT
    aiLabel.size = 30
    ;(aiLabel as Text & { weight?: number }).weight = 600
    aiLabel.textFill.color = COLOR.amberBright
    aiLabel.horizontalAlignment = HorizontalAlignment.Center
    aiLabel.verticalAlignment = VerticalAlignment.Center
    aiLabel.horizontalOverflow = HorizontalOverflow.Overflow
    aiLabel.verticalOverflow = VerticalOverflow.Overflow
    aiLabel.layoutRect = Rect.create(-2, 2, -0.9, 0.9)

    const versionButtonObj = global.scene.createSceneObject('VersionButton')
    versionButtonObj.setParent(this.sceneObject)
    // Local Z pushed forward (toward the camera side, matching identity-rotation content
    // elsewhere in this app — see HandAttach's own comment on the same convention) —
    // the drawer was reading as visually behind/blended into the paper panel below it
    // even though sibling draw order already puts it on top; a small forward push makes
    // that separation unambiguous instead of relying on draw order alone.
    versionButtonObj.getTransform().setLocalPosition(new vec3(innerW / 2 - 1.3 - 1.1 - GAP - 2.6, chromeRowY, 1.5))
    const versionButton = versionButtonObj.createComponent(Button.getTypeName()) as Button
    themeButton(versionButton, 'teal')
    versionButton.size = new vec3(5.2, 2.2, 1)
    const versionLabelObj = global.scene.createSceneObject('VersionButtonLabel')
    versionLabelObj.setParent(versionButtonObj)
    versionLabelObj.getTransform().setLocalPosition(new vec3(0, 0, 0.95))
    this.versionButtonLabel = versionLabelObj.createComponent('Component.Text') as Text
    this.styleButtonLabel(this.versionButtonLabel, 'v— ', 4.6)

    this.versionDropdown = versionButtonObj.createComponent(Dropdown.getTypeName()) as Dropdown
    this.versionDropdown.customTrigger = true
    this.versionDropdown.topButton = versionButton
    this.versionDropdown.hasTriggerBackground = false
    this.versionDropdown.selectionMode = 'single'
    this.versionDropdown.collapseOnSelect = true
    this.versionDropdown.itemHeight = 2.6
    this.versionDropdown.maxVisibleItems = 5
    // Opens downward — expandUp briefly fixed the drawer running into the panel below,
    // but reads unnatural for a dropdown (Prompt 69). Reverted: the drawer overlaying the
    // top of the panel when open is normal popover behavior, not a bug, as long as it
    // actually renders on top — which it does here, since it's created later in this
    // function than the paper skin (see the skin/Content re-append above), and Lens
    // Studio draws later same-parent siblings over earlier ones regardless of Z.
    this.versionDropdown.expandUp = false
    // Without this, Dropdown itself shifts its OWN sceneObject (the trigger button, since
    // Dropdown lives on the same object as versionButton) down on expand to keep an
    // "anchor edge" fixed as the drawer grows — meant for when a parent layout container
    // (e.g. ElementGroup) is the one managing that compensation. Nothing here does that,
    // so left at its default this reads as the whole button sliding down every time the
    // drawer opens. Setting this stops Dropdown from moving the trigger at all — only the
    // drawer itself grows/shrinks, the button it hangs off of stays put.
    this.versionDropdown.parentHandlesAnchor = true
    this.versionDropdown.startExpanded = false
    this.versionDropdown.onItemTapped.add(({ index }) => this.selectVersion(index))

    // Dropdown's own default drawer background is a near-transparent gray (Snap's stock
    // theme) — barely visible against this panel's cream paper skin, which read as the
    // version list having no background at all, just floating text overlapping the paper
    // content behind it. No public setter for this exists (same situation as BackPlate's
    // own background — see themePanel's own comment), so this reaches the same private
    // `bgRect` the component sets internally, the same "as unknown as" pattern already
    // used in this codebase for exactly this class of gap.
    const dropdownBg = (this.versionDropdown as unknown as { bgRect?: { backgroundColor: vec4 } }).bgRect
    if (dropdownBg) dropdownBg.backgroundColor = COLOR.tealDim

    // Page nav — Prev/Next now flips pages within the current version instead of
    // switching versions (that moved to the dropdown above). Same pre-authored objects,
    // repositioned below the (now much shorter) panel instead of inside it — chrome
    // lives outside the page, only the page itself lives inside.
    const belowPanelY = -PANEL_H / 2 - 2.0
    const navW = (innerW - 1.0) / 2
    themeButton(this.prevButton, 'teal')
    this.prevButton.size = new vec3(navW, ROW_H, 1)
    this.prevButton.sceneObject.getTransform().setLocalPosition(new vec3(-(navW / 2 + 0.5), belowPanelY, 0))
    this.styleButtonLabel(this.prevButtonLabel, '< Prev', navW - 0.5)
    this.prevButton.onTriggerUp.add(() => this.navigatePage(-1))

    themeButton(this.nextButton, 'teal')
    this.nextButton.size = new vec3(navW, ROW_H, 1)
    this.nextButton.sceneObject.getTransform().setLocalPosition(new vec3(navW / 2 + 0.5, belowPanelY, 0))
    this.styleButtonLabel(this.nextButtonLabel, 'Next >', navW - 0.5)
    this.nextButton.onTriggerUp.add(() => this.navigatePage(1))

    // Summary / Transcript tabs — pinned to the PAGE itself (inside the panel, in the
    // margin above where detailText's content starts), not to the floating chrome row.
    // Deliberately not up there with the header/version dropdown/AI button: those float
    // above the panel and have to be repositioned by hand whenever PANEL_H changes (see
    // the collision this same panel just had two prompts ago) — pinning these to the
    // panel's own frame instead means they can never drift out of sync with it.
    const tabY = PANEL_H / 2 - 1.8
    const tabW = 6.4
    const summaryTabObj = global.scene.createSceneObject('SummaryTab')
    summaryTabObj.setParent(this.sceneObject)
    summaryTabObj.getTransform().setLocalPosition(new vec3(-(tabW / 2 + 0.2), tabY, 0))
    this.summaryTabButton = summaryTabObj.createComponent(Button.getTypeName()) as Button
    this.summaryTabButton.size = new vec3(tabW, 2.0, 1)
    const summaryTabLabelObj = global.scene.createSceneObject('SummaryTabLabel')
    summaryTabLabelObj.setParent(summaryTabObj)
    summaryTabLabelObj.getTransform().setLocalPosition(new vec3(0, 0, 0.95))
    const summaryTabLabel = summaryTabLabelObj.createComponent('Component.Text') as Text
    this.styleButtonLabel(summaryTabLabel, 'Summary', tabW - 0.6)
    this.summaryTabButton.onTriggerUp.add(() => this.setViewMode('summary'))

    const transcriptTabObj = global.scene.createSceneObject('TranscriptTab')
    transcriptTabObj.setParent(this.sceneObject)
    transcriptTabObj.getTransform().setLocalPosition(new vec3(tabW / 2 + 0.2, tabY, 0))
    this.transcriptTabButton = transcriptTabObj.createComponent(Button.getTypeName()) as Button
    this.transcriptTabButton.size = new vec3(tabW, 2.0, 1)
    const transcriptTabLabelObj = global.scene.createSceneObject('TranscriptTabLabel')
    transcriptTabLabelObj.setParent(transcriptTabObj)
    transcriptTabLabelObj.getTransform().setLocalPosition(new vec3(0, 0, 0.95))
    const transcriptTabLabel = transcriptTabLabelObj.createComponent('Component.Text') as Text
    this.styleButtonLabel(transcriptTabLabel, 'Transcript', tabW - 0.6)
    this.transcriptTabButton.onTriggerUp.add(() => this.setViewMode('transcript'))

    this.updateModeTabs()

    // detailText now shows one PAGE at a time (see paginate()/showPage()) instead of the
    // whole summary as one long block — DETAIL_WINDOW_H is the per-page fit budget
    // pagination measures against, not just a generously-sized catch-all box anymore.
    // Recentered to (0,0) — the panel is now sized around this text specifically, rather
    // than this text being one region within a much taller stack of other content.
    this.detailText.sceneObject.getTransform().setLocalPosition(new vec3(0, 0, 0))
    this.detailText.text = 'Select a site to view its history'
    this.detailText.depthTest = true
    this.detailText.font = BODY_FONT
    this.detailText.size = 38
    ;(this.detailText as Text & { weight?: number }).weight = 500
    // Dark ink, not the white COLOR.textPrimary this used against the old flat panel —
    // white on the new cream paper skin would be nearly unreadable.
    this.detailText.textFill.color = INK
    this.detailText.horizontalAlignment = HorizontalAlignment.Center
    this.detailText.verticalAlignment = VerticalAlignment.Top
    this.detailText.horizontalOverflow = HorizontalOverflow.Wrap
    this.detailText.verticalOverflow = VerticalOverflow.Overflow
    this.detailText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -DETAIL_WINDOW_H / 2, DETAIL_WINDOW_H / 2)

    // Byline — sits in the real margin between detailText's own max extent
    // (DETAIL_WINDOW_H/2) and the panel's actual edge (PANEL_H/2), so it can never
    // overlap paginated content no matter how a page reflows. Muted/small, like a real
    // report's signature line, not competing with the page content above it.
    const authorObj = global.scene.createSceneObject('AuthorText')
    authorObj.setParent(contentNode)
    authorObj.getTransform().setLocalPosition(new vec3(0, -(PANEL_H / 2 - 1.2), 0.05))
    this.authorText = authorObj.createComponent('Component.Text') as Text
    this.authorText.text = ''
    this.authorText.depthTest = true
    this.authorText.font = BODY_FONT
    this.authorText.size = 30
    ;(this.authorText as Text & { weight?: number }).weight = 500
    this.authorText.textFill.color = new vec4(INK.r, INK.g, INK.b, 0.6)
    this.authorText.horizontalAlignment = HorizontalAlignment.Center
    this.authorText.verticalAlignment = VerticalAlignment.Center
    this.authorText.horizontalOverflow = HorizontalOverflow.Overflow
    this.authorText.verticalOverflow = VerticalOverflow.Overflow
    this.authorText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -0.9, 0.9)

    themeButton(this.photosButton, 'amber')
    this.photosButton.size = new vec3(innerW, ROW_H, 1)
    this.photosButton.sceneObject
      .getTransform()
      .setLocalPosition(new vec3(0, belowPanelY - ROW_H / 2 - 1.0 - ROW_H / 2, 0))
    this.styleButtonLabel(this.photosButtonLabel, 'View Photos', innerW - 0.5)
    this.photosButton.onTriggerUp.add(() => this.viewPhotos())
  }

  private styleButtonLabel(t: Text, text: string, widthCM: number): void {
    t.text = text
    t.depthTest = true
    t.font = BUTTON_FONT
    t.size = 38
    ;(t as Text & { weight?: number }).weight = 500
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.1, 1.1)
  }
}
