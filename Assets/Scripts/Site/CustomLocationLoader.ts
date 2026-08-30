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

// Maps a site's `custom_location_id` (from Supabase) to the pre-wired Custom
// Location SceneObject for it. Every onboarded site needs its Custom Location
// node's name added here to match — see CLAD_PROMPT_LOG.md for why this has
// to be wired at Editor time rather than resolved dynamically at runtime.
// Exported so SiteOnboarder.ts can warn when a site is registered in Supabase
// with a location ID that has no scene node wired up yet — see README.md.
export const LOCATION_ID_TO_NODE_NAME: Record<string, string> = {
  ZDB3WPGEL6BA: 'Custom Location: DemoSite',
}

@component
export class CustomLocationLoader extends BaseScriptComponent {
  @input
  sitePicker!: SitePicker

  @input
  siteRoot!: SceneObject

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
    const nodeName = LOCATION_ID_TO_NODE_NAME[customLocationId]
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
