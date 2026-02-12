"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { PrivyProvider } from "@privy-io/react-auth";
import { config, monadTestnet } from "@/lib/wagmi";
import { useState, createContext, useContext, type ReactNode } from "react";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";

// Context to indicate whether Privy is available
export const PrivyEnabledContext = createContext(false);
export const usePrivyEnabled = () => useContext(PrivyEnabledContext);

function CoreProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  // Only use Privy if app ID is configured
  if (PRIVY_APP_ID && PRIVY_APP_ID !== "your-privy-app-id-here") {
    return (
      <PrivyProvider
        appId={PRIVY_APP_ID}
        config={{
          appearance: {
            theme: "dark",
            accentColor: "#6366f1",
            logo: undefined,
          },
          loginMethods: ["email", "wallet", "google"],
          embeddedWallets: {
            ethereum: {
              createOnLogin: "users-without-wallets",
            },
          },
          defaultChain: monadTestnet,
          supportedChains: [monadTestnet],
        }}
      >
        <PrivyEnabledContext.Provider value={true}>
          <CoreProviders>{children}</CoreProviders>
        </PrivyEnabledContext.Provider>
      </PrivyProvider>
    );
  }

  // Fallback without Privy
  return (
    <PrivyEnabledContext.Provider value={false}>
      <CoreProviders>{children}</CoreProviders>
    </PrivyEnabledContext.Provider>
  );
}
