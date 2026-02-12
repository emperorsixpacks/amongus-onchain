-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('CREATED', 'ACTIVE', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WAGER', 'WINNINGS', 'REFUND', 'WITHDRAWAL');

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operatorKey" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "balance" TEXT NOT NULL DEFAULT '0',
    "totalDeposited" TEXT NOT NULL DEFAULT '0',
    "totalWon" TEXT NOT NULL DEFAULT '0',
    "totalLost" TEXT NOT NULL DEFAULT '0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'CREATED',
    "phase" TEXT NOT NULL DEFAULT 'lobby',
    "crewmatesWon" BOOLEAN,
    "winReason" TEXT,
    "totalPot" TEXT NOT NULL DEFAULT '0',
    "winningsPerPlayer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "settlementTxHash" TEXT,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameParticipant" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "isImpostor" BOOLEAN NOT NULL DEFAULT false,
    "colorId" INTEGER,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "isAlive" BOOLEAN NOT NULL DEFAULT true,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "wagerAmount" TEXT NOT NULL DEFAULT '0',
    "winnings" TEXT NOT NULL DEFAULT '0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "gameRoomId" TEXT,
    "txHash" TEXT,
    "blockNumber" INTEGER,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Operator_operatorKey_key" ON "Operator"("operatorKey");

-- CreateIndex
CREATE UNIQUE INDEX "Operator_walletAddress_key" ON "Operator"("walletAddress");

-- CreateIndex
CREATE INDEX "Operator_operatorKey_idx" ON "Operator"("operatorKey");

-- CreateIndex
CREATE INDEX "Operator_walletAddress_idx" ON "Operator"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_walletAddress_key" ON "Agent"("walletAddress");

-- CreateIndex
CREATE INDEX "Agent_walletAddress_idx" ON "Agent"("walletAddress");

-- CreateIndex
CREATE INDEX "Agent_operatorId_idx" ON "Agent"("operatorId");

-- CreateIndex
CREATE UNIQUE INDEX "Game_roomId_key" ON "Game"("roomId");

-- CreateIndex
CREATE INDEX "Game_roomId_idx" ON "Game"("roomId");

-- CreateIndex
CREATE INDEX "Game_status_idx" ON "Game"("status");

-- CreateIndex
CREATE INDEX "Game_createdAt_idx" ON "Game"("createdAt");

-- CreateIndex
CREATE INDEX "GameParticipant_gameId_idx" ON "GameParticipant"("gameId");

-- CreateIndex
CREATE INDEX "GameParticipant_agentId_idx" ON "GameParticipant"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "GameParticipant_gameId_agentId_key" ON "GameParticipant"("gameId", "agentId");

-- CreateIndex
CREATE INDEX "Transaction_walletAddress_idx" ON "Transaction"("walletAddress");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "Transaction_gameRoomId_idx" ON "Transaction"("gameRoomId");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameParticipant" ADD CONSTRAINT "GameParticipant_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameParticipant" ADD CONSTRAINT "GameParticipant_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
