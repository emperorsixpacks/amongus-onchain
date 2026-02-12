// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentRegistry
 * @notice On-chain registry tracking AI agent statistics for Among Us on Monad
 * @dev Stores agent performance data including wins, losses, kills, and tasks
 */
contract AgentRegistry {
    // ============ Structs ============

    struct AgentStats {
        string name;
        uint64 gamesPlayed;
        uint64 wins;
        uint64 losses;
        uint64 kills;
        uint64 deaths;
        uint64 tasksCompleted;
        uint64 timesImpostor;
        uint64 timesCrewmate;
        uint128 totalEarnings;
        uint128 totalLost;
        uint64 registeredAt;
        uint64 lastPlayedAt;
    }

    // ============ State Variables ============

    address public owner;
    address public gameSettlement;
    address public wagerVault;

    mapping(address => AgentStats) public agents;
    mapping(address => bool) public isRegistered;
    address[] public allAgents;

    uint256 public totalGamesPlayed;

    // ============ Events ============

    event AgentRegistered(address indexed agent, string name);
    event StatsUpdated(address indexed agent, uint64 gamesPlayed, uint64 wins);
    event GameRecorded(address indexed agent, bytes32 indexed gameId, bool won, bool wasImpostor);

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyAuthorized() {
        require(
            msg.sender == gameSettlement ||
            msg.sender == wagerVault ||
            msg.sender == owner,
            "Not authorized"
        );
        _;
    }

    // ============ Constructor ============

    constructor() {
        owner = msg.sender;
    }

    // ============ Registration ============

    /**
     * @notice Register a new agent
     */
    function registerAgent(address agent, string calldata name) external {
        if (isRegistered[agent]) return; // Already registered, skip

        string memory agentName = bytes(name).length > 0 ? name : "Agent";

        agents[agent] = AgentStats({
            name: agentName,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            kills: 0,
            deaths: 0,
            tasksCompleted: 0,
            timesImpostor: 0,
            timesCrewmate: 0,
            totalEarnings: 0,
            totalLost: 0,
            registeredAt: uint64(block.timestamp),
            lastPlayedAt: 0
        });

        isRegistered[agent] = true;
        allAgents.push(agent);

        emit AgentRegistered(agent, agentName);
    }

    /**
     * @notice Update agent name
     */
    function updateName(string calldata newName) external {
        require(isRegistered[msg.sender], "Not registered");
        require(bytes(newName).length > 0, "Name cannot be empty");
        agents[msg.sender].name = newName;
    }

    // ============ Stats Recording ============

    /**
     * @notice Record game result for an agent
     */
    function recordGameResult(
        address agent,
        bytes32 gameId,
        bool won,
        bool wasImpostor,
        uint64 kills,
        uint64 tasks,
        uint128 earnings,
        uint128 lost
    ) external onlyAuthorized {
        // Auto-register if needed
        if (!isRegistered[agent]) {
            this.registerAgent(agent, "Agent");
        }

        AgentStats storage stats = agents[agent];

        stats.gamesPlayed++;
        stats.lastPlayedAt = uint64(block.timestamp);

        if (won) {
            stats.wins++;
            stats.totalEarnings += earnings;
        } else {
            stats.losses++;
            stats.totalLost += lost;
        }

        if (wasImpostor) {
            stats.timesImpostor++;
            stats.kills += kills;
        } else {
            stats.timesCrewmate++;
            stats.tasksCompleted += tasks;
        }

        totalGamesPlayed++;

        emit GameRecorded(agent, gameId, won, wasImpostor);
        emit StatsUpdated(agent, stats.gamesPlayed, stats.wins);
    }

    /**
     * @notice Record a death
     */
    function recordDeath(address agent) external onlyAuthorized {
        if (isRegistered[agent]) {
            agents[agent].deaths++;
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get agent stats
     */
    function getAgentStats(address agent) external view returns (
        string memory name,
        uint64 gamesPlayed,
        uint64 wins,
        uint64 losses,
        uint64 kills,
        uint64 tasksCompleted
    ) {
        AgentStats memory s = agents[agent];
        return (s.name, s.gamesPlayed, s.wins, s.losses, s.kills, s.tasksCompleted);
    }

    /**
     * @notice Get win rate (basis points, 5000 = 50%)
     */
    function getWinRate(address agent) external view returns (uint256) {
        AgentStats memory stats = agents[agent];
        if (stats.gamesPlayed == 0) return 0;
        return (uint256(stats.wins) * 10000) / uint256(stats.gamesPlayed);
    }

    /**
     * @notice Get total agents
     */
    function getTotalAgents() external view returns (uint256) {
        return allAgents.length;
    }

    /**
     * @notice Get all agent addresses
     */
    function getAllAgents() external view returns (address[] memory) {
        return allAgents;
    }

    /**
     * @notice Get top agents by wins (simple version)
     */
    function getTopAgents(uint256 limit) external view returns (
        address[] memory addresses,
        uint64[] memory wins
    ) {
        uint256 count = limit < allAgents.length ? limit : allAgents.length;
        addresses = new address[](count);
        wins = new uint64[](count);

        // Copy and sort (simple bubble sort for small arrays)
        address[] memory sorted = new address[](allAgents.length);
        for (uint256 i = 0; i < allAgents.length; i++) {
            sorted[i] = allAgents[i];
        }

        for (uint256 i = 0; i < sorted.length && i < count; i++) {
            for (uint256 j = i + 1; j < sorted.length; j++) {
                if (agents[sorted[j]].wins > agents[sorted[i]].wins) {
                    address temp = sorted[i];
                    sorted[i] = sorted[j];
                    sorted[j] = temp;
                }
            }
            addresses[i] = sorted[i];
            wins[i] = agents[sorted[i]].wins;
        }

        return (addresses, wins);
    }

    // ============ Admin Functions ============

    function setGameSettlement(address _gameSettlement) external onlyOwner {
        gameSettlement = _gameSettlement;
    }

    function setWagerVault(address _wagerVault) external onlyOwner {
        wagerVault = _wagerVault;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }
}
