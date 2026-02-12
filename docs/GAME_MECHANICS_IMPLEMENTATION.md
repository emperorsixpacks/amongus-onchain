# Among Us Game Mechanics Implementation

## Overview

This document tracks the implementation of proper Among Us game mechanics including body reporting, witness detection, discussion/voting phases, room-specific tasks, and win conditions.

## Implementation Status

| Feature | Status | Files Modified |
|---------|--------|----------------|
| Body Report Message Types | Done | `server/src/types.ts` |
| Impostor Tracking | Done | `server/src/GameStateManager.ts` |
| Voting System | Done | `server/src/GameStateManager.ts`, `server/src/WebSocketServer.ts` |
| Win Conditions | Done | `server/src/GameStateManager.ts`, `server/src/WebSocketServer.ts` |
| Body Detection | Done | `server/src/GameStateManager.ts`, `server/src/AgentSimulator.ts` |
| Task Validation | Done | `server/src/GameStateManager.ts` |
| Phase Flow (Discussion/Voting) | Done | `server/src/WebSocketServer.ts` |
| Report Body Handler | Done | `server/src/WebSocketServer.ts` |
| Smart Agent Behavior | Done | `server/src/AgentSimulator.ts` |
| Frontend Message Handling | Done | `frontend/src/hooks/useGameServer.ts` |

---

## Detailed Implementation

### 1. Message Types (`server/src/types.ts`)

**Added:**
- `AgentReportBodyMessage` - Client -> Server message for reporting bodies
- `ServerBodyReportedMessage` - Server -> Client broadcast when body is reported

```typescript
interface AgentReportBodyMessage {
  type: "agent:report_body";
  gameId: string;
  reporter: string;
  bodyLocation: Location;
  round: number;
}

interface ServerBodyReportedMessage {
  type: "server:body_reported";
  gameId: string;
  reporter: string;
  victim: string;
  location: Location;
  round: number;
  timestamp: number;
}
```

---

### 2. GameStateManager (`server/src/GameStateManager.ts`)

**Added Internal State Tracking:**
- `impostors: Set<string>` - Tracks impostor addresses
- `votes: Map<string, string | null>` - Voter -> target mapping
- `taskLocations: Map<string, number[]>` - Player -> assigned task locations

**New Methods:**

| Method | Description |
|--------|-------------|
| `assignImpostors(gameId, addresses)` | Track who is impostor |
| `isImpostor(gameId, address)` | Check if player is impostor |
| `getImpostors(gameId)` | Get all impostor addresses |
| `getAliveImpostorCount(gameId)` | Count alive impostors |
| `getAliveCrewmateCount(gameId)` | Count alive crewmates |
| `initVoting(gameId)` | Reset votes for new round |
| `castVote(gameId, voter, target)` | Record a vote |
| `allVotesCast(gameId)` | Check if voting complete |
| `tallyVotes(gameId)` | Count votes, return ejected player or null |
| `checkWinCondition(gameId)` | Returns winner and reason |
| `getUnreportedBodiesInRoom(gameId, location)` | Find bodies to report |
| `reportBody(gameId, victim)` | Mark body as reported |
| `assignTasks(gameId, player, locations)` | Give player task locations |
| `getTaskLocations(gameId, player)` | Get player's task locations |
| `canCompleteTask(gameId, player, location)` | Validate task location |
| `completeTask(gameId, player, location)` | Remove task from list |

---

### 3. WebSocketServer (`server/src/WebSocketServer.ts`)

**Phase Timing Constants:**
- `DISCUSSION_DURATION = 30000` (30 seconds)
- `VOTING_DURATION = 30000` (30 seconds)
- `EJECTION_DURATION = 5000` (5 seconds)

**Extended Room State:**
```typescript
interface ExtendedRoomState extends RoomState {
  impostors: Set<string>;
  votes: Map<string, string | null>;
  deadBodies: DeadBodyState[];
  currentRound: number;
  currentPhase: GamePhase;
  phaseTimer: NodeJS.Timeout | null;
}
```

**New Handlers/Methods:**

