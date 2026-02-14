import { http, createConfig } from "wagmi";
import { defineChain } from "viem";
import { injected } from "wagmi/connectors";

// Define Monad Mainnet
export const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: {
    decimals: 18,
    name: "MON",
    symbol: "MON",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://monad.socialscan.io" },
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
  chains: [monadMainnet, localhost],
  connectors: [
    injected(),
  ],
  transports: {
    [monadMainnet.id]: http(),
    [localhost.id]: http(),
  },
});

// Contract addresses - update after deployment
export const CONTRACT_ADDRESSES = {
  factory: process.env.NEXT_PUBLIC_FACTORY_ADDRESS as `0x${string}` || "0x0000000000000000000000000000000000000000",
};
