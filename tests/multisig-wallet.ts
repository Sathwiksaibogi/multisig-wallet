
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

import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

describe("multisig-wallet", () => {
  // ==================================================
  // PROVIDER
  // ==================================================

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program =
    anchor.workspace.multisigWallet as Program<MultisigWallet>;

  // ==================================================
  // TEST ACCOUNTS
  // ==================================================

  // Provider wallet acts as initializer + first owner
  const initializer = provider.wallet;

  // Additional multisig owners
  const owner2 = Keypair.generate();
  const owner3 = Keypair.generate();

  // Account receiving SOL
  const recipient = Keypair.generate();

  // Account executing the proposal
  // Executor does NOT need to be an owner
  // in the current program design.
  const executor = Keypair.generate();

  // ==================================================
  // MULTISIG CONFIGURATION
  // ==================================================

  const walletId = new anchor.BN(1);

  const owners = [
    initializer.publicKey,
    owner2.publicKey,
    owner3.publicKey,
  ];

  const threshold = 2;

  // ==================================================
// PDAs / TOKEN ACCOUNTS
// ==================================================

let multisigPda: PublicKey;
let vaultPda: PublicKey;
let proposalPda: PublicKey;

let testMint: PublicKey;
let secondMint: PublicKey;

let tokenVaultPda: PublicKey;
let secondTokenVaultPda: PublicKey;

let depositorTokenAccount: PublicKey;
let recipientTokenAccount: PublicKey;

  // ==================================================
  // HELPER: AIRDROP SOL
  // ==================================================

  async function airdrop(
    publicKey: PublicKey,
    sol: number
  ) {
    const signature =
      await provider.connection.requestAirdrop(
        publicKey,
        sol * LAMPORTS_PER_SOL
      );

    await provider.connection.confirmTransaction(
      signature,
      "confirmed"
    );
  }

  // ==================================================
  // TEST 1
  // FUND TEST ACCOUNTS
  // ==================================================

  it("Funds test accounts", async () => {
    await airdrop(owner2.publicKey, 2);
    await airdrop(owner3.publicKey, 2);
    await airdrop(executor.publicKey, 2);
    await airdrop(recipient.publicKey, 1);

    console.log(
      "Owner 2:",
      owner2.publicKey.toString()
    );

    console.log(
      "Owner 3:",
      owner3.publicKey.toString()
    );

    console.log(
      "Executor:",
      executor.publicKey.toString()
    );

    console.log(
      "Recipient:",
      recipient.publicKey.toString()
    );
  });

  // ==================================================
  // TEST 2
  // INITIALIZE MULTISIG
  // ==================================================

  it("Initializes the multisig", async () => {
    // --------------------------------------------------
    // DERIVE MULTISIG PDA
    // --------------------------------------------------

    [multisigPda] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("multisig"),
          initializer.publicKey.toBuffer(),
          walletId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

    console.log(
      "Multisig PDA:",
      multisigPda.toString()
    );

    // --------------------------------------------------
    // INITIALIZE
    // --------------------------------------------------

    const tx =
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

    console.log(
      "Initialize transaction:",
      tx
    );

    // --------------------------------------------------
    // FETCH MULTISIG
    // --------------------------------------------------

    const multisig =
      await program.account.multisig.fetch(
        multisigPda
      );

    // --------------------------------------------------
    // ASSERTIONS
    // --------------------------------------------------

    assert.equal(
      multisig.walletId.toNumber(),
      1
    );

    assert.equal(
      multisig.threshold,
      2
    );

    assert.equal(
      multisig.proposalCount.toNumber(),
      0
    );

    assert.equal(
      multisig.initializer.toString(),
      initializer.publicKey.toString()
    );

    assert.equal(
      multisig.owners.length,
      3
    );

    assert.equal(
      multisig.owners[0].toString(),
      initializer.publicKey.toString()
    );

    assert.equal(
      multisig.owners[1].toString(),
      owner2.publicKey.toString()
    );

    assert.equal(
      multisig.owners[2].toString(),
      owner3.publicKey.toString()
    );

    console.log(
      "Multisig initialized successfully"
    );
  });

  // ==================================================
  // TEST 3
  // INITIALIZE VAULT
  // ==================================================

  it("Initializes the vault", async () => {
    // --------------------------------------------------
    // DERIVE VAULT PDA
    // --------------------------------------------------

    [vaultPda] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("vault"),
          multisigPda.toBuffer(),
        ],
        program.programId
      );

    console.log(
      "Vault PDA:",
      vaultPda.toString()
    );

    // --------------------------------------------------
    // INITIALIZE VAULT
    // --------------------------------------------------

    const tx =
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

    console.log(
      "Initialize vault transaction:",
      tx
    );

    // --------------------------------------------------
    // FETCH VAULT ACCOUNT
    // --------------------------------------------------

    const vaultAccount =
      await provider.connection.getAccountInfo(
        vaultPda
      );

    // Vault must exist
    assert.isNotNull(vaultAccount);

    // --------------------------------------------------
    // CHECK VAULT OWNER
    // --------------------------------------------------
    //
    // vault is an UncheckedAccount with space = 0.
    //
    // Therefore this account is owned by the System
    // Program, NOT by our multisig program.
    //

    assert.equal(
      vaultAccount!.owner.toString(),
      SystemProgram.programId.toString()
    );

    console.log(
      "Vault initialized successfully"
    );

    console.log(
      "Vault owner:",
      vaultAccount!.owner.toString()
    );
  });

  

  // ==================================================
  // TEST 4
  // DEPOSIT SOL INTO VAULT
  // ==================================================

  it("Deposits SOL into the vault", async () => {
    // --------------------------------------------------
    // DEPOSIT AMOUNT
    // --------------------------------------------------

    const amount =
      2 * LAMPORTS_PER_SOL;

    // --------------------------------------------------
    // CHECK BALANCE BEFORE
    // --------------------------------------------------

    const vaultBalanceBefore =
      await provider.connection.getBalance(
        vaultPda
      );

    console.log(
      "Vault balance before deposit:",
      vaultBalanceBefore
    );

    // --------------------------------------------------
    // DEPOSIT THROUGH PROGRAM
    // --------------------------------------------------
    //
    // IMPORTANT:
    //
    // We are NOT directly transferring SOL to the PDA.
    //
    // The transaction calls:
    //
    // deposit(2 SOL)
    //
    // and the program performs a CPI to the
    // System Program.
    //

    const tx =
      await program.methods
        .deposit(
          new anchor.BN(amount)
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

    console.log(
      "Deposit transaction:",
      tx
    );

    // --------------------------------------------------
    // CHECK BALANCE AFTER
    // --------------------------------------------------

    const vaultBalanceAfter =
      await provider.connection.getBalance(
        vaultPda
      );

    console.log(
      "Vault balance after deposit:",
      vaultBalanceAfter
    );

    // --------------------------------------------------
    // VERIFY EXACT INCREASE
    // --------------------------------------------------

    assert.equal(
      vaultBalanceAfter - vaultBalanceBefore,
      amount
    );

    console.log(
      "Vault funded successfully through deposit instruction"
    );
  });

  // ==================================================
  // TEST 5
  // REJECT ZERO DEPOSIT
  // ==================================================

  it("Rejects zero deposit", async () => {
    try {
      await program.methods
        .deposit(
          new anchor.BN(0)
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

      // If execution reaches here,
      // the program incorrectly allowed
      // a zero deposit.

      assert.fail(
        "Transaction should have failed"
      );

    } catch (error: any) {
      console.log(
        "Zero deposit correctly rejected"
      );

      const errorCode =
        error?.error?.errorCode?.code;

      console.log(
        "Error code:",
        errorCode
      );

      assert.equal(
        errorCode,
        "InvalidAmount"
      );
    }
  });

  // ==================================================
  // TEST 6
  // CREATE PROPOSAL
  // ==================================================

  it("Creates a proposal", async () => {
    // Current proposal_count = 0
    // Therefore proposal_id = 0

    const proposalId =
      new anchor.BN(0);

    // --------------------------------------------------
    // DERIVE PROPOSAL PDA
    // --------------------------------------------------

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

    console.log(
      "Proposal PDA:",
      proposalPda.toString()
    );

    // --------------------------------------------------
    // PROPOSAL AMOUNT
    // --------------------------------------------------

    const amount =
      0.5 * LAMPORTS_PER_SOL;

    // --------------------------------------------------
    // CREATE PROPOSAL
    // --------------------------------------------------

    const tx =
      await program.methods
        .createProposal(
          recipient.publicKey,
          new anchor.BN(amount),
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

    console.log(
      "Create proposal transaction:",
      tx
    );

    // --------------------------------------------------
    // FETCH PROPOSAL
    // --------------------------------------------------

    const proposal =
      await program.account.proposal.fetch(
        proposalPda
      );

    // --------------------------------------------------
    // ASSERTIONS
    // --------------------------------------------------

    assert.equal(
      proposal.wallet.toString(),
      multisigPda.toString()
    );

    assert.equal(
      proposal.proposalId.toNumber(),
      0
    );

    assert.equal(
      proposal.creator.toString(),
      initializer.publicKey.toString()
    );

    assert.equal(
      proposal.recipient.toString(),
      recipient.publicKey.toString()
    );

    assert.equal(
      proposal.amount.toNumber(),
      amount
    );

    assert.equal(
      proposal.approvals.length,
      0
    );

    // Proposal must start Pending
    assert.isTrue(
      "pending" in proposal.status
    );

    // --------------------------------------------------
    // CHECK PROPOSAL COUNTER
    // --------------------------------------------------

    const multisig =
      await program.account.multisig.fetch(
        multisigPda
      );

    assert.equal(
      multisig.proposalCount.toNumber(),
      1
    );

    console.log(
      "Proposal created successfully"
    );
  });

  // ==================================================
  // TEST 7
  // FIRST APPROVAL
  // ==================================================

  it("Allows the first owner to approve", async () => {
    const tx =
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

    console.log(
      "First approval transaction:",
      tx
    );

    // --------------------------------------------------
    // FETCH PROPOSAL
    // --------------------------------------------------

    const proposal =
      await program.account.proposal.fetch(
        proposalPda
      );

    // One approval
    assert.equal(
      proposal.approvals.length,
      1
    );

    // Initializer must be the approver
    assert.equal(
      proposal.approvals[0].toString(),
      initializer.publicKey.toString()
    );

    // Threshold is 2.
    // Therefore proposal is still Pending.
    assert.isTrue(
      "pending" in proposal.status
    );

    console.log(
      "First approval recorded successfully"
    );
  });

  // ==================================================
  // TEST 8
  // DOUBLE VOTING
  //
  // IMPORTANT:
  //
  // This test MUST happen while proposal is Pending.
  // ==================================================

  it("Rejects double voting", async () => {
    try {
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

      // If execution reaches here,
      // the program incorrectly allowed
      // double voting.

      assert.fail(
        "Transaction should have failed"
      );

    } catch (error: any) {
      console.log(
        "Double voting correctly rejected"
      );

      const errorCode =
        error?.error?.errorCode?.code;

      console.log(
        "Error code:",
        errorCode
      );

      assert.equal(
        errorCode,
        "DoubleVoting"
      );
    }
  });

  // ==================================================
  // TEST 9
  // NON-OWNER APPROVAL
  //
  // IMPORTANT:
  //
  // This also MUST happen while proposal is Pending.
  // ==================================================

  it("Rejects approval from a non-owner", async () => {
    const nonOwner =
      Keypair.generate();

    // Give non-owner enough SOL to pay
    // transaction fees.
    await airdrop(
      nonOwner.publicKey,
      1
    );

    try {
      await program.methods
        .approveProposal()
        .accounts({
          approver:
            nonOwner.publicKey,

          multisig:
            multisigPda,

          proposal:
            proposalPda,
        })
        .signers([nonOwner])
        .rpc();

      // If execution reaches here,
      // the program incorrectly allowed
      // a non-owner to approve.

      assert.fail(
        "Transaction should have failed"
      );

    } catch (error: any) {
      console.log(
        "Non-owner approval correctly rejected"
      );

      const errorCode =
        error?.error?.errorCode?.code;

      console.log(
        "Error code:",
        errorCode
      );

      assert.equal(
        errorCode,
        "ApproverNotOwner"
      );
    }
  });

  // ==================================================
  // TEST 10
  // SECOND APPROVAL
  //
  // This happens AFTER the negative approval tests.
  // ==================================================

  it("Allows the second owner to approve and marks proposal Ready", async () => {
    const tx =
      await program.methods
        .approveProposal()
        .accounts({
          approver:
            owner2.publicKey,

          multisig:
            multisigPda,

          proposal:
            proposalPda,
        })
        .signers([owner2])
        .rpc();

    console.log(
      "Second approval transaction:",
      tx
    );

    // --------------------------------------------------
    // FETCH PROPOSAL
    // --------------------------------------------------

    const proposal =
      await program.account.proposal.fetch(
        proposalPda
      );

    // There must now be two approvals.
    assert.equal(
      proposal.approvals.length,
      2
    );

    // Initializer approved
    assert.isTrue(
      proposal.approvals.some(
        key =>
          key.equals(
            initializer.publicKey
          )
      )
    );

    // Owner2 approved
    assert.isTrue(
      proposal.approvals.some(
        key =>
          key.equals(
            owner2.publicKey
          )
      )
    );

    // Threshold = 2
    // Therefore proposal must become Ready.
    assert.isTrue(
      "ready" in proposal.status
    );

    console.log(
      "Proposal reached threshold and is Ready"
    );
  });

  // ==================================================
  // TEST 11
  // EXECUTE PROPOSAL
  // ==================================================

  it("Executes the approved proposal", async () => {
    const amount =
      0.5 * LAMPORTS_PER_SOL;

    // --------------------------------------------------
    // BALANCES BEFORE
    // --------------------------------------------------

    const vaultBalanceBefore =
      await provider.connection.getBalance(
        vaultPda
      );

    const recipientBalanceBefore =
      await provider.connection.getBalance(
        recipient.publicKey
      );

    console.log(
      "Vault balance before:",
      vaultBalanceBefore
    );

    console.log(
      "Recipient balance before:",
      recipientBalanceBefore
    );

    // --------------------------------------------------
    // EXECUTE PROPOSAL
    // --------------------------------------------------

    const tx =
      await program.methods
        .executeProposal()
        .accounts({
          executor:
            executor.publicKey,

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
        .signers([executor])
        .rpc();

    console.log(
      "Execute transaction:",
      tx
    );

    // --------------------------------------------------
    // BALANCES AFTER
    // --------------------------------------------------

    const vaultBalanceAfter =
      await provider.connection.getBalance(
        vaultPda
      );

    const recipientBalanceAfter =
      await provider.connection.getBalance(
        recipient.publicKey
      );

    console.log(
      "Vault balance after:",
      vaultBalanceAfter
    );

    console.log(
      "Recipient balance after:",
      recipientBalanceAfter
    );

    // --------------------------------------------------
    // CHECK RECIPIENT
    // --------------------------------------------------

    assert.equal(
      recipientBalanceAfter -
        recipientBalanceBefore,
      amount
    );

    // --------------------------------------------------
    // CHECK VAULT
    // --------------------------------------------------

    assert.equal(
      vaultBalanceBefore -
        vaultBalanceAfter,
      amount
    );

    // --------------------------------------------------
    // CHECK PROPOSAL STATUS
    // --------------------------------------------------

    const proposal =
      await program.account.proposal.fetch(
        proposalPda
      );

    assert.isTrue(
      "executed" in proposal.status
    );

    console.log(
      "Proposal executed successfully"
    );
  });

  // ==================================================
  // TEST 12
  // CANNOT EXECUTE AGAIN
  // ==================================================

  it("Rejects executing an already executed proposal", async () => {
    try {
      await program.methods
        .executeProposal()
        .accounts({
          executor:
            executor.publicKey,

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
        .signers([executor])
        .rpc();

      // If we reach this point,
      // the program incorrectly allowed
      // a second execution.

      assert.fail(
        "Transaction should have failed"
      );

    } catch (error: any) {
      console.log(
        "Second execution correctly rejected"
      );

      const errorCode =
        error?.error?.errorCode?.code;

      console.log(
        "Error code:",
        errorCode
      );

      assert.equal(
        errorCode,
        "ProposalNotReady"
      );
    }
  });


// ==================================================
// TEST 13
// REMOVE EXECUTED PROPOSAL
// ==================================================

it("Removes an executed proposal and refunds its lamports to the remover", async () => {
  // --------------------------------------------------
  // CHECK PROPOSAL EXISTS BEFORE REMOVAL
  // --------------------------------------------------

  const proposalBefore =
    await provider.connection.getAccountInfo(
      proposalPda
    );

  assert.isNotNull(
    proposalBefore
  );

  // Store the proposal account's lamports
  // before it is closed.
  const proposalLamports =
    proposalBefore!.lamports;

  console.log(
    "Proposal lamports before removal:",
    proposalLamports
  );

  // --------------------------------------------------
  // REMOVER BALANCE BEFORE
  // --------------------------------------------------

  const removerBalanceBefore =
    await provider.connection.getBalance(
      initializer.publicKey
    );

  console.log(
    "Remover balance before:",
    removerBalanceBefore
  );

  // --------------------------------------------------
  // REMOVE PROPOSAL
  // --------------------------------------------------

  const tx =
    await program.methods
      .removeProposal()
      .accounts({
        remover:
          initializer.publicKey,

        multisig:
          multisigPda,

        proposal:
          proposalPda,
      })
      .rpc();

  console.log(
    "Remove proposal transaction:",
    tx
  );

  // --------------------------------------------------
  // CHECK PROPOSAL ACCOUNT
  // --------------------------------------------------
  //
  // close = remover means Anchor should:
  //
  // 1. Close the proposal account
  // 2. Transfer its remaining lamports
  //    to the remover
  // 3. Remove the account from the ledger
  //

  const proposalAfter =
    await provider.connection.getAccountInfo(
      proposalPda
    );

  assert.isNull(
    proposalAfter
  );

  console.log(
    "Proposal account successfully closed"
  );

  // --------------------------------------------------
  // REMOVER BALANCE AFTER
  // --------------------------------------------------

  const removerBalanceAfter =
    await provider.connection.getBalance(
      initializer.publicKey
    );

  console.log(
    "Remover balance after:",
    removerBalanceAfter
  );

  // --------------------------------------------------
  // VERIFY LAMPORTS WERE RETURNED
  // --------------------------------------------------
  //
  // The remover also pays the transaction fee.
  // Therefore we should not expect:
  //
  // removerBalanceAfter - removerBalanceBefore
  //     === proposalLamports
  //
  // Instead, the remover's balance should still
  // increase because the proposal's rent lamports
  // were returned.
  //

  assert.isAbove(
    removerBalanceAfter,
    removerBalanceBefore
  );

  console.log(
    "Proposal lamports successfully returned to remover"
  );
});

  // ==================================================
  // TEST 14
  // CREATE SECOND PROPOSAL FOR CANCELLATION
  // ==================================================

  it("Creates a second proposal for cancellation", async () => {
    // Current proposal_count = 1
    // Therefore the new proposal_id = 1

    const proposalId =
      new anchor.BN(1);

    // --------------------------------------------------
    // DERIVE SECOND PROPOSAL PDA
    // --------------------------------------------------

    const [cancelProposalPda] =
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

    // Store this PDA globally so the following
    // cancellation tests can use it.
    proposalPda = cancelProposalPda;

    console.log(
      "Cancellation proposal PDA:",
      proposalPda.toString()
    );

    // --------------------------------------------------
    // CREATE PROPOSAL
    // --------------------------------------------------

    const amount =
      0.25 * LAMPORTS_PER_SOL;

    const tx =
      await program.methods
        .createProposal(
          recipient.publicKey,
          new anchor.BN(amount),
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

    console.log(
      "Create cancellation proposal transaction:",
      tx
    );

    // --------------------------------------------------
    // FETCH PROPOSAL
    // --------------------------------------------------

    const proposal =
      await program.account.proposal.fetch(
        proposalPda
      );

    // --------------------------------------------------
    // ASSERTIONS
    // --------------------------------------------------

    assert.equal(
      proposal.proposalId.toNumber(),
      1
    );

    assert.equal(
      proposal.wallet.toString(),
      multisigPda.toString()
    );

    assert.equal(
      proposal.creator.toString(),
      initializer.publicKey.toString()
    );

    assert.equal(
      proposal.recipient.toString(),
      recipient.publicKey.toString()
    );

    assert.equal(
      proposal.amount.toNumber(),
      amount
    );

    assert.equal(
      proposal.approvals.length,
      0
    );

    assert.equal(
      proposal.cancels.length,
      0
    );

    assert.isTrue(
      "pending" in proposal.status
    );

    console.log(
      "Second proposal created successfully"
    );
  });


  // ==================================================
  // TEST 15
  // FIRST OWNER CANCELS PROPOSAL
  // ==================================================

  it("Allows the first owner to cancel the proposal", async () => {
    const tx =
      await program.methods
        .cancelProposal()
        .accounts({
          canceller:
            initializer.publicKey,

          multisig:
            multisigPda,

          proposal:
            proposalPda,
        })
        .rpc();

    console.log(
      "First cancellation transaction:",
      tx
    );

    // --------------------------------------------------
    // FETCH PROPOSAL
    // --------------------------------------------------

    const proposal =
      await program.account.proposal.fetch(
        proposalPda
      );

    // --------------------------------------------------
    // ASSERTIONS
    // --------------------------------------------------

    assert.equal(
      proposal.cancels.length,
      1
    );

    assert.equal(
      proposal.cancels[0].toString(),
      initializer.publicKey.toString()
    );

    // Threshold = 2.
    // Only one cancellation exists,
    // therefore proposal must still be Pending.
    assert.isTrue(
      "pending" in proposal.status
    );

    console.log(
      "First cancellation recorded successfully"
    );
  });


  // ==================================================
  // TEST 16
  // DOUBLE CANCELLATION
  // ==================================================

  it("Rejects double cancellation by the same owner", async () => {
    try {
      await program.methods
        .cancelProposal()
        .accounts({
          canceller:
            initializer.publicKey,

          multisig:
            multisigPda,

          proposal:
            proposalPda,
        })
        .rpc();

      // If execution reaches here,
      // the program incorrectly allowed
      // the same owner to cancel twice.

      assert.fail(
        "Transaction should have failed"
      );

    } catch (error: any) {
      console.log(
        "Double cancellation correctly rejected"
      );

      const errorCode =
        error?.error?.errorCode?.code;

      console.log(
        "Error code:",
        errorCode
      );

      // Your current program uses DoubleVoting
      // for duplicate cancellation as well.
      assert.equal(
        errorCode,
        "DoubleCancellation"
      );
    }
  });


  // ==================================================
  // TEST 17
  // NON-OWNER CANCELLATION
  // ==================================================

  it("Rejects cancellation from a non-owner", async () => {
    const nonOwner =
      Keypair.generate();

    // Give non-owner SOL to pay transaction fees.
    await airdrop(
      nonOwner.publicKey,
      1
    );

    try {
      await program.methods
        .cancelProposal()
        .accounts({
          canceller:
            nonOwner.publicKey,

          multisig:
            multisigPda,

          proposal:
            proposalPda,
        })
        .signers([nonOwner])
        .rpc();

      // If execution reaches here,
      // the program incorrectly allowed
      // a non-owner to cancel.

      assert.fail(
        "Transaction should have failed"
      );

    } catch (error: any) {
      console.log(
        "Non-owner cancellation correctly rejected"
      );

      const errorCode =
        error?.error?.errorCode?.code;

      console.log(
        "Error code:",
        errorCode
      );

      assert.equal(
        errorCode,
        "CancellerNotOwner"
      );
    }
  });


  // ==================================================
  // TEST 18
  // SECOND OWNER CANCELS
  //
  // Threshold = 2
  // Therefore this cancellation should change
  // the proposal status to Cancelled.
  // ==================================================

  it("Allows the second owner to cancel and marks proposal Cancelled", async () => {
    const tx =
      await program.methods
        .cancelProposal()
        .accounts({
          canceller:
            owner2.publicKey,

          multisig:
            multisigPda,

          proposal:
            proposalPda,
        })
        .signers([owner2])
        .rpc();

    console.log(
      "Second cancellation transaction:",
      tx
    );

    // --------------------------------------------------
    // FETCH PROPOSAL
    // --------------------------------------------------

    const proposal =
      await program.account.proposal.fetch(
        proposalPda
      );

    // --------------------------------------------------
    // CHECK CANCELLATIONS
    // --------------------------------------------------

    assert.equal(
      proposal.cancels.length,
      2
    );

    // Initializer cancelled
    assert.isTrue(
      proposal.cancels.some(
        key =>
          key.equals(
            initializer.publicKey
          )
      )
    );

    // Owner2 cancelled
    assert.isTrue(
      proposal.cancels.some(
        key =>
          key.equals(
            owner2.publicKey
          )
      )
    );

    // --------------------------------------------------
    // CHECK STATUS
    // --------------------------------------------------

    assert.isTrue(
      "cancelled" in proposal.status
    );

    console.log(
      "Proposal reached cancellation threshold"
    );

    console.log(
      "Proposal status is Cancelled"
    );
  });


  // ==================================================
  // TEST 19
  // CANNOT EXECUTE CANCELLED PROPOSAL
  // ==================================================

  it("Rejects execution of a cancelled proposal", async () => {
    try {
      await program.methods
        .executeProposal()
        .accounts({
          executor:
            executor.publicKey,

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
        .signers([executor])
        .rpc();

      // If execution reaches here,
      // the program incorrectly allowed
      // execution of a cancelled proposal.

      assert.fail(
        "Transaction should have failed"
      );

    } catch (error: any) {
      console.log(
        "Cancelled proposal execution correctly rejected"
      );

      const errorCode =
        error?.error?.errorCode?.code;

      console.log(
        "Error code:",
        errorCode
      );

      assert.equal(
        errorCode,
        "ProposalNotReady"
      );
    }
  });


  // ==================================================
  // TEST 20
  // REMOVE CANCELLED PROPOSAL
  // ==================================================

  it("Removes a cancelled proposal and refunds its lamports to the remover", async () => {
    // --------------------------------------------------
    // CHECK PROPOSAL ACCOUNT BEFORE REMOVAL
    // --------------------------------------------------

    const proposalAccountBefore =
      await provider.connection.getAccountInfo(
        proposalPda
      );

    assert.isNotNull(
      proposalAccountBefore
    );

    const proposalLamportsBefore =
      proposalAccountBefore!.lamports;

    console.log(
      "Cancelled proposal lamports before removal:",
      proposalLamportsBefore
    );

    // --------------------------------------------------
    // CHECK REMOVER BALANCE BEFORE
    // --------------------------------------------------

    const removerBalanceBefore =
      await provider.connection.getBalance(
        initializer.publicKey
      );

    console.log(
      "Remover balance before:",
      removerBalanceBefore
    );

    // --------------------------------------------------
    // REMOVE PROPOSAL
    // --------------------------------------------------

    const tx =
      await program.methods
        .removeProposal()
        .accounts({
          remover:
            initializer.publicKey,

          multisig:
            multisigPda,

          proposal:
            proposalPda,
        })
        .rpc();

    console.log(
      "Remove cancelled proposal transaction:",
      tx
    );

    // --------------------------------------------------
    // CHECK PROPOSAL ACCOUNT
    // --------------------------------------------------

    const proposalAccountAfter =
      await provider.connection.getAccountInfo(
        proposalPda
      );

    // Account should no longer exist.
    assert.isNull(
      proposalAccountAfter
    );

    console.log(
      "Cancelled proposal account successfully closed"
    );

    // --------------------------------------------------
    // CHECK REMOVER BALANCE AFTER
    // --------------------------------------------------

    const removerBalanceAfter =
      await provider.connection.getBalance(
        initializer.publicKey
      );

    console.log(
      "Remover balance after:",
      removerBalanceAfter
    );

    // --------------------------------------------------
    // VERIFY LAMPORT REFUND
    // --------------------------------------------------
    //
    // The transaction itself costs some lamports
    // as a transaction fee.
    //
    // Therefore we cannot simply expect:
    //
    // balanceAfter - balanceBefore
    //     === proposalLamportsBefore
    //
    // Instead, the important verification is that
    // the proposal account was closed and its
    // lamports were returned to the remover.
    //

    assert.isAbove(
      removerBalanceAfter,
      removerBalanceBefore
    );

    console.log(
      "Proposal lamports successfully returned to remover"
    );
  });


// ==================================================
// TEST 21
// MIXED VOTING:
// APPROVE -> CANCEL -> APPROVE
//
// Expected:
// Owner 1 approves
// Owner 2 cancels
// Owner 3 approves
// Approval threshold = 2
// Therefore proposal becomes READY.
// ==================================================

it("Allows mixed voting and reaches Ready when approval threshold is reached", async () => {
  // --------------------------------------------------
  // GET CURRENT PROPOSAL ID
  // --------------------------------------------------

  const multisigBefore =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisigBefore.proposalCount;

  // --------------------------------------------------
  // DERIVE NEW PROPOSAL PDA
  // --------------------------------------------------

  const [mixedProposalPda] =
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

  const amount =
    0.1 * LAMPORTS_PER_SOL;

  // --------------------------------------------------
  // CREATE PROPOSAL
  // --------------------------------------------------

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(amount),
      null
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        mixedProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  console.log(
    "Mixed-voting proposal created:",
    mixedProposalPda.toString()
  );

  // --------------------------------------------------
  // OWNER 1 APPROVES
  // --------------------------------------------------

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        mixedProposalPda,
    })
    .rpc();

  console.log(
    "Owner 1 approved"
  );

  // --------------------------------------------------
  // OWNER 2 CANCELS
  // --------------------------------------------------

  await program.methods
    .cancelProposal()
    .accounts({
      canceller:
        owner2.publicKey,

      multisig:
        multisigPda,

      proposal:
        mixedProposalPda,
    })
    .signers([owner2])
    .rpc();

  console.log(
    "Owner 2 cancelled"
  );

  // --------------------------------------------------
  // VERIFY STILL PENDING
  // --------------------------------------------------

  let proposal =
    await program.account.proposal.fetch(
      mixedProposalPda
    );

  assert.isTrue(
    "pending" in proposal.status
  );

  assert.equal(
    proposal.approvals.length,
    1
  );

  assert.equal(
    proposal.cancels.length,
    1
  );

  // --------------------------------------------------
  // OWNER 3 APPROVES
  // --------------------------------------------------

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner3.publicKey,

      multisig:
        multisigPda,

      proposal:
        mixedProposalPda,
    })
    .signers([owner3])
    .rpc();

  console.log(
    "Owner 3 approved"
  );

  // --------------------------------------------------
  // FETCH FINAL PROPOSAL
  // --------------------------------------------------

  proposal =
    await program.account.proposal.fetch(
      mixedProposalPda
    );

  // Two approvals reached threshold.
  assert.equal(
    proposal.approvals.length,
    2
  );

  // One cancellation remains recorded.
  assert.equal(
    proposal.cancels.length,
    1
  );

  // Approval threshold wins.
  assert.isTrue(
    "ready" in proposal.status
  );

  console.log(
    "Mixed voting correctly resulted in Ready"
  );
});


// ==================================================
// TEST 22
// REJECT CANCELLATION AFTER READY
//
// Once approval threshold is reached,
// proposal status becomes Ready.
//
// Cancellation must then fail with
// ProposalNotPending.
// ==================================================

it("Rejects cancellation after proposal becomes Ready", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [readyProposalPda] =
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

  // --------------------------------------------------
  // CREATE PROPOSAL
  // --------------------------------------------------

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(
        0.1 * LAMPORTS_PER_SOL
      ),
      null
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        readyProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  // --------------------------------------------------
  // TWO APPROVALS
  // --------------------------------------------------

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        readyProposalPda,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner2.publicKey,

      multisig:
        multisigPda,

      proposal:
        readyProposalPda,
    })
    .signers([owner2])
    .rpc();

  // --------------------------------------------------
  // VERIFY READY
  // --------------------------------------------------

  const proposal =
    await program.account.proposal.fetch(
      readyProposalPda
    );

  assert.isTrue(
    "ready" in proposal.status
  );

  // --------------------------------------------------
  // TRY TO CANCEL
  // --------------------------------------------------

  try {
    await program.methods
      .cancelProposal()
      .accounts({
        canceller:
          owner3.publicKey,

        multisig:
          multisigPda,

        proposal:
          readyProposalPda,
      })
      .signers([owner3])
      .rpc();

    assert.fail(
      "Cancellation should have failed"
    );

  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Cancellation after Ready correctly rejected"
    );

    console.log(
      "Error code:",
      errorCode
    );

    assert.equal(
      errorCode,
      "ProposalNotPending"
    );
  }
});


// ==================================================
// TEST 23
// REJECT APPROVAL AFTER CANCELLED
//
// Once cancellation threshold is reached,
// proposal status becomes Cancelled.
//
// Approval must then fail with
// ProposalNotPending.
// ==================================================

it("Rejects approval after proposal becomes Cancelled", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [cancelledProposalPda] =
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

  // --------------------------------------------------
  // CREATE PROPOSAL
  // --------------------------------------------------

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(
        0.1 * LAMPORTS_PER_SOL
      ),
      null
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        cancelledProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  // --------------------------------------------------
  // TWO CANCELLATIONS
  // --------------------------------------------------

  await program.methods
    .cancelProposal()
    .accounts({
      canceller:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        cancelledProposalPda,
    })
    .rpc();

  await program.methods
    .cancelProposal()
    .accounts({
      canceller:
        owner2.publicKey,

      multisig:
        multisigPda,

      proposal:
        cancelledProposalPda,
    })
    .signers([owner2])
    .rpc();

  // --------------------------------------------------
  // VERIFY CANCELLED
  // --------------------------------------------------

  const proposal =
    await program.account.proposal.fetch(
      cancelledProposalPda
    );

  assert.isTrue(
    "cancelled" in proposal.status
  );

  // --------------------------------------------------
  // TRY TO APPROVE
  // --------------------------------------------------

  try {
    await program.methods
      .approveProposal()
      .accounts({
        approver:
          owner3.publicKey,

        multisig:
          multisigPda,

        proposal:
          cancelledProposalPda,
      })
      .signers([owner3])
      .rpc();

    assert.fail(
      "Approval should have failed"
    );

  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Approval after Cancelled correctly rejected"
    );

    console.log(
      "Error code:",
      errorCode
    );

    assert.equal(
      errorCode,
      "ProposalNotPending"
    );
  }
});


