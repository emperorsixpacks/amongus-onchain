"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { usePrivy } from "@privy-io/react-auth";
import { usePrivyEnabled } from "@/components/layout/Providers";
import { generateOperatorKey } from "@/lib/operatorKeys";
import { api } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const STORAGE_KEY = "amongus-operator-key";

interface OperatorKeyData {
  operatorKey: string;
  walletAddress: string;
  createdAt: number;
}

export function OperatorKeyPanel() {
  const privyEnabled = usePrivyEnabled();
  const { authenticated, user, getAccessToken } = usePrivy();

  const [operatorKey, setOperatorKey] = useState<OperatorKeyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const walletAddress = user?.wallet?.address;

  // Load saved key from localStorage
  useEffect(() => {
    if (!walletAddress) return;

    const saved = localStorage.getItem(`${STORAGE_KEY}-${walletAddress.toLowerCase()}`);
    if (saved) {
      try {
        const data = JSON.parse(saved) as OperatorKeyData;
        setOperatorKey(data);
      } catch {
        localStorage.removeItem(`${STORAGE_KEY}-${walletAddress.toLowerCase()}`);
      }
    }
  }, [walletAddress]);

  // Validate key with server
  const validateKeyWithServer = useCallback(async (key: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_URL}/api/operators/me`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  // Register key with server
  const registerKeyWithServer = useCallback(async (key: string, wallet: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_URL}/api/operators`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ walletAddress: wallet }),
      });

      // 201 = created, 409 = already exists (which is fine)
      return res.status === 201 || res.status === 409;
    } catch {
      return false;
    }
  }, []);

  // Generate and register a new operator key
  const generateAndRegisterKey = useCallback(async () => {
    if (!walletAddress) return;

    setLoading(true);
    setError(null);

    try {
      // Generate a new key
      const newKey = generateOperatorKey();

      // Register with server
      const registered = await registerKeyWithServer(newKey, walletAddress);

      if (!registered) {
        throw new Error("Failed to register key with server");
      }

      // Save locally
      const keyData: OperatorKeyData = {
        operatorKey: newKey,
        walletAddress: walletAddress.toLowerCase(),
        createdAt: Date.now(),
      };

      localStorage.setItem(`${STORAGE_KEY}-${walletAddress.toLowerCase()}`, JSON.stringify(keyData));
      setOperatorKey(keyData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate key");
    } finally {
      setLoading(false);
    }
  }, [walletAddress, registerKeyWithServer]);

  // On mount: validate existing key or generate new one
  // Use a ref to prevent multiple initializations
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!walletAddress || loading || initialized) return;

    const initKey = async () => {
      setInitialized(true);
      setLoading(true);
      setError(null);

      try {
        // 1. Check if we already have a key in state (loaded from useEffect above)
        // or in localStorage directly as a fallback
        let currentKeyData = operatorKey;
        if (!currentKeyData) {
          const saved = localStorage.getItem(`${STORAGE_KEY}-${walletAddress.toLowerCase()}`);
          if (saved) {
            try {
              currentKeyData = JSON.parse(saved) as OperatorKeyData;
            } catch (e) {
              console.error("Failed to parse saved operator key:", e);
            }
          }
        }

        // 2. If we have a saved key, validate it
        if (currentKeyData) {
          console.log("Validating existing operator key from storage...");
          const isValid = await validateKeyWithServer(currentKeyData.operatorKey);
          if (isValid) {
            console.log("Existing operator key is valid.");
            setOperatorKey(currentKeyData);
            setLoading(false);
            return;
          }
          console.log("Existing operator key is invalid on server.");
        }

        // 3. Try to fetch existing key from backend using Privy auth
        console.log("Attempting to recover operator key from backend...");
        const token = await getAccessToken();
        if (token) {
          const result = await api.getActiveOperatorKey(token);
          if (result.success && result.operatorKey) {
            console.log("Successfully recovered operator key from backend.");
            const keyData: OperatorKeyData = {
              operatorKey: result.operatorKey,
              walletAddress: walletAddress.toLowerCase(),
              createdAt: result.createdAt || Date.now(),
            };
            localStorage.setItem(`${STORAGE_KEY}-${walletAddress.toLowerCase()}`, JSON.stringify(keyData));
            setOperatorKey(keyData);
            setLoading(false);
            return;
          }
        }

        // 4. No key found anywhere or existing key invalid, generate a new one
        console.log("No existing operator key found. Generating new one...");
        await generateAndRegisterKey();
      } catch (err) {
        console.error("Error during operator key initialization:", err);
        setError("Failed to initialize operator key");
      } finally {
        setLoading(false);
      }
    };

    initKey();
  }, [walletAddress, operatorKey, loading, initialized, validateKeyWithServer, registerKeyWithServer, generateAndRegisterKey, getAccessToken]);

  // Reset initialized when wallet changes
  useEffect(() => {
    setInitialized(false);
  }, [walletAddress]);

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

  const regenerateKey = async () => {
    if (!walletAddress) return;

    // Clear existing key
    localStorage.removeItem(`${STORAGE_KEY}-${walletAddress.toLowerCase()}`);
    setOperatorKey(null);

    // Generate new one
    await generateAndRegisterKey();
  };

  // Don't render if Privy is not enabled or not authenticated
  if (!privyEnabled || !authenticated || !walletAddress) {
    return null;
  }

  // Loading state
  if (loading || !operatorKey) {
    return (
      <motion.div
        className="bg-gray-800/60 backdrop-blur-sm rounded-xl px-4 py-3 border border-gray-700/50"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Generating operator key...</span>
        </div>
        {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      </motion.div>
    );
  }

  return (
    <motion.div
      className="bg-gray-800/60 backdrop-blur-sm rounded-xl px-4 py-3 border border-gray-700/50"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <svg className="w-4 h-4 text-cyan-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          <code className="text-gray-300 font-mono text-sm truncate">
            {showKey ? operatorKey.operatorKey : `oper_${"*".repeat(12)}`}
          </code>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setShowKey(!showKey)}
            className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-gray-700/50"
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
            className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-gray-700/50"
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
          <button
            onClick={regenerateKey}
            className="p-1.5 text-gray-500 hover:text-yellow-400 transition-colors rounded hover:bg-gray-700/50"
            title="Generate new key"
            disabled={loading}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
