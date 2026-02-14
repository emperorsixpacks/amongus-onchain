// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/WagerVault.sol";
import "../src/AgentRegistry.sol";

contract WagerVaultTest is Test {
    WagerVault public vault;
    AgentRegistry public registry;

    address public owner = address(this);
    address public gameSettlement = address(0x100);
    address public agent1 = address(0x1);
    address public agent2 = address(0x2);
    address public agent3 = address(0x3);

    uint256 public constant INITIAL_BALANCE = 1000 ether;
    uint256 public constant WAGER_AMOUNT = 10 ether;

    function setUp() public {
        registry = new AgentRegistry();
        vault = new WagerVault(address(registry));

        vault.setGameSettlement(gameSettlement);
        registry.setWagerVault(address(vault));

        // Fund agents with native MON
        vm.deal(agent1, INITIAL_BALANCE);
        vm.deal(agent2, INITIAL_BALANCE);
        vm.deal(agent3, INITIAL_BALANCE);
    }

    // ============ Deposit Tests ============

    function test_Deposit() public {
        uint256 depositAmount = 100 ether;

        vm.prank(agent1);
        vault.deposit{value: depositAmount}();

        assertEq(vault.getBalance(agent1), depositAmount);
        assertEq(address(vault).balance, depositAmount);
    }

    function test_DepositRegistersAgent() public {
        assertFalse(registry.isRegistered(agent1));

        vm.prank(agent1);
        vault.deposit{value: 100 ether}();

        assertTrue(registry.isRegistered(agent1));
    }

    function test_DepositZeroAmount() public {
        vm.prank(agent1);
        vm.expectRevert("Must deposit something");
        vault.deposit{value: 0}();
    }

    function test_DepositMultiple() public {
        vm.startPrank(agent1);
        vault.deposit{value: 50 ether}();
        vault.deposit{value: 30 ether}();
        vm.stopPrank();

        assertEq(vault.getBalance(agent1), 80 ether);
    }

    function test_DepositViaReceive() public {
        vm.prank(agent1);
        (bool success,) = address(vault).call{value: 100 ether}("");
        assertTrue(success);
        assertEq(vault.getBalance(agent1), 100 ether);
    }

    // ============ Withdraw Tests ============

    function test_Withdraw() public {
        uint256 depositAmount = 100 ether;
        uint256 withdrawAmount = 40 ether;

        vm.startPrank(agent1);
        vault.deposit{value: depositAmount}();
        uint256 balanceBefore = agent1.balance;
        vault.withdraw(withdrawAmount);
        vm.stopPrank();

        assertEq(vault.getBalance(agent1), depositAmount - withdrawAmount);
        assertEq(agent1.balance, balanceBefore + withdrawAmount);
    }

    function test_WithdrawInsufficientBalance() public {
        vm.startPrank(agent1);
        vault.deposit{value: 50 ether}();

        vm.expectRevert("Insufficient balance");
        vault.withdraw(100 ether);
        vm.stopPrank();
    }

    function test_WithdrawAll() public {
        uint256 depositAmount = 100 ether;

        vm.startPrank(agent1);
        vault.deposit{value: depositAmount}();
        vault.withdraw(depositAmount);
        vm.stopPrank();

        assertEq(vault.getBalance(agent1), 0);
    }

    // ============ Wager Tests ============

    function test_PlaceWager() public {
        bytes32 gameId = keccak256("game1");

        vm.startPrank(agent1);
        vault.deposit{value: 100 ether}();
        vault.placeWager(gameId);
        vm.stopPrank();

        assertTrue(vault.hasWagered(gameId, agent1));
        assertEq(vault.getBalance(agent1), 100 ether - WAGER_AMOUNT);
        assertEq(vault.getGamePot(gameId), WAGER_AMOUNT);
    }

    function test_PlaceWagerInsufficientBalance() public {
        bytes32 gameId = keccak256("game1");

        vm.startPrank(agent1);
        vault.deposit{value: 5 ether}(); // Less than wager amount

        vm.expectRevert("Insufficient balance for wager");
        vault.placeWager(gameId);
        vm.stopPrank();
    }

    function test_PlaceWagerTwice() public {
        bytes32 gameId = keccak256("game1");

        vm.startPrank(agent1);
        vault.deposit{value: 100 ether}();
        vault.placeWager(gameId);

        vm.expectRevert("Already wagered");
        vault.placeWager(gameId);
        vm.stopPrank();
    }

    function test_MultiplePlayersWager() public {
        bytes32 gameId = keccak256("game1");

        vm.prank(agent1);
        vault.deposit{value: 100 ether}();
        vm.prank(agent2);
        vault.deposit{value: 100 ether}();
        vm.prank(agent3);
        vault.deposit{value: 100 ether}();

        vm.prank(agent1);
        vault.placeWager(gameId);
        vm.prank(agent2);
        vault.placeWager(gameId);
        vm.prank(agent3);
        vault.placeWager(gameId);

        assertEq(vault.getGamePot(gameId), WAGER_AMOUNT * 3);

        address[] memory players = vault.getGamePlayers(gameId);
        assertEq(players.length, 3);
    }

    // ============ Settlement Tests ============

    function test_SettleGame() public {
        bytes32 gameId = keccak256("game1");

        // Setup: 3 players wager
        vm.prank(agent1);
        vault.deposit{value: 100 ether}();
        vm.prank(agent2);
        vault.deposit{value: 100 ether}();
        vm.prank(agent3);
        vault.deposit{value: 100 ether}();

        vm.prank(agent1);
        vault.placeWager(gameId);
        vm.prank(agent2);
        vault.placeWager(gameId);
        vm.prank(agent3);
        vault.placeWager(gameId);

        uint256 totalPot = WAGER_AMOUNT * 3; // 30 ether
        uint256 protocolFee = totalPot * 5 / 100; // 1.5 ether
        uint256 winningsPerPlayer = (totalPot - protocolFee) / 2; // 14.25 ether each

        // Settle: agent1 and agent2 win
        address[] memory winners = new address[](2);
        winners[0] = agent1;
        winners[1] = agent2;

        uint256 agent1BalanceBefore = vault.getBalance(agent1);
        uint256 agent2BalanceBefore = vault.getBalance(agent2);

        vm.prank(gameSettlement);
        vault.settleGame(gameId, winners);

        assertTrue(vault.isGameSettled(gameId));
        assertEq(vault.getBalance(agent1), agent1BalanceBefore + winningsPerPlayer);
        assertEq(vault.getBalance(agent2), agent2BalanceBefore + winningsPerPlayer);
        assertEq(vault.getBalance(owner), protocolFee); // Protocol fee to owner
    }

    function test_SettleGameAlreadySettled() public {
        bytes32 gameId = keccak256("game1");

        vm.prank(agent1);
        vault.deposit{value: 100 ether}();
        vm.prank(agent1);
        vault.placeWager(gameId);

        address[] memory winners = new address[](1);
        winners[0] = agent1;

        vm.prank(gameSettlement);
        vault.settleGame(gameId, winners);

        vm.prank(gameSettlement);
        vm.expectRevert("Already settled");
        vault.settleGame(gameId, winners);
    }

    function test_SettleGameUnauthorized() public {
        bytes32 gameId = keccak256("game1");

        vm.prank(agent1);
        vault.deposit{value: 100 ether}();
        vm.prank(agent1);
        vault.placeWager(gameId);

        address[] memory winners = new address[](1);
        winners[0] = agent1;

        vm.prank(agent1); // Not authorized
        vm.expectRevert("Only settlement contract");
        vault.settleGame(gameId, winners);
    }

    // ============ Refund Tests ============

    function test_RefundGame() public {
        bytes32 gameId = keccak256("game1");

        vm.prank(agent1);
        vault.deposit{value: 100 ether}();
        vm.prank(agent2);
        vault.deposit{value: 100 ether}();

        uint256 agent1BalanceAfterDeposit = vault.getBalance(agent1);
        uint256 agent2BalanceAfterDeposit = vault.getBalance(agent2);

        vm.prank(agent1);
        vault.placeWager(gameId);
        vm.prank(agent2);
        vault.placeWager(gameId);

        // Refund the game
        vm.prank(gameSettlement);
        vault.refundGame(gameId);

        assertTrue(vault.isGameRefunded(gameId));
        assertEq(vault.getBalance(agent1), agent1BalanceAfterDeposit);
        assertEq(vault.getBalance(agent2), agent2BalanceAfterDeposit);
    }

    function test_RefundGameAlreadySettled() public {
        bytes32 gameId = keccak256("game1");

        vm.prank(agent1);
        vault.deposit{value: 100 ether}();
        vm.prank(agent1);
        vault.placeWager(gameId);

        address[] memory winners = new address[](1);
        winners[0] = agent1;

        vm.prank(gameSettlement);
        vault.settleGame(gameId, winners);

        vm.prank(gameSettlement);
        vm.expectRevert("Already settled");
        vault.refundGame(gameId);
    }

    // ============ Admin Tests ============

    function test_SetWagerAmount() public {
        uint256 newAmount = 20 ether;
        vault.setWagerAmount(newAmount);
        assertEq(vault.wagerAmount(), newAmount);
    }

    function test_SetProtocolFee() public {
        vault.setProtocolFee(10);
        assertEq(vault.protocolFeePercent(), 10);
    }

    function test_SetProtocolFeeTooHigh() public {
        vm.expectRevert("Fee too high");
        vault.setProtocolFee(25);
    }

    function test_WithdrawProtocolFees() public {
        bytes32 gameId = keccak256("game1");

        // Create a game and settle to generate fees
        vm.prank(agent1);
        vault.deposit{value: 100 ether}();
        vm.prank(agent1);
        vault.placeWager(gameId);

        address[] memory winners = new address[](1);
        winners[0] = agent1;

        vm.prank(gameSettlement);
        vault.settleGame(gameId, winners);

        uint256 ownerFees = vault.getBalance(owner);
        assertTrue(ownerFees > 0);

        uint256 ownerBalanceBefore = owner.balance;
        vault.withdrawProtocolFees();

        assertEq(vault.getBalance(owner), 0);
        assertEq(owner.balance, ownerBalanceBefore + ownerFees);
    }

    function test_GetContractBalance() public {
        vm.prank(agent1);
        vault.deposit{value: 100 ether}();

        assertEq(vault.getContractBalance(), 100 ether);
    }

    // Allow this contract to receive MON
    receive() external payable {}
}
