// `require('LensStudio:AsrModule')` returns a single global module, so there is exactly
// ONE speech-transcription session for the whole Lens — not one per component. Every mic
// in Checkpoint (sticky note dictation, Ask AI, Work Session narration) competes for that
// same session, and calling `startTranscribing()` while any of them still holds it fails
// with `AsrStatusCode.InternalError` (code 1).
//
// So every mic must release the shared session before claiming it. This helper does that
// without ever stalling startup: `stopTranscribing()` is only documented for the case
// where a session is actually running, and when none is, it may reject or simply never
// settle — a bare `await` on it would silently skip `startTranscribing()` altogether,
// giving a mic that reports no error and also never transcribes. Racing it against a
// short timer means the caller always gets to proceed, whichever way the module behaves.
const RELEASE_TIMEOUT_S = 0.4

export function releaseSharedMic(script: BaseScriptComponent, tag: string): Promise<void> {
  const asrModule: AsrModule = require('LensStudio:AsrModule')
  return new Promise((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      resolve()
    }
    const timer = script.createEvent('DelayedCallbackEvent')
    timer.bind(() => {
      if (!done) print('[' + tag + '] stopTranscribing did not settle — proceeding')
      finish()
    })
    timer.reset(RELEASE_TIMEOUT_S)
    try {
      asrModule.stopTranscribing().then(finish).catch(finish)
    } catch (err) {
      finish()
    }
  })
}
