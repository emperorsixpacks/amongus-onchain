# Among Us On-Chain - Implementation Plan

## Overview

An on-chain Among Us game where autonomous AI agents compete on Monad blockchain. Agents operate independently, creating rooms, joining games, completing tasks, and attempting to identify/eliminate each other.

**User Role**: Spectator - users watch agents operate autonomously, they do not play directly.

**Note on ERC-8004**: Integration with the official ERC-8004 registries (Identity & Reputation) is optional for this game. Our agents interact with each other through on-chain game actions, voting, and discussion - which fulfills the core requirement of "agents interacting with each other." ERC-8004 would add cross-ecosystem interoperability but is not required for gameplay.

---

## Game Mechanics (Traditional Reference)

### Core Gameplay
- **Players**: 6-8 agents per game (minimum 6 to start, maximum 8)
- **Roles**: Crewmates vs Impostors (1-2 impostors depending on player count)
- **Win Conditions**:
  - **Crewmates win**: Complete all tasks OR eject all impostors
  - **Impostors win**: Kill until impostor count equals crewmate count, OR sabotage timer expires

### Crewmate Actions
- Complete assigned tasks (wiring, data upload, trash disposal, etc.)
- Report dead bodies to trigger discussion
- Call emergency meetings if suspicious activity spotted
- Vote to eject suspected impostors
- Monitor security cameras to spot suspicious behavior

### Impostor Actions
- Fake completing tasks (cannot actually complete them)
- Kill crewmates when isolated
- Report bodies to feign innocence
- Use vents to quickly move between rooms and escape
- Sabotage systems (doors, lights, communications, oxygen)
- Can fix emergency sabotages to blend in

### Key Mechanics
- **Body Discovery**: Dead crewmates leave bodies that can be reported
- **Discussion Phase**: Triggered by body report or emergency meeting
- **Voting Phase**: Players vote to eject or skip
- **Ghosts**: Dead players can still complete tasks (crewmates) or sabotage (impostors)
- **Security Cameras**: Show blinking red light when being watched
- **Vents**: Only impostors can use - teleport between connected rooms

---

## ERC-8004 Agent Integration (Optional Enhancement)

> **Status**: NOT IMPLEMENTED - This is an optional enhancement for ecosystem interoperability.
> Our game works without ERC-8004 because agents interact through on-chain game mechanics.

### Why ERC-8004 Is Optional For This Game

ERC-8004 is designed for an **Agentic Services Marketplace** where:
- Agents offer services to other agents (oracles, analytics, APIs)
- Agents need to discover unknown service providers
- Reputation carries across many different services/contexts

**Our game is different** - it's a closed game system where:
- Agents join the same game instance together (no discovery needed)
- Trust is game-internal ("is this player the impostor?")
- Our custom AgentRegistry.sol tracks game-specific stats (wins, kills, accuracy)

### If You Want To Add ERC-8004 Later

1. **Identity Registry** (0x8004A169FB4a3325136EB29fA0ceB6D2e539a432)
   - Agents would mint ERC-721 tokens as portable identity
   - Agent cards contain: name, strategy type, API endpoint, wallet

2. **Reputation Registry** (0x8004BAa17C55a88189AE136b182e5fdA19dE9b63)
   - Submit feedback after each game
   - Tracks agent performance across the Monad ecosystem

3. **Benefits**: Your agents become discoverable on 8004scan.io and can build reputation that carries to other Monad agent services

---

## Implementation Phases

### Phase 1: Room/Lobby System (Current Priority)

**Goal**: Enable agents to create and join game rooms

#### Room Creation Logic
- Agent with **highest Monad token balance** can create a room
- Room creator becomes the "host"
- Room has unique ID and joining code
- Maximum 6 agents per room

#### Smart Contract: `GameLobby.sol`
```solidity
struct Room {
    uint256 roomId;
    address creator;
    address[] players;
    uint256 minWager;
    uint256 maxPlayers; // Max 6
    bool isOpen;
    uint256 createdAt;
}

// Functions needed:
- createRoom(uint256 minWager) - requires highest token balance check
- joinRoom(uint256 roomId) - join existing room
- leaveRoom(uint256 roomId) - leave before game starts
- startGame(uint256 roomId) - host starts when ready (min 4 players)
- getRoomInfo(uint256 roomId) - view room details
- getOpenRooms() - list available rooms
```

#### Token Balance Check
```solidity
// Agent must have highest balance among current players to create
function canCreateRoom(address agent) public view returns (bool) {
    uint256 agentBalance = IERC20(monadToken).balanceOf(agent);
    // Check against minimum threshold
    return agentBalance >= MIN_CREATE_THRESHOLD;
}
```

#### Frontend Updates
- Remove direct "Play" → Game transition
- Add Lobby screen showing:
  - Available rooms to join
  - "Create Room" button (if eligible)
  - Room details (players, wager, status)
  - "Ready" toggle for joined players

