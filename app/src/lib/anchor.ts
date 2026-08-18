import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram
} from "@solana/web3.js";

import idl from "../idl/multisig_wallet.json";

export const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PROGRAM_ID ||
    "6kAdP7S1poZufGSxJ63LHr2KuLNjgmwNomjhu7WgAv8B"
);

export const RPC_URL =
  import.meta.env.VITE_RPC_URL ||
  "https://api.devnet.solana.com";

/**
 * Browser wallet adapters expose publicKey/signTransaction/signAllTransactions,
 * but do not expose the NodeWallet `payer` field.  Keep the boundary dynamic
 * here so AnchorProvider can use Phantom/Solflare-style adapter wallets
 * without leaking Node-only wallet typing into the React app.
 */
export function getProgram(
  connection: anchor.web3.Connection,
  wallet: any
): any {
  const provider =
    new anchor.AnchorProvider(
      connection,
      wallet,
      {
        commitment: "confirmed",
        preflightCommitment: "confirmed"
      }
    );

  return new anchor.Program(
    idl as anchor.Idl,
    provider
  ) as any;
}

export function deriveMultisigPda(
  initializer: PublicKey,
  walletId: anchor.BN
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("multisig"),
      initializer.toBuffer(),
      walletId.toArrayLike(
        Buffer,
        "le",
        8
      )
    ],
    PROGRAM_ID
  );
}

export function deriveVaultPda(
  multisig: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("vault"),
      multisig.toBuffer()
    ],
    PROGRAM_ID
  );
}

export function deriveTokenVaultPda(
  multisig: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("token_vault"),
      multisig.toBuffer(),
      mint.toBuffer()
    ],
    PROGRAM_ID
  );
}

export function deriveProposalPda(
  multisig: PublicKey,
  proposalId: anchor.BN
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("proposal"),
      multisig.toBuffer(),
      proposalId.toArrayLike(
        Buffer,
        "le",
        8
      )
    ],
    PROGRAM_ID
  );
}

export {
  SystemProgram
};
