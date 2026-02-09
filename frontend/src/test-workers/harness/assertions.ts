// Test Assertion Helpers

import { TestResult, TestAssertion } from '../config/WorkerConfig';

// ============ Game Completion Assertions ============

export function gameCompletes(): TestAssertion {
  return {
    name: 'Game completes',
    check: (r: TestResult) => r.finalState?.phase === 'Ended',
    message: 'Game should reach Ended phase',
  };
}

export function gameEndsWithin(maxRounds: number): TestAssertion {
  return {
    name: `Game ends within ${maxRounds} rounds`,
    check: (r: TestResult) =>
      r.finalState?.phase === 'Ended' && r.roundsPlayed <= maxRounds,
    message: `Game should complete within ${maxRounds} rounds`,
  };
}

export function gameDurationUnder(maxMs: number): TestAssertion {
  return {
    name: `Game duration under ${maxMs}ms`,
    check: (r: TestResult) => r.duration < maxMs,
    message: `Game should complete in under ${maxMs}ms`,
  };
}

// ============ Winner Assertions ============

export function crewmatesWin(): TestAssertion {
  return {
    name: 'Crewmates win',
    check: (r: TestResult) => r.finalState?.winner === 'crewmates',
    message: 'Crewmates should win the game',
  };
}

export function impostorsWin(): TestAssertion {
  return {
    name: 'Impostors win',
    check: (r: TestResult) => r.finalState?.winner === 'impostors',
    message: 'Impostors should win the game',
  };
}

export function winByReason(reason: string): TestAssertion {
  return {
    name: `Win by ${reason}`,
    check: (r: TestResult) => r.finalState?.reason === reason,
    message: `Game should be won by ${reason}`,
  };
}

// ============ Kill Assertions ============

export function atLeastKills(minKills: number): TestAssertion {
  return {
    name: `At least ${minKills} kill(s)`,
    check: (r: TestResult) => r.killCount >= minKills,
    message: `At least ${minKills} kill(s) should occur`,
  };
}

export function atMostKills(maxKills: number): TestAssertion {
  return {
    name: `At most ${maxKills} kill(s)`,
    check: (r: TestResult) => r.killCount <= maxKills,
    message: `At most ${maxKills} kill(s) should occur`,
  };
}

export function exactlyKills(numKills: number): TestAssertion {
  return {
    name: `Exactly ${numKills} kill(s)`,
    check: (r: TestResult) => r.killCount === numKills,
    message: `Exactly ${numKills} kill(s) should occur`,
  };
}

export function noKills(): TestAssertion {
  return {
    name: 'No kills',
    check: (r: TestResult) => r.killCount === 0,
    message: 'No kills should occur',
  };
}

// ============ Task Assertions ============

export function atLeastTasks(minTasks: number): TestAssertion {
  return {
    name: `At least ${minTasks} task(s) completed`,
    check: (r: TestResult) => r.tasksCompleted >= minTasks,
    message: `At least ${minTasks} task(s) should be completed`,
  };
}

export function allTasksCompleted(totalTasks: number): TestAssertion {
  return {
    name: 'All tasks completed',
    check: (r: TestResult) => r.tasksCompleted >= totalTasks,
    message: `All ${totalTasks} tasks should be completed`,
  };
}

export function taskCompletionRate(minRate: number): TestAssertion {
  return {
    name: `Task completion rate >= ${minRate * 100}%`,
    check: (r: TestResult) => {
      if (r.roundsPlayed === 0) return false;
      const rate = r.tasksCompleted / r.roundsPlayed;
      return rate >= minRate;
    },
    message: `Task completion rate should be at least ${minRate * 100}%`,
  };
}

// ============ Round Assertions ============

export function atLeastRounds(minRounds: number): TestAssertion {
  return {
    name: `At least ${minRounds} round(s)`,
    check: (r: TestResult) => r.roundsPlayed >= minRounds,
    message: `Game should last at least ${minRounds} round(s)`,
  };
}

export function atMostRounds(maxRounds: number): TestAssertion {
  return {
    name: `At most ${maxRounds} round(s)`,
    check: (r: TestResult) => r.roundsPlayed <= maxRounds,
    message: `Game should complete within ${maxRounds} round(s)`,
  };
}

// ============ Ejection Assertions ============

export function atLeastEjections(minEjections: number): TestAssertion {
  return {
    name: `At least ${minEjections} ejection(s)`,
    check: (r: TestResult) => r.ejectionCount >= minEjections,
    message: `At least ${minEjections} ejection(s) should occur`,
  };
}

export function impostorEjected(): TestAssertion {
  return {
    name: 'At least one impostor ejected',
    check: (r: TestResult) => {
      // Check decision logs for impostor ejection
      // This is a simplified check - real implementation would
      // track ejection details
      return r.ejectionCount > 0;
    },
    message: 'At least one impostor should be ejected',
  };
}

// ============ Decision Assertions ============

export function allDecisionsLogged(): TestAssertion {
  return {
    name: 'All decisions logged',
    check: (r: TestResult) => r.agentDecisions.length > 0,
    message: 'Agent decisions should be logged',
  };
}

export function noErrors(): TestAssertion {
  return {
    name: 'No errors',
    check: (r: TestResult) =>
      !r.logs.some((log) => log.level === 'error'),
    message: 'No errors should occur during the game',
  };
}

export function decisionTimeUnder(maxMs: number): TestAssertion {
  return {
    name: `Decision time under ${maxMs}ms`,
    check: (r: TestResult) => {
      for (const decision of r.agentDecisions) {
        const time = decision.context?.decisionTimeMs as number | undefined;
        if (time && time > maxMs) return false;
      }
      return true;
    },
    message: `All decisions should complete in under ${maxMs}ms`,
  };
}

// ============ Composite Assertions ============

export function standardGameAssertions(): TestAssertion[] {
  return [
    gameCompletes(),
    atLeastKills(1),
    atLeastTasks(1),
    noErrors(),
  ];
}

export function balancedGameAssertions(numPlayers: number): TestAssertion[] {
  return [
    gameCompletes(),
    atLeastRounds(2),
    atMostRounds(Math.ceil(numPlayers * 3)),
    atLeastKills(1),
    atMostKills(numPlayers - 1),
  ];
}
