
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
  // PDAs
  // ==================================================

  let multisigPda: PublicKey;
  let vaultPda: PublicKey;
  let proposalPda: PublicKey;

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
          new anchor.BN(amount)
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
          new anchor.BN(amount)
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


});