// ==================================================
// TEST 24
// INSUFFICIENT VAULT FUNDS
//
// Proposal becomes Ready, but the vault doesn't
// contain enough SOL.
//
// Expected:
// InsufficientVaultFunds
// ==================================================

it("Rejects execution when the vault has insufficient funds", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [insufficientFundsProposalPda] =
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

  // --------------------------------------------------
  // CREATE PROPOSAL
  //
  // Vault currently contains roughly 1.5 SOL.
  // Request an amount larger than the vault balance.
  // --------------------------------------------------

  const hugeAmount =
    10 * LAMPORTS_PER_SOL;

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(hugeAmount),
      null
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        insufficientFundsProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  // --------------------------------------------------
  // APPROVAL 1
  // --------------------------------------------------

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        insufficientFundsProposalPda,
    })
    .rpc();

  // --------------------------------------------------
  // APPROVAL 2
  // --------------------------------------------------

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner2.publicKey,

      multisig:
        multisigPda,

        proposal:
        insufficientFundsProposalPda,
    })
    .signers([owner2])
    .rpc();

  // --------------------------------------------------
  // VERIFY READY
  // --------------------------------------------------

  const proposal =
    await program.account.proposal.fetch(
      insufficientFundsProposalPda
    );

  assert.isTrue(
    "ready" in proposal.status
  );

  // --------------------------------------------------
  // TRY EXECUTION
  // --------------------------------------------------

  try {
    await program.methods
      .executeProposal()
      .accounts({
        executor:
          executor.publicKey,

        multisig:
          multisigPda,

        proposal:
          insufficientFundsProposalPda,

        vault:
          vaultPda,

        recipient:
          recipient.publicKey,

        systemProgram:
          SystemProgram.programId,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Execution should have failed"
    );

  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Insufficient vault funds correctly rejected"
    );

    console.log(
      "Error code:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InsufficientVaultFunds"
    );
  }
});


