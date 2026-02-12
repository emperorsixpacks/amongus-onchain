// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/GameSettlement.sol";
import "../src/WagerVault.sol";
import "../src/AgentRegistry.sol";
import "./MockERC20.sol";

contract GameSettlementTest is Test {
    GameSettlement public settlement;
    WagerVault public vault;
    AgentRegistry public registry;
    MockERC20 public token;

    address public owner = address(this);
    address public operator = address(0x100);
    address public agent1 = address(0x1);
    address public agent2 = address(0x2);
    address public agent3 = address(0x3);
    address public agent4 = address(0x4);
    address public agent5 = address(0x5);
    address public agent6 = address(0x6);

    uint256 public constant INITIAL_BALANCE = 1000 * 10**18;

    function setUp() public {
        token = new MockERC20();
        registry = new AgentRegistry();
        vault = new WagerVault(address(registry), address(token));
        settlement = new GameSettlement(address(vault), address(registry));

        // Configure contracts
        vault.setGameSettlement(address(settlement));
        registry.setGameSettlement(address(settlement));
        registry.setWagerVault(address(vault));
        settlement.setOperator(operator);

        // Fund agents
        address[6] memory agents = [agent1, agent2, agent3, agent4, agent5, agent6];
        for (uint i = 0; i < agents.length; i++) {
            token.mint(agents[i], INITIAL_BALANCE);
            vm.prank(agents[i]);
            token.approve(address(vault), type(uint256).max);
            vm.prank(agents[i]);
            vault.deposit(100 * 10**18);
        }
    }

    function _setupGame(bytes32 gameId) internal {
        // 6 players wager
        vm.prank(agent1);
        vault.placeWager(gameId);
        vm.prank(agent2);
        vault.placeWager(gameId);
        vm.prank(agent3);
        vault.placeWager(gameId);
        vm.prank(agent4);
        vault.placeWager(gameId);
        vm.prank(agent5);
        vault.placeWager(gameId);
        vm.prank(agent6);
        vault.placeWager(gameId);
    }

    // ============ Create Game Tests ============

    function test_CreateGame() public {
        bytes32 gameId = keccak256("game1");
        _setupGame(gameId);

        address[] memory players = new address[](6);
        players[0] = agent1;
        players[1] = agent2;
        players[2] = agent3;
        players[3] = agent4;
        players[4] = agent5;
        players[5] = agent6;

        address[] memory impostors = new address[](2);
        impostors[0] = agent1;
        impostors[1] = agent2;

        vm.prank(operator);
        settlement.createGame(gameId, players, impostors);

        assertEq(uint256(settlement.getGameStatus(gameId)), uint256(GameSettlement.GameStatus.Active));

        (uint256 created, ) = settlement.getTotalGames();
        assertEq(created, 1);
    }

    function test_CreateGameNotEnoughPlayers() public {
        bytes32 gameId = keccak256("game1");

        // Only 3 players wager
        vm.prank(agent1);
        vault.placeWager(gameId);
        vm.prank(agent2);
        vault.placeWager(gameId);
        vm.prank(agent3);
        vault.placeWager(gameId);

        address[] memory players = new address[](3);
        players[0] = agent1;
        players[1] = agent2;
        players[2] = agent3;

        address[] memory impostors = new address[](1);
        impostors[0] = agent1;

        vm.prank(operator);
        vm.expectRevert("Need 4+ players");
        settlement.createGame(gameId, players, impostors);
    }

    function test_CreateGameNoImpostors() public {
        bytes32 gameId = keccak256("game1");
        _setupGame(gameId);

        address[] memory players = new address[](6);
        players[0] = agent1;
        players[1] = agent2;
        players[2] = agent3;
        players[3] = agent4;
        players[4] = agent5;
        players[5] = agent6;

        address[] memory impostors = new address[](0);

        vm.prank(operator);
        vm.expectRevert("Need impostors");
        settlement.createGame(gameId, players, impostors);
    }

    function test_CreateGamePlayerNotWagered() public {
        bytes32 gameId = keccak256("game1");

        // Only 5 players wager (agent6 doesn't)
        vm.prank(agent1);
        vault.placeWager(gameId);
        vm.prank(agent2);
        vault.placeWager(gameId);
        vm.prank(agent3);
        vault.placeWager(gameId);
        vm.prank(agent4);
        vault.placeWager(gameId);
        vm.prank(agent5);
        vault.placeWager(gameId);

        address[] memory players = new address[](6);
        players[0] = agent1;
        players[1] = agent2;
        players[2] = agent3;
        players[3] = agent4;
        players[4] = agent5;
        players[5] = agent6; // Didn't wager!

        address[] memory impostors = new address[](1);
        impostors[0] = agent1;

        vm.prank(operator);
        vm.expectRevert("Player not wagered");
        settlement.createGame(gameId, players, impostors);
    }

    function test_CreateGameUnauthorized() public {
        bytes32 gameId = keccak256("game1");
        _setupGame(gameId);

        address[] memory players = new address[](6);
        players[0] = agent1;
        players[1] = agent2;
        players[2] = agent3;
        players[3] = agent4;
        players[4] = agent5;
        players[5] = agent6;

        address[] memory impostors = new address[](1);
        impostors[0] = agent1;

        vm.prank(agent1); // Not operator
        vm.expectRevert("Only operator");
        settlement.createGame(gameId, players, impostors);
    }

    // ============ Settle Game Tests ============

    function test_SettleGameCrewmatesWin() public {
        bytes32 gameId = keccak256("game1");
        _setupGame(gameId);

        address[] memory players = new address[](6);
        players[0] = agent1;
        players[1] = agent2;
        players[2] = agent3;
        players[3] = agent4;
        players[4] = agent5;
        players[5] = agent6;

        address[] memory impostors = new address[](2);
        impostors[0] = agent1;
        impostors[1] = agent2;

        vm.prank(operator);
        settlement.createGame(gameId, players, impostors);

        // Crewmates win (agent3, agent4, agent5, agent6)
        address[] memory winners = new address[](4);
        winners[0] = agent3;
        winners[1] = agent4;
        winners[2] = agent5;
        winners[3] = agent6;

        uint64[] memory kills = new uint64[](6);
        kills[0] = 1; // agent1 (impostor) got 1 kill
        kills[1] = 0; // agent2 (impostor) got 0 kills

        uint64[] memory tasks = new uint64[](6);
        tasks[2] = 5; // agent3 completed 5 tasks
        tasks[3] = 4; // agent4 completed 4 tasks
        tasks[4] = 3; // agent5 completed 3 tasks
        tasks[5] = 5; // agent6 completed 5 tasks

        vm.prank(operator);
        settlement.settleGame(gameId, true, winners, kills, tasks);

        assertEq(uint256(settlement.getGameStatus(gameId)), uint256(GameSettlement.GameStatus.Settled));

        (, uint256 settled) = settlement.getTotalGames();
        assertEq(settled, 1);

        // Check agent stats were recorded
        (, uint64 gamesPlayed, uint64 wins, , , ) = registry.getAgentStats(agent3);
        assertEq(gamesPlayed, 1);
        assertEq(wins, 1);

        (, gamesPlayed, wins, , , ) = registry.getAgentStats(agent1);
        assertEq(gamesPlayed, 1);
        assertEq(wins, 0); // Impostor lost
    }

    function test_SettleGameImpostorsWin() public {
        bytes32 gameId = keccak256("game1");
        _setupGame(gameId);

        address[] memory players = new address[](6);
        players[0] = agent1;
        players[1] = agent2;
        players[2] = agent3;
        players[3] = agent4;
        players[4] = agent5;
        players[5] = agent6;

        address[] memory impostors = new address[](2);
        impostors[0] = agent1;
        impostors[1] = agent2;

        vm.prank(operator);
        settlement.createGame(gameId, players, impostors);

        // Impostors win
        address[] memory winners = new address[](2);
        winners[0] = agent1;
        winners[1] = agent2;

        uint64[] memory kills = new uint64[](6);
        kills[0] = 2;
        kills[1] = 2;

        uint64[] memory tasks = new uint64[](6);

        vm.prank(operator);
        settlement.settleGame(gameId, false, winners, kills, tasks);

        // Check impostor stats
        uint64 impWins;
        uint64 impKills;
        (, , impWins, , impKills, ) = registry.getAgentStats(agent1);
        assertEq(impWins, 1);
        assertEq(impKills, 2);
    }

    function test_SettleGameNotActive() public {
        bytes32 gameId = keccak256("game1");

        address[] memory winners = new address[](1);
        winners[0] = agent1;

        uint64[] memory kills = new uint64[](0);
        uint64[] memory tasks = new uint64[](0);

        vm.prank(operator);
        vm.expectRevert("Game not active");
        settlement.settleGame(gameId, true, winners, kills, tasks);
    }

    // ============ Cancel Game Tests ============

    function test_CancelGame() public {
        bytes32 gameId = keccak256("game1");
        _setupGame(gameId);

        address[] memory players = new address[](6);
        players[0] = agent1;
        players[1] = agent2;
        players[2] = agent3;
        players[3] = agent4;
        players[4] = agent5;
        players[5] = agent6;

        address[] memory impostors = new address[](1);
        impostors[0] = agent1;

        vm.prank(operator);
        settlement.createGame(gameId, players, impostors);

        uint256 agent1BalanceBefore = vault.getBalance(agent1);

        vm.prank(operator);
        settlement.cancelGame(gameId);

        assertEq(uint256(settlement.getGameStatus(gameId)), uint256(GameSettlement.GameStatus.Cancelled));

        // Wagers should be refunded
        uint256 wagerAmount = vault.wagerAmount();
        assertEq(vault.getBalance(agent1), agent1BalanceBefore + wagerAmount);
    }

    // ============ View Functions Tests ============

    function test_GetGame() public {
        bytes32 gameId = keccak256("game1");
        _setupGame(gameId);

        address[] memory players = new address[](6);
        players[0] = agent1;
        players[1] = agent2;
        players[2] = agent3;
        players[3] = agent4;
        players[4] = agent5;
        players[5] = agent6;

        address[] memory impostors = new address[](2);
        impostors[0] = agent1;
        impostors[1] = agent2;

        vm.prank(operator);
        settlement.createGame(gameId, players, impostors);

        (
            address[] memory gamePlayers,
            address[] memory gameImpostors,
            uint64 createdAt,
            ,
            GameSettlement.GameStatus status,
        ) = settlement.getGame(gameId);

        assertEq(gamePlayers.length, 6);
        assertEq(gameImpostors.length, 2);
        assertTrue(createdAt > 0);
        assertEq(uint256(status), uint256(GameSettlement.GameStatus.Active));
    }

    // ============ Admin Tests ============

    function test_SetOperator() public {
        address newOperator = address(0x999);
        settlement.setOperator(newOperator);
        assertEq(settlement.operator(), newOperator);
    }

    function test_SetOperatorNotOwner() public {
        vm.prank(agent1);
        vm.expectRevert("Only owner");
        settlement.setOperator(address(0x999));
    }

    function test_TransferOwnership() public {
        settlement.transferOwnership(agent1);
        assertEq(settlement.owner(), agent1);
    }

    // ============ Integration Test ============

    function test_FullGameFlow() public {
        bytes32 gameId = keccak256("fullGame");

        // 1. Players deposit and wager
        _setupGame(gameId);

        uint256 agent3BalanceBeforeGame = vault.getBalance(agent3);

        // 2. Create game
        address[] memory players = new address[](6);
        players[0] = agent1;
        players[1] = agent2;
        players[2] = agent3;
        players[3] = agent4;
        players[4] = agent5;
        players[5] = agent6;

        address[] memory impostors = new address[](2);
        impostors[0] = agent1;
        impostors[1] = agent2;

        vm.prank(operator);
        settlement.createGame(gameId, players, impostors);

        // 3. Game plays out... (off-chain)

        // 4. Settle game - Crewmates win!
        address[] memory winners = new address[](4);
        winners[0] = agent3;
        winners[1] = agent4;
        winners[2] = agent5;
        winners[3] = agent6;

        uint64[] memory kills = new uint64[](6);
        kills[0] = 1;

        uint64[] memory tasks = new uint64[](6);
        tasks[2] = 5;
        tasks[3] = 4;
        tasks[4] = 3;
        tasks[5] = 5;

        vm.prank(operator);
        settlement.settleGame(gameId, true, winners, kills, tasks);

        // 5. Verify outcomes
        // Total pot: 6 * 10 tokens = 60 tokens
        // Protocol fee: 5% = 3 tokens
        // Distributable: 57 tokens
        // Per winner: 57 / 4 = 14.25 tokens

        uint256 wagerAmount = vault.wagerAmount();
        uint256 totalPot = wagerAmount * 6;
        uint256 protocolFee = totalPot * 5 / 100;
        uint256 winningsPerPlayer = (totalPot - protocolFee) / 4;

        // Winner should have: original balance + winnings
        assertEq(vault.getBalance(agent3), agent3BalanceBeforeGame + winningsPerPlayer);

        // Loser should have: original balance (wager was lost, not returned)
        // agent1 had 90 tokens after wager, now still 90
        assertEq(vault.getBalance(agent1), 90 * 10**18);

        // Protocol fee collected
        assertEq(vault.getBalance(owner), protocolFee);

        // Stats recorded
        (, uint64 gamesPlayed, uint64 wins, , , uint64 tasksCompleted) = registry.getAgentStats(agent3);
        assertEq(gamesPlayed, 1);
        assertEq(wins, 1);
        assertEq(tasksCompleted, 5);

        uint64 losses;
        uint64 agentKills;
        (,gamesPlayed, , losses, agentKills,) = registry.getAgentStats(agent1);
        assertEq(gamesPlayed, 1);
        assertEq(losses, 1);
        assertEq(agentKills, 1);
    }
}
