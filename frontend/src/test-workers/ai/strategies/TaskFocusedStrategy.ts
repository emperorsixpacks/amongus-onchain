// Task-Focused Crewmate Strategy

import { Role, GamePhase, Location } from '@/types/game';
import {
  BaseDecisionEngine,
  DecisionContext,
  DecisionResult,
} from '../DecisionEngine';
import { WorkerActionType } from '../../workers/WorkerMessage';

/**
 * Task-Focused Strategy (Crewmate)
 *
 * - Prioritizes completing tasks above all else
 * - Moves efficiently between task locations
 * - Reports bodies but doesn't investigate
 * - Votes quickly to return to tasks
 */
export class TaskFocusedStrategy extends BaseDecisionEngine {
  private taskRoute: Location[] = [];
  private currentTaskIndex: number = 0;

  // Task locations for efficient routing
  private readonly TASK_LOCATIONS: Location[] = [
    Location.Electrical,
    Location.Admin,
    Location.MedBay,
    Location.Storage,
    Location.Reactor,
    Location.Security,
    Location.UpperEngine,
    Location.LowerEngine,
  ];

  decide(context: DecisionContext): DecisionResult {
    const { phase } = context;

    if (phase === GamePhase.Voting) {
      return this.decideVote(context);
    }

    return this.decideAction(context);
  }

  private decideAction(context: DecisionContext): DecisionResult {
    const { availableActions, gameState, agentAddress } = context;

    // 1. Always report bodies first (interrupts tasks)
    if (this.canPerformAction(availableActions, WorkerActionType.REPORT_BODY)) {
      const bodies = gameState.deadBodies.filter(
        (b) => !b.reported && b.location === gameState.myLocation
      );

      if (bodies.length > 0) {
        return {
          action: this.createReportAction(bodies[0].victim),
          reasoning: `Found body, must report to continue tasks safely`,
          confidence: 0.95,
        };
      }
    }

    // 2. Do task if available at current location
    if (this.canPerformAction(availableActions, WorkerActionType.COMPLETE_TASK)) {
      const taskAction = this.findActionOfType(availableActions, WorkerActionType.COMPLETE_TASK);
      const taskId = taskAction?.taskIds?.[0];

      if (taskId) {
        return {
          action: this.createTaskAction(taskId),
          reasoning: `Completing task ${taskId} at ${Location[gameState.myLocation]}`,
          confidence: 0.9,
        };
      }
    }

    // 3. Move to next task location
    return this.moveToNextTask(context);
  }

  private moveToNextTask(context: DecisionContext): DecisionResult {
    const { availableActions, gameState } = context;

    if (!this.canPerformAction(availableActions, WorkerActionType.MOVE)) {
      return {
        action: this.createWaitAction(),
        reasoning: 'Cannot move, waiting for task opportunity',
        confidence: 0.5,
      };
    }

    const moveAction = this.findActionOfType(availableActions, WorkerActionType.MOVE);
    const adjacentLocations = moveAction?.locations || [];

    // Initialize task route if needed
    if (this.taskRoute.length === 0) {
      this.taskRoute = this.planTaskRoute(gameState.myLocation);
    }

    // Find next task location in route
    const nextTaskLocation = this.taskRoute[this.currentTaskIndex % this.taskRoute.length];

    // If we can move directly to next task location, do it
    if (adjacentLocations.includes(nextTaskLocation)) {
      this.currentTaskIndex++;
      return {
        action: this.createMoveAction(nextTaskLocation),
        reasoning: `Moving to task location: ${Location[nextTaskLocation]}`,
        confidence: 0.85,
      };
    }

    // Otherwise, find path toward task location
    const pathToTask = this.findPathToward(
      gameState.myLocation,
      nextTaskLocation,
      adjacentLocations
    );

    if (pathToTask !== undefined) {
      return {
        action: this.createMoveAction(pathToTask),
        reasoning: `Moving toward task location ${Location[nextTaskLocation]} via ${Location[pathToTask]}`,
        confidence: 0.8,
      };
    }

    // Fallback: move to any adjacent location with potential tasks
    const anyTaskLocation = this.pickRandom(
      adjacentLocations.filter((loc) => this.TASK_LOCATIONS.includes(loc))
    );

    if (anyTaskLocation !== undefined) {
      return {
        action: this.createMoveAction(anyTaskLocation),
        reasoning: `Moving to ${Location[anyTaskLocation]} for tasks`,
        confidence: 0.7,
      };
    }

    // Last resort: random movement
    const randomLoc = this.pickRandom(adjacentLocations);
    if (randomLoc !== undefined) {
      return {
        action: this.createMoveAction(randomLoc),
        reasoning: `Moving randomly to ${Location[randomLoc]}`,
        confidence: 0.5,
      };
    }

    return {
      action: this.createWaitAction(),
      reasoning: 'No movement options available',
      confidence: 0.3,
    };
  }

