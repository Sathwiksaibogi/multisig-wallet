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
  // --------------------------------------------------
  // PROVIDER
  // --------------------------------------------------

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .multisigWallet as Program<MultisigWallet>;

  // --------------------------------------------------
  // TEST ACCOUNTS
  // --------------------------------------------------

  // Provider wallet will act as initializer + owner
  const initializer = provider.wallet;

  // Two additional owners
  const owner2 = Keypair.generate();
  const owner3 = Keypair.generate();

  // Recipient of SOL
  const recipient = Keypair.generate();

  // Another account that can execute the proposal
  const executor = Keypair.generate();

  // --------------------------------------------------
  // MULTISIG CONFIGURATION
  // --------------------------------------------------

  const walletId = new anchor.BN(1);

  const owners = [
    initializer.publicKey,
    owner2.publicKey,
    owner3.publicKey,
  ];

  const threshold = 2;

  // --------------------------------------------------
  // PDAs
  // --------------------------------------------------

  let multisigPda: PublicKey;
  let proposalPda: PublicKey;

  // --------------------------------------------------
  // HELPER: AIRDROP SOL
  // --------------------------------------------------

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
  // TEST 1: FUND ACCOUNTS
  // ==================================================

  it("Funds test accounts", async () => {
    await airdrop(owner2.publicKey, 2);
    await airdrop(owner3.publicKey, 2);
    await airdrop(executor.publicKey, 2);
    await airdrop(recipient.publicKey, 1);

    console.log("Owner 2:", owner2.publicKey.toString());
    console.log("Owner 3:", owner3.publicKey.toString());
    console.log("Executor:", executor.publicKey.toString());
    console.log("Recipient:", recipient.publicKey.toString());
  });

  // ==================================================
  // TEST 2: INITIALIZE MULTISIG
  // ==================================================

  it("Initializes the multisig", async () => {
    // Derive multisig PDA
    [multisigPda] = PublicKey.findProgramAddressSync(
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

    // Initialize multisig
    const tx = await program.methods
      .initialize(
        walletId,
        owners,
        threshold
      )
      .accounts({
        initializer: initializer.publicKey,
        multisig: multisigPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(
      "Initialize transaction:",
      tx
    );

    // Fetch account
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

    console.log("Multisig initialized successfully");
  });

  // ==================================================
  // TEST 3: CREATE PROPOSAL
  // ==================================================

  it("Creates a proposal", async () => {
    // Current proposal count is 0.
    // Therefore proposal ID = 0.
    const proposalId = new anchor.BN(0);

    // Derive proposal PDA
    [proposalPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        multisigPda.toBuffer(),
        proposalId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    console.log(
      "Proposal PDA:",
      proposalPda.toString()
    );

    const amount =
      0.5 * LAMPORTS_PER_SOL;

    // Create proposal
    const tx = await program.methods
      .createProposal(
        recipient.publicKey,
        new anchor.BN(amount)
      )
      .accounts({
        creator: initializer.publicKey,
        multisig: multisigPda,
        proposal: proposalPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(
      "Create proposal transaction:",
      tx
    );

    // Fetch proposal
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

    // Anchor enum representation
    assert.isTrue(
      "pending" in proposal.status
    );

    // Check proposal counter
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
  // TEST 4: FIRST APPROVAL
  // ==================================================

  it("Allows the first owner to approve", async () => {
    const tx = await program.methods
      .approveProposal()
      .accounts({
        approver: initializer.publicKey,
        multisig: multisigPda,
        proposal: proposalPda,
      })
      .rpc();

    console.log(
      "First approval transaction:",
      tx
    );

    const proposal =
      await program.account.proposal.fetch(
        proposalPda
      );

    // One approval
    assert.equal(
      proposal.approvals.length,
      1
    );

    assert.equal(
      proposal.approvals[0].toString(),
      initializer.publicKey.toString()
    );

    // Threshold is 2, so proposal should
    // still be Pending.
    assert.isTrue(
      "pending" in proposal.status
    );

    console.log(
      "First approval recorded successfully"
    );
  });

  // ==================================================
  // TEST 5: SECOND APPROVAL
  // ==================================================

  it("Allows the second owner to approve and marks proposal Ready", async () => {
    const tx = await program.methods
      .approveProposal()
      .accounts({
        approver: owner2.publicKey,
        multisig: multisigPda,
        proposal: proposalPda,
      })
      .signers([owner2])
      .rpc();

    console.log(
      "Second approval transaction:",
      tx
    );

    const proposal =
      await program.account.proposal.fetch(
        proposalPda
      );

    // Two approvals
    assert.equal(
      proposal.approvals.length,
      2
    );

    assert.isTrue(
      proposal.approvals.some(
        (key) =>
          key.equals(initializer.publicKey)
      )
    );

    assert.isTrue(
      proposal.approvals.some(
        (key) =>
          key.equals(owner2.publicKey)
      )
    );

    // Threshold = 2
    // Therefore status must become Ready.
    assert.isTrue(
      "ready" in proposal.status
    );

    console.log(
      "Proposal reached threshold and is Ready"
    );
  });

  // ==================================================
  // TEST 6: PREVENT DOUBLE VOTING
  // ==================================================

  it("Rejects double voting", async () => {
    try {
      await program.methods
        .approveProposal()
        .accounts({
          approver: initializer.publicKey,
          multisig: multisigPda,
          proposal: proposalPda,
        })
        .rpc();

      assert.fail(
        "Transaction should have failed"
      );
    } catch (error) {
      console.log(
        "Double voting correctly rejected"
      );

      assert.include(
        error.toString(),
        "DoubleVoting"
      );
    }
  });

  // ==================================================
  // TEST 7: PREVENT NON-OWNER APPROVAL
  // ==================================================

  it("Rejects approval from a non-owner", async () => {
    const nonOwner = Keypair.generate();

    await airdrop(
      nonOwner.publicKey,
      1
    );

    try {
      await program.methods
        .approveProposal()
        .accounts({
          approver: nonOwner.publicKey,
          multisig: multisigPda,
          proposal: proposalPda,
        })
        .signers([nonOwner])
        .rpc();

      assert.fail(
        "Transaction should have failed"
      );
    } catch (error) {
      console.log(
        "Non-owner approval correctly rejected"
      );

      assert.include(
        error.toString(),
        "ApproverNotOwner"
      );
    }
  });

  // ==================================================
  // TEST 8: EXECUTE PROPOSAL
  // ==================================================

  it("Executes the approved proposal", async () => {
    const amount =
      0.5 * LAMPORTS_PER_SOL;

    // Fund the multisig PDA.
    // The PDA is the source of the SOL transfer.
    await airdrop(
      multisigPda,
      2
    );

    const balanceBefore =
      await provider.connection.getBalance(
        recipient.publicKey
      );

    console.log(
      "Recipient balance before:",
      balanceBefore
    );

    // Execute proposal
    const tx = await program.methods
      .executeProposal()
      .accounts({
        executor: executor.publicKey,
        multisig: multisigPda,
        proposal: proposalPda,
        recipient: recipient.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([executor])
      .rpc();

    console.log(
      "Execute transaction:",
      tx
    );

    const balanceAfter =
      await provider.connection.getBalance(
        recipient.publicKey
      );

    console.log(
      "Recipient balance after:",
      balanceAfter
    );

    // Recipient should receive the amount.
    assert.equal(
      balanceAfter - balanceBefore,
      amount
    );

    // Fetch proposal again
    const proposal =
      await program.account.proposal.fetch(
        proposalPda
      );

    // Proposal must now be Executed
    assert.isTrue(
      "executed" in proposal.status
    );

    console.log(
      "Proposal executed successfully"
    );
  });

  // ==================================================
  // TEST 9: CANNOT EXECUTE AGAIN
  // ==================================================

  it("Rejects executing an already executed proposal", async () => {
    try {
      await program.methods
        .executeProposal()
        .accounts({
          executor: executor.publicKey,
          multisig: multisigPda,
          proposal: proposalPda,
          recipient: recipient.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([executor])
        .rpc();

      assert.fail(
        "Transaction should have failed"
      );
    } catch (error) {
      console.log(
        "Second execution correctly rejected"
      );

      assert.include(
        error.toString(),
        "ProposalNotReady"
      );
    }
  });
});