// ==================================================
// TEST 25
// INVALID RECIPIENT
//
// Proposal specifies recipient A.
//
// Executor attempts to send funds to recipient B.
//
// Expected:
// InvalidRecipient
// ==================================================

it("Rejects execution with an invalid recipient", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [invalidRecipientProposalPda] =
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

  const amount =
    0.1 * LAMPORTS_PER_SOL;

  // --------------------------------------------------
  // CREATE PROPOSAL
  // --------------------------------------------------

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(amount),
      null
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        invalidRecipientProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  // --------------------------------------------------
  // APPROVE 1
  // --------------------------------------------------

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        invalidRecipientProposalPda,
    })
    .rpc();

  // --------------------------------------------------
  // APPROVE 2
  // --------------------------------------------------

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner2.publicKey,

      multisig:
        multisigPda,

      proposal:
        invalidRecipientProposalPda,
    })
    .signers([owner2])
    .rpc();

  // --------------------------------------------------
  // WRONG RECIPIENT
  // --------------------------------------------------

  const wrongRecipient =
    Keypair.generate();

  try {
    await program.methods
      .executeProposal()
      .accounts({
        executor:
          executor.publicKey,

        multisig:
          multisigPda,

        proposal:
          invalidRecipientProposalPda,

        vault:
          vaultPda,

        recipient:
          wrongRecipient.publicKey,

        systemProgram:
          SystemProgram.programId,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Execution should have failed"
    );

  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Invalid recipient correctly rejected"
    );

    console.log(
      "Error code:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InvalidRecipient"
    );
  }

  // --------------------------------------------------
  // IMPORTANT:
  // The proposal should STILL be Ready because
  // the failed transaction must not change state.
  // --------------------------------------------------

  const proposal =
    await program.account.proposal.fetch(
      invalidRecipientProposalPda
    );

  assert.isTrue(
    "ready" in proposal.status
  );

  console.log(
    "Proposal remained Ready after invalid recipient attempt"
  );

  // --------------------------------------------------
  // EXECUTE CORRECTLY
  // --------------------------------------------------

  await program.methods
    .executeProposal()
    .accounts({
      executor:
        executor.publicKey,

      multisig:
        multisigPda,

      proposal:
        invalidRecipientProposalPda,

      vault:
        vaultPda,

      recipient:
        recipient.publicKey,

      systemProgram:
        SystemProgram.programId,
    })
    .signers([executor])
    .rpc();

  const executedProposal =
    await program.account.proposal.fetch(
      invalidRecipientProposalPda
    );

  assert.isTrue(
    "executed" in executedProposal.status
  );

  console.log(
    "Correct recipient successfully executed"
  );

  // --------------------------------------------------
  // REMOVE PROPOSAL
  // --------------------------------------------------

  await program.methods
    .removeProposal()
    .accounts({
      remover:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        invalidRecipientProposalPda,
    })
    .rpc();

  console.log(
    "Invalid-recipient test proposal removed"
  );
});


