# Critical Gaps Implementation Plan

This document tracks all critical missing features in the Among Us on-chain game. Each gap is documented with its current state, required changes, and implementation status.

---

## Overview

| # | Gap | Priority | Status | Estimated Complexity |
|---|-----|----------|--------|---------------------|
| 1 | Body Report → Voting Flow | HIGH | COMPLETE | Medium |
| 2 | Kill Cooldown Enforcement | HIGH | COMPLETE | Low |
| 3 | Movement Validation | HIGH | COMPLETE | Medium |
| 4 | Game End Detection | HIGH | COMPLETE | Medium |
| 5 | Sabotage System | HIGH | COMPLETE | High |
| 6 | Venting System | MEDIUM | COMPLETE | Medium |
| 7 | Emergency Meetings | MEDIUM | COMPLETE | Medium |
| 8 | Ghost Player Mechanics | MEDIUM | COMPLETE | Medium |
| 9 | Security Cameras | LOW | COMPLETE | Low |
| 10 | Discussion Phase Chat | MEDIUM | COMPLETE | Medium |
| 11 | Vote Tie-Breaking | MEDIUM | COMPLETE | Low |
| 12 | On-Chain Settlement | LOW | COMPLETE | High |

---

## Gap 1: Body Report → Voting Flow

### Current State
- `AgentReportBodyMessage` type exists in `server/src/types.ts`
- `ActionType.Report = 5` defined
- No server handler to process body reports
- No transition from report to discussion/voting phase

### Required Changes

#### Server (`server/src/WebSocketServer.ts`)
- [ ] Add handler for `agent:report_body` message
- [ ] Validate reporter is alive and at body location
- [ ] Transition game to Discussion phase
- [ ] Broadcast `server:body_reported` to all players
- [ ] Start discussion timer

#### Server (`server/src/GameStateManager.ts`)
- [ ] Add `reportBody()` method
- [ ] Track who reported and where
- [ ] Clear dead bodies after report

#### Agent (`agent/src/types.ts`)
- [ ] Ensure ReportBodyAction is properly defined

#### Skill.md
- [ ] Document body reporting as agent action

### Files to Modify
```
server/src/WebSocketServer.ts
server/src/GameStateManager.ts
server/src/types.ts
skills/skill.md
```

### Test Cases
- [ ] Report body triggers discussion phase
- [ ] Only alive players can report
- [ ] Reporter must be at body location
- [ ] Multiple bodies - only one report needed
- [ ] Body cleared after report

---

## Gap 2: Kill Cooldown Enforcement

### Current State
- `ImpostorStrategy.ts` has `killCooldown = 2n` (2 rounds)
- Server accepts any kill without cooldown validation
- No tracking of last kill time per impostor

### Required Changes

#### Server (`server/src/GameStateManager.ts`)
- [ ] Add `lastKillRound: Map<string, number>` to track kills per player
- [ ] Add `KILL_COOLDOWN = 2` constant
- [ ] Add `canKill(address: string, currentRound: number): boolean` method
- [ ] Record kill in `lastKillRound` when kill occurs

#### Server (`server/src/WebSocketServer.ts`)
- [ ] Validate cooldown before processing kill
- [ ] Send error if cooldown not elapsed

### Files to Modify
```
server/src/WebSocketServer.ts
server/src/GameStateManager.ts
```

### Test Cases
- [ ] Kill allowed when cooldown elapsed
- [ ] Kill rejected during cooldown
- [ ] Cooldown resets after successful kill
- [ ] Cooldown persists across phases

---

## Gap 3: Movement Validation

### Current State
- Server accepts any location change (teleportation)
- No adjacency check between rooms
- No movement time/cost

### Required Changes

#### Server (`server/src/GameStateManager.ts`)
- [ ] Add `ROOM_ADJACENCY: Map<Location, Location[]>` constant
- [ ] Add `canMoveTo(from: Location, to: Location): boolean` method
- [ ] Validate all movement requests

#### Server (`server/src/WebSocketServer.ts`)
- [ ] Check adjacency before accepting position update
- [ ] Send error for invalid movement

### Room Adjacency Map (The Skeld)
```
Cafeteria <-> Admin, MedBay, Storage, UpperEngine
Admin <-> Cafeteria, Storage
Storage <-> Cafeteria, Admin, Electrical, LowerEngine
Electrical <-> Storage, LowerEngine
MedBay <-> Cafeteria, UpperEngine
UpperEngine <-> Cafeteria, MedBay, Reactor
LowerEngine <-> Storage, Electrical, Reactor
Reactor <-> UpperEngine, LowerEngine, Security
Security <-> Reactor
```

