import { scenariosIndex } from 'Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator'
import { ScenarioMetadata } from 'Leaf.lspkg/Scenarios/scenario/ScenarioMetadata'
import { CheckpointNavigationScenario } from './CheckpointNavigationScenario'
import { CheckpointStickyNoteScenario } from './CheckpointStickyNoteScenario'
import { CheckpointButtonInteractionScenario } from './CheckpointButtonInteractionScenario'
import { CheckpointIKReachScenario } from './CheckpointIKReachScenario'

@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    {
      id: 'checkpoint-navigation-scenario',
      typename: CheckpointNavigationScenario.getTypeName(),
    },
    {
      id: 'checkpoint-sticky-note-scenario',
      typename: CheckpointStickyNoteScenario.getTypeName(),
    },
    {
      id: 'checkpoint-button-interaction-scenario',
      typename: CheckpointButtonInteractionScenario.getTypeName(),
    },
    {
      id: 'checkpoint-ik-reach-scenario',
      typename: CheckpointIKReachScenario.getTypeName(),
    },
  ]
}
