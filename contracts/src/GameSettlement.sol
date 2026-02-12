// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./WagerVault.sol";
import "./AgentRegistry.sol";

/**
 * @title GameSettlement
 * @notice Orchestrates game creation, settlement, and stats recording on Monad
 * @dev Called by the game server to manage on-chain game lifecycle
 */
contract GameSettlement {
    // ============ Structs ============

    struct Game {
        bytes32 gameId;
        address[] players;
        address[] impostors;
        uint64 createdAt;
        uint64 settledAt;
        GameStatus status;
        bool crewmatesWon;
    }

    enum GameStatus {
        None,
        Active,
        Settled,
        Cancelled
    }

    // ============ State Variables ============

    address public owner;
    address public operator;

    WagerVault public wagerVault;
    AgentRegistry public agentRegistry;

    mapping(bytes32 => Game) public games;
    bytes32[] public allGameIds;

    uint256 public totalGamesCreated;
    uint256 public totalGamesSettled;

    // ============ Events ============

    event GameCreated(bytes32 indexed gameId, uint256 playerCount, uint256 impostorCount);
    event GameSettled(bytes32 indexed gameId, bool crewmatesWon, uint256 winnerCount);
    event GameCancelled(bytes32 indexed gameId);
    event OperatorUpdated(address indexed newOperator);

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator || msg.sender == owner, "Only operator");
        _;
    }

    // ============ Constructor ============

    constructor(address _wagerVault, address _agentRegistry) {
        owner = msg.sender;
        operator = msg.sender;
        wagerVault = WagerVault(payable(_wagerVault));
        agentRegistry = AgentRegistry(_agentRegistry);
    }

    // ============ Game Lifecycle ============

    /**
     * @notice Create a new game
     * @param gameId Unique game identifier
     * @param players Array of player addresses
     * @param impostors Array of impostor addresses
     */
    function createGame(
        bytes32 gameId,
        address[] calldata players,
        address[] calldata impostors
    ) external onlyOperator {
        require(games[gameId].status == GameStatus.None, "Game exists");
        require(players.length >= 4, "Need 4+ players");
        require(impostors.length > 0, "Need impostors");

        // Verify all players wagered
        for (uint256 i = 0; i < players.length; i++) {
            require(wagerVault.hasWagered(gameId, players[i]), "Player not wagered");
        }

        games[gameId] = Game({
            gameId: gameId,
            players: players,
            impostors: impostors,
            createdAt: uint64(block.timestamp),
            settledAt: 0,
            status: GameStatus.Active,
            crewmatesWon: false
        });

        allGameIds.push(gameId);
        totalGamesCreated++;

        emit GameCreated(gameId, players.length, impostors.length);
    }

    /**
     * @notice Settle a completed game
     * @param gameId Game identifier
     * @param crewmatesWon Whether crewmates won
     * @param winners Array of winner addresses
     * @param playerKills Array of kills per player (same order as game.players)
     * @param playerTasks Array of tasks per player (same order as game.players)
     */
    function settleGame(
        bytes32 gameId,
        bool crewmatesWon,
        address[] calldata winners,
        uint64[] calldata playerKills,
        uint64[] calldata playerTasks
    ) external onlyOperator {
        Game storage game = games[gameId];
        require(game.status == GameStatus.Active, "Game not active");
        require(winners.length > 0, "Need winners");

        game.status = GameStatus.Settled;
        game.settledAt = uint64(block.timestamp);
        game.crewmatesWon = crewmatesWon;

        // Record stats for each player
        uint256 wagerAmt = wagerVault.wagerAmount();

        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            bool isImpostor = _isImpostor(game.impostors, player);
            bool won = _isWinner(winners, player);

            agentRegistry.recordGameResult(
                player,
                gameId,
                won,
                isImpostor,
                i < playerKills.length ? playerKills[i] : 0,
                i < playerTasks.length ? playerTasks[i] : 0,
                won ? uint128(wagerAmt) : 0,
                won ? 0 : uint128(wagerAmt)
            );
        }

        // Settle wagers
        wagerVault.settleGame(gameId, winners);

        totalGamesSettled++;

        emit GameSettled(gameId, crewmatesWon, winners.length);
    }

    /**
     * @notice Cancel a game and refund players
     */
    function cancelGame(bytes32 gameId) external onlyOperator {
        Game storage game = games[gameId];
        require(
            game.status == GameStatus.Active || game.status == GameStatus.None,
            "Cannot cancel"
        );

        game.status = GameStatus.Cancelled;
        game.settledAt = uint64(block.timestamp);

        wagerVault.refundGame(gameId);

        emit GameCancelled(gameId);
    }

    // ============ View Functions ============

    function getGame(bytes32 gameId) external view returns (
        address[] memory players,
        address[] memory impostors,
        uint64 createdAt,
        uint64 settledAt,
        GameStatus status,
        bool crewmatesWon
    ) {
        Game memory g = games[gameId];
        return (g.players, g.impostors, g.createdAt, g.settledAt, g.status, g.crewmatesWon);
    }

    function getGameStatus(bytes32 gameId) external view returns (GameStatus) {
        return games[gameId].status;
    }

    function getTotalGames() external view returns (uint256 created, uint256 settled) {
        return (totalGamesCreated, totalGamesSettled);
    }

    // ============ Internal ============

    function _isImpostor(address[] memory impostors, address player) internal pure returns (bool) {
        for (uint256 i = 0; i < impostors.length; i++) {
            if (impostors[i] == player) return true;
        }
        return false;
    }

    function _isWinner(address[] calldata winners, address player) internal pure returns (bool) {
        for (uint256 i = 0; i < winners.length; i++) {
            if (winners[i] == player) return true;
        }
        return false;
    }

    // ============ Admin ============

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
        emit OperatorUpdated(_operator);
    }

    function setWagerVault(address _wagerVault) external onlyOwner {
        wagerVault = WagerVault(payable(_wagerVault));
    }

    function setAgentRegistry(address _agentRegistry) external onlyOwner {
        agentRegistry = AgentRegistry(_agentRegistry);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid");
        owner = newOwner;
    }
}