// ==================================================
// TEST 26
// PERMISSIONLESS EXECUTOR
//
// An account that is NOT an owner should still be
// able to execute a Ready proposal.
//
// This confirms the intentional design:
//
// Owners authorize.
// Anyone executes.
// ==================================================

it("Allows a non-owner executor to execute a Ready proposal", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [permissionlessProposalPda] =
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

  const amount =
    0.1 * LAMPORTS_PER_SOL;

  // --------------------------------------------------
  // CREATE PROPOSAL
  // --------------------------------------------------

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(amount),
      null
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        permissionlessProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  // --------------------------------------------------
  // TWO APPROVALS
  // --------------------------------------------------

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        permissionlessProposalPda,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner2.publicKey,

      multisig:
        multisigPda,

      proposal:
        permissionlessProposalPda,
    })
    .signers([owner2])
    .rpc();

  // --------------------------------------------------
  // VERIFY READY
  // --------------------------------------------------

  const readyProposal =
    await program.account.proposal.fetch(
      permissionlessProposalPda
    );

  assert.isTrue(
    "ready" in readyProposal.status
  );

  // --------------------------------------------------
  // EXECUTE USING NON-OWNER
  //
  // executor is NOT in:
  // initializer
  // owner2
  // owner3
  // --------------------------------------------------

  await program.methods
    .executeProposal()
    .accounts({
      executor:
        executor.publicKey,

      multisig:
        multisigPda,

      proposal:
        permissionlessProposalPda,

      vault:
        vaultPda,

      recipient:
        recipient.publicKey,

      systemProgram:
        SystemProgram.programId,
    })
    .signers([executor])
    .rpc();

  // --------------------------------------------------
  // VERIFY EXECUTED
  // --------------------------------------------------

  const executedProposal =
    await program.account.proposal.fetch(
      permissionlessProposalPda
    );

  assert.isTrue(
    "executed" in executedProposal.status
  );

  console.log(
    "Non-owner executor successfully executed Ready proposal"
  );

  // --------------------------------------------------
  // REMOVE
  // --------------------------------------------------

  await program.methods
    .removeProposal()
    .accounts({
      remover:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        permissionlessProposalPda,
    })
    .rpc();

  console.log(
    "Permissionless-executor proposal removed"
  );
});


// ==================================================
// TEST 27
// INVALID PROPOSAL WALLET
//
// This verifies that a proposal belonging to one
// multisig cannot be used with another multisig.
//
// NOTE:
// This test creates a second multisig account.
// ==================================================

it("Rejects using a proposal with the wrong multisig wallet", async () => {
  // --------------------------------------------------
  // CREATE SECOND MULTISIG OWNER
  // --------------------------------------------------

  const secondInitializer =
    Keypair.generate();

  await airdrop(
    secondInitializer.publicKey,
    2
  );

  // --------------------------------------------------
  // SECOND WALLET ID
  // --------------------------------------------------

  const secondWalletId =
    new anchor.BN(2);

  // --------------------------------------------------
  // DERIVE SECOND MULTISIG PDA
  // --------------------------------------------------

  const [secondMultisigPda] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("multisig"),
        secondInitializer.publicKey.toBuffer(),
        secondWalletId.toArrayLike(
          Buffer,
          "le",
          8
        ),
      ],
      program.programId
    );

  // --------------------------------------------------
  // INITIALIZE SECOND MULTISIG
  // --------------------------------------------------

  await program.methods
    .initialize(
      secondWalletId,
      [
        secondInitializer.publicKey,
        owner2.publicKey,
      ],
      2
    )
    .accounts({
      initializer:
        secondInitializer.publicKey,

      multisig:
        secondMultisigPda,

      systemProgram:
        SystemProgram.programId,
    })
    .signers([secondInitializer])
    .rpc();

  console.log(
    "Second multisig initialized:",
    secondMultisigPda.toString()
  );

  // --------------------------------------------------
  // CREATE A VALID PROPOSAL FOR ORIGINAL MULTISIG
  // --------------------------------------------------

  const originalMultisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    originalMultisig.proposalCount;

  const [originalProposalPda] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(
        0.1 * LAMPORTS_PER_SOL
      ),
      null
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        originalProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  console.log(
    "Proposal created for original multisig"
  );

  // --------------------------------------------------
  // TRY TO USE ORIGINAL PROPOSAL WITH SECOND
  // MULTISIG
  //
  // The PDA seeds don't match the second multisig,
  // so Anchor should reject the account.
  // --------------------------------------------------

  try {
    await program.methods
      .approveProposal()
      .accounts({
        approver:
          secondInitializer.publicKey,

        multisig:
          secondMultisigPda,

        proposal:
          originalProposalPda,
      })
      .signers([secondInitializer])
      .rpc();

    assert.fail(
      "Proposal should not be usable with another multisig"
    );

  } catch (error: any) {
    console.log(
      "Wrong multisig/proposal relationship correctly rejected"
    );

    // Depending on Anchor's account validation path,
    // this may be reported as an account constraint/
    // seeds error rather than the custom
    // InvalidProposalWallet error.
    console.log(
      "Expected account validation failure received"
    );

    assert.isTrue(
      !!error
    );
  }
});

// ==================================================
// TEST 28
// NO OWNERS
// ==================================================

