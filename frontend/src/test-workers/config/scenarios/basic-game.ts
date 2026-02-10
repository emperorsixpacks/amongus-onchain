// Basic Game Test Scenarios

import { TestScenarioConfig } from '../WorkerConfig';
import {
  gameCompletes,
  atLeastKills,
  atLeastTasks,
  atLeastRounds,
  noErrors,
  crewmatesWin,
  impostorsWin,
  standardGameAssertions,
  balancedGameAssertions,
} from '../../harness/assertions';

// ============ Standard Test Scenarios ============

export const STANDARD_6_PLAYER: TestScenarioConfig = {
  name: 'Standard 6-Player Game',
  description: 'Basic game with 6 players, 1 impostor, mixed strategies',
  agents: [
    { colorId: 0, strategy: 'task-focused', forcedRole: 'Crewmate', name: 'Red' },
    { colorId: 1, strategy: 'stealth', forcedRole: 'Impostor', name: 'Blue' },
    { colorId: 2, strategy: 'detective', forcedRole: 'Crewmate', name: 'Green' },
    { colorId: 3, strategy: 'passive', forcedRole: 'Crewmate', name: 'Pink' },
    { colorId: 4, strategy: 'task-focused', forcedRole: 'Crewmate', name: 'Orange' },
    { colorId: 5, strategy: 'passive', forcedRole: 'Crewmate', name: 'Yellow' },
  ],
  timeout: 120000, // 2 minutes
  assertions: standardGameAssertions(),
};

export const AGGRESSIVE_IMPOSTOR: TestScenarioConfig = {
  name: 'Aggressive Impostor vs Passive Crew',
  description: 'Tests aggressive impostor strategy against passive crewmates',
  agents: [
    { colorId: 0, strategy: 'passive', forcedRole: 'Crewmate' },
    { colorId: 1, strategy: 'aggressive', forcedRole: 'Impostor' },
    { colorId: 2, strategy: 'passive', forcedRole: 'Crewmate' },
    { colorId: 3, strategy: 'passive', forcedRole: 'Crewmate' },
    { colorId: 4, strategy: 'passive', forcedRole: 'Crewmate' },
    { colorId: 5, strategy: 'passive', forcedRole: 'Crewmate' },
  ],
  timeout: 90000, // 1.5 minutes
  gameSettings: {
    killCooldown: 5000, // Fast kills
  },
  assertions: [
    gameCompletes(),
    atLeastKills(2), // Aggressive should kill at least twice
    noErrors(),
  ],
};

export const DETECTIVE_TEAM: TestScenarioConfig = {
  name: 'Detective Team vs Stealth Impostor',
  description: 'Detective crewmates try to catch a stealthy impostor',
  agents: [
    { colorId: 0, strategy: 'detective', forcedRole: 'Crewmate' },
    { colorId: 1, strategy: 'stealth', forcedRole: 'Impostor' },
    { colorId: 2, strategy: 'detective', forcedRole: 'Crewmate' },
    { colorId: 3, strategy: 'task-focused', forcedRole: 'Crewmate' },
    { colorId: 4, strategy: 'detective', forcedRole: 'Crewmate' },
    { colorId: 5, strategy: 'task-focused', forcedRole: 'Crewmate' },
  ],
  timeout: 180000, // 3 minutes (detectives are methodical)
  assertions: [
    gameCompletes(),
    atLeastRounds(2), // Should have at least 2 rounds of play
    noErrors(),
  ],
};

export const TASK_RUSH: TestScenarioConfig = {
  name: 'Task Rush',
  description: 'All crewmates are task-focused, impostor must be quick',
  agents: [
    { colorId: 0, strategy: 'task-focused', forcedRole: 'Crewmate' },
    { colorId: 1, strategy: 'aggressive', forcedRole: 'Impostor' },
    { colorId: 2, strategy: 'task-focused', forcedRole: 'Crewmate' },
    { colorId: 3, strategy: 'task-focused', forcedRole: 'Crewmate' },
    { colorId: 4, strategy: 'task-focused', forcedRole: 'Crewmate' },
    { colorId: 5, strategy: 'task-focused', forcedRole: 'Crewmate' },
  ],
  timeout: 120000,
  gameSettings: {
    tasksPerPlayer: 3, // Fewer tasks for faster completion
  },
  assertions: [
    gameCompletes(),
    atLeastTasks(5), // Should complete at least 5 tasks
    noErrors(),
  ],
};

// ============ Chaos/Random Scenarios ============

export const RANDOM_CHAOS: TestScenarioConfig = {
  name: 'Random Chaos',
  description: 'All agents use random strategy - baseline test',
  agents: [
    { colorId: 0, strategy: 'random' },
    { colorId: 1, strategy: 'random' },
    { colorId: 2, strategy: 'random' },
    { colorId: 3, strategy: 'random' },
    { colorId: 4, strategy: 'random' },
    { colorId: 5, strategy: 'random' },
  ],
  timeout: 180000, // 3 minutes
  assertions: [
    {
      name: 'Game eventually ends',
      check: (r) => r.finalState?.phase === 'Ended' || r.duration >= 180000,
    },
    noErrors(),
  ],
};

