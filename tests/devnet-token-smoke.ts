import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MultisigWallet } from "../target/types/multisig_wallet";

import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import { assert } from "chai";

import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("multisig-wallet devnet token smoke test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program =
    anchor.workspace.multisigWallet as Program<MultisigWallet>;

  // Existing funded Devnet wallet.
  const payer = provider.wallet;

  // This wallet is also the sole multisig owner.
  const owner = payer;

  // Separate recipient.
  const recipient = Keypair.generate();

  let walletId: anchor.BN;

  let multisigPda: PublicKey;
  let tokenVaultPda: PublicKey;

  let mintPda: PublicKey;

  let depositorTokenAccount: PublicKey;
  let recipientTokenAccount: PublicKey;

  let proposalPda: PublicKey;

  it("runs the Devnet SPL-token smoke flow", async () => {
    // ==================================================
    // 1. CREATE A TEST SPL MINT
    // ==================================================

    mintPda = await createMint(
      provider.connection,
      payer.payer,
      payer.publicKey,
      null,
      6
    );

    console.log(
      "Test mint:",
      mintPda.toBase58()
    );

    // ==================================================
    // 2. DERIVE MULTISIG PDA
    // ==================================================

    walletId = new anchor.BN(
      Date.now()
    );

    [multisigPda] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("multisig"),
          owner.publicKey.toBuffer(),
          walletId.toArrayLike(
            Buffer,
            "le",
            8
          ),
        ],
        program.programId
      );

    // ==================================================
    // 3. INITIALIZE MULTISIG
    // ==================================================

    await program.methods
      .initialize(
        walletId,
        [owner.publicKey],
        1
      )
      .accounts({
        initializer:
          owner.publicKey,

        multisig:
          multisigPda,

        systemProgram:
          SystemProgram.programId,
      })
      .rpc();

    // ==================================================
    // 4. DERIVE TOKEN VAULT PDA
    // ==================================================

    [tokenVaultPda] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("token_vault"),
          multisigPda.toBuffer(),
          mintPda.toBuffer(),
        ],
        program.programId
      );

    // ==================================================
    // 5. INITIALIZE TOKEN VAULT
    //
    // payer can be anyone in our design.
    // Here the deployer wallet pays.
    // ==================================================

    await program.methods
      .initializeTokenVault()
      .accounts({
        payer:
          payer.publicKey,

        multisig:
          multisigPda,

        mint:
          mintPda,

        tokenVault:
          tokenVaultPda,

        tokenProgram:
          TOKEN_PROGRAM_ID,

        systemProgram:
          SystemProgram.programId,
      })
      .rpc();

    const tokenVaultBefore =
      await getAccount(
        provider.connection,
        tokenVaultPda
      );

    assert.equal(
      tokenVaultBefore.mint.toBase58(),
      mintPda.toBase58()
    );

    assert.equal(
      tokenVaultBefore.owner.toBase58(),
      multisigPda.toBase58()
    );

    assert.equal(
      tokenVaultBefore.amount.toString(),
      "0"
    );

    // ==================================================
    // 6. CREATE DEPOSITOR TOKEN ACCOUNT
    // ==================================================

    const depositorAta =
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer.payer,
        mintPda,
        owner.publicKey
      );

    depositorTokenAccount =
      depositorAta.address;

    // ==================================================
    // 7. CREATE RECIPIENT TOKEN ACCOUNT
    // ==================================================

    const recipientAta =
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer.payer,
        mintPda,
        recipient.publicKey
      );

    recipientTokenAccount =
      recipientAta.address;

    // ==================================================
    // 8. MINT TEST TOKENS
    //
    // Mint decimals = 6
    //
    // 10 tokens = 10,000,000 base units
    // ==================================================

    const mintedAmount =
      10_000_000;

    await mintTo(
      provider.connection,
      payer.payer,
      mintPda,
      depositorTokenAccount,
      payer.publicKey,
      mintedAmount
    );

    const depositorBefore =
      await getAccount(
        provider.connection,
        depositorTokenAccount
      );

    assert.equal(
      depositorBefore.amount.toString(),
      mintedAmount.toString()
    );

    // ==================================================
    // 9. DEPOSIT TOKENS INTO MULTISIG VAULT
    // ==================================================

    const depositAmount =
      new anchor.BN(5_000_000);

    await program.methods
      .depositToken(
        depositAmount
      )
      .accounts({
        depositor:
          owner.publicKey,

        multisig:
          multisigPda,

        mint:
          mintPda,

        tokenVault:
          tokenVaultPda,

        depositorTokenAccount:
          depositorTokenAccount,

        tokenProgram:
          TOKEN_PROGRAM_ID,
      })
      .rpc();

    const tokenVaultAfterDeposit =
      await getAccount(
        provider.connection,
        tokenVaultPda
      );

    assert.equal(
      tokenVaultAfterDeposit.amount.toString(),
      depositAmount.toString()
    );

    // ==================================================
    // 10. CREATE TOKEN PROPOSAL
    // ==================================================

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
      new anchor.BN(2_000_000);

    await program.methods
      .createProposal(
        recipient.publicKey,
        proposalAmount,
        mintPda
      )
      .accounts({
        creator:
          owner.publicKey,

        multisig:
          multisigPda,

        proposal:
          proposalPda,

        systemProgram:
          SystemProgram.programId,
      })
      .rpc();

    // ==================================================
    // 11. APPROVE TOKEN PROPOSAL
    //
    // Threshold = 1
    // ==================================================

    await program.methods
      .approveProposal()
      .accounts({
        approver:
          owner.publicKey,

        multisig:
          multisigPda,

        proposal:
          proposalPda,
      })
      .rpc();

    const readyProposal =
      await program.account.proposal.fetch(
        proposalPda
      );

    assert.isTrue(
      "ready" in readyProposal.status
    );

    // ==================================================
    // 12. CHECK RECIPIENT BALANCE BEFORE
    // ==================================================

    const recipientBefore =
      await getAccount(
        provider.connection,
        recipientTokenAccount
      );

    // ==================================================
    // 13. EXECUTE TOKEN PROPOSAL
    // ==================================================

    await program.methods
      .executeTokenProposal()
      .accounts({
        executor:
          owner.publicKey,

        multisig:
          multisigPda,

        mint:
          mintPda,

        proposal:
          proposalPda,

        tokenVault:
          tokenVaultPda,

        recipientTokenAccount:
          recipientTokenAccount,

        tokenProgram:
          TOKEN_PROGRAM_ID,
      })
      .rpc();

    // ==================================================
    // 14. VERIFY RECIPIENT BALANCE
    // ==================================================

    const recipientAfter =
      await getAccount(
        provider.connection,
        recipientTokenAccount
      );

    assert.equal(
      (
        recipientAfter.amount -
        recipientBefore.amount
      ).toString(),
      proposalAmount.toString()
    );

    // ==================================================
    // 15. VERIFY TOKEN VAULT BALANCE
    // ==================================================

    const tokenVaultAfterExecution =
      await getAccount(
        provider.connection,
        tokenVaultPda
      );

    assert.equal(
      tokenVaultAfterExecution.amount.toString(),
      "3000000"
    );

    // 5,000,000 deposited
    // -2,000,000 executed
    // =3,000,000 remaining

    // ==================================================
    // 16. VERIFY PROPOSAL STATUS
    // ==================================================

    const executedProposal =
      await program.account.proposal.fetch(
        proposalPda
      );

    assert.isTrue(
      "executed" in executedProposal.status
    );

    console.log(
      "Devnet SPL-token smoke test passed"
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
      "Mint:",
      mintPda.toBase58()
    );

    console.log(
      "Token vault:",
      tokenVaultPda.toBase58()
    );

    console.log(
      "Proposal:",
      proposalPda.toBase58()
    );
  });
});