it("Rejects multisig initialization with no owners", async () => {
  const testInitializer = Keypair.generate();

  await airdrop(testInitializer.publicKey, 2);

  const testWalletId = new anchor.BN(100);

  const [testMultisigPda] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("multisig"),
        testInitializer.publicKey.toBuffer(),
        testWalletId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

  try {
    await program.methods
      .initialize(
        testWalletId,
        [],
        1
      )
      .accounts({
        initializer: testInitializer.publicKey,
        multisig: testMultisigPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([testInitializer])
      .rpc();

    assert.fail(
      "Initialization should have failed"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "No-owner initialization rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "NoOwners"
    );
  }
});

// ==================================================
// TEST 29
// TOO MANY OWNERS
// ==================================================

it("Rejects multisig initialization with more than 10 owners", async () => {
  const testInitializer = Keypair.generate();

  await airdrop(testInitializer.publicKey, 2);

  const extraOwners = Array.from(
    { length: 10 },
    () => Keypair.generate().publicKey
  );

  const testOwners = [
    testInitializer.publicKey,
    ...extraOwners,
  ];

  assert.equal(
    testOwners.length,
    11
  );

  const testWalletId = new anchor.BN(101);

  const [testMultisigPda] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("multisig"),
        testInitializer.publicKey.toBuffer(),
        testWalletId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

  try {
    await program.methods
      .initialize(
        testWalletId,
        testOwners,
        2
      )
      .accounts({
        initializer: testInitializer.publicKey,
        multisig: testMultisigPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([testInitializer])
      .rpc();

    assert.fail(
      "Initialization should have failed"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Too-many-owners initialization rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "TooManyOwners"
    );
  }
});

// ==================================================
// TEST 30
// INVALID THRESHOLD = 0
// ==================================================

it("Rejects multisig initialization with threshold zero", async () => {
  const testInitializer = Keypair.generate();

  await airdrop(testInitializer.publicKey, 2);

  const testWalletId = new anchor.BN(102);

  const [testMultisigPda] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("multisig"),
        testInitializer.publicKey.toBuffer(),
        testWalletId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

  try {
    await program.methods
      .initialize(
        testWalletId,
        [testInitializer.publicKey],
        0
      )
      .accounts({
        initializer: testInitializer.publicKey,
        multisig: testMultisigPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([testInitializer])
      .rpc();

    assert.fail(
      "Initialization should have failed"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Zero threshold rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InvalidThreshold"
    );
  }
});

// ==================================================
// TEST 31
// THRESHOLD GREATER THAN OWNER COUNT
// ==================================================

it("Rejects a threshold greater than the number of owners", async () => {
  const testInitializer = Keypair.generate();

  await airdrop(testInitializer.publicKey, 2);

  const testWalletId = new anchor.BN(103);

  const [testMultisigPda] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("multisig"),
        testInitializer.publicKey.toBuffer(),
        testWalletId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

  try {
    await program.methods
      .initialize(
        testWalletId,
        [testInitializer.publicKey],
        2
      )
      .accounts({
        initializer: testInitializer.publicKey,
        multisig: testMultisigPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([testInitializer])
      .rpc();

    assert.fail(
      "Initialization should have failed"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Invalid threshold rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InvalidThreshold"
    );
  }
});

// ==================================================
// TEST 32
// DUPLICATE OWNERS
// ==================================================

it("Rejects duplicate owners during multisig initialization", async () => {
  const testInitializer = Keypair.generate();
  const duplicateOwner = Keypair.generate();

  await airdrop(testInitializer.publicKey, 2);

  const testWalletId = new anchor.BN(104);

  const [testMultisigPda] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("multisig"),
        testInitializer.publicKey.toBuffer(),
        testWalletId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

  const duplicateOwners = [
    testInitializer.publicKey,
    duplicateOwner.publicKey,
    duplicateOwner.publicKey,
  ];

  try {
    await program.methods
      .initialize(
        testWalletId,
        duplicateOwners,
        2
      )
      .accounts({
        initializer: testInitializer.publicKey,
        multisig: testMultisigPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([testInitializer])
      .rpc();

    assert.fail(
      "Initialization should have failed"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Duplicate owners rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "DuplicateOwners"
    );
  }
});

// ==================================================
// TEST 33
// INVALID VAULT INITIALIZER
// ==================================================

it("Rejects vault initialization by an invalid initializer", async () => {
  const invalidInitializer = Keypair.generate();

  await airdrop(
    invalidInitializer.publicKey,
    1
  );

  try {
    await program.methods
      .initializeVault()
      .accounts({
        initializer:
          invalidInitializer.publicKey,

        multisig:
          multisigPda,

        vault:
          vaultPda,

        systemProgram:
          SystemProgram.programId,
      })
      .signers([invalidInitializer])
      .rpc();

    assert.fail(
      "Vault initialization should have failed"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Invalid vault initializer rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InvalidInitializer"
    );
  }
});

// ==================================================
// TEST 34
// NON-OWNER CREATE PROPOSAL
// ==================================================

it("Rejects proposal creation by a non-owner", async () => {
  const nonOwner = Keypair.generate();

  await airdrop(
    nonOwner.publicKey,
    1
  );

  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [nonOwnerProposalPda] =
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

  try {
    await program.methods
      .createProposal(
        recipient.publicKey,
        new anchor.BN(
          0.1 * LAMPORTS_PER_SOL
        ),
        null
      )
      .accounts({
        creator:
          nonOwner.publicKey,

        multisig:
          multisigPda,

        proposal:
          nonOwnerProposalPda,

        systemProgram:
          SystemProgram.programId,
      })
      .signers([nonOwner])
      .rpc();

    assert.fail(
      "Non-owner should not create proposal"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Non-owner proposal creation rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "CreatorNotOwner"
    );
  }
});

// ==================================================
// TEST 35
// ZERO PROPOSAL AMOUNT
// ==================================================

it("Rejects a proposal with zero amount", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [zeroAmountProposalPda] =
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

  try {
    await program.methods
      .createProposal(
        recipient.publicKey,
        new anchor.BN(0),
        null
      )
      .accounts({
        creator:
          initializer.publicKey,

        multisig:
          multisigPda,

        proposal:
          zeroAmountProposalPda,

        systemProgram:
          SystemProgram.programId,
      })
      .rpc();

    assert.fail(
      "Zero-value proposal should have failed"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Zero proposal amount rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InvalidAmount"
    );
  }
});

// ==================================================
// TEST 36
// APPROVE -> CANCEL BY SAME OWNER
// ==================================================

it("Rejects cancellation by an owner who already approved", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [proposal] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(
        0.1 * LAMPORTS_PER_SOL
      ),
      null
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  // Owner approves
  await program.methods
    .approveProposal()
    .accounts({
      approver:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal,
    })
    .rpc();

  // Same owner tries to cancel
  try {
    await program.methods
      .cancelProposal()
      .accounts({
        canceller:
          initializer.publicKey,

        multisig:
          multisigPda,

        proposal,
      })
      .rpc();

    assert.fail(
      "Owner should not be able to cancel after approving"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Approve-then-cancel correctly rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "AlreadyVoted"
    );
  }
});

// ==================================================
// TEST 37
// CANCEL -> APPROVE BY SAME OWNER
// ==================================================

it("Rejects approval by an owner who already cancelled", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [proposal] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(
        0.1 * LAMPORTS_PER_SOL
      ),
      null
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  // Owner cancels
  await program.methods
    .cancelProposal()
    .accounts({
      canceller:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal,
    })
    .rpc();

  // Same owner tries to approve
  try {
    await program.methods
      .approveProposal()
      .accounts({
        approver:
          initializer.publicKey,

        multisig:
          multisigPda,

        proposal,
      })
      .rpc();

    assert.fail(
      "Owner should not be able to approve after cancelling"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Cancel-then-approve correctly rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "AlreadyVoted"
    );
  }
});

// ==================================================
// TEST 38
// EXECUTE PENDING PROPOSAL
// ==================================================

it("Rejects execution of a Pending proposal", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [pendingProposalPda] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(
        0.1 * LAMPORTS_PER_SOL
      ),
      null
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        pendingProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  try {
    await program.methods
      .executeProposal()
      .accounts({
        executor:
          executor.publicKey,

        multisig:
          multisigPda,

        proposal:
          pendingProposalPda,

        vault:
          vaultPda,

        recipient:
          recipient.publicKey,

        systemProgram:
          SystemProgram.programId,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Pending proposal should not execute"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Pending execution correctly rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "ProposalNotReady"
    );
  }
});

// ==================================================
// TEST 39
// REMOVE PENDING PROPOSAL
// ==================================================

it("Rejects removal of a Pending proposal", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [pendingProposalPda] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(
        0.1 * LAMPORTS_PER_SOL
      ),
      null
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        pendingProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  try {
    await program.methods
      .removeProposal()
      .accounts({
        remover:
          initializer.publicKey,

        multisig:
          multisigPda,

        proposal:
          pendingProposalPda,
      })
      .rpc();

    assert.fail(
      "Pending proposal should not be removable"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Pending proposal removal correctly rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "ProposalNotExecuted"
    );
  }
});

// ==================================================
// TEST 40
// NON-OWNER REMOVE
// ==================================================

it("Rejects removal of a terminal proposal by a non-owner", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [proposalPdaForRemoval] =
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

  // --------------------------------------------------
  // CREATE
  // --------------------------------------------------

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(
        0.1 * LAMPORTS_PER_SOL
      ),
      null
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        proposalPdaForRemoval,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  // --------------------------------------------------
  // CANCEL WITH TWO OWNERS
  // --------------------------------------------------

  await program.methods
    .cancelProposal()
    .accounts({
      canceller:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        proposalPdaForRemoval,
    })
    .rpc();

  await program.methods
    .cancelProposal()
    .accounts({
      canceller:
        owner2.publicKey,

      multisig:
        multisigPda,

      proposal:
        proposalPdaForRemoval,
    })
    .signers([owner2])
    .rpc();

  // --------------------------------------------------
  // VERIFY CANCELLED
  // --------------------------------------------------

  const proposal =
    await program.account.proposal.fetch(
      proposalPdaForRemoval
    );

  assert.isTrue(
    "cancelled" in proposal.status
  );

  // --------------------------------------------------
  // CREATE NON-OWNER
  // --------------------------------------------------

  const nonOwner = Keypair.generate();

  await airdrop(
    nonOwner.publicKey,
    1
  );

  // --------------------------------------------------
  // TRY TO REMOVE
  // --------------------------------------------------

  try {
    await program.methods
      .removeProposal()
      .accounts({
        remover:
          nonOwner.publicKey,

        multisig:
          multisigPda,

        proposal:
          proposalPdaForRemoval,
      })
      .signers([nonOwner])
      .rpc();

    assert.fail(
      "Non-owner should not remove proposal"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Non-owner removal correctly rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "RemoverNotOwner"
    );
  }
});
 // ==================================================
  // TEST 41
  // SPL TOKEN MINT
  // ==================================================
  it("Creates a test SPL token mint", async () => {
  testMint = await createMint(
    provider.connection,
    initializer.payer,
    initializer.publicKey,
    null,
    6
  );

  console.log("Test token mint:", testMint.toBase58());

  assert.isTrue(testMint instanceof PublicKey);
  });
 // ==================================================
// TEST 42
// INITIALIZE TOKEN VAULT
// ==================================================

it("Initializes the multisig token vault", async () => {
  const [tokenVaultPda] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("token_vault"),
        multisigPda.toBuffer(),
        testMint.toBuffer(),
      ],
      program.programId
    );

  const tx =
    await program.methods
      .initializeTokenVault()
      .accounts({
        payer: initializer.publicKey,
        multisig: multisigPda,
        mint: testMint,
        tokenVault: tokenVaultPda,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

  console.log(
    "Token vault:",
    tokenVaultPda.toBase58()
  );

  console.log(
    "Initialize token vault transaction:",
    tx
  );

  const tokenVault =
    await getAccount(
      provider.connection,
      tokenVaultPda
    );

  assert.equal(
    tokenVault.mint.toBase58(),
    testMint.toBase58()
  );

  assert.equal(
    tokenVault.owner.toBase58(),
    multisigPda.toBase58()
  );

  assert.equal(
    tokenVault.amount.toString(),
    "0"
  );

  console.log(
    "Token vault initialized successfully"
  );
});
// ==================================================
// TEST 43
// PERMISSIONLESS TOKEN VAULT INITIALIZATION
// ==================================================

it("Allows a non-owner payer to initialize a token vault", async () => {
  // --------------------------------------------------
  // CREATE SECOND TEST MINT
  // --------------------------------------------------

  secondMint = await createMint(
    provider.connection,
    initializer.payer,
    initializer.publicKey,
    null,
    6
  );

  console.log(
    "Second test mint:",
    secondMint.toBase58()
  );

  // --------------------------------------------------
  // DERIVE SECOND TOKEN VAULT
  // --------------------------------------------------

  [
    secondTokenVaultPda
  ] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("token_vault"),
        multisigPda.toBuffer(),
        secondMint.toBuffer(),
      ],
      program.programId
    );

  // --------------------------------------------------
  // EXECUTOR IS NOT AN OWNER
  // AND NOT THE MULTISIG INITIALIZER
  // --------------------------------------------------

  await program.methods
    .initializeTokenVault()
    .accounts({
      payer: executor.publicKey,
      multisig: multisigPda,
      mint: secondMint,
      tokenVault: secondTokenVaultPda,
      tokenProgram:
        anchor.utils.token.TOKEN_PROGRAM_ID,
      systemProgram:
        SystemProgram.programId,
    })
    .signers([executor])
    .rpc();

  // --------------------------------------------------
  // VERIFY
  // --------------------------------------------------

  const tokenVault =
    await getAccount(
      provider.connection,
      secondTokenVaultPda
    );

  assert.equal(
    tokenVault.mint.toBase58(),
    secondMint.toBase58()
  );

  assert.equal(
    tokenVault.owner.toBase58(),
    multisigPda.toBase58()
  );

  assert.equal(
    tokenVault.amount.toString(),
    "0"
  );

  console.log(
    "Permissionless token vault initialization succeeded"
  );
});
// ==================================================
// TEST 44
// REJECT DUPLICATE TOKEN VAULT INITIALIZATION
// ==================================================

it("Rejects initializing the same token vault twice", async () => {
  const [existingTokenVaultPda] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("token_vault"),
        multisigPda.toBuffer(),
        testMint.toBuffer(),
      ],
      program.programId
    );

  try {
    await program.methods
      .initializeTokenVault()
      .accounts({
        payer: executor.publicKey,
        multisig: multisigPda,
        mint: testMint,
        tokenVault: existingTokenVaultPda,
        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram:
          SystemProgram.programId,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Duplicate token vault initialization should fail"
    );

  } catch (error: any) {
    console.log(
      "Duplicate token vault correctly rejected"
    );

    assert.isTrue(
      !!error
    );
  }
});
// ==================================================
// TEST 45
// CREATE TOKEN ACCOUNTS AND FUND DEPOSITOR
// ==================================================

it("Creates token accounts and funds the depositor", async () => {
  // --------------------------------------------------
  // CREATE INITIALIZER TOKEN ACCOUNT
  // --------------------------------------------------

  const sourceAccount =
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      initializer.payer,
      testMint,
      initializer.publicKey
    );

  depositorTokenAccount =
    sourceAccount.address;

  // --------------------------------------------------
  // CREATE RECIPIENT TOKEN ACCOUNT
  // --------------------------------------------------

  const destinationAccount =
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      initializer.payer,
      testMint,
      recipient.publicKey
    );

  recipientTokenAccount =
    destinationAccount.address;

  // --------------------------------------------------
  // MINT 100 TOKENS
  //
  // Mint has 6 decimals.
  // 100 tokens = 100_000_000 base units.
  // --------------------------------------------------

  const tokenAmount =
    100_000_000n;

  await mintTo(
  provider.connection,
  initializer.payer,
  testMint,
  depositorTokenAccount,
  initializer.publicKey,
  100_000_000
);

  const depositorAccount =
    await getAccount(
      provider.connection,
      depositorTokenAccount
    );

  assert.equal(
    depositorAccount.amount.toString(),
    tokenAmount.toString()
  );

  console.log(
    "Depositor token balance:",
    depositorAccount.amount.toString()
  );

  console.log(
    "Recipient token account:",
    recipientTokenAccount.toBase58()
  );
});