  private planTaskRoute(startLocation: Location): Location[] {
    // Simple greedy task route planning
    const remaining = [...this.TASK_LOCATIONS];
    const route: Location[] = [];
    let current = startLocation;

    while (remaining.length > 0) {
      // Find nearest task location
      let nearest: Location | null = null;
      let nearestDist = Infinity;

      for (const loc of remaining) {
        const dist = this.estimateDistance(current, loc);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = loc;
        }
      }

      if (nearest !== null) {
        route.push(nearest);
        remaining.splice(remaining.indexOf(nearest), 1);
        current = nearest;
      } else {
        break;
      }
    }

    return route;
  }

  private estimateDistance(from: Location, to: Location): number {
    // BFS to find shortest path length
    if (from === to) return 0;

    const visited = new Set<Location>();
    const queue: Array<{ loc: Location; dist: number }> = [{ loc: from, dist: 0 }];

    while (queue.length > 0) {
      const { loc, dist } = queue.shift()!;

      if (loc === to) return dist;

      if (visited.has(loc)) continue;
      visited.add(loc);

      for (const adj of this.getAdjacentRooms(loc)) {
        if (!visited.has(adj)) {
          queue.push({ loc: adj, dist: dist + 1 });
        }
      }
    }

    return Infinity;
  }

  private findPathToward(
    from: Location,
    to: Location,
    adjacentLocations: Location[]
  ): Location | undefined {
    // Find which adjacent location gets us closer to target
    let best: Location | undefined;
    let bestDist = this.estimateDistance(from, to);

    for (const adj of adjacentLocations) {
      const dist = this.estimateDistance(adj, to);
      if (dist < bestDist) {
        bestDist = dist;
        best = adj;
      }
    }

    return best;
  }

  private decideVote(context: DecisionContext): DecisionResult {
    const { gameState, agentAddress } = context;

    // Task-focused players want to return to tasks quickly
    // They vote based on simple heuristics

    const alivePlayers = this.getAlivePlayers(gameState.players, agentAddress);

    // Check if anyone was near recent bodies
    const recentBodies = gameState.deadBodies.filter((b) => b.reported);

    if (recentBodies.length > 0) {
      const lastBody = recentBodies[recentBodies.length - 1];

      // Vote for anyone who was at the body location (if known)
      const suspects = alivePlayers.filter(
        (p) => this.memory.playerLastSeen.get(p.address)?.location === lastBody.location
      );

      if (suspects.length > 0) {
        const suspect = suspects[0];
        return {
          action: this.createVoteAction(suspect.address),
          reasoning: `Voting for ${suspect.address} who was near the body`,
          confidence: 0.7,
        };
      }
    }

    // Skip to end meeting quickly and return to tasks
    return {
      action: this.createSkipAction(),
      reasoning: 'No clear suspect, skipping to return to tasks',
      confidence: 0.6,
    };
  }

  reset(): void {
    super.reset();
    this.taskRoute = [];
    this.currentTaskIndex = 0;
  }
}
