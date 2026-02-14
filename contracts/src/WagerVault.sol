// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentRegistry.sol";

/**
 * @title WagerVault
 * @notice Escrow contract for Among Us on-chain game wagers using native MON
 * @dev Holds native MON deposits, manages game wagers, and distributes winnings
 */
contract WagerVault {
    // ============ State Variables ============

    address public owner;
    address public gameSettlement;
    AgentRegistry public agentRegistry;

    uint256 public wagerAmount = 10 * 10**18; // Default: 10 MON
    uint256 public protocolFeePercent = 5; // 5% protocol fee

    // Agent balances (deposited funds)
    mapping(address => uint256) public balances;

    // Game wager tracking
    struct GameWager {
        uint256 totalPot;
        address[] players;
        mapping(address => bool) hasWagered;
        bool settled;
        bool refunded;
    }

    mapping(bytes32 => GameWager) private gameWagers;

    // ============ Events ============

    event Deposited(address indexed agent, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed agent, uint256 amount, uint256 newBalance);
    event WagerPlaced(bytes32 indexed gameId, address indexed agent, uint256 amount);
    event GameSettled(bytes32 indexed gameId, address[] winners, uint256 winningsPerPlayer, uint256 protocolFee);
    event GameRefunded(bytes32 indexed gameId, uint256 playersRefunded);
    event WagerAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event ProtocolFeeUpdated(uint256 oldFee, uint256 newFee);

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlySettlement() {
        require(msg.sender == gameSettlement, "Only settlement contract");
        _;
    }

    // ============ Constructor ============

    constructor(address _agentRegistry) {
        owner = msg.sender;
        agentRegistry = AgentRegistry(_agentRegistry);
    }

    // ============ Deposit & Withdraw ============

    /**
     * @notice Deposit native MON to your balance
     * @dev Send MON with the transaction
     */
    function deposit() external payable {
        require(msg.value > 0, "Must deposit something");

        balances[msg.sender] += msg.value;

        // Register agent if not already registered
        if (!agentRegistry.isRegistered(msg.sender)) {
            agentRegistry.registerAgent(msg.sender, "");
        }

        emit Deposited(msg.sender, msg.value, balances[msg.sender]);
    }

    /**
     * @notice Withdraw native MON from your balance
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, amount, balances[msg.sender]);
    }

    /**
     * @notice Get balance for an agent
     */
    function getBalance(address agent) external view returns (uint256) {
        return balances[agent];
    }

    // ============ Wager Management ============

    /**
     * @notice Place a wager to join a game
     * @param gameId Unique game identifier
     */
    function placeWager(bytes32 gameId) external {
        require(balances[msg.sender] >= wagerAmount, "Insufficient balance for wager");
        require(!gameWagers[gameId].hasWagered[msg.sender], "Already wagered");
        require(!gameWagers[gameId].settled, "Game already settled");
        require(!gameWagers[gameId].refunded, "Game was refunded");

        balances[msg.sender] -= wagerAmount;
        gameWagers[gameId].totalPot += wagerAmount;
        gameWagers[gameId].players.push(msg.sender);
        gameWagers[gameId].hasWagered[msg.sender] = true;

        emit WagerPlaced(gameId, msg.sender, wagerAmount);
    }

    /**
     * @notice Check if agent has wagered for a game
     */
    function hasWagered(bytes32 gameId, address agent) external view returns (bool) {
        return gameWagers[gameId].hasWagered[agent];
    }

    /**
     * @notice Get game pot size
     */
    function getGamePot(bytes32 gameId) external view returns (uint256) {
        return gameWagers[gameId].totalPot;
    }

    /**
     * @notice Get players in a game
     */
    function getGamePlayers(bytes32 gameId) external view returns (address[] memory) {
        return gameWagers[gameId].players;
    }

    /**
     * @notice Check if game is settled
     */
    function isGameSettled(bytes32 gameId) external view returns (bool) {
        return gameWagers[gameId].settled;
    }

    /**
     * @notice Check if game is refunded
     */
    function isGameRefunded(bytes32 gameId) external view returns (bool) {
        return gameWagers[gameId].refunded;
    }

    // ============ Settlement (Called by GameSettlement) ============

    /**
     * @notice Settle a game and distribute winnings
     * @param gameId Game identifier
     * @param winners Array of winner addresses
     */
    function settleGame(bytes32 gameId, address[] calldata winners) external onlySettlement {
        GameWager storage game = gameWagers[gameId];
        require(!game.settled, "Already settled");
        require(!game.refunded, "Game was refunded");
        require(game.totalPot > 0, "No pot to settle");
        require(winners.length > 0, "Must have winners");

        game.settled = true;

        // Calculate protocol fee
        uint256 protocolFee = (game.totalPot * protocolFeePercent) / 100;
        uint256 distributablePot = game.totalPot - protocolFee;
        uint256 winningsPerPlayer = distributablePot / winners.length;

        // Distribute to winners
        for (uint256 i = 0; i < winners.length; i++) {
            balances[winners[i]] += winningsPerPlayer;
        }

        // Protocol fee stays in contract (owner can withdraw)
        balances[owner] += protocolFee;

        emit GameSettled(gameId, winners, winningsPerPlayer, protocolFee);
    }

    /**
     * @notice Refund all players in a cancelled game
     * @param gameId Game identifier
     */
    function refundGame(bytes32 gameId) external onlySettlement {
        GameWager storage game = gameWagers[gameId];
        require(!game.settled, "Already settled");
        require(!game.refunded, "Already refunded");

        game.refunded = true;

        // Refund all players
        uint256 playerCount = game.players.length;
        for (uint256 i = 0; i < playerCount; i++) {
            balances[game.players[i]] += wagerAmount;
        }

        emit GameRefunded(gameId, playerCount);
    }

    // ============ Admin Functions ============

    /**
     * @notice Set the game settlement contract address
     */
    function setGameSettlement(address _gameSettlement) external onlyOwner {
        gameSettlement = _gameSettlement;
    }

    /**
     * @notice Update the wager amount
     */
    function setWagerAmount(uint256 _wagerAmount) external onlyOwner {
        emit WagerAmountUpdated(wagerAmount, _wagerAmount);
        wagerAmount = _wagerAmount;
    }

    /**
     * @notice Update the protocol fee percentage
     */
    function setProtocolFee(uint256 _feePercent) external onlyOwner {
        require(_feePercent <= 20, "Fee too high"); // Max 20%
        emit ProtocolFeeUpdated(protocolFeePercent, _feePercent);
        protocolFeePercent = _feePercent;
    }

    /**
     * @notice Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }

    /**
     * @notice Emergency withdraw protocol fees (owner only)
     */
    function withdrawProtocolFees() external onlyOwner {
        uint256 ownerBalance = balances[owner];
        require(ownerBalance > 0, "No fees to withdraw");
        balances[owner] = 0;

        (bool success, ) = payable(owner).call{value: ownerBalance}("");
        require(success, "Transfer failed");
    }

    /**
     * @notice Get contract's total MON balance
     */
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Allow contract to receive MON
     */
    receive() external payable {
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value, balances[msg.sender]);
    }
}