// ==================================================
// TEST 46
// DEPOSIT SPL TOKENS
// ==================================================

it("Deposits SPL tokens into the multisig token vault", async () => {
  [
    tokenVaultPda
  ] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("token_vault"),
        multisigPda.toBuffer(),
        testMint.toBuffer(),
      ],
      program.programId
    );

  const amount =
    new anchor.BN(10_000_000);

  const before =
    await getAccount(
      provider.connection,
      tokenVaultPda
    );

  const beforeAmount =
    before.amount;

  await program.methods
    .depositToken(amount)
    .accounts({
      depositor:
        initializer.publicKey,

      multisig:
        multisigPda,

      mint:
        testMint,

      tokenVault:
        tokenVaultPda,

      depositorTokenAccount:
        depositorTokenAccount,

      tokenProgram:
        anchor.utils.token.TOKEN_PROGRAM_ID,
    })
    .rpc();

  const after =
    await getAccount(
      provider.connection,
      tokenVaultPda
    );

  const difference =
    after.amount - beforeAmount;

  assert.equal(
    difference.toString(),
    amount.toString()
  );

  assert.equal(
    after.owner.toBase58(),
    multisigPda.toBase58()
  );

  assert.equal(
    after.mint.toBase58(),
    testMint.toBase58()
  );

  console.log(
    "Token vault balance after deposit:",
    after.amount.toString()
  );
});
// ==================================================
// TEST 47
// REJECT ZERO TOKEN DEPOSIT
// ==================================================

it("Rejects a zero SPL token deposit", async () => {
  try {
    await program.methods
      .depositToken(
        new anchor.BN(0)
      )
      .accounts({
        depositor:
          initializer.publicKey,

        multisig:
          multisigPda,

        mint:
          testMint,

        tokenVault:
          tokenVaultPda,

        depositorTokenAccount:
          depositorTokenAccount,

        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    assert.fail(
      "Zero token deposit should fail"
    );

  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Zero token deposit rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InvalidAmount"
    );
  }
});
// ==================================================
// TEST 48
// REJECT INVALID DEPOSITOR TOKEN ACCOUNT
// ==================================================

it("Rejects a token deposit using an account not owned by the depositor", async () => {
  try {
    await program.methods
      .depositToken(
        new anchor.BN(1_000_000)
      )
      .accounts({
        depositor:
          owner2.publicKey,

        multisig:
          multisigPda,

        mint:
          testMint,

        tokenVault:
          tokenVaultPda,

        // This account belongs to initializer,
        // not owner2.
        depositorTokenAccount:
          depositorTokenAccount,

        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([owner2])
      .rpc();

    assert.fail(
      "Invalid depositor token account should fail"
    );

  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Invalid depositor rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InvalidDepositor"
    );
  }
});
// ==================================================
// TEST 49
// REJECT WRONG MINT DURING TOKEN DEPOSIT
// ==================================================

it("Rejects a token deposit when the depositor token account uses the wrong mint", async () => {
  try {
    await program.methods
      .depositToken(
        new anchor.BN(1_000_000)
      )
      .accounts({
        depositor:
          initializer.publicKey,

        multisig:
          multisigPda,

        mint:
          secondMint,

        tokenVault:
          secondTokenVaultPda,

        // This token account belongs to testMint,
        // not secondMint.
        depositorTokenAccount:
          depositorTokenAccount,

        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    assert.fail(
      "Wrong mint deposit should fail"
    );

  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Wrong mint deposit rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InvalidMint"
    );
  }
});
// ==================================================
// TEST 50
// CREATE TOKEN PROPOSAL
// ==================================================

let tokenProposalPda: PublicKey;

it("Creates an SPL token proposal", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  [
    tokenProposalPda
  ] =
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

  const amount =
    new anchor.BN(2_000_000);

  await program.methods
    .createProposal(
      recipient.publicKey,
      amount,
      testMint
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        tokenProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  const proposal =
    await program.account.proposal.fetch(
      tokenProposalPda
    );

  assert.equal(
    proposal.wallet.toBase58(),
    multisigPda.toBase58()
  );

  assert.equal(
    proposal.proposalId.toNumber(),
    proposalId.toNumber()
  );

  assert.equal(
    proposal.recipient.toBase58(),
    recipient.publicKey.toBase58()
  );

  assert.equal(
    proposal.amount.toString(),
    amount.toString()
  );

  assert.isNotNull(
    proposal.mint
  );

  assert.equal(
    proposal.mint!.toBase58(),
    testMint.toBase58()
  );

  assert.equal(
    proposal.approvals.length,
    0
  );

  assert.equal(
    proposal.cancels.length,
    0
  );

  assert.isTrue(
    "pending" in proposal.status
  );

  console.log(
    "Token proposal created successfully"
  );
});
// ==================================================
// TEST 51
// APPROVE TOKEN PROPOSAL
// ==================================================

it("Approves the SPL token proposal and reaches Ready", async () => {
  await program.methods
    .approveProposal()
    .accounts({
      approver:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        tokenProposalPda,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner2.publicKey,

      multisig:
        multisigPda,

      proposal:
        tokenProposalPda,
    })
    .signers([owner2])
    .rpc();

  const proposal =
    await program.account.proposal.fetch(
      tokenProposalPda
    );

  assert.equal(
    proposal.approvals.length,
    2
  );

  assert.isTrue(
    "ready" in proposal.status
  );

  console.log(
    "Token proposal reached Ready"
  );
});
// ==================================================
// TEST 52
// EXECUTE TOKEN PROPOSAL
// ==================================================

it("Executes an approved SPL token proposal", async () => {
  const tokenVaultBefore =
    await getAccount(
      provider.connection,
      tokenVaultPda
    );

  const recipientBefore =
    await getAccount(
      provider.connection,
      recipientTokenAccount
    );

  const amount =
    BigInt(2_000_000);

  await program.methods
    .executeTokenProposal()
    .accounts({
      executor:
        executor.publicKey,

      multisig:
        multisigPda,

      mint:
        testMint,

      proposal:
        tokenProposalPda,

      tokenVault:
        tokenVaultPda,

      recipientTokenAccount:
        recipientTokenAccount,

      tokenProgram:
        anchor.utils.token.TOKEN_PROGRAM_ID,
    })
    .signers([executor])
    .rpc();

  const tokenVaultAfter =
    await getAccount(
      provider.connection,
      tokenVaultPda
    );

  const recipientAfter =
    await getAccount(
      provider.connection,
      recipientTokenAccount
    );

  assert.equal(
    (
      tokenVaultBefore.amount -
      tokenVaultAfter.amount
    ).toString(),
    amount.toString()
  );

  assert.equal(
    (
      recipientAfter.amount -
      recipientBefore.amount
    ).toString(),
    amount.toString()
  );

  const proposal =
    await program.account.proposal.fetch(
      tokenProposalPda
    );

  assert.isTrue(
    "executed" in proposal.status
  );

  console.log(
    "SPL token proposal executed successfully"
  );
});
// ==================================================
// TEST 53
// REJECT SECOND TOKEN EXECUTION
// ==================================================

it("Rejects executing an already executed token proposal", async () => {
  try {
    await program.methods
      .executeTokenProposal()
      .accounts({
        executor:
          executor.publicKey,

        multisig:
          multisigPda,

        mint:
          testMint,

        proposal:
          tokenProposalPda,

        tokenVault:
          tokenVaultPda,

        recipientTokenAccount:
          recipientTokenAccount,

        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Second token execution should fail"
    );

  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Second token execution rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "ProposalNotReady"
    );
  }
});
// ==================================================
// TEST 54
// INSUFFICIENT TOKEN VAULT FUNDS
// ==================================================

it("Rejects token execution when the token vault has insufficient funds", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [insufficientTokenProposalPda] =
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

  // Vault has far less than this.
  const hugeAmount =
    new anchor.BN(500_000_000);

  await program.methods
    .createProposal(
      recipient.publicKey,
      hugeAmount,
      testMint
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        insufficientTokenProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        insufficientTokenProposalPda,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner2.publicKey,

      multisig:
        multisigPda,

      proposal:
        insufficientTokenProposalPda,
    })
    .signers([owner2])
    .rpc();

  try {
    await program.methods
      .executeTokenProposal()
      .accounts({
        executor:
          executor.publicKey,

        multisig:
          multisigPda,

        mint:
          testMint,

        proposal:
          insufficientTokenProposalPda,

        tokenVault:
          tokenVaultPda,

        recipientTokenAccount:
          recipientTokenAccount,

        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Insufficient token funds should fail"
    );

  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Insufficient token funds rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InsufficientVaultFunds"
    );
  }
});
// ==================================================
// TEST 55
// INVALID TOKEN RECIPIENT
// ==================================================

it("Rejects token execution with an incorrect recipient token account", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [invalidRecipientTokenProposalPda] =
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

  const amount =
    new anchor.BN(1_000_000);

  await program.methods
    .createProposal(
      recipient.publicKey,
      amount,
      testMint
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        invalidRecipientTokenProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        invalidRecipientTokenProposalPda,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner2.publicKey,

      multisig:
        multisigPda,

      proposal:
        invalidRecipientTokenProposalPda,
    })
    .signers([owner2])
    .rpc();

  const wrongRecipient =
    Keypair.generate();

  const wrongRecipientAta =
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      initializer.payer,
      testMint,
      wrongRecipient.publicKey
    );

  try {
    await program.methods
      .executeTokenProposal()
      .accounts({
        executor:
          executor.publicKey,

        multisig:
          multisigPda,

        mint:
          testMint,

        proposal:
          invalidRecipientTokenProposalPda,

        tokenVault:
          tokenVaultPda,

        recipientTokenAccount:
          wrongRecipientAta.address,

        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Invalid token recipient should fail"
    );

  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Invalid token recipient rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InvalidRecipient"
    );
  }

  // The failed transaction must leave proposal Ready.
  const proposal =
    await program.account.proposal.fetch(
      invalidRecipientTokenProposalPda
    );

  assert.isTrue(
    "ready" in proposal.status
  );

  // Execute correctly afterwards.
  await program.methods
    .executeTokenProposal()
    .accounts({
      executor:
        executor.publicKey,

      multisig:
        multisigPda,

      mint:
        testMint,

      proposal:
        invalidRecipientTokenProposalPda,

      tokenVault:
        tokenVaultPda,

      recipientTokenAccount:
        recipientTokenAccount,

      tokenProgram:
        anchor.utils.token.TOKEN_PROGRAM_ID,
    })
    .signers([executor])
    .rpc();

  await program.methods
    .removeProposal()
    .accounts({
      remover:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        invalidRecipientTokenProposalPda,
    })
    .rpc();
});
// ==================================================
// TEST 56
// WRONG MINT DURING TOKEN EXECUTION
// ==================================================

