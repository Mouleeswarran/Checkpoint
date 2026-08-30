import { setSupabaseConfig } from './SupabaseClient'

// Your own (self-hosted, not Snap Cloud) Supabase project's connection details, entered
// directly in the Inspector instead of a git-ignored .ts file — same pattern as
// RemoteServiceGatewayCredentials. These values get serialized into Assets/Scene.scene,
// so — exactly like that component — blank them to "" before committing and restore them
// locally afterward; the repo's pre-commit hook blocks a commit that has real values
// staged here, same as it already does for the RSG tokens.
@component
export class SupabaseCredentials extends BaseScriptComponent {
  @input
  @hint('Settings → Data API in the Supabase dashboard, e.g. https://YOUR-PROJECT-REF.supabase.co/rest/v1')
  restUrl: string = ''

  @input
  @hint('Same dashboard page, e.g. https://YOUR-PROJECT-REF.supabase.co/storage/v1')
  storageUrl: string = ''

  @input
  @hint('Settings → API Keys → the "publishable" key (the newer name for what used to be called the anon key). Safe to ship client-side — scoped entirely by this project\'s RLS policies (see supabase/migrations/0001_checkpoint_schema.sql).')
  publishableKey: string = ''

  onAwake(): void {
    setSupabaseConfig({
      restUrl: this.restUrl,
      storageUrl: this.storageUrl,
      publishableKey: this.publishableKey,
    })
  }
}