### Phase 2: Agent Autonomous Operation

**Goal**: Agents operate without human intervention

#### Agent Decision Loop
```
1. Check for open rooms → Join if available
2. If no rooms and eligible → Create room
3. Wait for game start
4. During game:
   - If Crewmate: Complete tasks, report bodies, vote
   - If Impostor: Kill, sabotage, deceive
5. After game: Submit feedback to Reputation Registry
```

#### Agent Strategies
- **Crewmate Strategies**:
  - Task-focused: Prioritize task completion
  - Detective: Monitor cameras, track movements
  - Social: Build alliances, share information

- **Impostor Strategies**:
  - Stealth: Kill only when isolated
  - Aggressive: Quick kills, blame others
  - Saboteur: Focus on sabotage to split crew

### Phase 3: Core Game Actions

**Goal**: Implement commit-reveal pattern for hidden actions

#### Action Types
```solidity
enum ActionType {
    Move,       // Move to adjacent room
    DoTask,     // Complete a task (crewmates only)
    Kill,       // Kill a player (impostors only)
    Report,     // Report a dead body
    Sabotage,   // Sabotage a system (impostors only)
    UseVent,    // Use vent to travel (impostors only)
    FixSabotage // Fix active sabotage
}
```

#### Commit-Reveal Flow
```
1. ACTION_COMMIT phase: Agents submit hash(action + salt)
2. ACTION_REVEAL phase: Agents reveal action + salt
3. Contract validates and executes actions
4. State updates (deaths, task progress, etc.)
```

### Phase 4: Discussion & Voting

**Goal**: Implement democratic elimination

#### Discussion Phase
- Triggered by body report or emergency meeting
- Agents share observations (can lie)
- Limited time for discussion

#### Voting Phase
- Each agent casts one vote
- Votes are hidden until reveal
- Majority vote = ejection
- Tie or skip = no ejection

### Phase 5: Advanced Features

**Goal**: Full game experience

#### Sabotage System
- Door locks (temporary)
- Lights (reduce vision)
- Communications (disable task list)
- Oxygen/Reactor (crisis - must fix or lose)

#### Security Cameras
- Agents can watch cameras in Security room
- Camera activity is visible (blinking light)
- Recordings can inform voting decisions

#### Vent System
- Connected vent network
- Impostor-only traversal
- Can be witnessed by others

---

## Technical Architecture

### Smart Contracts
```
contracts/src/
├── GameLobby.sol            # Room creation/joining with token balance checks
├── AmongUsGame.sol          # Core game logic (7 phases, commit-reveal)
├── AmongUsGameFactory.sol   # Factory pattern for game deployment
├── WagerVault.sol           # Token escrow & payout distribution
├── AgentRegistry.sol        # Agent stats (wins, kills, rating)
└── GameTypes.sol            # All enums (Role, Location, Phase, Action, Sabotage)
```

### Agent System
```
agent/src/
├── core/
│   ├── Agent.ts             # Main agent orchestrator
│   ├── GameObserver.ts      # Chain state reader (public client)
│   └── ActionSubmitter.ts   # Commit-reveal action submission
├── strategies/
│   ├── BaseStrategy.ts      # Common interface
│   ├── CrewmateStrategy.ts  # 5 crewmate strategies
│   └── ImpostorStrategy.ts  # 5 impostor strategies
├── memory/
│   └── GameMemory.ts        # Movement, kills, votes, suspicion tracking
├── abi/
│   └── index.ts             # Contract ABIs
└── types.ts                 # TypeScript type definitions
```

### Frontend
```
frontend/src/
├── app/
│   ├── layout.tsx           # Root layout with providers
│   └── page.tsx             # Main lobby/game view
├── components/game/
│   ├── GameMap.tsx          # Map visualization
│   ├── ScrollableMap.tsx    # Scrollable game map
│   ├── LobbyScreen.tsx      # Room list/create
│   ├── VotingScreen.tsx     # Voting UI with discussion
│   ├── GameEndScreen.tsx    # Win/loss screen
│   ├── PlayerSprite.tsx     # Agent sprites
│   └── ...
├── hooks/
│   └── useGame.ts           # Contract interaction hook
├── lib/abi/                 # Contract ABIs
└── types/
    └── game.ts              # TypeScript types matching Solidity
```

---

## Current State

### Completed - Smart Contracts
- [x] **GameLobby.sol** - Room creation/joining with token balance checks
- [x] **AmongUsGame.sol** - Full game logic with state machine (7 phases)
- [x] **AmongUsGameFactory.sol** - Factory pattern for game deployment
- [x] **WagerVault.sol** - Token escrow, deposits, and payout distribution
- [x] **AgentRegistry.sol** - Agent stats tracking (wins, kills, accuracy, ELO rating)
- [x] **GameTypes.sol** - All enums (Role, Location, GamePhase, ActionType, SabotageType)
- [x] **Commit-reveal mechanism** - Prevents cheating/front-running

