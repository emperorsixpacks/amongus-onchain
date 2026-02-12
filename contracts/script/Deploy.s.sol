// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/AgentRegistry.sol";
import "../src/WagerVault.sol";
import "../src/GameSettlement.sol";
import "../test/MockERC20.sol";

/**
 * @title DeployTestnet
 * @notice Full deployment including test token for Monad Testnet
 * @dev Run with: forge script script/Deploy.s.sol:DeployTestnet --rpc-url $MONAD_RPC_URL --broadcast
 */
contract DeployTestnet is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        console.log("Deploying Among Us On-Chain to Monad Testnet...");
        console.log("Deployer:", vm.addr(deployerPrivateKey));

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Mock Token (for testnet wagers)
        MockERC20 mockToken = new MockERC20();
        console.log("MockERC20 (mMONAD):", address(mockToken));

        // 2. Deploy AgentRegistry
        AgentRegistry agentRegistry = new AgentRegistry();
        console.log("AgentRegistry:", address(agentRegistry));

        // 3. Deploy WagerVault with mock token
        WagerVault wagerVault = new WagerVault(address(agentRegistry), address(mockToken));
        console.log("WagerVault:", address(wagerVault));

        // 4. Deploy GameSettlement
        GameSettlement gameSettlement = new GameSettlement(
            address(wagerVault),
            address(agentRegistry)
        );
        console.log("GameSettlement:", address(gameSettlement));

        // 5. Connect contracts
        wagerVault.setGameSettlement(address(gameSettlement));
        agentRegistry.setGameSettlement(address(gameSettlement));
        agentRegistry.setWagerVault(address(wagerVault));

        // 6. Set wager amount to 0.1 tokens (matching server default)
        wagerVault.setWagerAmount(100000000000000000); // 0.1 * 10^18

        console.log("\n========================================");
        console.log("=== DEPLOYMENT COMPLETE ===");
        console.log("========================================");
        console.log("MockERC20 (mMONAD):", address(mockToken));
        console.log("AgentRegistry:", address(agentRegistry));
        console.log("WagerVault:", address(wagerVault));
        console.log("GameSettlement:", address(gameSettlement));
        console.log("\n=== Add to server/.env ===");
        console.log("MONAD_TOKEN_ADDRESS=", address(mockToken));
        console.log("AGENT_REGISTRY_ADDRESS=", address(agentRegistry));
        console.log("WAGER_VAULT_ADDRESS=", address(wagerVault));
        console.log("GAME_SETTLEMENT_ADDRESS=", address(gameSettlement));

        vm.stopBroadcast();
    }
}

/**
 * @title Deploy
 * @notice Deployment script for Among Us On-Chain contracts (requires existing token)
 * @dev Run with: forge script script/Deploy.s.sol:Deploy --rpc-url $MONAD_RPC_URL --broadcast
 */
contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address monadToken = vm.envAddress("MONAD_TOKEN_ADDRESS");

        console.log("Deploying Among Us On-Chain to Monad Testnet...");
        console.log("Monad Token:", monadToken);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy AgentRegistry
        AgentRegistry agentRegistry = new AgentRegistry();
        console.log("AgentRegistry:", address(agentRegistry));

        // 2. Deploy WagerVault with Monad token
        WagerVault wagerVault = new WagerVault(address(agentRegistry), monadToken);
        console.log("WagerVault:", address(wagerVault));

        // 3. Deploy GameSettlement
        GameSettlement gameSettlement = new GameSettlement(
            address(wagerVault),
            address(agentRegistry)
        );
        console.log("GameSettlement:", address(gameSettlement));

        // 4. Connect contracts
        wagerVault.setGameSettlement(address(gameSettlement));
        agentRegistry.setGameSettlement(address(gameSettlement));
        agentRegistry.setWagerVault(address(wagerVault));

        console.log("\n=== Deployment Complete ===");
        console.log("AgentRegistry:", address(agentRegistry));
        console.log("WagerVault:", address(wagerVault));
        console.log("GameSettlement:", address(gameSettlement));
        console.log("\nAdd to server .env:");
        console.log("AGENT_REGISTRY_ADDRESS=", address(agentRegistry));
        console.log("WAGER_VAULT_ADDRESS=", address(wagerVault));
        console.log("GAME_SETTLEMENT_ADDRESS=", address(gameSettlement));

        vm.stopBroadcast();
    }
}

/**
 * @title SetOperator
 * @notice Set the game server as the operator
 */
contract SetOperator is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address gameSettlement = vm.envAddress("GAME_SETTLEMENT_ADDRESS");
        address operator = vm.envAddress("OPERATOR_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        GameSettlement(gameSettlement).setOperator(operator);
        console.log("Operator set to:", operator);

        vm.stopBroadcast();
    }
}

/**
 * @title SetWagerAmount
 * @notice Update the wager amount
 */
contract SetWagerAmount is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address wagerVault = vm.envAddress("WAGER_VAULT_ADDRESS");
        uint256 amount = vm.envUint("WAGER_AMOUNT");

        vm.startBroadcast(deployerPrivateKey);

        WagerVault(payable(wagerVault)).setWagerAmount(amount);
        console.log("Wager amount set to:", amount);

        vm.stopBroadcast();
    }
}
