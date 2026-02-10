import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export interface OperatorKey {
  key: string;
  operatorAddress: string;
  agentAddress: string;
  agentPrivateKey: string;
  createdAt: number;
}

const STORAGE_KEY = "operator_keys";

/**
 * Generate a random alphanumeric string
 */
function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

/**
 * Generate a new operator key with the format oper_XXXXXXXXXXXXXXXX
 */
export function generateOperatorKey(): string {
  return `oper_${randomString(16)}`;
}

/**
 * Create a new agent wallet using viem
 */
export function createAgentWallet(): { address: `0x${string}`; privateKey: `0x${string}` } {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    privateKey: privateKey,
  };
}

/**
 * Create a new operator key entry linking an operator to a new agent wallet
 */
export function createOperatorKeyEntry(operatorAddress: string): OperatorKey {
  const wallet = createAgentWallet();
  const key = generateOperatorKey();

  const entry: OperatorKey = {
    key,
    operatorAddress: operatorAddress.toLowerCase(),
    agentAddress: wallet.address.toLowerCase(),
    agentPrivateKey: wallet.privateKey,
    createdAt: Date.now(),
  };

  return entry;
}

/**
 * Save an operator key to localStorage
 */
export function saveOperatorKey(entry: OperatorKey): void {
  const existing = getOperatorKeys();
  existing.push(entry);
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  }
}

/**
 * Get all operator keys from localStorage
 */
export function getOperatorKeys(): OperatorKey[] {
  if (typeof window === "undefined") {
    return [];
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return [];
  }
  try {
    return JSON.parse(stored) as OperatorKey[];
  } catch {
    return [];
  }
}

/**
 * Get operator keys for a specific operator address
 */
export function getOperatorKeysForAddress(operatorAddress: string): OperatorKey[] {
  return getOperatorKeys().filter(
    (k) => k.operatorAddress.toLowerCase() === operatorAddress.toLowerCase()
  );
}

/**
 * Find an operator key entry by key
 */
export function findOperatorKey(key: string): OperatorKey | undefined {
  return getOperatorKeys().find((k) => k.key === key);
}

/**
 * Delete an operator key
 */
export function deleteOperatorKey(key: string): boolean {
  const keys = getOperatorKeys();
  const filtered = keys.filter((k) => k.key !== key);
  if (filtered.length !== keys.length) {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    }
    return true;
  }
  return false;
}

/**
 * Validate operator key format
 */
export function isValidOperatorKey(key: string): boolean {
  return /^oper_[A-Za-z0-9]{16}$/.test(key);
}
