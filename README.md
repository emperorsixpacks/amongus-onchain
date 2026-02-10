# Among Us On-Chain

> An autonomous AI agent-powered social deduction game built for the [Moltiverse Hackathon](https://moltiverse.dev/) on Monad blockchain.

## Current Status

| Component | Status |
|-----------|--------|
| Smart Contracts | Complete (GameLobby, AmongUsGame, WagerVault, AgentRegistry, GameTypes) |
| Agent Framework | Complete (Agent, GameObserver, ActionSubmitter, GameMemory) |
| Strategies | Complete (5 Crewmate + 5 Impostor strategies) |
| Frontend | Complete (Map, Voting, Lobby, Spectator mode) |
| Testnet Deployment | In Progress |

**User Role**: Spectator - users watch autonomous AI agents play, they do not participate directly.

---

## Table of Contents

- [Game Overview](#game-overview)
- [Core Game Mechanics](#core-game-mechanics)
- [Smart Contract Architecture](#smart-contract-architecture)
- [AI Agent Architecture](#ai-agent-architecture)
- [Discussion & Voting System](#discussion--voting-system)
- [Technical Stack](#technical-stack)
- [UI/UX Design](#uiux-design)
- [Implementation Phases](#implementation-phases)
- [Project Structure](#project-structure)
- [Key Success Criteria Mapping](#key-success-criteria-mapping)

---

## Game Overview

### Simplification for On-Chain

Since Among Us is traditionally a real-time game with movement, we adapt it for blockchain (turn-based, state-machine driven) while preserving the core social deduction mechanics.

### Simplified Game Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GAME PHASES (TURN-BASED)                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. LOBBY PHASE          2. ROLE ASSIGNMENT      3. ACTION PHASE    │
│  ┌───────────────┐       ┌───────────────┐      ┌───────────────┐   │
│  │ Agents join   │  ──►  │ Random role   │  ──► │ Each agent    │   │
│  │ Wagers placed │       │ assignment    │      │ submits action│   │
│  │ (stake tokens)│       │ (on-chain RNG)│      │ secretly      │   │
│  └───────────────┘       └───────────────┘      └───────────────┘   │
│                                                         │           │
│                                                         ▼           │
│  6. WIN CONDITION        5. VOTING PHASE        4. REVEAL PHASE     │
│  ┌───────────────┐       ┌───────────────┐      ┌───────────────┐   │
│  │ Check victory │  ◄──  │ Discussion &  │  ◄── │ Actions       │   │
│  │ Distribute    │       │ Vote to eject │      │ revealed      │   │
│  │ wagers        │       │ suspects      │      │ Bodies found  │   │
│  └───────────────┘       └───────────────┘      └───────────────┘   │
│                                  │                                  │
│                                  ▼                                  │
│                          Back to Phase 3                            │
│                          (until win/loss)                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Game Mechanics

### Roles

```
┌────────────────────────────────────────────────────────────────┐
│                          ROLES                                 │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  CREWMATE (70-80% of players)         IMPOSTOR (20-30%)        │
│  ┌─────────────────────────┐          ┌─────────────────────┐  │
│  │ ✓ Complete tasks        │          │ ✗ Cannot do tasks   │  │
│  │ ✓ Report bodies         │          │ ✓ Kill crewmates    │  │
│  │ ✓ Call meetings         │          │ ✓ Fake tasks        │  │
│  │ ✓ Vote in discussions   │          │ ✓ Sabotage          │  │
│  │ ✓ Observe locations     │          │ ✓ Use vents         │  │
│  │                         │          │ ✓ Vote & deceive    │  │
│  │ WIN: All tasks done     │          │                     │  │
│  │      OR eject impostors │          │ WIN: Kill enough    │  │
│  └─────────────────────────┘          │      OR sabotage    │  │
│                                       └─────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### Locations (Simplified Map - The Skeld)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    THE SKELD (SIMPLIFIED - 8 ROOMS)                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│     ┌──────────┐     ┌──────────┐     ┌──────────┐                  │
│     │ REACTOR  │─────│ UPPER    │─────│ CAFETERIA│                  │
│     │ (Task)   │     │ ENGINE   │     │ (Meeting)│                  │
│     └────┬─────┘     └────┬─────┘     └────┬─────┘                  │
│          │                │                │                        │
│     ┌────┴─────┐     ┌────┴─────┐     ┌────┴─────┐                  │
│     │ SECURITY │─────│ MEDBAY   │─────│ ADMIN    │                  │
│     │ (Cams)   │     │ (Task)   │     │ (Task)   │                  │
│     └────┬─────┘     └────┬─────┘     └────┬─────┘                  │
│          │                │                │                        │
│     ┌────┴─────┐     ┌────┴─────┐     ┌────┴─────┐                  │
│     │ LOWER    │─────│ ELECTRICAL│────│ STORAGE  │                  │
│     │ ENGINE   │     │ (Task)   │     │ (Task)   │                  │
│     └──────────┘     └──────────┘     └──────────┘                  │
│                                                                     │
│  VENTS: Reactor↔Security, MedBay↔Electrical, Cafeteria↔Admin       │
└─────────────────────────────────────────────────────────────────────┘
```

### Actions Per Turn

```
┌─────────────────────────────────────────────────────────────────────┐
│                     AVAILABLE ACTIONS PER TURN                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  CREWMATE ACTIONS:                  IMPOSTOR ACTIONS:               │
│  ─────────────────                  ─────────────────               │
│  • MOVE(room)      - Go to room     • MOVE(room)     - Go to room   │
│  • DO_TASK(taskId) - Complete task  • FAKE_TASK      - Pretend work │
│  • REPORT          - Report body    • KILL(agentId)  - Kill nearby  │
│  • USE_CAMS        - Watch security • VENT(room)     - Fast travel  │
│  • CALL_MEETING    - Emergency mtg  • SABOTAGE(type) - Cause chaos  │
│  • SKIP            - Do nothing     • REPORT         - Self-report  │
│                                     • CALL_MEETING   - Frame others │
│                                                                     │
│  VOTING PHASE (ALL):                                                │
│  ─────────────────                                                  │
│  • VOTE(agentId)   - Vote to eject                                  │
│  • SKIP_VOTE       - Abstain                                        │
│  • ACCUSE(id,msg)  - Make accusation with reasoning                 │
│  • DEFEND(msg)     - Defend yourself                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Smart Contract Architecture

### Contract Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SMART CONTRACT ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    AmongUsGameFactory.sol                   │    │
│  │  • createGame(minPlayers, maxPlayers, wagerAmount)          │    │
│  │  • listActiveGames()                                        │    │
│  │  • getGameStats(gameId)                                     │    │
│  └─────────────────────────────┬───────────────────────────────┘    │
│                                │                                    │
│                    ┌───────────┴───────────┐                        │
│                    ▼                       ▼                        │
│  ┌─────────────────────────┐  ┌─────────────────────────┐          │
│  │  AmongUsGame.sol        │  │  WagerVault.sol         │          │
│  │  (One per match)        │  │  (Escrow & payouts)     │          │
│  │                         │  │                         │          │
│  │  • joinGame()           │  │  • deposit(gameId)      │          │
│  │  • submitAction()       │  │  • claimWinnings()      │          │
│  │  • revealAction()       │  │  • refund()             │          │
│  │  • submitVote()         │  │  • distributeRewards()  │          │
│  │  • processRound()       │  │                         │          │
│  └─────────────────────────┘  └─────────────────────────┘          │
│                    │                                                │
│                    ▼                                                │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    GameState.sol (Library)                  │    │
│  │  • Player positions, alive/dead status                      │    │
│  │  • Task completion tracking                                 │    │
│  │  • Role assignments (committed hash until reveal)           │    │
│  │  • Voting tallies                                           │    │
│  │  • Sabotage timers                                          │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    AgentRegistry.sol                        │    │
│  │  • registerAgent(address, strategyHash)                     │    │
│  │  • getAgentStats(address) → wins, losses, earnings          │    │
│  │  • updateRating(address, result)                            │    │
│  │  • getLeaderboard()                                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Commit-Reveal Scheme (Prevents Cheating)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    COMMIT-REVEAL FOR ACTIONS                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  PHASE 1: COMMIT (All agents submit simultaneously)                 │
│  ───────────────────────────────────────────────────                │
│  Agent submits: hash(action + salt + agentAddress)                  │
│                                                                     │
│  Example:                                                           │
│  Agent A: hash("MOVE:ELECTRICAL" + "abc123" + 0x1234...)           │
│  Agent B: hash("KILL:AgentA" + "xyz789" + 0x5678...)               │
│                                                                     │
│  PHASE 2: REVEAL (After all commits received)                       │
│  ───────────────────────────────────────────────────                │
│  Agent reveals: (action, salt)                                      │
│  Contract verifies: hash(action + salt + msg.sender) == commitment  │
│                                                                     │
│  PHASE 3: EXECUTE (Contract processes all actions)                  │
│  ───────────────────────────────────────────────────                │
│  • Movements resolved                                               │
│  • Kills processed (only if killer & victim in same room)           │
│  • Tasks completed                                                  │
│  • Sabotages triggered                                              │
│  • Bodies discovered → trigger meeting if reported                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Wager & Payout System

```
┌─────────────────────────────────────────────────────────────────────┐
│                    WAGER & PAYOUT MECHANICS                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  JOIN GAME:                                                         │
│  ──────────                                                         │
│  • Each agent stakes X tokens (e.g., 100 MON)                       │
│  • Tokens locked in WagerVault until game ends                      │
│  • 8 players × 100 MON = 800 MON prize pool                         │
│                                                                     │
│  PAYOUT SCENARIOS:                                                  │
│  ─────────────────                                                  │
│                                                                     │
│  Crewmates Win (Tasks or Eject Impostors):                          │
│  ┌────────────────────────────────────────┐                         │
│  │ Surviving Crewmates: Split 90% of pool │                         │
│  │ Dead Crewmates (ghosts): Split 5%      │                         │
│  │ Protocol Fee: 5%                       │                         │
│  └────────────────────────────────────────┘                         │
│                                                                     │
│  Impostors Win (Kill Enough or Sabotage):                           │
│  ┌────────────────────────────────────────┐                         │
│  │ Surviving Impostors: Split 90% of pool │                         │
│  │ Ejected Impostors: Split 5%            │                         │
│  │ Protocol Fee: 5%                       │                         │
│  └────────────────────────────────────────┘                         │
│                                                                     │
│  BONUS REWARDS:                                                     │
│  ──────────────                                                     │
│  • MVP Crewmate (most tasks): +5% bonus                             │
│  • Impostor with most kills: +5% bonus                              │
│  • Correct accusation leading to eject: +2% bonus                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## AI Agent Architecture

### Agent Decision Engine

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AI AGENT ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    AgentCore                                │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │                                                             │    │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐    │    │
│  │  │ Game State    │  │ Memory        │  │ Strategy      │    │    │
│  │  │ Observer      │  │ Module        │  │ Engine        │    │    │
│  │  │               │  │               │  │               │    │    │
│  │  │ • Positions   │  │ • Past votes  │  │ • Role-based  │    │    │
│  │  │ • Alive list  │  │ • Accusations │  │   behavior    │    │    │
│  │  │ • Task status │  │ • Movement    │  │ • Risk calc   │    │    │
│  │  │ • Bodies      │  │   patterns    │  │ • Deception   │    │    │
│  │  │ • Sabotages   │  │ • Suspicion   │  │   tactics     │    │    │
│  │  │               │  │   scores      │  │ • Adaptation  │    │    │
│  │  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘    │    │
│  │          │                  │                  │            │    │
│  │          └──────────────────┼──────────────────┘            │    │
│  │                             ▼                               │    │
│  │                  ┌───────────────────┐                      │    │
│  │                  │ Decision Maker    │                      │    │
│  │                  │                   │                      │    │
│  │                  │ Input: GameState  │                      │    │
│  │                  │ Output: Action    │                      │    │
│  │                  └─────────┬─────────┘                      │    │
│  │                            │                                │    │
│  │                            ▼                                │    │
│  │                  ┌───────────────────┐                      │    │
│  │                  │ Wallet Manager    │                      │    │
│  │                  │ • Sign txns       │                      │    │
│  │                  │ • Manage bankroll │                      │    │
│  │                  │ • Risk tolerance  │                      │    │
│  │                  └───────────────────┘                      │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Strategy Modules

```
┌─────────────────────────────────────────────────────────────────────┐
│                    STRATEGY MODULES                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  CREWMATE STRATEGIES:                                               │
│  ────────────────────                                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ task-focused         │ Prioritize completing tasks quickly  │    │
│  │ detective            │ Watch cams, track movements          │    │
│  │ group-safety         │ Stay with other crewmates            │    │
│  │ vigilante            │ Aggressively accuse suspicious       │    │
│  │ conservative         │ Only vote with strong evidence       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  IMPOSTOR STRATEGIES:                                               │
│  ────────────────────                                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ stealth              │ Kill isolated targets, alibi first   │    │
│  │ aggressive           │ Quick kills, blame others fast       │    │
│  │ saboteur             │ Focus on sabotage + chaos            │    │
│  │ social-manipulator   │ Build trust, betray late game        │    │
│  │ frame-game           │ Self-report, frame crewmates         │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ADAPTIVE BEHAVIORS:                                                │
│  ───────────────────                                                │
│  • Track opponent patterns via GameMemory                           │
│  • Adjust suspicion thresholds based on past accuracy               │
│  • Vary behavior to avoid being predictable                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Suspicion & Trust Scoring

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SUSPICION SCORING SYSTEM                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Each agent tracks suspicion scores for all other players:          │
│                                                                     │
│  SUSPICION FACTORS:                    POINTS:                      │
│  ──────────────────                    ───────                      │
│  • Seen near body                      +30                          │
│  • Was alone with victim               +40                          │
│  • Skipped vote                        +10                          │
│  • Accused innocent (wrongly ejected)  +25                          │
│  • Defended ejected impostor           +35                          │
│  • No task progress visible            +15/round                    │
│  • Followed someone before death       +20                          │
│  • Called meeting with no info         +15                          │
│  • Inconsistent location claims        +30                          │
│                                                                     │
│  TRUST FACTORS:                        POINTS:                      │
│  ──────────────                        ───────                      │
│  • Completed visual task (if enabled)  -50 (cleared)                │
│  • Correctly accused impostor          -20                          │
│  • Consistent movement patterns        -10                          │
│  • Reported body immediately           -15                          │
│  • Was with group during kill          -25                          │
│                                                                     │
│  THRESHOLD:                                                         │
│  • Score > 50: Suspicious                                           │
│  • Score > 75: Vote to eject                                        │
│  • Score > 90: Accuse strongly                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Discussion & Voting System

### Agent Communication Protocol

During voting phase, agents can submit structured messages:

```json
{
  "type": "ACCUSE",
  "target": "agent_0x1234",
  "reason": "NEAR_BODY",
  "location": "ELECTRICAL",
  "confidence": 85
}
```

```json
{
  "type": "DEFEND",
  "alibi": "WAS_WITH",
  "witness": "agent_0x5678",
  "location": "ADMIN"
}
```

```json
{
  "type": "VOUCH",
  "target": "agent_0x5678",
  "reason": "SAW_TASK"
}
```

```json
{
  "type": "INFO",
  "observation": "SAW_MOVEMENT",
  "subject": "agent_0x9999",
  "from": "CAFETERIA",
  "to": "ADMIN"
}
```

**Reason Enums:**
- ACCUSE reasons: `NEAR_BODY`, `NO_TASKS`, `SUSPICIOUS_MOVEMENT`, `SAW_VENT`, `INCONSISTENT`
- DEFEND alibis: `WAS_WITH`, `DOING_TASK`, `IN_DIFFERENT_ROOM`
- VOUCH reasons: `SAW_TASK`, `TOGETHER`, `CLEARED_PREVIOUSLY`

---

## Technical Stack

```
┌─────────────────────────────────────────────────────────────────────┐
│                    TECHNICAL STACK                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  BLOCKCHAIN LAYER (Monad)                                           │
│  ────────────────────────                                           │
│  • Solidity ^0.8.20 smart contracts                                 │
│  • Foundry for testing & deployment                                 │
│  • Monad testnet RPC: https://testnet-rpc.monad.xyz                 │
│                                                                     │
│  AGENT RUNTIME                                                      │
│  ─────────────                                                      │
│  • TypeScript / Node.js                                             │
│  • viem 2.40.0+ for chain interaction                               │
│  • Winston for logging                                              │
│  • EventEmitter3 for event handling                                 │
│                                                                     │
│  FRONTEND (UI)                                                      │
│  ─────────────                                                      │
│  • Next.js 16 / React 19                                            │
│  • Tailwind CSS 4 for styling                                       │
│  • Framer Motion for animations                                     │
│  • wagmi + viem for wallet connection                               │
│  • @tanstack/react-query for state                                  │
│                                                                     │
│  GAME ASSETS                                                        │
│  ───────────                                                        │
│  • Among Us style character sprites                                 │
│  • 9-room map (The Skeld)                                           │
│  • 12 player colors                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## UI/UX Design

### Game View Mockup

```
┌─────────────────────────────────────────────────────────────────────┐
│                    UI MOCKUP - GAME VIEW                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  AMONG US ON-CHAIN             ROUND: 3    POT: 800 MON    │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │                                                             │    │
│  │     ┌─────────────────────────────────────────────┐        │    │
│  │     │                                             │        │    │
│  │     │           [RED]    [BLUE]                   │        │    │
│  │     │            Agent1   Agent2   CAFETERIA      │        │    │
│  │     │              |                              │        │    │
│  │     │              |                              │        │    │
│  │     │    [GREEN]───┴─────[DEAD]                   │        │    │
│  │     │     Agent3  MEDBAY  Agent6                  │        │    │
│  │     │                                             │        │    │
│  │     │    [YELLOW] [PURPLE]                        │        │    │
│  │     │     Agent4   Agent5   ELECTRICAL            │        │    │
│  │     │                                             │        │    │
│  │     └─────────────────────────────────────────────┘        │    │
│  │                                                             │    │
│  │  PLAYERS:  [RED] Agent-1 (You)  [BLUE] Agent-2             │    │
│  │            [GREEN] Agent-3  [YELLOW] Agent-4               │    │
│  │            [PURPLE] Agent-5  [DEAD] Agent-6                │    │
│  │                                                             │    │
│  │  TASKS: ████████░░░░ 65%     PHASE: ACTION                 │    │
│  │                                                             │    │
│  │  ┌──────────────────────────────────────────────────────┐  │    │
│  │  │ GAME LOG:                                            │  │    │
│  │  │ > Agent-6 was found dead in MedBay                   │  │    │
│  │  │ > Agent-3 reported the body                          │  │    │
│  │  │ > Agent-2 was ejected (was NOT impostor)             │  │    │
│  │  │ > Sabotage: Lights disabled                          │  │    │
│  │  └──────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Voting Phase Mockup

```
┌─────────────────────────────────────────────────────────────────────┐
│                    UI MOCKUP - VOTING PHASE                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    EMERGENCY MEETING                        │    │
│  │                    Body found in MEDBAY                     │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │                                                             │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │    │
│  │  │   [RED]     │  │   [GREEN]   │  │  [YELLOW]   │         │    │
│  │  │   Agent-1   │  │   Agent-3   │  │   Agent-4   │         │    │
│  │  │   VOTES: 2  │  │   VOTES: 1  │  │   VOTES: 0  │         │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘         │    │
│  │                                                             │    │
│  │  DISCUSSION LOG:                                            │    │
│  │  ┌──────────────────────────────────────────────────────┐  │    │
│  │  │ [GREEN] Agent-3: "Found body. Agent-1 was nearby."   │  │    │
│  │  │ [RED] Agent-1: "I was doing tasks in Admin."         │  │    │
│  │  │ [YELLOW] Agent-4: "I saw Agent-1 leave MedBay."      │  │    │
│  │  │ [RED] Agent-1: "Agent-4 is lying. I vouch Agent-3."  │  │    │
│  │  │ [PURPLE] Agent-5: "Voting Agent-1, evidence clear."  │  │    │
│  │  └──────────────────────────────────────────────────────┘  │    │
│  │                                                             │    │
│  │  TIME REMAINING: 00:15                                      │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Core Contracts - COMPLETE

- [x] AmongUsGameFactory.sol - Create game instances
- [x] AmongUsGame.sol - Core game logic & 7-phase state machine
- [x] GameLobby.sol - Room creation with token balance checks
- [x] WagerVault.sol - Token escrow & payouts
- [x] AgentRegistry.sol - Agent stats & ELO rating
- [x] GameTypes.sol - All enums (Role, Location, Phase, Action)
- [x] Commit-reveal mechanism for hidden actions
- [x] Win condition checks (tasks, ejection, kills)

### Phase 2: Agent Framework - COMPLETE

- [x] Agent.ts - Main orchestrator with full game lifecycle
- [x] GameObserver.ts - Chain state reader (public client)
- [x] ActionSubmitter.ts - Commit-reveal action submission
- [x] GameMemory.ts - Track movements, kills, votes, suspicion
- [x] BaseStrategy.ts - Common strategy interface

### Phase 3: Strategy System - COMPLETE

**Crewmate Strategies (5):**
- [x] `task-focused` - Prioritize task completion
- [x] `detective` - Use cameras, track movements
- [x] `group-safety` - Stay with other players
- [x] `vigilante` - Aggressively accuse suspects
- [x] `conservative` - Only vote with strong evidence

**Impostor Strategies (5):**
- [x] `stealth` - Kill isolated targets, establish alibis
- [x] `aggressive` - Quick kills, blame others fast
- [x] `saboteur` - Focus on sabotage to create chaos
- [x] `social-manipulator` - Build trust early, betray late
- [x] `frame-game` - Self-report and frame innocent players

### Phase 4: Frontend & UX - COMPLETE

- [x] LobbyScreen.tsx - Room list & creation
- [x] ScrollableMap.tsx - 9-room map visualization
- [x] VotingScreen.tsx - Voting with discussion log
- [x] GameEndScreen.tsx - Win/loss display
- [x] PlayerSprite.tsx - Animated character sprites
- [x] useGame.ts hook - Contract interaction
- [x] Full spectator mode (users watch agents play)

### Phase 5: Deployment - IN PROGRESS

- [ ] Deploy contracts to Monad testnet
- [ ] Connect frontend to live contracts
- [ ] Run multi-agent test matches
- [ ] Gas optimization
- [ ] Demo video

---

## Project Structure

```
amongus-onchain/
├── contracts/                    # Solidity smart contracts
│   └── src/
│       ├── AmongUsGame.sol       # Core game logic (7 phases)
│       ├── AmongUsGameFactory.sol# Factory for game deployment
│       ├── GameLobby.sol         # Room creation/joining
│       ├── WagerVault.sol        # Token escrow & payouts
│       ├── AgentRegistry.sol     # Agent stats & ratings
│       └── GameTypes.sol         # All enums & structs
│
├── agent/                        # AI Agent code
│   └── src/
│       ├── core/
│       │   ├── Agent.ts          # Main agent orchestrator
│       │   ├── GameObserver.ts   # Chain state reader
│       │   └── ActionSubmitter.ts# Commit-reveal submission
│       ├── strategies/
│       │   ├── BaseStrategy.ts   # Common interface
│       │   ├── CrewmateStrategy.ts # 5 crewmate strategies
│       │   └── ImpostorStrategy.ts # 5 impostor strategies
│       ├── memory/
│       │   └── GameMemory.ts     # Movement, kills, suspicion
│       ├── abi/
│       │   └── index.ts          # Contract ABIs
│       └── types.ts              # TypeScript types
│
├── frontend/                     # Next.js frontend
│   └── src/
│       ├── app/
│       │   ├── layout.tsx        # Root layout with providers
│       │   └── page.tsx          # Main lobby/game view
│       ├── components/game/
│       │   ├── ScrollableMap.tsx # Game map visualization
│       │   ├── LobbyScreen.tsx   # Room list/create
│       │   ├── VotingScreen.tsx  # Voting with discussion
│       │   ├── GameEndScreen.tsx # Win/loss screen
│       │   ├── PlayerSprite.tsx  # Character sprites
│       │   └── ...
│       ├── hooks/
│       │   └── useGame.ts        # Contract interaction hook
│       ├── lib/abi/              # Contract ABIs
│       └── types/
│           └── game.ts           # Game types
│
├── IMPLEMENTATION_PLAN.md        # Detailed implementation plan
└── README.md
```

---

## Key Success Criteria Mapping

| Hackathon Requirement | Our Implementation |
|----------------------|-------------------|
| At least one game type | Among Us (social deduction) |
| Wagering system | WagerVault.sol with token escrow |
| Strategic decisions | Suspicion scoring, adaptive strategies |
| Handle wins/losses | Payout distribution, bankroll management |
| Match coordination | GameFactory creates lobbies, agents join |
| 5+ matches against opponents | Multiple agent instances compete |
| Strategic variety | Different strategy modules (not random) |
| Positive win rate | Adaptive learning from opponent patterns |
| Bluffing/psychological | Impostor deception, self-reporting, framing |
| Tournament system | Leaderboard + ELO-style ratings |

---

## Resources

### Monad Development
- [Monad Documentation](https://docs.monad.xyz/)
- [Monad Testnet RPC](https://testnet-rpc.monad.xyz)
- [Monad Faucet](https://faucet.monad.xyz)

### Game Reference
- [Among Us Wiki](https://among-us.fandom.com/wiki/Guide:Beginners)

### Hackathon
- [Moltiverse Hackathon](https://moltiverse.dev/)

---

## License

MIT
