"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { usePrivy } from "@privy-io/react-auth";
import { usePrivyEnabled } from "@/components/layout/Providers";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface OperatorKeyData {
  operatorKey: string;
  walletAddress: string;
  createdAt: number;
}

export function OperatorKeyPanel() {
  const privyEnabled = usePrivyEnabled();
  const { authenticated, user } = usePrivy();

  const [operatorKey, setOperatorKey] = useState<OperatorKeyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const walletAddress = user?.wallet?.address;

  const fetchOrCreateOperatorKey = useCallback(async () => {
    if (!walletAddress) return;

    setLoading(true);
    setError(null);

    try {
      // First try to get existing key
      let res = await fetch(`${API_URL}/api/operators/${walletAddress}`);

      if (res.status === 404) {
        // Create new key
        res = await fetch(`${API_URL}/api/operators`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress }),
        });
      }

      if (!res.ok) {
        throw new Error(`Failed to get operator key: ${res.statusText}`);
      }

      const data = await res.json();
      setOperatorKey(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get operator key");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  // Fetch operator key when wallet connects
  useEffect(() => {
    if (privyEnabled && authenticated && walletAddress) {
      fetchOrCreateOperatorKey();
    }
  }, [privyEnabled, authenticated, walletAddress, fetchOrCreateOperatorKey]);

  const copyToClipboard = async () => {
    if (!operatorKey) return;

    try {
      await navigator.clipboard.writeText(operatorKey.operatorKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Failed to copy to clipboard");
    }
  };

  // Don't render if Privy is not enabled or not authenticated
  if (!privyEnabled || !authenticated || !walletAddress) {
    return null;
  }

  return (
    <motion.div
      className="bg-gray-900/90 rounded-lg p-4 border border-gray-700"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <h3 className="text-cyan-400 font-bold text-sm mb-3 uppercase tracking-wider">
        Your Operator Key
      </h3>

      {loading && (
        <div className="text-gray-400 text-sm animate-pulse">
          Loading...
        </div>
      )}

      {error && (
        <div className="text-red-400 text-sm mb-2">
          {error}
          <button
            onClick={fetchOrCreateOperatorKey}
            className="ml-2 text-cyan-400 underline hover:text-cyan-300"
          >
            Retry
          </button>
        </div>
      )}

      {operatorKey && (
        <div className="space-y-3">
          {/* Key display */}
          <div className="bg-gray-800/50 rounded p-3">
            <div className="flex items-center justify-between gap-2">
              <code className="text-green-400 font-mono text-sm flex-1 break-all">
                {showKey
                  ? operatorKey.operatorKey
                  : `oper_${"*".repeat(16)}`}
              </code>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="p-1.5 text-gray-400 hover:text-white transition-colors"
                  title={showKey ? "Hide key" : "Show key"}
                >
                  {showKey ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={copyToClipboard}
                  className="p-1.5 text-gray-400 hover:text-white transition-colors"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Info */}
          <p className="text-gray-400 text-xs">
            Use this key to link AI agents to your wallet. Keep it secret!
          </p>

          {/* Created date */}
          <div className="text-gray-500 text-xs">
            Created: {new Date(operatorKey.createdAt).toLocaleDateString()}
          </div>
        </div>
      )}
    </motion.div>
  );
}
