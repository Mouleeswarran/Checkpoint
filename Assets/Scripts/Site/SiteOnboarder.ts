import { supabaseInsert, supabaseSelect } from '../Backend/SupabaseClient'
import { LOCATION_ID_TO_NODE_NAME } from './CustomLocationLoader'

// One bundled entry per site — `@typedef` (not `@component`) is Lens Studio's own
// pattern for a multi-field struct usable as an `@input` array element, confirmed
// against real precedent already in this project's own dependency tree
// (SpectaclesUIKit's `Callback` in Utility/SceneUtilities.ts, and SIK's
// `HandVisualOverrideItem` in HandVisual.ts). The Inspector renders `entries` below as
// ONE "+ Add Value" button; each click adds one row that expands to these four labeled
// fields together — not four separate lists that can silently fall out of sync with
// each other by index.
@typedef
export class SiteEntry {
  @input
  @hint('Required. Everything else can be left blank.')
  siteName: string = ''

  @input
  @hint('Optional — leave 0 if unknown. The site still works, it just won’t sort by GPS proximity in the picker until this is set.')
  latitude: number = 0

  @input
  @hint('Optional — same caveat as latitude.')
  longitude: number = 0

  @input
  @hint(
    'Optional — the Location ID from your scanned Custom Location AR asset. Leave blank if you haven’t scanned this site yet; fill it in and re-run later.'
  )
  customLocationId: string = ''
}

// A self-service alternative to hand-writing SQL/REST calls to register a new job site.
// Lives on its own disabled-by-default SceneObject ("SiteOnboarder" at scene root — never
// touches anything else in the app, safe to leave in the scene permanently) so it never
// runs unless deliberately enabled.
//
// What this DOES automate: writing the `sites` row to Supabase — the tedious part
// someone would otherwise do by hand in the Supabase dashboard or via a raw REST call.
//
// What this does NOT automate, and can't from pure runtime script: pairing a physical
// space with an actual Custom Location AR asset. That's an author-time step — scan the
// space with Lens Studio's Custom Location AR package to get a Location ID, create a
// `.location` asset from it, wire a "Custom Location: <Name>" SceneObject under
// SiteRoot the same way the existing DemoSite node is set up, and add the
// `custom_location_id` → node-name mapping in CustomLocationLoader.ts. See README.md
// for the full walkthrough. A site with no Custom Location node wired yet still shows
// up in the Site Picker — CustomLocationLoader.onLocationUnavailable already handles
// that case with a clear "this site isn't set up for notes yet" message.
@component
export class SiteOnboarder extends BaseScriptComponent {
  @input
  @label('Sites')
  entries: SiteEntry[] = []

  @input
  @hint(
    'WARNING — check this before running: if an entry includes a Custom Location Id, its "Custom Location: <Name>" SceneObject must already be wired under SiteRoot (see README.md step (b)/(c)) before you run this. Onboarding the Supabase row first is fine either way — this tool will just print a warning for any location ID it doesn\'t recognize yet, as a reminder to finish that step, not an error.'
  )
  acknowledgedWiringStep: boolean = false

  @input
  @hint(
    'Off by default so this never fires by accident. Flip on, run the Lens once, then flip back off — re-running with the same names is safe (existing sites are skipped, not duplicated) but there\'s no reason to leave it on.'
  )
  runOnboarding: boolean = false

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      if (this.runOnboarding) this.onboardAll()
    })
  }

  private async onboardAll(): Promise<void> {
    if (!this.acknowledgedWiringStep) {
      print(
        '[SiteOnboarder] acknowledgedWiringStep is off — proceeding anyway, but see this component\'s own hint text: sites with a Custom Location Id need their Custom Location scene node wired up separately (README.md step (b)/(c)). This tool cannot create that wiring for you.'
      )
    }
    const count = this.entries.length
    print(`[SiteOnboarder] Processing ${count} entr${count === 1 ? 'y' : 'ies'}...`)
    for (const entry of this.entries) {
      await this.onboardOne(entry)
    }
    print('[SiteOnboarder] Done.')
  }

  private async onboardOne(entry: SiteEntry): Promise<void> {
    const name = (entry.siteName ?? '').trim()
    if (!name) return

    const customLocationId = (entry.customLocationId ?? '').trim() || null
    if (customLocationId && !LOCATION_ID_TO_NODE_NAME[customLocationId]) {
      print(
        `[SiteOnboarder] "${name}": WARNING — location ID "${customLocationId}" has no scene node mapped in CustomLocationLoader.ts yet. The site will still be created, but notes won't be able to anchor at it until that wiring is done (see README.md step (b)/(c)).`
      )
    }

    const { data: existing, error: selectError } = await supabaseSelect<{ id: string }>(
      'sites',
      `select=id&name=eq.${encodeURIComponent(name)}`
    )
    if (selectError) {
      print(`[SiteOnboarder] "${name}": failed to check for an existing site — ${selectError}`)
      return
    }
    if (existing && existing.length > 0) {
      print(`[SiteOnboarder] "${name}": already exists, skipped`)
      return
    }

    const { error: insertError } = await supabaseInsert('sites', {
      name,
      latitude: entry.latitude ?? 0,
      longitude: entry.longitude ?? 0,
      custom_location_id: customLocationId,
    })
    if (insertError) {
      print(`[SiteOnboarder] "${name}": insert failed — ${insertError}`)
      return
    }
    print(`[SiteOnboarder] "${name}": created`)
  }
}
