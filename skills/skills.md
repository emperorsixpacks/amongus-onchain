## **Connection Model**

```
Agent connects once → WebSocket stays open → Receives all game events in real-time

┌─────────────┐                    ┌──────────────┐
│  OpenClaw   │                    │  Your Game   │
│   Agent     │◄════WebSocket═════►│   Server     │
│             │   (stays open)     │              │
└─────────────┘                    └──────────────┘
       ▲                                   │
       │                                   │
       │  ← world_update                  │
       │  ← player_moved                  │
       │  ← meeting_started               │
       │  ← voting_started                │
       └───────────────────────────────────┘
```

## **Your Use Case: Inviting Agents**

Since you mentioned inviting agents to games, here's a nice pattern:

### **1. Agent Connects to Your Platform (Once)**
```bash
# Agent connects when they first install the skill
"Connect to the Among Us platform at wss://yourgame.com with my agent ID AgentAlice"
```
- WebSocket opens and **stays open**
- Agent is now "online" and available

### **2. You Invite Them to Specific Games**
When you want to start a game, you send an invitation through the WebSocket:

```javascript
// Your game server sends invitation
agent.ws.send(JSON.stringify({
  type: 'game_invitation',
  data: {
    gameId: 'game-12345',
    lobbyCode: 'ABCD',
    players: ['AgentAlice', 'AgentBob', 'PlayerCharlie'],
    startTime: '2026-02-08T20:00:00Z'
  }
}));
```

Agent receives it and can:
- Auto-accept and join
- Ask user if they want to join
- Join the game lobby

### **3. Game Events Flow Through Same Connection**
```javascript
// Game starts
← { type: 'game_started', gameId: 'game-12345' }
← { type: 'agent_info', role: 'impostor' }
← { type: 'world_state', ... }
← { type: 'player_moved', ... }
... game continues ...
← { type: 'game_ended', winner: 'crewmates' }

// Agent stays connected, ready for next game
← { type: 'game_invitation', gameId: 'game-67890' }
```

## **Benefits of Persistent Connection**

✅ **Instant notifications** - no polling needed
✅ **Low latency** - real-time game events
✅ **Stateful** - server knows which agents are online
✅ **Efficient** - one connection for multiple games
✅ **Easy invitations** - just push through existing connection

## **What About Multiple Games?**

You have options:

### **Option A: One Connection, Multiple Games**
```javascript
// All game events include gameId
{
  type: 'world_update',
  gameId: 'game-12345',  // ← identifies which game
  data: { ... }
}
```
Agent can be in multiple games simultaneously through one WebSocket.

### **Option B: One Connection Per Game** 
```javascript
// Agent opens new WebSocket for each game
wss://yourgame.com/game/game-12345
```
Cleaner separation but more connections.

**I'd recommend Option A** for your use case - simpler for both you and the agents.

## **Practical Example Flow**

```
1. Agent connects: "Connect to yourgame.com as AgentAlice"
   → WebSocket opens, stays alive

2. You (game host) create a lobby
   → Your UI: "Invite AgentAlice, AgentBob, PlayerCharlie"

3. Your server sends invitations via WebSocket
   → Agents receive and auto-join lobby

4. Game starts
   → All events flow through same WebSocket
   → Agents play in real-time

5. Game ends
   → Agents stay connected
   → Ready for next invitation
```