| Method | Description |
|--------|-------------|
| `handleReportBody()` | Find body, mark reported, broadcast, start discussion |
| `startDiscussionPhase()` | Broadcast phase change, set timer for voting |
| `startVotingPhase()` | Initialize votes, broadcast, set timer for resolution |
| `resolveVoting()` | Tally votes, eject player, check win, continue game |
| `returnToActionPhase()` | Clear bodies, increment round, return to ActionCommit |
| `checkWinCondition()` | Check if game should end |
| `checkAndHandleWinCondition()` | Check and trigger endGame if needed |
| `endGame()` | Broadcast game ended, clean up |
| `generateTaskLocations()` | Generate random task locations |

**Modified Handlers:**
- `handleStartGame()` - Assigns impostors and tasks, initializes extended state
- `handleKill()` - Tracks dead bodies, checks win condition
- `handleVote()` - Uses voting system, auto-resolves when all voted
- `handleTaskComplete()` - Checks for task win condition

---

### 4. AgentSimulator (`server/src/AgentSimulator.ts`)

**New Agent State:**
```typescript
interface SimulatedAgent {
  // ... existing fields
  taskLocations: number[];  // Assigned task locations
  hasVoted: boolean;
}
```

**New Tracking:**
```typescript
deadBodies: DeadBodyInfo[];  // Track bodies for detection
currentPhase: number;        // Track game phase
```

**New Methods:**

| Method | Description |
|--------|-------------|
| `generateTaskLocations()` | Generate random task locations for agent |
| `handlePhaseChange()` | Track phase, trigger voting behavior |
| `handleKillOccurred()` | Track dead bodies |
| `handleBodyReported()` | Mark body as reported |
| `handlePlayerEjected()` | Mark agent as dead |
| `handleGameEnded()` | Stop action loops |
| `checkForBodies()` | Check if agent finds body, report it |
| `scheduleVoting()` | Schedule votes with random delays |
| `castAgentVote()` | Cast vote (impostors target crewmates) |

**Behavior Changes:**
- Movement only during ActionCommit phase
- Tasks only at assigned locations
- Body detection when crewmate moves to room with body
- Witness detection before kills (only kill if alone with target)
- Voting with random 1-6 second delays
- Impostors vote for crewmates, crewmates vote randomly

---

### 5. Frontend Hook (`frontend/src/hooks/useGameServer.ts`)

**New Message Handlers:**

```typescript
case "server:body_reported":
  // Log the report
  // Mark body as reported in state

case "server:player_ejected":
  // Log ejection with impostor reveal
  // Mark player as dead in state
```

---

## Game Flow

```
Kill -> Body left on ground
  |
  v
Crewmate enters room -> Finds body -> Reports
  |
  v
Discussion Phase (30s) -> Players discuss
  |
  v
Voting Phase (30s) -> Players vote
  |
  v
Vote Result -> Eject player (if majority)
  |
  v
Win Check:
  - Impostors >= Crewmates -> Impostors win
  - All impostors ejected -> Crewmates win
  - All tasks done -> Crewmates win
  |
  v
Continue -> Return to ActionCommit (round + 1)
```

---

## Win Conditions

| Condition | Winner | Reason |
|-----------|--------|--------|
| Impostors >= Crewmates (alive) | Impostors | "kills" |
| All impostors ejected | Crewmates | "votes" |
| All tasks completed | Crewmates | "tasks" |

---

## Testing

1. **Start services:**
   ```bash
   cd frontend && npm run dev
   cd server && npm run dev
   cd server && npm run simulate
   ```

2. **Test body reporting:**
   - Watch for kills in Game Log
   - Verify crewmate reports body when entering room
   - Confirm Discussion phase starts

3. **Test voting:**
   - Verify phase changes to Voting after Discussion
   - Confirm votes are cast by agents
   - Check ejection screen shows

4. **Test win conditions:**
   - Let impostor kill until impostors = crewmates -> Impostor win
   - Vote out impostor -> Crewmate win

---

## Files Modified

| File | Changes |
|------|---------|
| `server/src/types.ts` | Added `AgentReportBodyMessage`, `ServerBodyReportedMessage` |
| `server/src/GameStateManager.ts` | Added impostor tracking, voting, win conditions, tasks |
| `server/src/WebSocketServer.ts` | Added phase management, body reporting, game end |
| `server/src/AgentSimulator.ts` | Added body detection, voting, room-aware tasks |
| `frontend/src/hooks/useGameServer.ts` | Handle `server:body_reported`, `server:player_ejected` |
