import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { createLogger } from "./logger.js";
import { privyWalletService } from "./PrivyWalletService.js";
import { wagerService } from "./WagerService.js";
import type { WebSocketRelayServer } from "./WebSocketServer.js";

const logger = createLogger("api");

// ============ OPERATOR KEY STORAGE ============

interface RegisteredOperator {
  operatorKey: string; // The key itself (hashed for comparison)
  walletAddress: string;
  createdAt: number;
}

// In-memory storage (in production, use a database)
// Maps operator key -> operator info
const registeredOperators = new Map<string, RegisteredOperator>();

function registerOperatorKey(operatorKey: string, walletAddress: string): boolean {
  // Operator key must start with "oper_"
  if (!operatorKey.startsWith("oper_")) {
    return false;
  }

  // Check if key already exists
  if (registeredOperators.has(operatorKey)) {
    return false;
  }

  const normalizedAddress = walletAddress.toLowerCase();
  const entry: RegisteredOperator = {
    operatorKey,
    walletAddress: normalizedAddress,
    createdAt: Date.now(),
  };

  registeredOperators.set(operatorKey, entry);
  logger.info(`Registered operator key for ${normalizedAddress.slice(0, 10)}...`);
  return true;
}

function validateOperatorKey(operatorKey: string): RegisteredOperator | null {
  return registeredOperators.get(operatorKey) || null;
}

// Extract Bearer token from Authorization header
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7); // Remove "Bearer " prefix
}

// Middleware to require operator authentication
interface AuthenticatedRequest extends Request {
  operator?: RegisteredOperator;
}

function requireOperatorAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const operatorKey = extractBearerToken(req);

  if (!operatorKey) {
    res.status(401).json({ error: "Authorization header required. Use: Authorization: Bearer {operatorKey}" });
    return;
  }

  const operator = validateOperatorKey(operatorKey);
  if (!operator) {
    res.status(401).json({ error: "Invalid operator key" });
    return;
  }

  req.operator = operator;
  next();
}

