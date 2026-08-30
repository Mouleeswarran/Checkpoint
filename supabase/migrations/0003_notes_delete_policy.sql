-- Adds a real DELETE policy for notes. Migration 0001 deliberately omitted DELETE
-- policies everywhere (soft-delete only, `deleted = true`) so a leaked anon/publishable
-- key — baked directly into the compiled Lens — couldn't destroy data. Per explicit
-- request (see CLAD_PROMPT_LOG.md), deleting a note in the Lens should now actually
-- remove the row from Supabase rather than just flagging it. Accepted tradeoff for a
-- hackathon demo: the anon key can now delete any note for any site, not just add/edit.
-- Scoped to `notes` only — every other table keeps the original soft-delete-only posture.
-- Run this in the SQL Editor when convenient; StickyNote.ts's delete will otherwise get a
-- permission-denied response from PostgREST and only remove the note locally.

create policy "anon delete notes" on notes for delete to anon using (true);
