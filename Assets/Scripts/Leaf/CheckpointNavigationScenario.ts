import { Scenario } from 'Leaf.lspkg/Scenarios/scenario/Scenario'
import { expect } from 'Leaf.lspkg/Utils/common/Expect'
import { findSceneObjectByName, sleep } from 'Leaf.lspkg/Utils/common/Utils'
import { CheckpointLeafInteractor } from './CheckpointLeafInteractor'

// Full app flow end-to-end, asserting the mutual-exclusivity invariant (exactly one of the
// seven top-level panels enabled) at every step: NameEntry -> Save -> SitePicker -> select
// site -> MainMenu -> each of the 4 destinations opens alone and its "< Menu" returns cleanly
// -> Switch Site returns to SitePicker, now showing its own back button.
@component
export class CheckpointNavigationScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const interactor = new CheckpointLeafInteractor()

    // This scenario assumes a fresh Lens (NameUI is the only panel that can ever show once,
    // right at start) — if a prior scenario already advanced past it, skip straight to the
    // parts of the flow that are still exercisable from wherever the app currently is.
    const nameUI = findSceneObjectByName('NameUI')
    if (nameUI && nameUI.enabled) {
      interactor.assertOnlyPanelEnabled('NameUI')

      await interactor.tapButton('Save')
      await sleep(300)
      interactor.assertOnlyPanelEnabled('UI')

      const backBefore = findSceneObjectByName('BackToMenu')
      if (!backBefore) throw new Error('BackToMenu scene object not found on SitePicker')
      expect(backBefore.enabled).toBe(false)

      await interactor.tapButton('Demo Site (Test)')
      await sleep(300)
      interactor.assertOnlyPanelEnabled('MenuUI')
    } else {
      await interactor.ensureAtMenu()
      interactor.assertOnlyPanelEnabled('MenuUI')
    }

    // Each of the 4 menu destinations opens alone, and its own "< Menu" returns cleanly.
    const destinations: Array<[string, string]> = [
      ['Sticky Notes', 'NotesUI'],
      ['Work Session', 'SessionUI'],
      ['Version History', 'HistoryUI'],
      ['Ask AI', 'AskAIUI'],
    ]
    for (const [buttonName, panelName] of destinations) {
      await interactor.tapButton(buttonName)
      await sleep(300)
      interactor.assertOnlyPanelEnabled(panelName)

      await interactor.tapButton('Menu')
      await sleep(300)
      interactor.assertOnlyPanelEnabled('MenuUI')
    }

    // "Switch Site" returns to SitePicker, which now also shows its own back button
    // (setBackVisible fires once a site has been chosen at least once).
    await interactor.tapButton('Switch Site')
    await sleep(300)
    interactor.assertOnlyPanelEnabled('UI')

    const backAfter = findSceneObjectByName('BackToMenu')
    if (!backAfter) throw new Error('BackToMenu scene object not found on SitePicker')
    expect(backAfter.enabled).toBe(true)

    // SitePicker's own "< Menu" back button returns to Main Menu.
    await interactor.tapButton('BackToMenu')
    await sleep(300)
    interactor.assertOnlyPanelEnabled('MenuUI')
  }
}
