import { http, createConfig } from "wagmi";
import { defineChain } from "viem";
import { injected } from "wagmi/connectors";

// Define Monad Testnet
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "MON",
    symbol: "MON",
  },
  rpcUrls: {
    default: {
      http: ["https://testnet-rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
});

// Local development chain
export const localhost = defineChain({
  id: 31337,
  name: "Localhost",
  nativeCurrency: {
    decimals: 18,
    name: "ETH",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: ["http://localhost:8545"],
    },
  },
});

export const config = createConfig({
  chains: [monadTestnet, localhost],
  connectors: [
    injected(),
  ],
  transports: {
    [monadTestnet.id]: http(),
    [localhost.id]: http(),
  },
});

// Contract addresses - update after deployment
export const CONTRACT_ADDRESSES = {
  factory: process.env.NEXT_PUBLIC_FACTORY_ADDRESS as `0x${string}` || "0x0000000000000000000000000000000000000000",
};