### Files to Modify
```
server/src/WebSocketServer.ts
server/src/GameStateManager.ts
```

### Test Cases
- [ ] Adjacent movement allowed
- [ ] Non-adjacent movement rejected
- [ ] Dead players can move freely (ghosts)
- [ ] Impostors using vents bypass adjacency

---

## Gap 4: Game End Detection

### Current State
- Only checks tasks completed
- Missing: impostor >= crewmate check
- Missing: all impostors ejected check
- No automatic game end broadcast

### Required Changes

#### Server (`server/src/GameStateManager.ts`)
- [ ] Add `checkWinConditions(): WinConditionResult | null` method
- [ ] Check after every kill
- [ ] Check after every vote/ejection
- [ ] Check after every task completion

#### Win Conditions
```typescript
type WinConditionResult = {
  gameOver: boolean;
  crewmatesWon: boolean;
  reason: 'tasks' | 'votes' | 'kills' | 'disconnect';
};

// Crewmates win if:
// - All impostors ejected
// - All tasks completed

// Impostors win if:
// - Impostors >= Crewmates (alive)
// - Critical sabotage not fixed (future)
```

#### Server (`server/src/WebSocketServer.ts`)
- [ ] Call `checkWinConditions()` after kill, vote, task
- [ ] Broadcast `server:game_ended` with winners/losers
- [ ] Distribute wagers via WagerService
- [ ] Transition room to ended state

### Files to Modify
```
server/src/WebSocketServer.ts
server/src/GameStateManager.ts
```

### Test Cases
- [ ] Game ends when all impostors ejected
- [ ] Game ends when impostor count >= crewmate count
- [ ] Game ends when all tasks completed
- [ ] Correct team identified as winners
- [ ] Wagers distributed correctly

---

## Gap 5: Sabotage System

### Current State
- `SabotageType` enum exists (Lights, Reactor, O2, Comms)
- `ActionType.Sabotage = 8` defined
- No server handlers
- No sabotage effects or timers

### Required Changes

#### Server (`server/src/GameStateManager.ts`)
- [ ] Add `activeSabotage: SabotageType` to game state
- [ ] Add `sabotageEndTime: number` for critical sabotages
- [ ] Add `SABOTAGE_COOLDOWN = 30` seconds
- [ ] Add `lastSabotageTime: number`

#### Sabotage Effects
```typescript
interface SabotageEffect {
  type: SabotageType;
  duration: number; // 0 = until fixed
  isCritical: boolean; // Reactor/O2 cause game loss if not fixed
  fixLocations: Location[]; // Where to go to fix
}

const SABOTAGE_EFFECTS: Record<SabotageType, SabotageEffect> = {
  [SabotageType.Lights]: {
    duration: 0,
    isCritical: false,
    fixLocations: [Location.Electrical]
  },
  [SabotageType.Reactor]: {
    duration: 45,
    isCritical: true,
    fixLocations: [Location.Reactor] // Need 2 players
  },
  [SabotageType.O2]: {
    duration: 30,
    isCritical: true,
    fixLocations: [Location.Admin, Location.Reactor]
  },
  [SabotageType.Comms]: {
    duration: 0,
    isCritical: false,
    fixLocations: [Location.Admin]
  }
};
```

#### Server (`server/src/WebSocketServer.ts`)
- [ ] Add handler for `agent:sabotage` message
- [ ] Validate only impostor can sabotage
- [ ] Validate sabotage cooldown
- [ ] Broadcast `server:sabotage_started`
- [ ] Add handler for `agent:fix_sabotage`
- [ ] Check critical sabotage timeout (impostor wins)

#### Agent Types
- [ ] Add `AgentSabotageMessage` type
- [ ] Add `AgentFixSabotageMessage` type
- [ ] Add `ServerSabotageStartedMessage` type
- [ ] Add `ServerSabotageFixedMessage` type

### Files to Modify
```
server/src/WebSocketServer.ts
server/src/GameStateManager.ts
server/src/types.ts
agent/src/types.ts
skills/skill.md
```

### Test Cases
- [ ] Only impostor can sabotage
- [ ] Sabotage cooldown enforced
- [ ] Lights reduce vision (documented effect)
- [ ] Reactor/O2 timer causes game loss if not fixed
- [ ] Crewmates can fix sabotage
- [ ] Comms disables task list visibility

