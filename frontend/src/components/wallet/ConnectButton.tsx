"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { motion } from "framer-motion";
import { usePrivyEnabled } from "@/components/layout/Providers";

export function ConnectButton() {
  const privyEnabled = usePrivyEnabled();

  if (privyEnabled) {
    return <PrivyConnectButton />;
  }

  return <WagmiConnectButton />;
}

function PrivyConnectButton() {
  const { ready, authenticated, user, login, logout } = usePrivy();

  const truncateAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // Get the wallet address from Privy user
  const walletAddress = user?.wallet?.address;

  if (!ready) {
    return (
      <div className="px-4 py-2 bg-gray-600/80 rounded-lg border border-gray-400 text-white font-bold">
        Loading...
      </div>
    );
  }

  if (authenticated && walletAddress) {
    return (
      <div className="flex items-center gap-3 bg-gray-800/60 backdrop-blur-sm rounded-xl px-2 py-2 border border-gray-700/50">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-white font-mono text-sm">
            {truncateAddress(walletAddress)}
          </span>
        </div>
        <motion.button
          className="px-3 py-1.5 bg-gray-700/80 rounded-lg text-gray-300 text-sm font-medium hover:bg-red-600/80 hover:text-white transition-all duration-200"
          onClick={() => logout()}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          Disconnect
        </motion.button>
      </div>
    );
  }

  return (
    <motion.button
      className="px-4 py-2 bg-blue-600/80 rounded-lg border border-blue-400 text-white font-bold hover:bg-blue-500/80 transition-colors"
      onClick={login}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      Connect Wallet
    </motion.button>
  );
}

function WagmiConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const truncateAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-3 bg-gray-800/60 backdrop-blur-sm rounded-xl px-2 py-2 border border-gray-700/50">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-white font-mono text-sm">
            {truncateAddress(address)}
          </span>
        </div>
        <motion.button
          className="px-3 py-1.5 bg-gray-700/80 rounded-lg text-gray-300 text-sm font-medium hover:bg-red-600/80 hover:text-white transition-all duration-200"
          onClick={() => disconnect()}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          Disconnect
        </motion.button>
      </div>
    );
  }

  return (
    <motion.button
      className="px-4 py-2 bg-blue-600/80 rounded-lg border border-blue-400 text-white font-bold hover:bg-blue-500/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      onClick={() => {
        const injectedConnector = connectors.find((c) => c.id === "injected");
        if (injectedConnector) {
          connect({ connector: injectedConnector });
        }
      }}
      disabled={isPending}
      whileHover={!isPending ? { scale: 1.05 } : {}}
      whileTap={!isPending ? { scale: 0.95 } : {}}
    >
      {isPending ? "Connecting..." : "Connect Wallet"}
    </motion.button>
  );
}
