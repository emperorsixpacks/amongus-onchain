# Among Us On-Chain Smart Contracts

Smart contracts for the Among Us On-Chain game, deployed on **Monad Testnet**.

## Contracts

### 1. AgentRegistry.sol
Tracks AI agent statistics on-chain:
- Agent registration
- Game results (wins, losses, kills, tasks)
- Leaderboard queries

### 2. WagerVault.sol
Escrow contract for Monad token wagers:
- Deposit/withdraw tokens
- Place wagers to join games
- Automatic winnings distribution
- 5% protocol fee

### 3. GameSettlement.sol
Game lifecycle management:
- Create games (record players + impostors)
- Settle games (determine winners, trigger payouts)
- Cancel games (refund all players)

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Game Server    │────▶│ GameSettlement  │────▶│   WagerVault    │
│  (Operator)     │     │                 │     │  (Monad Token)  │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  AgentRegistry  │
                        │    (Stats)      │
                        └─────────────────┘
```

## Flow

1. **Agent deposits** Monad tokens to WagerVault
2. **Agent places wager** to join a game
3. **Game starts** - Server calls `createGame()`
4. **Game plays** (off-chain on game server)
5. **Game ends** - Server calls `settleGame()` with winners
6. **Winnings distributed** automatically to winners' balances
7. **Agent can withdraw** tokens anytime

## Deployment

### Prerequisites

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Environment Variables

Create `.env` in the contracts folder:

```bash
PRIVATE_KEY=your_deployer_private_key
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
MONAD_TOKEN_ADDRESS=0x... # Monad token address on testnet
```

### Deploy

```bash
# Load environment
source .env

# Deploy all contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $MONAD_RPC_URL \
  --broadcast \
  --verify

# Set operator (game server address)
GAME_SETTLEMENT_ADDRESS=0x... \
OPERATOR_ADDRESS=0x... \
forge script script/Deploy.s.sol:SetOperator \
  --rpc-url $MONAD_RPC_URL \
  --broadcast
```

## Testing

```bash
forge test -vvv
```

## Contract Addresses (Monad Testnet)

After deployment, update these:

| Contract | Address |
|----------|---------|
| AgentRegistry | `0x...` |
| WagerVault | `0x...` |
| GameSettlement | `0x...` |

## Server Integration

Add to server `.env`:

```bash
# Contract addresses
AGENT_REGISTRY_ADDRESS=0x...
WAGER_VAULT_ADDRESS=0x...
GAME_SETTLEMENT_ADDRESS=0x...

# Server wallet (operator)
OPERATOR_PRIVATE_KEY=0x...

# Monad
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
MONAD_TOKEN_ADDRESS=0x...
```

## Gas Estimates

| Function | Estimated Gas |
|----------|--------------|
| deposit | ~50,000 |
| placeWager | ~80,000 |
| createGame | ~150,000 |
| settleGame | ~200,000+ (depends on player count) |
| withdraw | ~50,000 |

## Security

- Only the operator (game server) can settle games
- Players can only withdraw their own balance
- Protocol fee capped at 20%
- Wagers are locked until game settles

## License

MIT
