# Checkpoint

**Version control for the physical world.** Built for field technicians (electricians, plumbers, HVAC techs, mechanics, TV installers, and similar on-site trades) who hand off work to each other across time, often without ever meeting.

A technician arrives at a job site wearing Spectacles. They:

- Drop **sticky notes** anchored to the exact physical spot that matters (typed or dictated, with plain/info/warning/danger types), pinned in place via Custom Locations so they're exactly where they were left, visit after visit.
- Start a **work session**: narrate what they're doing out loud, snap reference photos as they go. On Stop, the whole session is saved and summarized by an LLM into a dated, versioned record — equipment mentioned, parts changed, a short narrative — with photos linked inline at the point they were taken.
- On the *next* visit — a different technician, possibly days later — the site opens already carrying that history. A **version history** view shows prior sessions' summaries and raw transcripts side by side. An **Ask AI** panel lets them ask a plain-language question ("what did the last person do with the pump?") and get an answer grounded in everything logged before, with an option to attach a photo of their own to the question.

Built for the CLAD Summer Hackathon, Week 3 "Connect" — see [`CLAD_PROMPT_LOG.md`](./CLAD_PROMPT_LOG.md) for the full prompt-by-prompt build log.

## Tech

Lens Studio / Spectacles — Spectacles Interaction Kit + UI Kit, Custom Locations AR, the built-in ASR module for dictation, the Remote Service Gateway (OpenAI `gpt-4.1-nano`) for summarization and Q&A, and a self-hosted Supabase project (PostgREST + Storage) for all persistence — no Snap Cloud dependency.

## Setup

Checkpoint uses its own Supabase project (not Snap Cloud) for all persistence. To run this project from a fresh clone:

### 1. Create your own Supabase project

Go to [supabase.com](https://supabase.com), create a new project, and open the **SQL Editor**.

### 2. Run the migrations

Run the files in `supabase/migrations/` in order, in the SQL Editor:

1. `0001_checkpoint_schema.sql` — tables, RLS policies, and the `session-captures` storage bucket.
2. `0003_notes_delete_policy.sql` — adds a delete policy for notes (optional; without it, note deletion is soft-delete only).

Read `0001`'s own header comment before running it — it explains the RLS/security model for this no-login-system app.

### 3. Fill in your Supabase config

Select the `SupabaseCredentials` SceneObject in the scene and fill in your own project's values on the component in the Inspector:

- `Rest Url` / `Storage Url` — your project's URL, from Settings → Data API in the Supabase dashboard.
- `Publishable Key` — Settings → API Keys → the "publishable" key (the newer name for what used to be called the anon key). This is safe to ship in client code; it's scoped entirely by the RLS policies from step 2. These are intentionally left blank in this repo — never commit real values there (same rule as the Remote Service Gateway credentials in the next step).

Recompile in Lens Studio — the Lens now talks to your own project.

### 4. Add your Remote Service Gateway credentials

Select the `RemoteServiceGatewayCredentials` SceneObject in the scene and fill in your own OpenAI/Google/Snap tokens on the component in the Inspector (its own on-screen instructions link to Snap's Remote Service Gateway setup guide). These are intentionally left blank in this repo — never commit real tokens there.

### 5. Onboard your first site

A "site" needs three things: a name, (optionally) GPS coordinates for proximity sorting, and a Custom Location for AR anchoring. The last part requires a physical space and Lens Studio's own Custom Location AR tooling — there's no way around actually scanning somewhere.

Do these in order — (b) and (c) are the scene-wiring half, and **must** happen before (d) if you want notes to actually anchor; SiteOnboarder will still create a Supabase row out of order, it just can't be used for notes until the wiring below exists.

**a. Scan the space** — use Snap's Custom Location AR package (already installed in this project, `Packages/Custom Location AR.lspkg`) to scan your site and generate a `.location` asset with a Location ID. This is standard Lens Studio functionality — see Snap's own Custom Locations documentation for the scan flow.

**b. Wire the Custom Location node into the scene** — under `SiteRoot`, duplicate the existing `Custom Location: DemoSite` SceneObject, rename it, and point its `LocatedAtComponent` at your new `.location` asset instead.

**c. Map the Location ID to that node** — add one line to `LOCATION_ID_TO_NODE_NAME` in `Assets/Scripts/Site/CustomLocationLoader.ts`:

```ts
export const LOCATION_ID_TO_NODE_NAME: Record<string, string> = {
  ZDB3WPGEL6BA: 'Custom Location: DemoSite',
  YOUR_NEW_LOCATION_ID: 'Custom Location: YourSiteName', // add this line
}
```

Recompile.

**d. Register the site in Supabase** — enable the `SiteOnboarder` SceneObject at the scene root (it ships disabled). In the Inspector, click "Add Value" on its `Sites` list — each click adds one bundled entry with its own **Site Name**, **Latitude**, **Longitude**, and **Custom Location Id** fields (only the name is required). Flip `runOnboarding` on and run the Lens once. Check the Logger for `[SiteOnboarder] "<name>": created` — and heed any `WARNING` line, which means a Custom Location Id you entered isn't mapped in step (c) yet. Flip `runOnboarding` back off and disable the object again — re-running is safe (existing sites are skipped by name, not duplicated) but there's no reason to leave it on.

Your site now appears in the Site Picker, and notes/sessions anchor correctly once you select it.

A site with a name but no Custom Location wired yet still shows up in the picker — you just can't place notes there until steps (b)/(c) are done (the app tells the technician this clearly rather than failing silently).

### 6. Extended Permissions

Running Internet + Camera + Audio together (which this Lens does) requires Extended Permissions — configure this in Lens Studio's project settings before testing on-device.