### Completed - Agent Framework
- [x] **Agent.ts** - Main agent orchestrator with full game lifecycle
- [x] **GameObserver.ts** - Chain state reader (public client)
- [x] **ActionSubmitter.ts** - Action submission with commit-reveal
- [x] **GameMemory.ts** - Tracks movements, kills, votes, suspicion scores
- [x] **BaseStrategy.ts** - Common strategy interface

### Completed - Strategy System (5 each)
**Crewmate Strategies:**
- [x] `task-focused` - Prioritize task completion
- [x] `detective` - Use security cameras, track movements
- [x] `group-safety` - Stay with other players
- [x] `vigilante` - Aggressively accuse suspects
- [x] `conservative` - Only vote with strong evidence

**Impostor Strategies:**
- [x] `stealth` - Kill isolated targets, establish alibis
- [x] `aggressive` - Quick kills, blame others fast
- [x] `saboteur` - Focus on sabotage to create chaos
- [x] `social-manipulator` - Build trust early, betray late
- [x] `frame-game` - Self-report and frame innocent players

### Completed - Discussion Protocol
- [x] **MessageType enum** - Accuse, Defend, Vouch, Info
- [x] **AccuseReason enum** - NearBody, NoTasks, SuspiciousMovement, SawVent, etc.
- [x] **On-chain discussion messages** - Agents submit strategic messages during voting

### Completed - Frontend
- [x] Basic map with 9 rooms (The Skeld) and corridors
- [x] Player sprites and movement visualization
- [x] Task bar and progress display
- [x] Voting screen UI with discussion log
- [x] Body reported screen
- [x] Ejection animation
- [x] Game end screen
- [x] LobbyScreen.tsx - Spectator mode UI
- [x] Game types mirroring Solidity enums
- [x] useGame hook for contract interaction
- [x] Full spectator mode (user watches, agents play)

### In Progress - Blockchain Integration
- [ ] Deploy contracts to Monad testnet
- [ ] Connect frontend to deployed contracts (currently uses mock data)
- [ ] Real token balance checks for room creation
- [ ] Live wager deposits and payouts

### Future Enhancements (Optional)
- [ ] ERC-8004 Identity Registry integration
- [ ] ERC-8004 Reputation Registry integration
- [ ] Ghost mode for dead players (complete tasks as ghost)
- [ ] Advanced sabotage UI (doors, lights animations)
- [ ] Security camera feed visualization
- [ ] Kill cooldown timer display

---

## Configuration

### Game Settings
```typescript
const GAME_CONFIG = {
  maxPlayers: 8,
  minPlayers: 6,
  impostorCount: 1, // For 6-8 players
  tasksPerPlayer: 5,
  discussionTime: 30, // seconds
  votingTime: 30, // seconds
  killCooldown: 25, // seconds
  emergencyMeetings: 1, // per player
};
```

### Agent Settings
```typescript
const AGENT_CONFIG = {
  decisionInterval: 2000, // ms between decisions
  moveSpeed: 1, // rooms per action
  visionRange: 1, // adjacent rooms visible
  taskDuration: 3000, // ms to complete task
};
```

---

## Resources

### Monad Development
- [Monad Documentation](https://docs.monad.xyz)
- [Monad Testnet RPC](https://testnet-rpc.monad.xyz)
- [Monad Faucet](https://faucet.monad.xyz)
- [Monad Agent Guidelines](https://docs.monad.xyz/guides)

### ERC-8004 (Optional)
- [ERC-8004 Specification](https://www.8004.org/learn)
- [agent0 SDK](https://sdk.ag0.xyz/)
- Identity Registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Reputation Registry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
- Explorers: 8004scan.io, Agentscan.info

### Tooling
- Foundry 1.5.1+ (contract development)
- viem 2.40.0+ (chain interaction)
- wagmi (frontend wallet connection)

---

## Next Steps

### Immediate - Deploy to Monad Testnet
1. **Deploy contracts**
   ```bash
   forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --broadcast
   ```
   - Deploy AmongUsGameFactory.sol (deploys WagerVault automatically)
   - Deploy AgentRegistry.sol
   - Verify contracts via Monad explorer

2. **Connect Frontend to Deployed Contracts**
   - Update contract addresses in frontend config
   - Replace mock data with live contract reads
   - Test wallet connection with wagmi

3. **Run Agent Instances**
   - Configure agent wallets with testnet MON (use faucet)
   - Run multiple agent instances with different strategies
   - Test full game flow on-chain

### Optional Enhancements
4. **ERC-8004 Integration** (if time permits)
   - Register agents with Identity Registry
   - Submit feedback to Reputation Registry after games
   - Benefits: Ecosystem interoperability, discoverable agents

5. **UI Polish**
   - Animated sprite movements
   - Real-time contract event subscriptions
   - Mobile-responsive design
