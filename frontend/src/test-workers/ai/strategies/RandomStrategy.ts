// Random Strategy - Baseline Decision Engine

import { Role, GamePhase } from '@/types/game';
import {
  BaseDecisionEngine,
  DecisionContext,
  DecisionResult,
} from '../DecisionEngine';
import { WorkerActionType } from '../../workers/WorkerMessage';

/**
 * Random Strategy
 *
 * Makes completely random decisions from available actions.
 * Useful as a baseline for comparing other strategies.
 */
export class RandomStrategy extends BaseDecisionEngine {
  decide(context: DecisionContext): DecisionResult {
    const { availableActions, gameState, role, phase } = context;

    // Handle voting phase separately
    if (phase === GamePhase.Voting) {
      return this.decideVote(context);
    }

    // Filter to meaningful actions (exclude WAIT most of the time)
    const meaningfulActions = availableActions.filter(
      (a) => a.type !== WorkerActionType.WAIT
    );

    // If no meaningful actions, wait
    if (meaningfulActions.length === 0) {
      return {
        action: this.createWaitAction(),
        reasoning: 'No actions available, waiting',
        confidence: 1.0,
      };
    }

    // Pick a random action type
    const randomAction = this.pickRandom(meaningfulActions);

    if (!randomAction) {
      return {
        action: this.createWaitAction(),
        reasoning: 'No valid action found',
        confidence: 0.5,
      };
    }

    switch (randomAction.type) {
      case WorkerActionType.MOVE: {
        const locations = randomAction.locations || [];
        const targetLocation = this.pickRandom(locations);
        if (targetLocation !== undefined) {
          return {
            action: this.createMoveAction(targetLocation),
            reasoning: `Randomly moving to ${targetLocation}`,
            confidence: 0.5,
          };
        }
        break;
      }

      case WorkerActionType.KILL: {
        const targets = randomAction.targets || [];
        const target = this.pickRandom(targets);
        if (target) {
          return {
            action: this.createKillAction(target),
            reasoning: `Randomly killing ${target}`,
            confidence: 0.3,
          };
        }
        break;
      }

      case WorkerActionType.REPORT_BODY: {
        const bodies = gameState.deadBodies.filter((b) => !b.reported);
        const body = this.pickRandom(bodies);
        if (body) {
          return {
            action: this.createReportAction(body.victim),
            reasoning: `Randomly reporting body of ${body.victim}`,
            confidence: 0.6,
          };
        }
        break;
      }

      case WorkerActionType.COMPLETE_TASK: {
        const taskIds = randomAction.taskIds || [];
        const taskId = this.pickRandom(taskIds);
        if (taskId) {
          return {
            action: this.createTaskAction(taskId),
            reasoning: `Randomly completing task ${taskId}`,
            confidence: 0.7,
          };
        }
        break;
      }

      case WorkerActionType.SABOTAGE: {
        const sabotageTypes = [1, 2, 3, 4]; // Lights, Reactor, O2, Comms
        const sabotageType = this.pickRandom(sabotageTypes);
        if (sabotageType) {
          return {
            action: { type: WorkerActionType.SABOTAGE, sabotageType },
            reasoning: `Randomly sabotaging (type ${sabotageType})`,
            confidence: 0.4,
          };
        }
        break;
      }
    }

    // Fallback to waiting
    return {
      action: this.createWaitAction(),
      reasoning: 'Could not execute random action, waiting',
      confidence: 0.3,
    };
  }

  private decideVote(context: DecisionContext): DecisionResult {
    const { gameState } = context;
    const alivePlayers = this.getAlivePlayers(
      gameState.players,
      context.agentAddress
    );

    // 30% chance to skip
    if (Math.random() < 0.3) {
      return {
        action: this.createSkipAction(),
        reasoning: 'Randomly decided to skip vote',
        confidence: 0.5,
      };
    }

    // Vote for random player
    const target = this.pickRandom(alivePlayers);
    if (target) {
      return {
        action: this.createVoteAction(target.address),
        reasoning: `Randomly voting for ${target.address}`,
        confidence: 0.3,
      };
    }

    return {
      action: this.createSkipAction(),
      reasoning: 'No valid vote target, skipping',
      confidence: 0.5,
    };
  }
}