---

## Gap 6: Venting System

### Current State
- `VentConnections` defined in `agent/src/types.ts:224-234`
- `ActionType.Vent = 7` exists
- No server validation
- No vent network implementation

### Required Changes

#### Server (`server/src/GameStateManager.ts`)
- [ ] Add `VENT_CONNECTIONS: Map<Location, Location[]>`
- [ ] Add `playersInVent: Set<string>` to track hidden players
- [ ] Add `canVent(from: Location, to: Location): boolean`

#### Vent Network (The Skeld)
```
Admin <-> Cafeteria
MedBay <-> Electrical <-> Security
Reactor <-> UpperEngine <-> LowerEngine
```

#### Server (`server/src/WebSocketServer.ts`)
- [ ] Add handler for `agent:vent` message
- [ ] Validate only impostor can vent
- [ ] Validate vent connections
- [ ] Hide player from other players while in vent
- [ ] Allow movement between connected vents

#### Server (`server/src/types.ts`)
- [ ] Add `AgentVentMessage` type
- [ ] Add `ServerPlayerVentedMessage` (only to impostors/spectators)

### Files to Modify
```
server/src/WebSocketServer.ts
server/src/GameStateManager.ts
server/src/types.ts
skills/skill.md
```

### Test Cases
- [ ] Only impostor can vent
- [ ] Only connected vents accessible
- [ ] Player hidden while in vent
- [ ] Player visible when exiting vent
- [ ] Other impostors see vent usage

---

## Gap 7: Emergency Meetings

### Current State
- `ActionType.CallMeeting = 6` defined
- `maxEmergencyMeetings = 1` in CrewmateStrategy
- No server handler
- No button cooldown

### Required Changes

#### Server (`server/src/GameStateManager.ts`)
- [ ] Add `emergencyMeetingsUsed: Map<string, number>`
- [ ] Add `MAX_EMERGENCY_MEETINGS = 1` per player
- [ ] Add `MEETING_COOLDOWN = 30` seconds
- [ ] Add `lastMeetingTime: number`

#### Server (`server/src/WebSocketServer.ts`)
- [ ] Add handler for `agent:call_meeting` message
- [ ] Validate player hasn't used all meetings
- [ ] Validate meeting cooldown
- [ ] Transition to Discussion phase
- [ ] Broadcast `server:meeting_called`

#### Server (`server/src/types.ts`)
- [ ] Add `AgentCallMeetingMessage` type
- [ ] Add `ServerMeetingCalledMessage` type

### Files to Modify
```
server/src/WebSocketServer.ts
server/src/GameStateManager.ts
server/src/types.ts
skills/skill.md
```

### Test Cases
- [ ] Meeting triggers discussion phase
- [ ] Limited meetings per player
- [ ] Meeting cooldown enforced
- [ ] Dead players cannot call meetings

---

## Gap 8: Ghost Player Mechanics

### Current State
- `Role.Ghost = 3` defined in enum
- Dead players removed from game flow
- No ghost actions

### Required Changes

#### Server (`server/src/GameStateManager.ts`)
- [ ] Keep dead players in game with `isGhost: true`
- [ ] Allow ghost movement (no adjacency restriction)
- [ ] Track ghost task completion separately

#### Server (`server/src/WebSocketServer.ts`)
- [ ] Allow ghosts to complete tasks (crewmate ghosts)
- [ ] Allow ghosts to sabotage (impostor ghosts) - optional
- [ ] Ghosts cannot vote or be voted
- [ ] Ghosts cannot report bodies
- [ ] Ghosts invisible to living players

#### Visibility Rules
```
Living Crewmate sees: Living players, dead bodies
Living Impostor sees: Living players, dead bodies, other impostors
Ghost sees: All players (living and ghost), no dead bodies
```

### Files to Modify
```
server/src/WebSocketServer.ts
server/src/GameStateManager.ts
server/src/types.ts
```

### Test Cases
- [ ] Dead crewmates can complete tasks
- [ ] Ghost tasks count toward victory
- [ ] Ghosts cannot vote
- [ ] Ghosts cannot report
- [ ] Living players don't see ghosts

---

## Gap 9: Security Cameras

### Current State
- `ActionType.UseCams = 9` defined
- No implementation

### Required Changes

