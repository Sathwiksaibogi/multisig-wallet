import React, {
  useMemo
} from "react";

import ReactDOM from "react-dom/client";

import {
  ConnectionProvider,
  WalletProvider
} from "@solana/wallet-adapter-react";

import {
  WalletAdapterNetwork,
  type WalletError
} from "@solana/wallet-adapter-base";

import {
  WalletModalProvider
} from "@solana/wallet-adapter-react-ui";

import {
  SolflareWalletAdapter
} from "@solana/wallet-adapter-wallets";

import "@solana/wallet-adapter-react-ui/styles.css";

import App from "./App";
import "./styles.css";

function Root() {
  const endpoint =
    import.meta.env.VITE_RPC_URL ||
    "https://api.devnet.solana.com";

  const wallets =
    useMemo(
      () => [
        new SolflareWalletAdapter({
          network:
            WalletAdapterNetwork.Devnet
        })
      ],
      []
    );

  const handleWalletError = (
    error: WalletError
  ) => {
    const message =
      error?.message
        ?.toLowerCase() || "";

    if (
      message.includes(
        "user rejected"
      ) ||
      message.includes(
        "user rejected the request"
      )
    ) {
      return;
    }

    console.error(
      "Wallet error:",
      error
    );
  };

  return (
    <ConnectionProvider
      endpoint={endpoint}
    >
      <WalletProvider
        wallets={wallets}
        autoConnect
        onError={
          handleWalletError
        }
      >
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

ReactDOM.createRoot(
  document.getElementById(
    "root"
  )!
).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);