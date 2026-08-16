// ==================================================
// DEVNET SMOKE TEST
// NO FAUCET REQUIRED
// ==================================================

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MultisigWallet } from "../target/types/multisig_wallet";

import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

import { assert } from "chai";

describe("multisig-wallet devnet smoke test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program =
    anchor.workspace.multisigWallet as Program<MultisigWallet>;

  const initializer = provider.wallet;

  const walletId =
    new anchor.BN(Date.now());

  // Use the deployer itself as all required owners.
  // This avoids needing funded additional signers.
  const owners = [
    initializer.publicKey,
  ];

  const threshold = 1;

  // This account does not need to sign for receiving SOL.
  const recipient = Keypair.generate();

  // Executor can also be the deployer.
  const executor = initializer;

  let multisigPda: PublicKey;
  let vaultPda: PublicKey;
  let proposalPda: PublicKey;

  it("runs the Devnet SOL smoke flow", async () => {
    // --------------------------------------------------
    // MULTISIG PDA
    // --------------------------------------------------

    [multisigPda] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("multisig"),
          initializer.publicKey.toBuffer(),
          walletId.toArrayLike(
            Buffer,
            "le",
            8
          ),
        ],
        program.programId
      );

    // --------------------------------------------------
    // INITIALIZE MULTISIG
    // --------------------------------------------------

    await program.methods
      .initialize(
        walletId,
        owners,
        threshold
      )
      .accounts({
        initializer:
          initializer.publicKey,

        multisig:
          multisigPda,

        systemProgram:
          SystemProgram.programId,
      })
      .rpc();

    const multisig =
      await program.account.multisig.fetch(
        multisigPda
      );

    assert.equal(
      multisig.threshold,
      1
    );

    // --------------------------------------------------
    // SOL VAULT PDA
    // --------------------------------------------------

    [vaultPda] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("vault"),
          multisigPda.toBuffer(),
        ],
        program.programId
      );

    // --------------------------------------------------
    // INITIALIZE VAULT
    // --------------------------------------------------

    await program.methods
      .initializeVault()
      .accounts({
        initializer:
          initializer.publicKey,

        multisig:
          multisigPda,

        vault:
          vaultPda,

        systemProgram:
          SystemProgram.programId,
      })
      .rpc();

    // --------------------------------------------------
    // DEPOSIT
    // --------------------------------------------------

    const depositAmount =
      0.01 * LAMPORTS_PER_SOL;

    await program.methods
      .deposit(
        new anchor.BN(depositAmount)
      )
      .accounts({
        depositor:
          initializer.publicKey,

        multisig:
          multisigPda,

        vault:
          vaultPda,

        systemProgram:
          SystemProgram.programId,
      })
      .rpc();

    // --------------------------------------------------
    // CREATE SOL PROPOSAL
    // --------------------------------------------------

    const proposalId =
      new anchor.BN(0);

    [proposalPda] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("proposal"),
          multisigPda.toBuffer(),
          proposalId.toArrayLike(
            Buffer,
            "le",
            8
          ),
        ],
        program.programId
      );

    const proposalAmount =
      0.001 * LAMPORTS_PER_SOL;

    await program.methods
      .createProposal(
        recipient.publicKey,
        new anchor.BN(proposalAmount),
        null
      )
      .accounts({
        creator:
          initializer.publicKey,

        multisig:
          multisigPda,

        proposal:
          proposalPda,

        systemProgram:
          SystemProgram.programId,
      })
      .rpc();

    // --------------------------------------------------
    // APPROVE
    // --------------------------------------------------

    await program.methods
      .approveProposal()
      .accounts({
        approver:
          initializer.publicKey,

        multisig:
          multisigPda,

        proposal:
          proposalPda,
      })
      .rpc();

    // --------------------------------------------------
    // VERIFY READY
    // --------------------------------------------------

    const readyProposal =
      await program.account.proposal.fetch(
        proposalPda
      );

    assert.isTrue(
      "ready" in readyProposal.status
    );

    // --------------------------------------------------
    // EXECUTE
    // --------------------------------------------------

    const recipientBefore =
      await provider.connection.getBalance(
        recipient.publicKey
      );

    await program.methods
      .executeProposal()
      .accounts({
        executor:
          initializer.publicKey,

        multisig:
          multisigPda,

        proposal:
          proposalPda,

        vault:
          vaultPda,

        recipient:
          recipient.publicKey,

        systemProgram:
          SystemProgram.programId,
      })
      .rpc();

    const recipientAfter =
      await provider.connection.getBalance(
        recipient.publicKey
      );

    assert.equal(
      recipientAfter - recipientBefore,
      proposalAmount
    );

    const executedProposal =
      await program.account.proposal.fetch(
        proposalPda
      );

    assert.isTrue(
      "executed" in executedProposal.status
    );

    console.log(
      "Devnet SOL smoke test passed"
    );

    console.log(
      "Program:",
      program.programId.toBase58()
    );

    console.log(
      "Multisig:",
      multisigPda.toBase58()
    );

    console.log(
      "Vault:",
      vaultPda.toBase58()
    );

    console.log(
      "Proposal:",
      proposalPda.toBase58()
    );
  });
});