export function createApiServer(wsServer: WebSocketRelayServer) {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // ============ ROOMS ============

  // Get all rooms and server stats
  app.get("/api/rooms", (_req: Request, res: Response) => {
    const stats = wsServer.getStats();
    const rooms = wsServer.getRooms();

    res.json({
      rooms: rooms.map((room) => ({
        roomId: room.roomId,
        players: room.players.map((p) => ({
          address: p.address,
          colorId: p.colorId,
          isAlive: p.isAlive,
        })),
        spectators: room.spectators.length,
        maxPlayers: room.maxPlayers,
        phase: room.phase,
        createdAt: room.createdAt,
      })),
      stats,
    });
  });

  // Get specific room
  app.get("/api/rooms/:roomId", (req: Request<{ roomId: string }>, res: Response) => {
    const room = wsServer.getRoom(req.params.roomId);

    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    res.json({
      roomId: room.roomId,
      players: room.players,
      spectators: room.spectators.length,
      maxPlayers: room.maxPlayers,
      phase: room.phase,
      createdAt: room.createdAt,
    });
  });

  // ============ LEADERBOARD ============

  // Get leaderboard
  app.get("/api/leaderboard", (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
    const leaderboard = wsServer.getLeaderboard(limit);

    res.json({
      agents: leaderboard,
      timestamp: Date.now(),
    });
  });

  // Get specific agent stats
  app.get("/api/agents/:address/stats", (req: Request<{ address: string }>, res: Response) => {
    const stats = wsServer.getAgentStats(req.params.address);

    if (!stats) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    res.json(stats);
  });

  // ============ OPERATOR KEYS ============

  // Register an operator key (user provides their own key)
  // The operator key is passed in Authorization header, wallet address in body
  app.post("/api/operators", (req: Request, res: Response) => {
    const operatorKey = extractBearerToken(req);
    const { walletAddress } = req.body;

    if (!operatorKey) {
      res.status(401).json({ error: "Authorization header required. Use: Authorization: Bearer {your_operator_key}" });
      return;
    }

    if (!operatorKey.startsWith("oper_")) {
      res.status(400).json({ error: "Invalid operator key format. Must start with 'oper_'" });
      return;
    }

    if (!walletAddress || typeof walletAddress !== "string") {
      res.status(400).json({ error: "walletAddress is required in body" });
      return;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({ error: "Invalid wallet address format" });
      return;
    }

    const success = registerOperatorKey(operatorKey, walletAddress);

    if (!success) {
      res.status(409).json({ error: "Operator key already registered" });
      return;
    }

    res.status(201).json({
      success: true,
      walletAddress: walletAddress.toLowerCase(),
      createdAt: Date.now(),
    });
  });

  // Validate operator key (check if authenticated)
  app.get("/api/operators/me", (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    requireOperatorAuth(req, res, () => {
      res.json({
        valid: true,
        walletAddress: req.operator!.walletAddress,
        createdAt: req.operator!.createdAt,
      });
    });
  });

  // ============ OPERATOR / AGENTS ============

  // Create a new agent wallet (requires operator auth)
  app.post("/api/agents", (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    requireOperatorAuth(req, res, async () => {
      if (!privyWalletService.isEnabled()) {
        res.status(503).json({
          error: "Privy wallet service not configured",
          message: "Set PRIVY_APP_ID and PRIVY_APP_SECRET in server environment",
        });
        return;
      }

      try {
        const operatorKey = extractBearerToken(req)!;
        const result = await privyWalletService.createAgentWallet(operatorKey);

        if (result) {
          logger.info(`Agent wallet created via API: ${result.address}`);
          res.status(201).json({
            success: true,
            agentAddress: result.address,
            userId: result.userId,
            createdAt: Date.now(),
          });
        } else {
          res.status(500).json({ error: "Failed to create agent wallet" });
        }
      } catch (error) {
        logger.error("Error creating agent wallet:", error);
        res.status(500).json({
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });
  });

  // List agents for an operator (requires operator auth)
  app.get("/api/agents", (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    requireOperatorAuth(req, res, () => {
      const operatorKey = extractBearerToken(req)!;
      const agents = privyWalletService.getAgentWalletsForOperator(operatorKey);

      res.json({
        agents: agents.map((a) => ({
          address: a.address,
          userId: a.userId,
          createdAt: a.createdAt,
        })),
        count: agents.length,
      });
    });
  });

  // ============ WAGER ENDPOINTS ============

  // Get wager configuration
  app.get("/api/wager/config", (_req: Request, res: Response) => {
    res.json({
      wagerAmount: wagerService.getWagerAmount().toString(),
      wagerAmountMON: Number(wagerService.getWagerAmount()) / 1e18,
      timestamp: Date.now(),
    });
  });

  // Get agent balance
  app.get("/api/wager/balance/:address", (req: Request<{ address: string }>, res: Response) => {
    const { address } = req.params;

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      res.status(400).json({ error: "Invalid wallet address format" });
      return;
    }

    const balanceInfo = wagerService.getBalanceInfo(address);
    const balance = wagerService.getBalance(address);

    res.json({
      address: address.toLowerCase(),
      balance: balance.toString(),
      balanceMON: Number(balance) / 1e18,
      totalDeposited: balanceInfo?.totalDeposited.toString() || "0",
      totalWon: balanceInfo?.totalWon.toString() || "0",
      totalLost: balanceInfo?.totalLost.toString() || "0",
      wagerAmount: wagerService.getWagerAmount().toString(),
      canAffordWager: wagerService.canAffordWager(address),
      timestamp: Date.now(),
    });
  });

  // Deposit funds (for testing - in production this would be triggered by on-chain events)
  app.post("/api/wager/deposit", (req: Request, res: Response) => {
    const { address, amount } = req.body;

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      res.status(400).json({ error: "Invalid wallet address" });
      return;
    }

    if (!amount) {
      res.status(400).json({ error: "Amount is required" });
      return;
    }

    try {
      const amountBigInt = BigInt(amount);
      if (amountBigInt <= 0) {
        res.status(400).json({ error: "Amount must be positive" });
        return;
      }

      wagerService.deposit(address, amountBigInt);

      const newBalance = wagerService.getBalance(address);

      res.json({
        success: true,
        address: address.toLowerCase(),
        deposited: amount,
        newBalance: newBalance.toString(),
        newBalanceMON: Number(newBalance) / 1e18,
        timestamp: Date.now(),
      });
    } catch (error) {
      res.status(400).json({ error: "Invalid amount format" });
    }
  });

  // Get game pot info
  app.get("/api/wager/game/:gameId", (req: Request<{ gameId: string }>, res: Response) => {
    const { gameId } = req.params;

    const gameWager = wagerService.getGameWager(gameId);

    if (!gameWager) {
      res.json({
        gameId,
        totalPot: "0",
        playerCount: 0,
        settled: false,
        timestamp: Date.now(),
      });
      return;
    }

    res.json({
      gameId,
      totalPot: gameWager.totalPot.toString(),
      totalPotMON: Number(gameWager.totalPot) / 1e18,
      playerCount: gameWager.wagers.size,
      settled: gameWager.settled,
      timestamp: Date.now(),
    });
  });

  // ============ SERVER INFO ============

  // Get server configuration and status
  app.get("/api/server", (_req: Request, res: Response) => {
    const stats = wsServer.getStats();

    res.json({
      version: "1.0.0",
      privy: {
        enabled: privyWalletService.isEnabled(),
      },
      wager: {
        amount: wagerService.getWagerAmount().toString(),
        amountMON: Number(wagerService.getWagerAmount()) / 1e18,
      },
      limits: stats.limits,
      connections: stats.connections,
      rooms: stats.rooms,
    });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("API error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
