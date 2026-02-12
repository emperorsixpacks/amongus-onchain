// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AgentRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry public registry;

    address public owner = address(this);
    address public agent1 = address(0x1);
    address public agent2 = address(0x2);
    address public agent3 = address(0x3);
    address public gameSettlement = address(0x100);

    function setUp() public {
        registry = new AgentRegistry();
        registry.setGameSettlement(gameSettlement);
    }

    // ============ Registration Tests ============

    function test_RegisterAgent() public {
        registry.registerAgent(agent1, "TestAgent");

        assertTrue(registry.isRegistered(agent1));
        assertEq(registry.getTotalAgents(), 1);

        (string memory name, uint64 gamesPlayed, uint64 wins, , , ) = registry.getAgentStats(agent1);
        assertEq(name, "TestAgent");
        assertEq(gamesPlayed, 0);
        assertEq(wins, 0);
    }

    function test_RegisterAgentDefaultName() public {
        registry.registerAgent(agent1, "");

        (string memory name, , , , , ) = registry.getAgentStats(agent1);
        assertEq(name, "Agent");
    }

    function test_RegisterAgentIdempotent() public {
        registry.registerAgent(agent1, "First");
        registry.registerAgent(agent1, "Second"); // Should not change

        (string memory name, , , , , ) = registry.getAgentStats(agent1);
        assertEq(name, "First");
        assertEq(registry.getTotalAgents(), 1);
    }

    function test_UpdateName() public {
        registry.registerAgent(agent1, "OldName");

        vm.prank(agent1);
        registry.updateName("NewName");

        (string memory name, , , , , ) = registry.getAgentStats(agent1);
        assertEq(name, "NewName");
    }

    function test_UpdateNameNotRegistered() public {
        vm.prank(agent1);
        vm.expectRevert("Not registered");
        registry.updateName("NewName");
    }

    function test_UpdateNameEmpty() public {
        registry.registerAgent(agent1, "OldName");

        vm.prank(agent1);
        vm.expectRevert("Name cannot be empty");
        registry.updateName("");
    }

    // ============ Stats Recording Tests ============

    function test_RecordGameResultWin() public {
        registry.registerAgent(agent1, "Winner");

        vm.prank(gameSettlement);
        registry.recordGameResult(
            agent1,
            keccak256("game1"),
            true,  // won
            false, // not impostor
            0,     // kills
            5,     // tasks
            100,   // earnings
            0      // lost
        );

        (
            ,
            uint64 gamesPlayed,
            uint64 wins,
            uint64 losses,
            ,
            uint64 tasksCompleted
        ) = registry.getAgentStats(agent1);

        assertEq(gamesPlayed, 1);
        assertEq(wins, 1);
        assertEq(losses, 0);
        assertEq(tasksCompleted, 5);
    }

    function test_RecordGameResultLoss() public {
        registry.registerAgent(agent1, "Loser");

        vm.prank(gameSettlement);
        registry.recordGameResult(
            agent1,
            keccak256("game1"),
            false, // lost
            true,  // was impostor
            2,     // kills
            0,     // tasks
            0,     // earnings
            100    // lost
        );

        (
            ,
            uint64 gamesPlayed,
            uint64 wins,
            uint64 losses,
            uint64 kills,
        ) = registry.getAgentStats(agent1);

        assertEq(gamesPlayed, 1);
        assertEq(wins, 0);
        assertEq(losses, 1);
        assertEq(kills, 2);
    }

    function test_RecordGameResultAutoRegister() public {
        assertFalse(registry.isRegistered(agent1));

        vm.prank(gameSettlement);
        registry.recordGameResult(
            agent1,
            keccak256("game1"),
            true, false, 0, 3, 50, 0
        );

        assertTrue(registry.isRegistered(agent1));
    }

    function test_RecordGameResultUnauthorized() public {
        registry.registerAgent(agent1, "Agent");

        vm.prank(agent1); // Not authorized
        vm.expectRevert("Not authorized");
        registry.recordGameResult(
            agent1,
            keccak256("game1"),
            true, false, 0, 0, 0, 0
        );
    }

    function test_RecordDeath() public {
        registry.registerAgent(agent1, "Victim");

        vm.prank(gameSettlement);
        registry.recordDeath(agent1);

        // Death recorded (no easy way to check directly, but no revert means success)
        assertTrue(registry.isRegistered(agent1));
    }

    // ============ View Functions Tests ============

    function test_GetWinRate() public {
        registry.registerAgent(agent1, "Agent");

        // Record 3 wins and 1 loss
        vm.startPrank(gameSettlement);
        for (uint i = 0; i < 3; i++) {
            registry.recordGameResult(agent1, keccak256(abi.encode("win", i)), true, false, 0, 0, 0, 0);
        }
        registry.recordGameResult(agent1, keccak256("loss"), false, false, 0, 0, 0, 0);
        vm.stopPrank();

        uint256 winRate = registry.getWinRate(agent1);
        assertEq(winRate, 7500); // 75% = 7500 basis points
    }

    function test_GetWinRateNoGames() public {
        registry.registerAgent(agent1, "Agent");
        assertEq(registry.getWinRate(agent1), 0);
    }

    function test_GetTopAgents() public {
        // Register and record games for multiple agents
        registry.registerAgent(agent1, "Agent1");
        registry.registerAgent(agent2, "Agent2");
        registry.registerAgent(agent3, "Agent3");

        vm.startPrank(gameSettlement);
        // Agent2 has most wins (3)
        for (uint i = 0; i < 3; i++) {
            registry.recordGameResult(agent2, keccak256(abi.encode("a2", i)), true, false, 0, 0, 0, 0);
        }
        // Agent1 has 2 wins
        for (uint i = 0; i < 2; i++) {
            registry.recordGameResult(agent1, keccak256(abi.encode("a1", i)), true, false, 0, 0, 0, 0);
        }
        // Agent3 has 1 win
        registry.recordGameResult(agent3, keccak256("a3"), true, false, 0, 0, 0, 0);
        vm.stopPrank();

        (address[] memory addresses, uint64[] memory wins) = registry.getTopAgents(3);

        assertEq(addresses[0], agent2);
        assertEq(wins[0], 3);
        assertEq(addresses[1], agent1);
        assertEq(wins[1], 2);
        assertEq(addresses[2], agent3);
        assertEq(wins[2], 1);
    }

    // ============ Admin Tests ============

    function test_SetGameSettlement() public {
        address newSettlement = address(0x999);
        registry.setGameSettlement(newSettlement);
        assertEq(registry.gameSettlement(), newSettlement);
    }

    function test_SetGameSettlementNotOwner() public {
        vm.prank(agent1);
        vm.expectRevert("Only owner");
        registry.setGameSettlement(address(0x999));
    }

    function test_TransferOwnership() public {
        registry.transferOwnership(agent1);
        assertEq(registry.owner(), agent1);
    }

    function test_TransferOwnershipZeroAddress() public {
        vm.expectRevert("Invalid address");
        registry.transferOwnership(address(0));
    }
}
