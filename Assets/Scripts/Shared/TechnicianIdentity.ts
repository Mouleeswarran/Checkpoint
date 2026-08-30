// Technician identity, persisted on-device via Lens Studio's PersistentStorageSystem —
// survives across Lens restarts on the same device (so the name-entry screen only shows
// once per device), but never leaves the device and never touches Supabase. This is
// single-device personal-preference data, not shared/cross-device data, so on-device
// storage is the right tool — no login/account system, by design.
const STORAGE_KEY = 'checkpoint_technician_name'

function store(): GeneralDataStore {
  return global.persistentStorageSystem.store
}

export function hasTechnicianName(): boolean {
  return store().has(STORAGE_KEY)
}

export function getTechnicianName(): string {
  return store().has(STORAGE_KEY) ? store().getString(STORAGE_KEY) : 'Technician'
}

export function setTechnicianName(name: string): void {
  const trimmed = name.trim()
  if (trimmed.length > 0) store().putString(STORAGE_KEY, trimmed)
}
