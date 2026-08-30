// Checkpoint's own Supabase project (not Snap Cloud). Plain REST (PostgREST) calls
// via InternetModule.fetch() — NOT the SupabaseClient.lspkg polyfilled client, which
// routes through a native SupabaseModule that rejects independently-hosted Supabase
// projects ("Not a valid supabase request") and appears gated to Snap-Cloud-provisioned
// URLs only, despite its generic-looking createClient(url, key) signature. Confirmed by
// runtime error in Preview — see CLAD_PROMPT_LOG.md.
//
// No login/account system by design, so every request just carries the publishable key —
// RLS policies grant access to the `anon` role directly (see
// supabase/migrations/0001_checkpoint_schema.sql), matching this key's scope.
//
// Actual values live in SupabaseConfig.ts, which is git-ignored — see
// SupabaseConfig.example.ts for what to fill in, and README.md for the full walkthrough.

import { REST_URL, STORAGE_URL, PUBLISHABLE_KEY } from './SupabaseConfig'

const internetModule: InternetModule = require('LensStudio:InternetModule')

function headers(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: PUBLISHABLE_KEY,
    Authorization: 'Bearer ' + PUBLISHABLE_KEY,
    'Content-Type': 'application/json',
    ...extra,
  }
}

export interface SupabaseResult<T> {
  data: T | null
  error: string | null
}

// query is a raw PostgREST query string, e.g. "select=id,name&order=created_at.asc"
export async function supabaseSelect<T>(table: string, query: string): Promise<SupabaseResult<T[]>> {
  try {
    const response = await internetModule.fetch(`${REST_URL}/${table}?${query}`, {
      method: 'GET',
      headers: headers(),
    })
    const text = await response.text()
    if (response.status < 200 || response.status >= 300) {
      return { data: null, error: `HTTP ${response.status}: ${text}` }
    }
    return { data: JSON.parse(text) as T[], error: null }
  } catch (err) {
    return { data: null, error: String(err) }
  }
}

export async function supabaseInsert<T>(table: string, body: object): Promise<SupabaseResult<T[]>> {
  try {
    const response = await internetModule.fetch(`${REST_URL}/${table}`, {
      method: 'POST',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(body),
    })
    const text = await response.text()
    if (response.status < 200 || response.status >= 300) {
      return { data: null, error: `HTTP ${response.status}: ${text}` }
    }
    return { data: JSON.parse(text) as T[], error: null }
  } catch (err) {
    return { data: null, error: String(err) }
  }
}

// query selects the row(s) to update, e.g. "id=eq.<uuid>"
export async function supabaseUpdate<T>(table: string, query: string, body: object): Promise<SupabaseResult<T[]>> {
  try {
    const response = await internetModule.fetch(`${REST_URL}/${table}?${query}`, {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(body),
    })
    const text = await response.text()
    if (response.status < 200 || response.status >= 300) {
      return { data: null, error: `HTTP ${response.status}: ${text}` }
    }
    return { data: JSON.parse(text) as T[], error: null }
  } catch (err) {
    return { data: null, error: String(err) }
  }
}

// query selects the row(s) to delete, e.g. "id=eq.<uuid>". Requires a DELETE RLS policy
// on the table (see supabase/migrations/0003_notes_delete_policy.sql) — most tables in
// this project deliberately don't have one (soft-delete only), so this will come back
// with a permission-denied error unless that migration has been run.
export async function supabaseDelete<T>(table: string, query: string): Promise<SupabaseResult<T[]>> {
  try {
    const response = await internetModule.fetch(`${REST_URL}/${table}?${query}`, {
      method: 'DELETE',
      headers: headers({ Prefer: 'return=representation' }),
    })
    const text = await response.text()
    if (response.status < 200 || response.status >= 300) {
      return { data: null, error: `HTTP ${response.status}: ${text}` }
    }
    return { data: text ? (JSON.parse(text) as T[]) : [], error: null }
  } catch (err) {
    return { data: null, error: String(err) }
  }
}

export async function supabaseUploadBytes(
  bucket: string,
  path: string,
  bytes: Uint8Array,
  contentType: string
): Promise<SupabaseResult<{ path: string }>> {
  try {
    const response = await internetModule.fetch(`${STORAGE_URL}/object/${bucket}/${path}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': contentType, 'x-upsert': 'true' }),
      body: bytes,
    })
    const text = await response.text()
    if (response.status < 200 || response.status >= 300) {
      return { data: null, error: `HTTP ${response.status}: ${text}` }
    }
    return { data: { path }, error: null }
  } catch (err) {
    return { data: null, error: String(err) }
  }
}

export function supabasePublicUrl(bucket: string, path: string): string {
  return `${STORAGE_URL}/object/public/${bucket}/${path}`
}
