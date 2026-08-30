import { BackPlate } from 'SpectaclesUIKit.lspkg/Scripts/BackPlate'
import { Button } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button'
import { ScrollWindow } from 'SpectaclesUIKit.lspkg/Scripts/Components/ScrollWindow/ScrollWindow'
import Event, { PublicApi } from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { supabaseSelect } from '../Backend/SupabaseClient'
import { themeButton, themePanel, styleBackButton } from '../Shared/ThemedUI'
import { COLOR, HEADER_FONT, BUTTON_FONT, BODY_FONT, BACK_ICON } from '../Shared/Theme'
import { getTechnicianName } from '../Shared/TechnicianIdentity'
import { GpsIndicator } from './GpsIndicator'

// Permission declaration only — RawLocationModule has no members of its own; the
// actual API surface (GeoLocation, LocationService, GeoPosition) is ambient/global.
require('LensStudio:RawLocationModule')

// Haversine great-circle distance in km — sites are real-world job sites kilometers
// (not meters) apart, so this flat approximation is more than accurate enough for
// sorting/display and avoids pulling in a full geodesy library for one calculation.
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m away` : `${km.toFixed(1)} km away`
}

// ── Typography: single source of truth for size + weight + font role ─────────
const FONT_SIZE_SCALE = 1.0
type TextRole = 'Title1' | 'Title2' | 'HeadlineXL' | 'Headline1' | 'Headline2' | 'Subheadline' | 'Button' | 'Callout' | 'Body' | 'Caption'
type FontRole = 'header' | 'button' | 'body'
// fontRole is a string, not a captured Font reference — Theme.ts's HEADER_FONT etc. are
// `let` exports FontManager.ts can reassign at runtime, and baking a Font *value* into
// this table at module-load time (evaluated before FontManager's OnAwake ever runs)
// would freeze every role onto whatever font was default, silently ignoring an
// Inspector-swapped font. Resolving the role to a live Theme.ts read on every
// applyTextRole() call is what makes the swap actually take effect.
const TYPE_SCALE: Record<TextRole, { size: number; weight: number; fontRole: FontRole }> = {
  Title1: { size: 105, weight: 700, fontRole: 'header' },
  Title2: { size: 93, weight: 700, fontRole: 'header' },
  HeadlineXL: { size: 62, weight: 700, fontRole: 'header' },
  Headline1: { size: 54, weight: 700, fontRole: 'header' },
  Headline2: { size: 48, weight: 700, fontRole: 'header' },
  Subheadline: { size: 41, weight: 700, fontRole: 'header' },
  Button: { size: 39, weight: 500, fontRole: 'button' },
  Callout: { size: 39, weight: 700, fontRole: 'button' },
  Body: { size: 39, weight: 500, fontRole: 'body' },
  Caption: { size: 38, weight: 500, fontRole: 'body' },
}
function resolveFont(role: FontRole): Font {
  return role === 'header' ? HEADER_FONT : role === 'button' ? BUTTON_FONT : BODY_FONT
}
function roleSize(role: TextRole, distanceCm: number = 110): number {
  return TYPE_SCALE[role].size * FONT_SIZE_SCALE * (distanceCm / 110)
}
function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = roleSize(role, distanceCm)
  t.font = resolveFont(TYPE_SCALE[role].fontRole)
  ;(t as Text & { weight?: number }).weight = TYPE_SCALE[role].weight
}

const PANEL_W = 26
// Fixed, like every sibling panel — NOT recomputed at runtime from content (see the
// prompt log for why: an async dynamic resize once corrupted this panel's collider into
// a Z-bloated volume that blocked pinches on other panels). The site list lives inside
// a fixed-size scrollable viewport now instead of growing the panel itself, so a fixed
// panel height works regardless of how many sites are onboarded.
const PANEL_H = 28
const PAD = 1.6
const ROW_H = 3.2
const ROW_GAP = 1.2
// Visible rows before the list scrolls — beyond this, ScrollWindow (SpectaclesUIKit)
// clips and drags the rest into view instead of the panel growing to fit everyone.
const VIEWPORT_ROWS = 3
const VIEWPORT_H = VIEWPORT_ROWS * ROW_H + (VIEWPORT_ROWS - 1) * ROW_GAP
// "Accurately on" a site — GeoLocationAccuracy.High is documented accurate to ~30m, so
// 50m gives a margin above that noise floor rather than requiring a suspiciously exact
// match that real hardware jitter would rarely produce.
const ACCURACY_THRESHOLD_KM = 0.05
// BeveledPrismVisual's opaque body is physically ~0.5cm deep at rest (size.z=1,
// half-depth 0.5) and pops forward another 0.3cm on hover — labels must clear the
// worst case (0.5 + 0.3 + a small epsilon) or they render inside/behind the solid
// prism and disappear.
const BUTTON_LABEL_Z = 0.95

export interface SiteSelection {
  siteId: string
  siteName: string
  customLocationId: string | null
}

interface SiteRow {
  id: string
  name: string
  custom_location_id: string | null
  latitude: number
  longitude: number
}

// Header/BackToMenu/ChangeName/GpsIndicator/SiteListScroll are pre-authored in the
// editor scene — real Transforms the user can drag in the Scene panel. Only the site
// *rows* inside the scroll viewport are created at runtime, since their count depends
// on what's in Supabase.
@component
export class SitePicker extends BaseScriptComponent {
  @input
  headerText!: Text

  @input
  backButton!: Button
  @input
  backButtonLabel!: Text

  @input
  changeNameButton!: Button
  @input
  changeNameButtonLabel!: Text

  @input
  siteListScroll!: ScrollWindow

  @input
  gpsIndicator!: GpsIndicator

  @input
  statusText!: Text

  private content!: SceneObject
  private backPlate!: BackPlate
  private currentPosition: GeoPosition | null = null
  private hasBegunSearch = false
  private _onSiteSelected = new Event<SiteSelection>()
  private _onBackRequested = new Event<void>()
  private _onChangeNameRequested = new Event<void>()
  private _onReopened = new Event<void>()

  get onSiteSelected(): PublicApi<SiteSelection> {
    return this._onSiteSelected.publicApi()
  }

  get onBackRequested(): PublicApi<void> {
    return this._onBackRequested.publicApi()
  }

  get onChangeNameRequested(): PublicApi<void> {
    return this._onChangeNameRequested.publicApi()
  }

  // Fires when this panel becomes visible again after the very first time (i.e. a
  // genuine "Switch Site" reopen, not the initial launch flow) — see the OnEnableEvent
  // handler in init(). CustomLocationLoader listens for this to hide the outgoing site's
  // notes immediately on reopen, instead of leaving them visible until a new site is
  // actually picked.
  get onReopened(): PublicApi<void> {
    return this._onReopened.publicApi()
  }

  // Only meaningful once a menu exists to go back to (i.e. a site was already chosen
  // once before) — PanelManager toggles this when re-opening the picker via "Switch Site".
  setBackVisible(visible: boolean): void {
    this.backButton.sceneObject.enabled = visible
  }

  // Called by PanelManager exactly when it's about to show this panel — NOT run from
  // OnStartEvent/init(). It used to be: the instant the Lens booted, unconditionally,
  // regardless of whether Site Picker was actually the panel on screen. That broke the
  // very flow it exists for: for a first-time technician (Name Entry shown first), this
  // panel's own SceneObject ("UI" at scene root) runs its OnStartEvent BEFORE
  // PanelManager's even decides which panel to show — confirmed directly by reading the
  // scene hierarchy, "UI" sits earlier in root sibling order than "PanelManager", and
  // script execution follows hierarchy order. So the whole search→found sequence,
  // including the amber ring's animation, ran to completion entirely behind the Name
  // Entry screen — invisible — and had already finished (or been wiped back to idle by
  // the very next OnEnableEvent below) by the time the technician ever actually looked at
  // this panel. For a *returning* technician, PanelManager shows this panel immediately at
  // boot, so the old timing happened to look right by coincidence — which is exactly why
  // this only ever showed up on the first-time flow.
  //
  // Guarded to run only once ever: a later "Switch Site" reopen must NOT re-trigger this
  // — it would immediately re-select the same nearest site via GPS and bounce straight
  // back to Main Menu, defeating "Switch Site" as a manual override (see the
  // OnEnableEvent handler below, which still runs its own lighter reset on every reopen).
  beginSearch(): void {
    if (this.hasBegunSearch) return
    this.hasBegunSearch = true
    this.setStatus('Finding nearby sites...')
    this.gpsIndicator.startSearching()
    this.resolveLocation().then(() => this.loadSites())
  }

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init())
  }

  private init(): void {
    this.content = this.headerText.sceneObject.getParent()
    this.backPlate = this.sceneObject.getComponent(BackPlate.getTypeName()) as BackPlate
    themePanel(this.backPlate, COLOR.panelBg)
    this.backPlate.size = new vec2(PANEL_W, PANEL_H)
    // No logo here — GpsIndicator already occupies this panel's top area with its own
    // amber ring animation; a second target-shaped mark right next to it read as
    // cluttered/duplicated rather than as branding.

    const innerW = PANEL_W - PAD * 2

    this.headerText.text = 'Select Site'
    this.headerText.depthTest = true
    applyTextRole(this.headerText, 'Title2')
    this.headerText.horizontalAlignment = HorizontalAlignment.Center
    this.headerText.verticalAlignment = VerticalAlignment.Center
    this.headerText.horizontalOverflow = HorizontalOverflow.Overflow
    this.headerText.verticalOverflow = VerticalOverflow.Overflow
    this.headerText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -2, 2)

    styleBackButton(this.backButton, this.backButtonLabel, BACK_ICON)
    this.backButton.onTriggerUp.add(() => this._onBackRequested.invoke())
    this.backButton.sceneObject.enabled = false

    themeButton(this.changeNameButton, 'teal')
    this.changeNameButton.size = new vec3(innerW, 2.2, 1)
    this.styleButtonLabel(this.changeNameButtonLabel, this.changeNameLabelText(), innerW - 0.5)
    this.changeNameButton.onTriggerUp.add(() => this._onChangeNameRequested.invoke())

    this.siteListScroll.vertical = true
    this.siteListScroll.horizontal = false
    this.siteListScroll.windowSize = new vec2(innerW, VIEWPORT_H)
    this.siteListScroll.scrollDimensions = new vec2(-1, VIEWPORT_H)

    // The stored name may not exist yet at build time (a brand-new technician who
    // hasn't saved one) — refresh the label every time this panel actually becomes
    // visible so it never shows stale text from before their first save. Also resets
    // the GPS badge to idle here — init() (and so the badge's search/confirm state)
    // only ever runs once, so re-opening this panel via "Switch Site" after an earlier
    // auto-select left the "Loading your '<site>' site" confirmation visual stuck on
    // screen even though the list underneath was already fully loaded and interactive.
    // Doesn't re-run the search/auto-select itself — that would immediately re-select
    // the same nearest site and bounce straight back to Main Menu, defeating the whole
    // point of "Switch Site" as a manual override.
    this.createEvent('OnEnableEvent').bind(() => {
      this.changeNameButtonLabel.text = this.changeNameLabelText()
      this.gpsIndicator.resetToIdle()
      this._onReopened.invoke()
    })
  }

  private changeNameLabelText(): string {
    return `Not ${getTechnicianName()}? Tap to change`
  }

  // Gives the device up to 4s to produce a GPS fix before the site list renders, so
  // sites can be sorted nearest-first (and checked against ACCURACY_THRESHOLD_KM for
  // auto-selection) on first paint instead of popping into a new order after the list
  // is already visible. Resolves either way — a technician without location permission,
  // indoors with no fix, or in Lens Studio Preview (which has no real GPS provider)
  // still gets a fully working list, just in DB order with no distance labels.
  private async resolveLocation(): Promise<void> {
    const locationService = GeoLocation.createLocationService()
    locationService.accuracy = GeoLocationAccuracy.High
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      locationService.getCurrentPosition(
        (pos) => {
          this.currentPosition = pos
          finish()
        },
        (err) => {
          print('[SitePicker] Location unavailable: ' + err)
          finish()
        }
      )
      const timeout = this.createEvent('DelayedCallbackEvent')
      timeout.bind(() => finish())
      timeout.reset(4)
    })
  }

  private async loadSites(): Promise<void> {
    const { data, error } = await supabaseSelect<SiteRow>(
      'sites',
      'select=id,name,custom_location_id,latitude,longitude&order=created_at.asc'
    )
    if (error) {
      print('[SitePicker] Failed to load sites: ' + error)
      this.gpsIndicator.stopSearching()
      this.setStatus('Could not load sites')
      this.changeNameButton.sceneObject.enabled = true
      return
    }

    const rows = data ?? []
    if (rows.length === 0) {
      this.gpsIndicator.stopSearching()
      this.setStatus('No sites onboarded yet')
      this.changeNameButton.sceneObject.enabled = true
      return
    }

    // The list always renders first, even when a site is about to be auto-selected
    // below — so there's something concrete on screen (and the site the technician's
    // about to be dropped into is visible in context) rather than jumping straight from
    // "searching" to a confirmation overlay with nothing behind it.
    const sorted = this.sortByProximity(rows)
    this.renderSiteList(sorted)
    this.gpsIndicator.stopSearching()
    this.changeNameButton.sceneObject.enabled = true

    // "Accurately on a site" — the nearest sorted result is within ACCURACY_THRESHOLD_KM
    // of the current GPS fix. Plays out as a confirmation overlay on top of the
    // now-visible list, then closes this panel the same way a manual tap would.
    const nearest = sorted[0]
    if (this.currentPosition && this.hasKnownLocation(nearest) && this.distanceKm(nearest) <= ACCURACY_THRESHOLD_KM) {
      await this.gpsIndicator.showFound(nearest.name)
      this._onSiteSelected.invoke({
        siteId: nearest.id,
        siteName: nearest.name,
        customLocationId: nearest.custom_location_id,
      })
    }
  }

  private renderSiteList(sorted: SiteRow[]): void {
    this.setStatus('')
    const scrollH = this.contentHeight(sorted.length)
    this.siteListScroll.scrollDimensions = new vec2(-1, scrollH)
    sorted.forEach((site, i) => {
      const y = scrollH / 2 - ROW_H / 2 - i * (ROW_H + ROW_GAP)
      this.addSiteRow(site, y)
    })
    // ScrollWindow's default scroll position (0,0) centers the *middle* of the content
    // in the viewport — with more than a viewport's worth of rows, that opens on some
    // arbitrary middle row instead of the nearest (first) one. Scroll to the top edge
    // so the list always opens showing the nearest sites, scrolling down for the rest.
    this.siteListScroll.scrollPosition = new vec2(0, VIEWPORT_H / 2 - scrollH / 2)
  }

  private contentHeight(rowCount: number): number {
    const raw = rowCount * ROW_H + Math.max(0, rowCount - 1) * ROW_GAP
    return Math.max(raw, VIEWPORT_H)
  }

  // Nearest-first when a GPS fix is available; unchanged DB order otherwise. Sites
  // with no known coordinates (latitude/longitude both 0 — the placeholder every site
  // gets until its onboarding step assigns real coordinates, same idea as
  // custom_location_id) sort to the end rather than falsely reading as "0km away".
  private sortByProximity(rows: SiteRow[]): SiteRow[] {
    if (!this.currentPosition) return rows
    return rows
      .map((row) => ({ row, distanceKm: this.hasKnownLocation(row) ? this.distanceKm(row) : null }))
      .sort((a, b) => {
        if (a.distanceKm === null && b.distanceKm === null) return 0
        if (a.distanceKm === null) return 1
        if (b.distanceKm === null) return -1
        return a.distanceKm - b.distanceKm
      })
      .map((entry) => entry.row)
  }

  private hasKnownLocation(site: SiteRow): boolean {
    return site.latitude !== 0 || site.longitude !== 0
  }

  private distanceKm(site: SiteRow): number {
    return haversineKm(this.currentPosition!.latitude, this.currentPosition!.longitude, site.latitude, site.longitude)
  }

  private distanceSuffix(site: SiteRow): string {
    if (!this.currentPosition || !this.hasKnownLocation(site)) return ''
    return ' — ' + formatDistance(this.distanceKm(site))
  }

  // Single pre-authored status label (loading / empty / error) shown in place of the
  // scroll viewport — toggled via text content rather than created/destroyed per call,
  // since its position never needs to move (the list around it is what scrolls).
  private setStatus(message: string): void {
    this.statusText.text = message
    this.statusText.depthTest = true
    applyTextRole(this.statusText, 'Caption')
    this.statusText.textFill.color = new vec4(1, 1, 1, 0.55)
    this.statusText.horizontalAlignment = HorizontalAlignment.Center
    this.statusText.verticalAlignment = VerticalAlignment.Center
    this.statusText.horizontalOverflow = HorizontalOverflow.Overflow
    this.statusText.verticalOverflow = VerticalOverflow.Overflow
    const innerW = PANEL_W - PAD * 2
    this.statusText.layoutRect = Rect.create(-innerW / 2, innerW / 2, -1, 1)
  }

  private addSiteRow(site: SiteRow, y: number): void {
    const rowW = PANEL_W - PAD * 2
    const so = global.scene.createSceneObject(site.name || 'Site')
    this.siteListScroll.addObject(so)
    so.getTransform().setLocalPosition(new vec3(0, y, 0))

    const btn = so.createComponent(Button.getTypeName()) as Button
    themeButton(btn, 'amber')
    btn.size = new vec3(rowW, ROW_H, 1)
    const label = (site.name || 'Untitled site') + this.distanceSuffix(site)
    this.addButtonLabel(so, label, rowW - 0.5)

    btn.onTriggerUp.add(() => {
      this._onSiteSelected.invoke({
        siteId: site.id,
        siteName: site.name,
        customLocationId: site.custom_location_id,
      })
    })
  }

  private styleButtonLabel(t: Text, text: string, widthCM: number): void {
    t.text = text
    t.depthTest = true
    applyTextRole(t, 'Button')
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.2, 1.2)
  }

  private addButtonLabel(parent: SceneObject, text: string, widthCM: number): Text {
    const so = global.scene.createSceneObject('ButtonLabel')
    so.setParent(parent)
    so.getTransform().setLocalPosition(new vec3(0, 0, BUTTON_LABEL_Z))
    const t = so.createComponent('Component.Text') as Text
    this.styleButtonLabel(t, text, widthCM)
    return t
  }
}