export const MIXED_RANDOM: TestScenarioConfig = {
  name: 'Mixed Random',
  description: 'Some strategic agents, some random - chaos test',
  agents: [
    { colorId: 0, strategy: 'detective', forcedRole: 'Crewmate' },
    { colorId: 1, strategy: 'random', forcedRole: 'Impostor' },
    { colorId: 2, strategy: 'random' },
    { colorId: 3, strategy: 'task-focused', forcedRole: 'Crewmate' },
    { colorId: 4, strategy: 'random' },
    { colorId: 5, strategy: 'passive', forcedRole: 'Crewmate' },
  ],
  timeout: 150000,
  assertions: [
    gameCompletes(),
    noErrors(),
  ],
};

// ============ 8-Player Scenarios ============

export const LARGE_GAME_8_PLAYERS: TestScenarioConfig = {
  name: 'Large 8-Player Game',
  description: '8 players with 2 impostors',
  agents: [
    { colorId: 0, strategy: 'task-focused', forcedRole: 'Crewmate' },
    { colorId: 1, strategy: 'stealth', forcedRole: 'Impostor' },
    { colorId: 2, strategy: 'detective', forcedRole: 'Crewmate' },
    { colorId: 3, strategy: 'passive', forcedRole: 'Crewmate' },
    { colorId: 4, strategy: 'aggressive', forcedRole: 'Impostor' },
    { colorId: 5, strategy: 'task-focused', forcedRole: 'Crewmate' },
    { colorId: 6, strategy: 'detective', forcedRole: 'Crewmate' },
    { colorId: 7, strategy: 'passive', forcedRole: 'Crewmate' },
  ],
  timeout: 180000,
  gameSettings: {
    numImpostors: 2,
  },
  assertions: balancedGameAssertions(8),
};

// ============ Edge Case Scenarios ============

export const MINIMUM_PLAYERS: TestScenarioConfig = {
  name: 'Minimum 4 Players',
  description: 'Tests game with minimum player count',
  agents: [
    { colorId: 0, strategy: 'task-focused', forcedRole: 'Crewmate' },
    { colorId: 1, strategy: 'stealth', forcedRole: 'Impostor' },
    { colorId: 2, strategy: 'detective', forcedRole: 'Crewmate' },
    { colorId: 3, strategy: 'passive', forcedRole: 'Crewmate' },
  ],
  timeout: 90000,
  assertions: [
    gameCompletes(),
    noErrors(),
  ],
};

export const ALL_DETECTIVES: TestScenarioConfig = {
  name: 'All Detectives',
  description: 'All crewmates are detectives - high detection',
  agents: [
    { colorId: 0, strategy: 'detective', forcedRole: 'Crewmate' },
    { colorId: 1, strategy: 'stealth', forcedRole: 'Impostor' },
    { colorId: 2, strategy: 'detective', forcedRole: 'Crewmate' },
    { colorId: 3, strategy: 'detective', forcedRole: 'Crewmate' },
    { colorId: 4, strategy: 'detective', forcedRole: 'Crewmate' },
    { colorId: 5, strategy: 'detective', forcedRole: 'Crewmate' },
  ],
  timeout: 150000,
  assertions: [
    gameCompletes(),
    atLeastRounds(1), // Should catch impostor relatively quickly
    noErrors(),
  ],
};

// ============ Scenario Collections ============

export const ALL_BASIC_SCENARIOS: TestScenarioConfig[] = [
  STANDARD_6_PLAYER,
  AGGRESSIVE_IMPOSTOR,
  DETECTIVE_TEAM,
  TASK_RUSH,
];

export const ALL_CHAOS_SCENARIOS: TestScenarioConfig[] = [
  RANDOM_CHAOS,
  MIXED_RANDOM,
];

export const ALL_SCENARIOS: TestScenarioConfig[] = [
  ...ALL_BASIC_SCENARIOS,
  ...ALL_CHAOS_SCENARIOS,
  LARGE_GAME_8_PLAYERS,
  MINIMUM_PLAYERS,
  ALL_DETECTIVES,
];

// ============ Quick Test Scenarios (faster execution) ============

export const QUICK_TEST: TestScenarioConfig = {
  name: 'Quick Test',
  description: 'Fast scenario for CI/CD',
  agents: [
    { colorId: 0, strategy: 'task-focused', forcedRole: 'Crewmate' },
    { colorId: 1, strategy: 'aggressive', forcedRole: 'Impostor' },
    { colorId: 2, strategy: 'passive', forcedRole: 'Crewmate' },
    { colorId: 3, strategy: 'passive', forcedRole: 'Crewmate' },
  ],
  timeout: 30000, // 30 seconds
  gameSettings: {
    tasksPerPlayer: 2,
    killCooldown: 3000,
    discussionDuration: 5000,
    votingDuration: 10000,
  },
  assertions: [
    gameCompletes(),
    noErrors(),
  ],
};
