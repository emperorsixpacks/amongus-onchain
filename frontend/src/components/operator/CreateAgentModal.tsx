"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import {
  createOperatorKeyEntry,
  saveOperatorKey,
  type OperatorKey,
} from "@/lib/operatorKeys";
import { usePrivyEnabled } from "@/components/layout/Providers";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface CreateAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAgentCreated?: (entry: OperatorKey) => void;
}

export function CreateAgentModal({
  isOpen,
  onClose,
  onAgentCreated,
}: CreateAgentModalProps) {
  const privyEnabled = usePrivyEnabled();
  const { user } = usePrivy();
  const { address: wagmiAddress } = useAccount();

  // Get address from Privy or wagmi depending on which is enabled
  const address = privyEnabled ? user?.wallet?.address as `0x${string}` | undefined : wagmiAddress;
  const [createdAgent, setCreatedAgent] = useState<OperatorKey | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!address) return;

    setLoading(true);
    setError(null);

    try {
      const entry = createOperatorKeyEntry(address);

      // Register the operator key with the server
      const res = await fetch(`${API_URL}/api/operators`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${entry.key}`,
        },
        body: JSON.stringify({ walletAddress: address }),
      });

      if (!res.ok && res.status !== 409) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to register operator key");
      }

      saveOperatorKey(entry);
      setCreatedAgent(entry);
      onAgentCreated?.(entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleClose = () => {
    setCreatedAgent(null);
    setCopied(null);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <motion.div
            className="bg-gray-900 rounded-xl border border-gray-700 p-6 max-w-lg w-full"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            {!createdAgent ? (
              <>
                <h2 className="text-2xl font-bold text-white mb-4">
                  Create New Agent
                </h2>
                <p className="text-gray-400 mb-6">
                  This will generate a new agent wallet and operator key. The operator
                  key allows you to control the agent and withdraw funds to your
                  connected wallet.
                </p>

                {!address ? (
                  <p className="text-yellow-400 mb-4">
                    Please connect your wallet first.
                  </p>
                ) : (
                  <div className="bg-gray-800 rounded-lg p-4 mb-6">
                    <p className="text-sm text-gray-400">Operator Wallet</p>
                    <p className="text-white font-mono text-sm break-all">
                      {address}
                    </p>
                  </div>
                )}

                {error && (
                  <p className="text-red-400 text-sm mb-4">{error}</p>
                )}

                <div className="flex gap-3">
                  <button
                    className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50"
                    onClick={handleClose}
                    disabled={loading}
                  >
                    Cancel
                  </button>
                  <button
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleCreate}
                    disabled={!address || loading}
                  >
                    {loading ? "Creating..." : "Create Agent"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-green-400 mb-4">
                  Agent Created!
                </h2>
                <p className="text-gray-400 mb-4">
                  Save these credentials securely. The private key will not be shown
                  again after closing this modal.
                </p>

                <div className="space-y-4">
                  <div className="bg-gray-800 rounded-lg p-4">
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-sm text-gray-400">Operator Key</p>
                      <button
                        className="text-xs text-blue-400 hover:text-blue-300"
                        onClick={() => handleCopy(createdAgent.key, "key")}
                      >
                        {copied === "key" ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <p className="text-white font-mono text-sm break-all">
                      {createdAgent.key}
                    </p>
                  </div>

                  <div className="bg-gray-800 rounded-lg p-4">
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-sm text-gray-400">Agent Wallet Address</p>
                      <button
                        className="text-xs text-blue-400 hover:text-blue-300"
                        onClick={() => handleCopy(createdAgent.agentAddress, "address")}
                      >
                        {copied === "address" ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <p className="text-white font-mono text-sm break-all">
                      {createdAgent.agentAddress}
                    </p>
                  </div>

                  <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-sm text-red-400">
                        Agent Private Key (SAVE THIS!)
                      </p>
                      <button
                        className="text-xs text-blue-400 hover:text-blue-300"
                        onClick={() =>
                          handleCopy(createdAgent.agentPrivateKey, "privateKey")
                        }
                      >
                        {copied === "privateKey" ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <p className="text-white font-mono text-xs break-all">
                      {createdAgent.agentPrivateKey}
                    </p>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-yellow-900/30 border border-yellow-700 rounded-lg">
                  <p className="text-yellow-400 text-sm">
                    <strong>Important:</strong> Use these values when configuring your
                    agent:
                  </p>
                  <ul className="text-yellow-400/80 text-sm mt-2 list-disc list-inside">
                    <li>
                      Set <code className="bg-gray-800 px-1">OPERATOR_KEY</code> to the
                      operator key
                    </li>
                    <li>
                      Set <code className="bg-gray-800 px-1">AGENT_PRIVATE_KEY</code> to
                      the agent private key
                    </li>
                  </ul>
                </div>

                <button
                  className="w-full mt-6 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
                  onClick={handleClose}
                >
                  Done
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
