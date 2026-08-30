import { DefaultLeafInteractor } from 'Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor'
import { findInteractablesByName } from 'Leaf.lspkg/Interactors/InteractableUtils'
import { findSceneObjectByName, sleep } from 'Leaf.lspkg/Utils/common/Utils'
import { expect } from 'Leaf.lspkg/Utils/common/Expect'

// Checkpoint's seven mutually-exclusive top-level windows (see PanelManager.ts).
// Sticky notes and ImageViewer are intentionally excluded — they're not gated by PanelManager.
export const TOP_LEVEL_PANELS = ['NameUI', 'UI', 'MenuUI', 'NotesUI', 'SessionUI', 'HistoryUI', 'AskAIUI']

export class CheckpointLeafInteractor extends DefaultLeafInteractor {
  async tapButton(buttonName: string): Promise<void> {
    const button = findInteractablesByName(buttonName, undefined, true)[0]
    if (!button) {
      throw new Error(`Button "${buttonName}" not found or not enabled`)
    }
    await this.trigger(button)
    await sleep(200)
  }

  // Core invariant under test: exactly one of the seven top-level panels is enabled at a time.
  assertOnlyPanelEnabled(expectedActive: string): void {
    for (const name of TOP_LEVEL_PANELS) {
      const so = findSceneObjectByName(name)
      if (!so) {
        throw new Error(`Panel scene object not found: ${name}`)
      }
      expect(so.enabled).toBe(name === expectedActive)
    }
  }

  findChildByName(parent: SceneObject, name: string): SceneObject | null {
    for (let i = 0; i < parent.getChildrenCount(); i++) {
      const child = parent.getChild(i)
      if (child.name === name) return child
    }
    return null
  }

  countChildrenNamed(parent: SceneObject, name: string): number {
    let count = 0
    for (let i = 0; i < parent.getChildrenCount(); i++) {
      if (parent.getChild(i).name === name) count++
    }
    return count
  }

  lastChildNamed(parent: SceneObject, name: string): SceneObject | null {
    let result: SceneObject | null = null
    for (let i = 0; i < parent.getChildrenCount(); i++) {
      const child = parent.getChild(i)
      if (child.name === name) result = child
    }
    return result
  }

  // Scenarios share the live Lens instance (see LEAF "shared state" guidance) — this brings
  // the app to Main Menu no matter which panel a previous scenario left active, and handles
  // the very-first-run case (NameUI still up) too, so every scenario can run standalone.
  async ensureAtMenu(): Promise<void> {
    const nameUI = findSceneObjectByName('NameUI')
    if (nameUI && nameUI.enabled) {
      await this.tapButton('Save')
      await sleep(300)
    }

    const sitePicker = findSceneObjectByName('UI')
    if (sitePicker && sitePicker.enabled) {
      await this.tapButton('Demo Site (Test)')
      await sleep(300)
    }

    for (const name of ['NotesUI', 'SessionUI', 'HistoryUI', 'AskAIUI']) {
      const panel = findSceneObjectByName(name)
      if (panel && panel.enabled) {
        await this.tapButton('Menu')
        await sleep(300)
        break
      }
    }
  }
}
