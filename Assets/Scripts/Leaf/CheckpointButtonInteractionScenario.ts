import { Scenario } from 'Leaf.lspkg/Scenarios/scenario/Scenario'
import { expect } from 'Leaf.lspkg/Utils/common/Expect'
import { findInteractableByName, findInteractablesByName } from 'Leaf.lspkg/Interactors/InteractableUtils'
import { LeafHandInteractor } from 'Leaf.lspkg/Interactors/interactor/LeafTwoHandInteractor'
import { sleep } from 'Leaf.lspkg/Utils/common/Utils'
import { CheckpointLeafInteractor } from './CheckpointLeafInteractor'

// Spot-checks that buttons on two different panels are actually interactable via a simulated
// hand PINCH (not the generic scripted interactor) post-redesign — the button visual system
// changed from a flat RoundedRectangleVisual to an opaque BeveledPrismVisual, so this guards
// against a real functional regression in input routing, not just a cosmetic one.
@component
export class CheckpointButtonInteractionScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const nav = new CheckpointLeafInteractor()
    await nav.ensureAtMenu()

    const hand = LeafHandInteractor.get('right')

    // Panel 1 — Main Menu: pinch "Sticky Notes" and confirm its handler actually navigated.
    const stickyNotesBtn = findInteractableByName('Sticky Notes')
    if (!stickyNotesBtn) throw new Error('"Sticky Notes" interactable not found on Main Menu')
    await hand.trigger(stickyNotesBtn)
    await sleep(400)
    const notesEnabled = findInteractablesByName('Warning', undefined, true).length >= 1
    expect(notesEnabled).toBe(true)

    // Panel 2 — Sticky Notes: pinch "Warning" and confirm the Place Here control appears —
    // proves the redesigned button forwards the pinch through to armPlacement().
    const warningBtn = findInteractableByName('Warning')
    if (!warningBtn) throw new Error('"Warning" interactable not found on Sticky Notes panel')
    await hand.trigger(warningBtn)
    await sleep(400)
    expect(findInteractablesByName('PlaceHere', undefined, true).length).toBe(1)

    // Clean up armed state without touching the network/location path.
    const cancelBtn = findInteractableByName('Cancel')
    if (!cancelBtn) throw new Error('"Cancel" interactable not found on Sticky Notes panel')
    await hand.trigger(cancelBtn)
    await sleep(300)

    // Return to Main Menu, also via a hand pinch on the redesigned "< Menu" button.
    const backBtn = findInteractableByName('Menu')
    if (!backBtn) throw new Error('"< Menu" interactable not found on Sticky Notes panel')
    await hand.trigger(backBtn)
    await sleep(400)
    expect(findInteractablesByName('Sticky Notes', undefined, true).length).toBe(1)
  }
}
