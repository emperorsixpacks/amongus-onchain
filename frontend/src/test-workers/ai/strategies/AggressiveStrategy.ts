// Aggressive Impostor Strategy

import { Role, GamePhase, Location } from '@/types/game';
import {
  BaseDecisionEngine,
  DecisionContext,
  DecisionResult,
} from '../DecisionEngine';
import { WorkerActionType } from '../../workers/WorkerMessage';

/**
 * Aggressive Strategy (Impostor)
 *
 * - Prioritizes killing whenever possible
 * - Takes risks even with potential witnesses
 * - Sabotages frequently to create chaos
 * - Votes aggressively to eliminate threats
 */
export class AggressiveStrategy extends BaseDecisionEngine {
  private killCooldown: number = 0;
  private lastKillTime: number = 0;
  private readonly KILL_COOLDOWN_MS = 10000; // 10 seconds

  decide(context: DecisionContext): DecisionResult {
    const { phase, role } = context;

    // Verify we're an impostor
    if (role !== Role.Impostor) {
      console.warn('Aggressive strategy used for non-impostor');
      return this.fallbackBehavior(context);
    }

    // Handle voting phase
    if (phase === GamePhase.Voting) {
      return this.decideVote(context);
    }

    // Update kill cooldown
    const now = Date.now();
    this.killCooldown = Math.max(0, this.KILL_COOLDOWN_MS - (now - this.lastKillTime));

    // Priority: Kill > Sabotage > Hunt > Move
    return this.decideAction(context);
  }

  private decideAction(context: DecisionContext): DecisionResult {
    const { availableActions, gameState, agentAddress } = context;

    // 1. Try to kill if available and off cooldown
    if (this.killCooldown <= 0 && this.canPerformAction(availableActions, WorkerActionType.KILL)) {
      const killAction = this.findActionOfType(availableActions, WorkerActionType.KILL);
      const targets = killAction?.targets || [];

      if (targets.length > 0) {
        // Aggressive: kill even with witnesses nearby (but prefer isolated)
        const playersHere = this.getPlayersInLocation(
          gameState.players,
          gameState.myLocation,
          agentAddress
        );

        // Find best target (prefer isolated victims)
        const target = this.selectKillTarget(targets, playersHere, gameState);

        if (target) {
          this.lastKillTime = Date.now();
          return {
            action: this.createKillAction(target),
            reasoning: `Aggressively killing ${target} (${playersHere.length} witnesses)`,
            confidence: playersHere.length <= 1 ? 0.9 : 0.6,
          };
        }
      }
    }

    // 2. Sabotage if kill on cooldown and no one nearby
    if (this.canPerformAction(availableActions, WorkerActionType.SABOTAGE)) {
      const playersHere = this.getPlayersInLocation(
        gameState.players,
        gameState.myLocation,
        agentAddress
      );

      // Sabotage to create chaos or distraction
      if (playersHere.length === 0 && Math.random() < 0.4) {
        // Prefer O2 or Reactor (critical sabotages)
        const sabotageType = Math.random() < 0.5 ? 2 : 3; // Reactor or O2
        return {
          action: { type: WorkerActionType.SABOTAGE, sabotageType },
          reasoning: `Sabotaging (type ${sabotageType}) to create chaos`,
          confidence: 0.7,
        };
      }
    }

    // 3. Hunt - move towards populated areas
    if (this.canPerformAction(availableActions, WorkerActionType.MOVE)) {
      const moveAction = this.findActionOfType(availableActions, WorkerActionType.MOVE);
      const locations = moveAction?.locations || [];

      if (locations.length > 0) {
        // Find location with most potential victims
        const bestLocation = this.findHuntingGround(locations, gameState, agentAddress);

        if (bestLocation !== undefined) {
          return {
            action: this.createMoveAction(bestLocation),
            reasoning: `Hunting: moving to ${Location[bestLocation]}`,
            confidence: 0.7,
          };
        }
      }
    }

    // 4. Wait and watch
    return {
      action: this.createWaitAction(),
      reasoning: 'Waiting for opportunity',
      confidence: 0.5,
    };
  }

  private selectKillTarget(
    targets: `0x${string}`[],
    playersHere: ReturnType<typeof this.getPlayersInLocation>,
    gameState: ReturnType<typeof this.getPlayersInLocation>[0]['location'] extends never
      ? never
      : { players: { address: `0x${string}`; isAlive: boolean }[] }
  ): `0x${string}` | undefined {
    // Prefer targets that are alone with us
    if (targets.length === 1 && playersHere.length === 1) {
      return targets[0]; // Perfect opportunity
    }

    // Otherwise pick random target (aggressive doesn't care much)
    return this.pickRandom(targets);
  }

  private findHuntingGround(
    locations: Location[],
    gameState: { players: { address: `0x${string}`; location: Location; isAlive: boolean }[] },
    agentAddress: `0x${string}`
  ): Location | undefined {
    // Count alive players in each adjacent location
    const locationCounts: Array<{ location: Location; count: number }> = [];

    for (const loc of locations) {
      const count = gameState.players.filter(
        (p) => p.isAlive && p.location === loc && p.address !== agentAddress
      ).length;
      locationCounts.push({ location: loc, count });
    }

    // Sort by count descending (most players first)
    locationCounts.sort((a, b) => b.count - a.count);

    // Prefer locations with 1-2 players (good kill opportunity)
    const ideal = locationCounts.find((lc) => lc.count >= 1 && lc.count <= 2);
    if (ideal) return ideal.location;

    // Otherwise go where there are people
    const populated = locationCounts.find((lc) => lc.count > 0);
    if (populated) return populated.location;

    // Random if no players found
    return this.pickRandom(locations);
  }

  private decideVote(context: DecisionContext): DecisionResult {
    const { gameState, agentAddress, teammates } = context;
    const alivePlayers = this.getAlivePlayers(gameState.players, agentAddress);

    // Never vote for teammates
    const nonTeammates = alivePlayers.filter(
      (p) => !teammates.includes(p.address)
    );

    if (nonTeammates.length === 0) {
      return {
        action: this.createSkipAction(),
        reasoning: 'Only teammates alive, skipping vote',
        confidence: 0.9,
      };
    }

    // Aggressive: vote for whoever seems most dangerous (random in this impl)
    // In a real implementation, track who's been asking questions
    const target = this.pickRandom(nonTeammates);

    if (target) {
      return {
        action: this.createVoteAction(target.address),
        reasoning: `Aggressively voting to eliminate ${target.address}`,
        confidence: 0.7,
      };
    }

    return {
      action: this.createSkipAction(),
      reasoning: 'No good vote target',
      confidence: 0.5,
    };
  }

  private fallbackBehavior(context: DecisionContext): DecisionResult {
    // Non-impostor fallback: just do tasks
    const { availableActions } = context;

    if (this.canPerformAction(availableActions, WorkerActionType.COMPLETE_TASK)) {
      const taskAction = this.findActionOfType(availableActions, WorkerActionType.COMPLETE_TASK);
      const taskId = this.pickRandom(taskAction?.taskIds || []);
      if (taskId) {
        return {
          action: this.createTaskAction(taskId),
          reasoning: 'Fallback: completing task',
          confidence: 0.6,
        };
      }
    }

    return {
      action: this.createWaitAction(),
      reasoning: 'Fallback: waiting',
      confidence: 0.3,
    };
  }
}
