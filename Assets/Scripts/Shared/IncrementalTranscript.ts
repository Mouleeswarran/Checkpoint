// AsrModule accumulates text WITHIN one phrase (each update carries the whole phrase
// spoken so far, not just the new words) but starts a brand new phrase — empty text —
// the moment silenceUntilTerminationMs elapses and isFinal fires (see AsrModule's own
// documented behavior, referenced in SessionRecorder.ts's startNarration comment). A
// caller that just does `this.text = e.text` therefore grows correctly within a single
// phrase but silently DISCARDS everything said before the first pause long enough to
// finalize it — exactly the "replace as you speak" bug this class exists to fix.
//
// Call update() on every AsrModule.TranscriptionUpdateEvent. `text` always reflects
// everything spoken since the last reset() — finalized phrases are kept permanently,
// the still-in-progress phrase is appended live on top of them.
export class IncrementalTranscript {
  private committed = ''
  private live = ''

  update(e: { text: string; isFinal: boolean }): string {
    if (e.isFinal) {
      const finalPhrase = e.text.trim()
      if (finalPhrase.length > 0) {
        this.committed = this.committed ? this.committed + ' ' + finalPhrase : finalPhrase
      }
      this.live = ''
    } else {
      this.live = e.text
    }
    return this.text
  }

  get text(): string {
    if (!this.live) return this.committed
    return this.committed ? this.committed + ' ' + this.live : this.live
  }

  // Overwrite everything — used when the technician manually edits the text via the
  // system keyboard (see the Edit button in StickyNote/SessionContextPanel), so the
  // next spoken phrase appends onto their edit rather than the pre-edit transcript.
  set text(value: string) {
    this.committed = value
    this.live = ''
  }

  reset(): void {
    this.committed = ''
    this.live = ''
  }
}