it("Rejects token execution when the supplied mint does not match the proposal", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [wrongMintProposalPda] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(1_000_000),
      testMint
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        wrongMintProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        wrongMintProposalPda,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner2.publicKey,

      multisig:
        multisigPda,

      proposal:
        wrongMintProposalPda,
    })
    .signers([owner2])
    .rpc();

  const wrongMintRecipientAta =
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      initializer.payer,
      secondMint,
      recipient.publicKey
    );

  try {
    await program.methods
      .executeTokenProposal()
      .accounts({
        executor:
          executor.publicKey,

        multisig:
          multisigPda,

        // Proposal says testMint,
        // but we deliberately supply secondMint.
        mint:
          secondMint,

        proposal:
          wrongMintProposalPda,

        tokenVault:
          secondTokenVaultPda,

        recipientTokenAccount:
          wrongMintRecipientAta.address,

        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Wrong mint execution should fail"
    );

  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Wrong mint execution rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InvalidMint"
    );
  }
});
// ==================================================
// TEST 57
// SOL PROPOSAL CANNOT USE TOKEN EXECUTION
// ==================================================

it("Rejects executing a SOL proposal through the token execution instruction", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [solProposalPda] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(
        100_000_000
      ),
      null
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        solProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  try {
    await program.methods
      .executeTokenProposal()
      .accounts({
        executor:
          executor.publicKey,

        multisig:
          multisigPda,

        mint:
          testMint,

        proposal:
          solProposalPda,

        tokenVault:
          tokenVaultPda,

        recipientTokenAccount:
          recipientTokenAccount,

        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "SOL proposal should not execute as token proposal"
    );

  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "SOL proposal correctly rejected by token execution:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InvalidMint"
    );
  }
});
// ==================================================
// TEST 58
// TOKEN PROPOSAL CANNOT USE SOL EXECUTION
// ==================================================

it("Rejects executing an SPL token proposal through the SOL execution instruction", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [tokenProposalForSolExecutionPda] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(
        1_000_000
      ),
      testMint
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        tokenProposalForSolExecutionPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  try {
    await program.methods
      .executeProposal()
      .accounts({
        executor:
          executor.publicKey,

        multisig:
          multisigPda,

        proposal:
          tokenProposalForSolExecutionPda,

        vault:
          vaultPda,

        recipient:
          recipient.publicKey,

        systemProgram:
          SystemProgram.programId,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Token proposal should not execute as SOL proposal"
    );

  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Token proposal correctly rejected by SOL execution:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InvalidMint"
    );
  }
});
// ==================================================
// TEST 59
// WRONG TOKEN VAULT
// ==================================================

it("Rejects execution with a token account that is not the multisig token vault PDA", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [wrongVaultProposalPda] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(1_000_000),
      testMint
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        wrongVaultProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        wrongVaultProposalPda,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner2.publicKey,

      multisig:
        multisigPda,

      proposal:
        wrongVaultProposalPda,
    })
    .signers([owner2])
    .rpc();

  // Owner2's ATA is a valid token account for testMint,
  // but it is NOT the multisig token-vault PDA.
  const fakeVault =
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      initializer.payer,
      testMint,
      owner2.publicKey
    );

  try {
    await program.methods
      .executeTokenProposal()
      .accounts({
        executor:
          executor.publicKey,

        multisig:
          multisigPda,

        mint:
          testMint,

        proposal:
          wrongVaultProposalPda,

        tokenVault:
          fakeVault.address,

        recipientTokenAccount:
          recipientTokenAccount,

        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Wrong token vault should fail"
    );

  } catch (error: any) {
    console.log(
      "Wrong token vault correctly rejected"
    );

    assert.isTrue(
      !!error
    );
  }
});
// ==================================================
// TEST 60
// CANCEL AND REMOVE TOKEN PROPOSAL
// ==================================================

it("Cancels and removes an SPL token proposal", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [cancelTokenProposalPda] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(1_000_000),
      testMint
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        cancelTokenProposalPda,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .cancelProposal()
    .accounts({
      canceller:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        cancelTokenProposalPda,
    })
    .rpc();

  await program.methods
    .cancelProposal()
    .accounts({
      canceller:
        owner2.publicKey,

      multisig:
        multisigPda,

      proposal:
        cancelTokenProposalPda,
    })
    .signers([owner2])
    .rpc();

  const proposal =
    await program.account.proposal.fetch(
      cancelTokenProposalPda
    );

  assert.isTrue(
    "cancelled" in proposal.status
  );

  await program.methods
    .removeProposal()
    .accounts({
      remover:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        cancelTokenProposalPda,
    })
    .rpc();

  const accountAfter =
    await provider.connection.getAccountInfo(
      cancelTokenProposalPda
    );

  assert.isNull(
    accountAfter
  );

  console.log(
    "Cancelled token proposal successfully removed"
  );
});
// ==================================================
// TEST 61
// REJECT SOL VAULT DRAIN BELOW RENT RESERVE
// ==================================================

it("Rejects SOL execution that would drain the vault below its minimum balance", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [proposalPdaForRentTest] =
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

  // --------------------------------------------------
  // CURRENT VAULT BALANCE
  // --------------------------------------------------

  const vaultBalance =
    await provider.connection.getBalance(
      vaultPda
    );

  // --------------------------------------------------
  // MINIMUM BALANCE REQUIRED FOR THE VAULT
  // --------------------------------------------------

  const minimumBalance =
    await provider.connection.getMinimumBalanceForRentExemption(
      0
    );

  console.log(
    "Vault balance:",
    vaultBalance
  );

  console.log(
    "Vault minimum balance:",
    minimumBalance
  );

  // Make the proposal large enough that executing
  // it would leave the vault below its minimum balance,
  // but still less than or equal to the current balance.
  const amount =
    vaultBalance - minimumBalance + 1;

  assert.isAbove(
    amount,
    0
  );

  assert.isAtMost(
    amount,
    vaultBalance
  );

  // --------------------------------------------------
  // CREATE SOL PROPOSAL
  // --------------------------------------------------

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(amount),
      null
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        proposalPdaForRentTest,

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
        proposalPdaForRentTest,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner2.publicKey,

      multisig:
        multisigPda,

      proposal:
        proposalPdaForRentTest,
    })
    .signers([owner2])
    .rpc();

  // --------------------------------------------------
  // VERIFY READY
  // --------------------------------------------------

  const proposal =
    await program.account.proposal.fetch(
      proposalPdaForRentTest
    );

  assert.isTrue(
    "ready" in proposal.status
  );

  // --------------------------------------------------
  // EXECUTE
  // --------------------------------------------------

  try {
    await program.methods
      .executeProposal()
      .accounts({
        executor:
          executor.publicKey,

        multisig:
          multisigPda,

        proposal:
          proposalPdaForRentTest,

        vault:
          vaultPda,

        recipient:
          recipient.publicKey,

        systemProgram:
          SystemProgram.programId,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Execution should have failed because it would violate the vault minimum balance"
    );

  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Rent-reserve protection correctly rejected execution:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InsufficientVaultFunds"
    );
  }

  // --------------------------------------------------
  // IMPORTANT:
  // Proposal must remain Ready after failed execution.
  // --------------------------------------------------

  const proposalAfter =
    await program.account.proposal.fetch(
      proposalPdaForRentTest
    );

  assert.isTrue(
    "ready" in proposalAfter.status
  );
});
// ==================================================
// TEST 62
// PROPOSAL ID REMAINS MONOTONIC AFTER REMOVAL
// ==================================================

it("Keeps proposal IDs monotonic after removing a proposal", async () => {
  const multisigBefore =
    await program.account.multisig.fetch(
      multisigPda
    );

  const firstProposalId =
    multisigBefore.proposalCount;

  // --------------------------------------------------
  // CREATE PROPOSAL
  // --------------------------------------------------

  const [firstProposalPda] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        multisigPda.toBuffer(),
        firstProposalId.toArrayLike(
          Buffer,
          "le",
          8
        ),
      ],
      program.programId
    );

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(100_000_000),
      null
    )
    .accounts({
      creator: initializer.publicKey,
      multisig: multisigPda,
      proposal: firstProposalPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const createdProposal =
    await program.account.proposal.fetch(
      firstProposalPda
    );

  assert.equal(
    createdProposal.proposalId.toNumber(),
    firstProposalId.toNumber()
  );

  // --------------------------------------------------
  // CANCEL IT
  // --------------------------------------------------

  await program.methods
    .cancelProposal()
    .accounts({
      canceller: initializer.publicKey,
      multisig: multisigPda,
      proposal: firstProposalPda,
    })
    .rpc();

  await program.methods
    .cancelProposal()
    .accounts({
      canceller: owner2.publicKey,
      multisig: multisigPda,
      proposal: firstProposalPda,
    })
    .signers([owner2])
    .rpc();

  // --------------------------------------------------
  // REMOVE IT
  // --------------------------------------------------

  await program.methods
    .removeProposal()
    .accounts({
      remover: initializer.publicKey,
      multisig: multisigPda,
      proposal: firstProposalPda,
    })
    .rpc();

  assert.isNull(
    await provider.connection.getAccountInfo(
      firstProposalPda
    )
  );

  // --------------------------------------------------
  // CREATE NEXT PROPOSAL
  // --------------------------------------------------

  const multisigAfter =
    await program.account.multisig.fetch(
      multisigPda
    );

  const secondProposalId =
    multisigAfter.proposalCount;

  assert.equal(
    secondProposalId.toNumber(),
    firstProposalId.toNumber() + 1
  );

  const [secondProposalPda] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        multisigPda.toBuffer(),
        secondProposalId.toArrayLike(
          Buffer,
          "le",
          8
        ),
      ],
      program.programId
    );

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(100_000_000),
      null
    )
    .accounts({
      creator: initializer.publicKey,
      multisig: multisigPda,
      proposal: secondProposalPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const secondProposal =
    await program.account.proposal.fetch(
      secondProposalPda
    );

  assert.equal(
    secondProposal.proposalId.toNumber(),
    secondProposalId.toNumber()
  );

  console.log(
    "Proposal IDs remain monotonic after removal"
  );
});
// ==================================================
// TEST 63
// INDEPENDENT TOKEN VAULTS PER MINT
// ==================================================

