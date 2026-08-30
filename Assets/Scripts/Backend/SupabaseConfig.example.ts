// Template — copy this file to SupabaseConfig.ts (same folder) and fill in your own
// Supabase project's values before running the Lens. SupabaseConfig.ts is git-ignored,
// so your real values never get committed.
//
// Setup: see README.md at the project root for the full walkthrough (running the SQL
// migrations, where to find these values in your Supabase dashboard, and onboarding
// your first physical site).

export const REST_URL = 'https://YOUR-PROJECT-REF.supabase.co/rest/v1'
export const STORAGE_URL = 'https://YOUR-PROJECT-REF.supabase.co/storage/v1'
// Settings → API Keys → "publishable" key (the newer name for what used to be called
// the anon key). Safe to ship client-side — it's gated entirely by the RLS policies in
// supabase/migrations/0001_checkpoint_schema.sql, not a secret.
export const PUBLISHABLE_KEY = 'sb_publishable_YOUR_KEY_HERE'
