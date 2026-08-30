import { Scenario } from 'Leaf.lspkg/Scenarios/scenario/Scenario'
import { expect } from 'Leaf.lspkg/Utils/common/Expect'
import { findInteractableByName } from 'Leaf.lspkg/Interactors/InteractableUtils'
import { createIKInteractor } from 'Leaf.lspkg/Interactors/interactor/ik/visualizer/BitmojiAvatar'
import { findSceneObjectByName, sleep } from 'Leaf.lspkg/Utils/common/Utils'
import { CheckpointLeafInteractor } from './CheckpointLeafInteractor'

// IK reachability check for Main Menu — the hub every user reaches for on every visit.
// BeveledPrismVisual changed button depth/geometry (opaque prism body, forward pop on
// hover/press) versus the old flat translucent visual, which could plausibly move the
// effective hit target. A full-arm IK trigger only succeeds if the reach ray actually
// converges on the button, so this doubles as both a functional and reachability check.
@component
export class CheckpointIKReachScenario extends Scenario {
  private readonly _interactor = createIKInteractor()

  async run(): Promise<void> {
    await sleep(1500)
    const nav = new CheckpointLeafInteractor()
    await nav.ensureAtMenu()

    const stickyNotesBtn = findInteractableByName('Sticky Notes')
    if (!stickyNotesBtn) throw new Error('"Sticky Notes" interactable not found on Main Menu')
    await this._interactor.trigger(stickyNotesBtn)
    await sleep(400)
    const notesUI = findSceneObjectByName('NotesUI')
    expect(notesUI ? notesUI.enabled : false).toBe(true)

    const backBtn = findInteractableByName('Menu')
    if (!backBtn) throw new Error('"< Menu" interactable not found on Sticky Notes panel')
    await this._interactor.trigger(backBtn)
    await sleep(400)
    const menuUI = findSceneObjectByName('MenuUI')
    expect(menuUI ? menuUI.enabled : false).toBe(true)
  }
}
