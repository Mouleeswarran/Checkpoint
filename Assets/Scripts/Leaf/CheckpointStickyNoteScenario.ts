import { Scenario } from 'Leaf.lspkg/Scenarios/scenario/Scenario'
import { expect } from 'Leaf.lspkg/Utils/common/Expect'
import { findInteractablesByName } from 'Leaf.lspkg/Interactors/InteractableUtils'
import { findSceneObject, matchSceneObjectName, matchSceneObjectParentName, sleep } from 'Leaf.lspkg/Utils/common/Utils'
import { CheckpointLeafInteractor } from './CheckpointLeafInteractor'

// Sticky note creation: from Sticky Notes, arm a note type (Warning), place it, and confirm
// a note SceneObject with the StickyNote component spawns and renders with visible text and
// controls (not blank/missing labels) — a regression check on the new BeveledPrismVisual
// button system and the torn-paper panel skin.
@component
export class CheckpointStickyNoteScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const interactor = new CheckpointLeafInteractor()
    await interactor.ensureAtMenu()

    await interactor.tapButton('Sticky Notes')
    await sleep(300)
    interactor.assertOnlyPanelEnabled('NotesUI')

    // The Custom Location content node notes are parented under — its existence confirms
    // site/location activation actually wired up NotePlacer for placement.
    const contentNode = findSceneObject(
      (so) => matchSceneObjectName('Content')(so) && matchSceneObjectParentName('Custom Location: DemoSite')(so)
    )
    if (!contentNode) {
      throw new Error('Custom Location content node not found — site/location was not activated')
    }
    const notesBefore = interactor.countChildrenNamed(contentNode, 'Note')

    // Arm a Warning note.
    await interactor.tapButton('Warning')
    await sleep(300)
    // armPlacement() only enables the Place Here row once currentSiteId/currentContentNode are
    // set (via CustomLocationLoader.onLocationActivated) — this is a real signal, not a formality.
    expect(findInteractablesByName('PlaceHere', undefined, true).length).toBe(1)

    // Place it.
    await interactor.tapButton('PlaceHere')
    await sleep(500)

    const notesAfter = interactor.countChildrenNamed(contentNode, 'Note')
    expect(notesAfter).toBe(notesBefore + 1)

    const newNote = interactor.lastChildNamed(contentNode, 'Note')
    if (!newNote) throw new Error('Newly placed Note scene object not found')
    expect(newNote.enabled).toBe(true)

    const noteContent = interactor.findChildByName(newNote, 'Content')
    if (!noteContent) throw new Error('New note has no Content child — StickyNote failed to build its panel')

    const typeLabelSO = interactor.findChildByName(noteContent, 'TypeLabel')
    if (!typeLabelSO) throw new Error('New note has no TypeLabel child')
    const typeLabelText = (typeLabelSO.getComponent('Component.Text') as Text).text
    expect(typeLabelText).toBe('WARNING')

    const controlsSO = interactor.findChildByName(noteContent, 'Controls')
    if (!controlsSO) throw new Error('New note has no Controls row')

    // isNew note gets a Mic button (not Translate) plus Delete — both must render with a
    // non-empty label given the redesign moved labels to local Z=0.95 to clear the new
    // opaque BeveledPrismVisual body.
    const micSO = interactor.findChildByName(controlsSO, 'Mic')
    if (!micSO) throw new Error('New note is missing its Mic button')
    const micLabelSO = interactor.findChildByName(micSO, 'Label')
    if (!micLabelSO) throw new Error('Mic button has no Label child')
    const micLabelText = (micLabelSO.getComponent('Component.Text') as Text).text
    expect(micLabelText.length > 0).toBe(true)

    const deleteSO = interactor.findChildByName(controlsSO, 'Delete')
    if (!deleteSO) throw new Error('New note is missing its Delete button')
    const deleteLabelSO = interactor.findChildByName(deleteSO, 'Label')
    if (!deleteLabelSO) throw new Error('Delete button has no Label child')
    const deleteLabelText = (deleteLabelSO.getComponent('Component.Text') as Text).text
    expect(deleteLabelText.length > 0).toBe(true)

    // Both controls must actually be interactable (enabled through the full hierarchy), not
    // just present as data — confirms the new button visuals didn't break input routing.
    expect(findInteractablesByName('Mic', undefined, true).length >= 1).toBe(true)
    expect(findInteractablesByName('Delete', undefined, true).length >= 1).toBe(true)

    // Return to Main Menu, leaving the app in a predictable state for later scenarios.
    await interactor.tapButton('Menu')
    await sleep(300)
    interactor.assertOnlyPanelEnabled('MenuUI')
  }
}