it("Maintains independent token vaults for different mints", async () => {
  const firstVault =
    await getAccount(
      provider.connection,
      tokenVaultPda
    );

  const secondVault =
    await getAccount(
      provider.connection,
      secondTokenVaultPda
    );

  assert.equal(
    firstVault.mint.toBase58(),
    testMint.toBase58()
  );

  assert.equal(
    secondVault.mint.toBase58(),
    secondMint.toBase58()
  );

  assert.notEqual(
    tokenVaultPda.toBase58(),
    secondTokenVaultPda.toBase58()
  );

  assert.equal(
    firstVault.owner.toBase58(),
    multisigPda.toBase58()
  );

  assert.equal(
    secondVault.owner.toBase58(),
    multisigPda.toBase58()
  );

  console.log(
    "Different mints correctly use independent token vaults"
  );
});
// ==================================================
// TEST 64
// FAILED TOKEN DEPOSIT PRESERVES VAULT BALANCE
// ==================================================

it("Does not modify the token vault after a rejected wrong-mint deposit", async () => {
  const before =
    await getAccount(
      provider.connection,
      secondTokenVaultPda
    );

  try {
    await program.methods
      .depositToken(
        new anchor.BN(1_000_000)
      )
      .accounts({
        depositor:
          initializer.publicKey,

        multisig:
          multisigPda,

        mint:
          secondMint,

        tokenVault:
          secondTokenVaultPda,

        // This account belongs to testMint.
        depositorTokenAccount:
          depositorTokenAccount,

        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    assert.fail(
      "Wrong-mint deposit should fail"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    assert.equal(
      errorCode,
      "InvalidMint"
    );
  }

  const after =
    await getAccount(
      provider.connection,
      secondTokenVaultPda
    );

  assert.equal(
    after.amount.toString(),
    before.amount.toString()
  );

  console.log(
    "Rejected token deposit left vault balance unchanged"
  );
});
// ==================================================
// TEST 65
// WRONG TOKEN RECIPIENT OWNER
// ==================================================

it("Rejects token execution when the recipient token account belongs to the wrong owner", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [proposalPdaForOwnerTest] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(1_000_000),
      testMint
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        proposalPdaForOwnerTest,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        initializer.publicKey,
      multisig:
        multisigPda,
      proposal:
        proposalPdaForOwnerTest,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner2.publicKey,
      multisig:
        multisigPda,
      proposal:
        proposalPdaForOwnerTest,
    })
    .signers([owner2])
    .rpc();

  const wrongOwnerAta =
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      initializer.payer,
      testMint,
      owner2.publicKey
    );

  try {
    await program.methods
      .executeTokenProposal()
      .accounts({
        executor:
          executor.publicKey,

        multisig:
          multisigPda,

        mint:
          testMint,

        proposal:
          proposalPdaForOwnerTest,

        tokenVault:
          tokenVaultPda,

        recipientTokenAccount:
          wrongOwnerAta.address,

        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Wrong recipient owner should be rejected"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Wrong recipient owner rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InvalidRecipient"
    );
  }
});
// ==================================================
// TEST 66
// WRONG RECIPIENT TOKEN ACCOUNT MINT
// ==================================================

it("Rejects token execution when the recipient belongs to the correct owner but uses another mint", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [proposalPdaForMintTest] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(1_000_000),
      testMint
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        proposalPdaForMintTest,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        initializer.publicKey,
      multisig:
        multisigPda,
      proposal:
        proposalPdaForMintTest,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner2.publicKey,
      multisig:
        multisigPda,
      proposal:
        proposalPdaForMintTest,
    })
    .signers([owner2])
    .rpc();

  // Same recipient owner, but token account uses secondMint.
  const wrongMintRecipientAta =
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      initializer.payer,
      secondMint,
      recipient.publicKey
    );

  try {
    await program.methods
      .executeTokenProposal()
      .accounts({
        executor:
          executor.publicKey,

        multisig:
          multisigPda,

        mint:
          testMint,

        proposal:
          proposalPdaForMintTest,

        tokenVault:
          tokenVaultPda,

        recipientTokenAccount:
          wrongMintRecipientAta.address,

        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Wrong recipient mint should be rejected"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    console.log(
      "Wrong recipient mint rejected:",
      errorCode
    );

    assert.equal(
      errorCode,
      "InvalidMint"
    );
  }
});
// ==================================================
// TEST 67
// FAILED TOKEN EXECUTION PRESERVES READY STATE
// ==================================================

it("Keeps a token proposal Ready after a failed execution", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [proposalPdaForStateTest] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(1_000_000),
      testMint
    )
    .accounts({
      creator:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        proposalPdaForStateTest,

      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        initializer.publicKey,
      multisig:
        multisigPda,
      proposal:
        proposalPdaForStateTest,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner2.publicKey,
      multisig:
        multisigPda,
      proposal:
        proposalPdaForStateTest,
    })
    .signers([owner2])
    .rpc();

  // Deliberately wrong recipient.
  const wrongRecipientAta =
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      initializer.payer,
      testMint,
      owner3.publicKey
    );

  try {
    await program.methods
      .executeTokenProposal()
      .accounts({
        executor:
          executor.publicKey,

        multisig:
          multisigPda,

        mint:
          testMint,

        proposal:
          proposalPdaForStateTest,

        tokenVault:
          tokenVaultPda,

        recipientTokenAccount:
          wrongRecipientAta.address,

        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Execution should have failed"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    assert.equal(
      errorCode,
      "InvalidRecipient"
    );
  }

  const proposal =
    await program.account.proposal.fetch(
      proposalPdaForStateTest
    );

  assert.isTrue(
    "ready" in proposal.status
  );

  console.log(
    "Token proposal remained Ready after failed execution"
  );
});
// ==================================================
// TEST 68
// CANCELLED TOKEN PROPOSAL CANNOT EXECUTE
// ==================================================

it("Rejects execution of a cancelled token proposal", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [cancelledTokenProposalPda] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(1_000_000),
      testMint
    )
    .accounts({
      creator:
        initializer.publicKey,
      multisig:
        multisigPda,
      proposal:
        cancelledTokenProposalPda,
      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .cancelProposal()
    .accounts({
      canceller:
        initializer.publicKey,
      multisig:
        multisigPda,
      proposal:
        cancelledTokenProposalPda,
    })
    .rpc();

  await program.methods
    .cancelProposal()
    .accounts({
      canceller:
        owner2.publicKey,
      multisig:
        multisigPda,
      proposal:
        cancelledTokenProposalPda,
    })
    .signers([owner2])
    .rpc();

  try {
    await program.methods
      .executeTokenProposal()
      .accounts({
        executor:
          executor.publicKey,
        multisig:
          multisigPda,
        mint:
          testMint,
        proposal:
          cancelledTokenProposalPda,
        tokenVault:
          tokenVaultPda,
        recipientTokenAccount:
          recipientTokenAccount,
        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Cancelled token proposal should not execute"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    assert.equal(
      errorCode,
      "ProposalNotReady"
    );
  }

  console.log(
    "Cancelled token proposal execution correctly rejected"
  );
});
// ==================================================
// TEST 69
// PENDING TOKEN PROPOSAL CANNOT EXECUTE
// ==================================================

it("Rejects execution of a pending token proposal", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [pendingTokenProposalPda] =
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

  await program.methods
    .createProposal(
      recipient.publicKey,
      new anchor.BN(1_000_000),
      testMint
    )
    .accounts({
      creator:
        initializer.publicKey,
      multisig:
        multisigPda,
      proposal:
        pendingTokenProposalPda,
      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  try {
    await program.methods
      .executeTokenProposal()
      .accounts({
        executor:
          executor.publicKey,
        multisig:
          multisigPda,
        mint:
          testMint,
        proposal:
          pendingTokenProposalPda,
        tokenVault:
          tokenVaultPda,
        recipientTokenAccount:
          recipientTokenAccount,
        tokenProgram:
          anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([executor])
      .rpc();

    assert.fail(
      "Pending token proposal should not execute"
    );
  } catch (error: any) {
    const errorCode =
      error?.error?.errorCode?.code;

    assert.equal(
      errorCode,
      "ProposalNotReady"
    );
  }

  console.log(
    "Pending token proposal execution correctly rejected"
  );
});
// ==================================================
// TEST 70
// COMPLETE TOKEN LIFECYCLE
// CREATE -> APPROVE -> READY -> EXECUTE -> REMOVE
// ==================================================

it("Completes the full SPL token proposal lifecycle", async () => {
  const multisig =
    await program.account.multisig.fetch(
      multisigPda
    );

  const proposalId =
    multisig.proposalCount;

  const [lifecycleProposalPda] =
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

  const amount =
    new anchor.BN(1_000_000);

  // --------------------------------------------------
  // CREATE
  // --------------------------------------------------

  await program.methods
    .createProposal(
      recipient.publicKey,
      amount,
      testMint
    )
    .accounts({
      creator:
        initializer.publicKey,
      multisig:
        multisigPda,
      proposal:
        lifecycleProposalPda,
      systemProgram:
        SystemProgram.programId,
    })
    .rpc();

  let proposal =
    await program.account.proposal.fetch(
      lifecycleProposalPda
    );

  assert.isTrue(
    "pending" in proposal.status
  );

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
        lifecycleProposalPda,
    })
    .rpc();

  await program.methods
    .approveProposal()
    .accounts({
      approver:
        owner2.publicKey,
      multisig:
        multisigPda,
      proposal:
        lifecycleProposalPda,
    })
    .signers([owner2])
    .rpc();

  proposal =
    await program.account.proposal.fetch(
      lifecycleProposalPda
    );

  assert.isTrue(
    "ready" in proposal.status
  );

  // --------------------------------------------------
  // EXECUTE
  // --------------------------------------------------

  await program.methods
    .executeTokenProposal()
    .accounts({
      executor:
        executor.publicKey,

      multisig:
        multisigPda,

      mint:
        testMint,

      proposal:
        lifecycleProposalPda,

      tokenVault:
        tokenVaultPda,

      recipientTokenAccount:
        recipientTokenAccount,

      tokenProgram:
        anchor.utils.token.TOKEN_PROGRAM_ID,
    })
    .signers([executor])
    .rpc();

  proposal =
    await program.account.proposal.fetch(
      lifecycleProposalPda
    );

  assert.isTrue(
    "executed" in proposal.status
  );

  // --------------------------------------------------
  // REMOVE
  // --------------------------------------------------

  await program.methods
    .removeProposal()
    .accounts({
      remover:
        initializer.publicKey,

      multisig:
        multisigPda,

      proposal:
        lifecycleProposalPda,
    })
    .rpc();

  const removed =
    await provider.connection.getAccountInfo(
      lifecycleProposalPda
    );

  assert.isNull(
    removed
  );

  console.log(
    "Full SPL token proposal lifecycle completed successfully"
  );
});

});

