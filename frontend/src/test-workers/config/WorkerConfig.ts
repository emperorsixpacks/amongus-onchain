// Worker Configuration Types

import { Location, Role } from '@/types/game';

// ============ Strategy Types ============

export type StrategyType =
  | 'aggressive'   // Quick kills, risky plays (Impostor)
  | 'stealth'      // Careful kills, build alibis (Impostor)
  | 'passive'      // Focus on tasks, avoid conflict (Crewmate)
  | 'task-focused' // Prioritize task completion (Crewmate)
  | 'detective'    // Gather info, track movements (Crewmate)
  | 'random';      // Random decisions (baseline - Both)

export const IMPOSTOR_STRATEGIES: StrategyType[] = ['aggressive', 'stealth', 'random'];
export const CREWMATE_STRATEGIES: StrategyType[] = ['passive', 'task-focused', 'detective', 'random'];

// ============ Agent Configuration ============

export interface AgentConfig {
  colorId: number;
  strategy: StrategyType;
  forcedRole?: 'Crewmate' | 'Impostor'; // For testing specific scenarios
  name?: string;
}

// ============ Test Scenario Configuration ============

export interface TestScenarioConfig {
  name: string;
  description?: string;
  agents: AgentConfig[];
  timeout: number; // milliseconds

  // Game settings
  gameSettings?: Partial<GameSettings>;

  // Assertions to run after game
  assertions: TestAssertion[];
}

// ============ Test Assertions ============

export interface TestResult {
  gameId: string;
  finalState: {
    phase: string;
    winner?: 'crewmates' | 'impostors';
    reason?: string;
  } | null;
  killCount: number;
  ejectionCount: number;
  tasksCompleted: number;
  roundsPlayed: number;
  duration: number;
  logs: TestLog[];
  agentDecisions: AgentDecision[];
}

export interface TestAssertion {
  name: string;
  check: (result: TestResult) => boolean;
  message?: string;
}

export interface TestAssertionResult {
  name: string;
  passed: boolean;
  message?: string;
}

// ============ Worker Configuration ============

export interface WorkerPoolConfig {
  maxWorkers: number;
  workerTimeout: number; // Per-worker timeout
  restartOnCrash: boolean;
}

export interface WorkerInitConfig {
  workerId: string;
  agentAddress: `0x${string}`;
  gameId: string;
  colorId: number;
  strategy: StrategyType;
  serverUrl: string;
}

// ============ Logging Types ============

export interface TestLog {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string; // worker ID or 'harness'
  message: string;
  data?: Record<string, unknown>;
}

export interface AgentDecision {
  timestamp: number;
  agentAddress: `0x${string}`;
  phase: string;
  action: string;
  reasoning?: string;
  context?: Record<string, unknown>;
}

// ============ Default Configurations ============

export const DEFAULT_WORKER_POOL_CONFIG: WorkerPoolConfig = {
  maxWorkers: 10,
  workerTimeout: 300000, // 5 minutes
  restartOnCrash: true,
};

export const DEFAULT_GAME_SETTINGS = {
  numImpostors: 1,
  tasksPerPlayer: 5,
  votingDuration: 30000,     // 30 seconds
  discussionDuration: 15000, // 15 seconds
  killCooldown: 10000,       // 10 seconds
  actionTimeout: 30,         // 30 seconds per action phase
};

export type GameSettings = typeof DEFAULT_GAME_SETTINGS;

// ============ Pre-built Scenarios ============

export const BASIC_6_PLAYER_SCENARIO: TestScenarioConfig = {
  name: 'Basic 6-Player Game',
  description: 'Standard game with 6 players, 1 impostor',
  agents: [
    { colorId: 0, strategy: 'task-focused', forcedRole: 'Crewmate' },
    { colorId: 1, strategy: 'stealth', forcedRole: 'Impostor' },
    { colorId: 2, strategy: 'detective', forcedRole: 'Crewmate' },
    { colorId: 3, strategy: 'passive', forcedRole: 'Crewmate' },
    { colorId: 4, strategy: 'task-focused', forcedRole: 'Crewmate' },
    { colorId: 5, strategy: 'passive', forcedRole: 'Crewmate' },
  ],
  timeout: 120000, // 2 minutes
  assertions: [
    {
      name: 'Game completes',
      check: (r) => r.finalState?.phase === 'Ended',
      message: 'Game should reach Ended phase',
    },
    {
      name: 'At least one kill occurs',
      check: (r) => r.killCount >= 1,
      message: 'Impostor should kill at least once',
    },
    {
      name: 'Some tasks completed',
      check: (r) => r.tasksCompleted > 0,
      message: 'Crewmates should complete at least some tasks',
    },
  ],
};

export const AGGRESSIVE_IMPOSTOR_SCENARIO: TestScenarioConfig = {
  name: 'Aggressive Impostor Test',
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
  assertions: [
    {
      name: 'Game completes',
      check: (r) => r.finalState?.phase === 'Ended',
    },
    {
      name: 'Multiple kills occur',
      check: (r) => r.killCount >= 2,
      message: 'Aggressive impostor should kill multiple times',
    },
  ],
};

export const DETECTIVE_VS_STEALTH_SCENARIO: TestScenarioConfig = {
  name: 'Detective vs Stealth',
  description: 'Detective crewmates try to catch a stealthy impostor',
  agents: [
    { colorId: 0, strategy: 'detective', forcedRole: 'Crewmate' },
    { colorId: 1, strategy: 'stealth', forcedRole: 'Impostor' },
    { colorId: 2, strategy: 'detective', forcedRole: 'Crewmate' },
    { colorId: 3, strategy: 'task-focused', forcedRole: 'Crewmate' },
    { colorId: 4, strategy: 'task-focused', forcedRole: 'Crewmate' },
    { colorId: 5, strategy: 'detective', forcedRole: 'Crewmate' },
  ],
  timeout: 180000, // 3 minutes
  assertions: [
    {
      name: 'Game completes',
      check: (r) => r.finalState?.phase === 'Ended',
    },
    {
      name: 'At least one meeting called',
      check: (r) => r.roundsPlayed >= 1,
      message: 'Detectives should discover bodies',
    },
  ],
};

export const RANDOM_CHAOS_SCENARIO: TestScenarioConfig = {
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
  timeout: 180000,
  assertions: [
    {
      name: 'Game eventually ends',
      check: (r) => r.finalState?.phase === 'Ended' || r.duration >= 180000,
    },
  ],
};
