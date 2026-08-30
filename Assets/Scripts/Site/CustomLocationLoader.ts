import Event, { PublicApi } from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import { SitePicker } from './SitePicker'

export interface LocationActivation {
  siteId: string
  contentNode: SceneObject
}

export interface LocationUnavailable {
  siteId: string
  siteName: string
  reason: 'not_onboarded' | 'node_missing'
}

// One bundled entry per mapping — same `@typedef` pattern as SiteOnboarder's
// `SiteEntry` (confirmed precedent: SpectaclesUIKit's `Callback`, SIK's
// `HandVisualOverrideItem`). Renders as a single "+ Add Value" list in the
// Inspector instead of two parallel arrays that could fall out of sync by index.
@typedef
export class LocationMapping {
  @input
  @hint('The Location ID from your scanned Custom Location AR asset.')
  locationId: string = ''

  @input
  @hint('Exact name of the "Custom Location: <Name>" SceneObject under SiteRoot for this location — see README.md.')
  nodeName: string = ''
}

// Maps a site's `custom_location_id` (from Supabase) to the pre-wired Custom
// Location SceneObject for it — entered in the Inspector below, not hand-edited
// here. Every onboarded site needs its Custom Location node's name added as a
// row — see CLAD_PROMPT_LOG.md for why this has to be wired at Editor time
// rather than resolved dynamically at runtime.
//
// Populated into this mutable lookup by CustomLocationLoader's own onAwake() —
// same "manager sets shared module state before anyone reads it" pattern as
// FontManager/Theme.ts and SupabaseCredentials/SupabaseClient.ts. Every
// object's onAwake runs before any object's OnStartEvent, so this is always
// populated before activate() (fired off a site-selection event) or
// SiteOnboarder's onboarding (fired off its own OnStartEvent) ever read it,
// regardless of where CustomLocationLoader sits in the hierarchy.
let nodeNameByLocationId: Record<string, string> = {}

// Exported so SiteOnboarder.ts can warn when a site is registered in Supabase
// with a location ID that has no scene node wired up yet — see README.md.
export function getNodeNameForLocation(locationId: string): string | undefined {
  return nodeNameByLocationId[locationId]
}

@component
export class CustomLocationLoader extends BaseScriptComponent {
  @input
  sitePicker!: SitePicker

  @input
  siteRoot!: SceneObject

  @input
  @label('Location Mappings')
  @hint('One row per onboarded site\'s Custom Location — Location ID (from the scan) and the exact SceneObject name it was wired up as under SiteRoot.')
  locationMappings: LocationMapping[] = []

  private activeNode: SceneObject | null = null
  private _onLocationActivated = new Event<LocationActivation>()
  private _onLocationUnavailable = new Event<LocationUnavailable>()

  get onLocationActivated(): PublicApi<LocationActivation> {
    return this._onLocationActivated.publicApi()
  }

  // Fires instead of onLocationActivated when the selected site has no scanned Custom
  // Location yet — consumers like NotePlacer use this to show a clear "this site isn't
  // set up for notes yet" message instead of the generic (and, for this case,
  // misleading) "Select a site first".
  get onLocationUnavailable(): PublicApi<LocationUnavailable> {
    return this._onLocationUnavailable.publicApi()
  }

  onAwake(): void {
    nodeNameByLocationId = {}
    for (const mapping of this.locationMappings) {
      const locationId = (mapping.locationId ?? '').trim()
      const nodeName = (mapping.nodeName ?? '').trim()
      if (locationId && nodeName) nodeNameByLocationId[locationId] = nodeName
    }

    this.createEvent('OnStartEvent').bind(() => {
      this.sitePicker.onSiteSelected.add((selection) => {
        this.activate(selection.siteId, selection.siteName, selection.customLocationId)
      })
      // Reopening Site Picker (tapping "Switch Site") used to leave the outgoing site's
      // Custom Location node — and every note anchored under it — enabled and visible
      // until a *new* site was actually picked, since activate() only ever runs on
      // selection. A technician browsing the list to switch away from a site doesn't
      // want its notes still cluttering the view while they decide; deactivate
      // immediately on reopen instead of waiting for the next selection.
      this.sitePicker.onReopened.add(() => this.deactivateCurrent())
    })
  }

  private deactivateCurrent(): void {
    if (this.activeNode) {
      this.activeNode.enabled = false
      this.activeNode = null
    }
  }

  private activate(siteId: string, siteName: string, customLocationId: string | null): void {
    this.deactivateCurrent()
    if (!customLocationId) {
      print('[CustomLocationLoader] Selected site has no custom_location_id yet (not onboarded)')
      this._onLocationUnavailable.invoke({ siteId, siteName, reason: 'not_onboarded' })
      return
    }
    const nodeName = nodeNameByLocationId[customLocationId]
    if (!nodeName) {
      print('[CustomLocationLoader] No scene node mapped for location id: ' + customLocationId)
      this._onLocationUnavailable.invoke({ siteId, siteName, reason: 'node_missing' })
      return
    }
    const node = this.findChildByName(this.siteRoot, nodeName)
    if (!node) {
      print('[CustomLocationLoader] Node not found in SiteRoot: ' + nodeName)
      this._onLocationUnavailable.invoke({ siteId, siteName, reason: 'node_missing' })
      return
    }
    node.enabled = true
    this.activeNode = node
    const contentNode = this.findChildByName(node, 'Content')
    if (contentNode) {
      this._onLocationActivated.invoke({ siteId, contentNode })
    } else {
      this._onLocationUnavailable.invoke({ siteId, siteName, reason: 'node_missing' })
    }
  }

  private findChildByName(root: SceneObject, name: string): SceneObject | null {
    for (let i = 0; i < root.getChildrenCount(); i++) {
      const child = root.getChild(i)
      if (child.name === name) return child
    }
    return null
  }
}