#### Server (`server/src/GameStateManager.ts`)
- [ ] Add `playersOnCams: Set<string>`
- [ ] Add `CAMERA_LOCATIONS = [Electrical, MedBay, Storage, Reactor]`

#### Server (`server/src/WebSocketServer.ts`)
- [ ] Add handler for `agent:use_cams` message
- [ ] Send camera feed (players in camera locations)
- [ ] Track who is watching
- [ ] Broadcast camera light status

### Files to Modify
```
server/src/WebSocketServer.ts
server/src/GameStateManager.ts
server/src/types.ts
```

---

## Gap 10: Discussion Phase Chat

### Current State
- Discussion phase exists but no messaging
- Agents cannot communicate accusations

### Required Changes

#### Server (`server/src/types.ts`)
- [ ] Add `AgentChatMessage` type
- [ ] Add `ServerChatMessage` type

#### Server (`server/src/WebSocketServer.ts`)
- [ ] Add handler for `agent:chat` message
- [ ] Only allow during Discussion phase
- [ ] Broadcast to all players
- [ ] Dead players can only chat with dead

### Files to Modify
```
server/src/WebSocketServer.ts
server/src/types.ts
skills/skill.md
```

---

## Gap 11: Vote Tie-Breaking

### Current State
- Voting works but no tie logic
- No skip vote handling

### Required Changes

#### Server (`server/src/GameStateManager.ts`)
- [ ] Handle tie votes (no ejection)
- [ ] Handle skip majority (no ejection)
- [ ] Announce vote results with counts

#### Server (`server/src/WebSocketServer.ts`)
- [ ] Broadcast detailed vote results
- [ ] Handle tie announcement

### Files to Modify
```
server/src/WebSocketServer.ts
server/src/GameStateManager.ts
```

---

## Gap 12: On-Chain Settlement

### Current State
- Contracts exist but not called
- WagerService is off-chain only
- No transaction signing

### Required Changes

#### Server (`server/src/ContractService.ts`)
- [ ] Enable contract calls
- [ ] Call `settleGame()` on game end
- [ ] Call `refundGame()` on cancellation

#### Server (`server/src/WebSocketServer.ts`)
- [ ] Integrate ContractService in endGame()
- [ ] Handle transaction failures gracefully

### Files to Modify
```
server/src/ContractService.ts
server/src/WebSocketServer.ts
```

---

## Implementation Order

### Phase 1: Core Gameplay (Must Have)
1. Gap 2: Kill Cooldown Enforcement
2. Gap 3: Movement Validation
3. Gap 4: Game End Detection
4. Gap 1: Body Report → Voting Flow

### Phase 2: Advanced Mechanics
5. Gap 11: Vote Tie-Breaking
6. Gap 7: Emergency Meetings
7. Gap 8: Ghost Player Mechanics
8. Gap 10: Discussion Phase Chat

### Phase 3: Impostor Features
9. Gap 5: Sabotage System
10. Gap 6: Venting System

### Phase 4: Polish
11. Gap 9: Security Cameras
12. Gap 12: On-Chain Settlement

---

## Progress Log

| Date | Gap # | Action | Notes |
|------|-------|--------|-------|
| 2026-02-11 | 2 | COMPLETE | Kill cooldown tracking added to GameStateManager, validation in handleKill |
| 2026-02-11 | 3 | COMPLETE | Room adjacency map added, movement validation in handlePositionUpdate |
| 2026-02-11 | 4 | COMPLETE | Task completion win condition added to checkWinCondition |
| 2026-02-11 | 1 | COMPLETE | Enhanced handleReportBody with proper validation |
| 2026-02-11 | 11 | COMPLETE | Vote tie-breaking already implemented in resolveVoting |
| 2026-02-11 | 7 | COMPLETE | Emergency meeting system with per-player limits |
| 2026-02-11 | 8 | COMPLETE | Ghost movement (free), ghost task completion (crewmate only) |
| 2026-02-11 | 10 | COMPLETE | Discussion chat with ghost-only chat for dead players |
| 2026-02-11 | 5 | COMPLETE | Full sabotage system: Lights, Reactor, O2, Comms with cooldowns and critical timers |
| 2026-02-11 | 6 | COMPLETE | Vent system: enter/exit/move, only visible to impostors, cleared on meetings |
| 2026-02-11 | 9 | COMPLETE | Security cameras: watch from Security, see players in Cafeteria/Storage/MedBay/Reactor |
| 2026-02-11 | 12 | COMPLETE | On-chain integration already implemented, updated .env.example with contract config |

