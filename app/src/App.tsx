import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import * as anchor from "@coral-xyz/anchor";

import {
  PublicKey,
  SystemProgram
} from "@solana/web3.js";

import {
  useAnchorWallet,
  useConnection,
  useWallet
} from "@solana/wallet-adapter-react";

import {
  WalletMultiButton
} from "@solana/wallet-adapter-react-ui";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";

import {
  deriveMultisigPda,
  deriveProposalPda,
  deriveTokenVaultPda,
  deriveVaultPda,
  getProgram,
  PROGRAM_ID
} from "./lib/anchor";

import {
  formatUnits,
  parseUnits,
  shortenAddress,
  statusClass,
  statusLabel
} from "./lib/format";

type Page =
  | "overview"
  | "proposals"
  | "treasury"
  | "members"
  | "settings";

type NoticeType =
  | "success"
  | "error"
  | "info";

type Notice = {
  type: NoticeType;
  title: string;
  message: string;
} | null;

type ProposalRow = {
  address: PublicKey;
  data: any;
};

type TokenVaultRow = {
  address: PublicKey;
  mint: PublicKey;
  amount: bigint;
  decimals: number;
};

function App() {
  const { connection } =
    useConnection();

  const {
    publicKey,
    connected
  } = useWallet();

  const anchorWallet =
    useAnchorWallet();

  const program: any =
    useMemo(() => {
      if (!anchorWallet) {
        return null;
      }

      return getProgram(
        connection,
        anchorWallet
      );
    }, [
      connection,
      anchorWallet
    ]);

  const [page, setPage] =
    useState<Page>(
      "overview"
    );

  const [
    initializerInput,
    setInitializerInput
  ] = useState("");

  const [
    treasuryAddressInput,
    setTreasuryAddressInput
  ] = useState("");

  const [loadedWalletId, setLoadedWalletId] =
    useState<anchor.BN | null>(
      null
    );

  const [
    multisigAddress,
    setMultisigAddress
  ] = useState<PublicKey | null>(
    null
  );

  const [multisig, setMultisig] =
    useState<any>(null);

  const [vaultAddress, setVaultAddress] =
    useState<PublicKey | null>(
      null
    );

  const [vaultBalance, setVaultBalance] =
    useState(0);

  const [
    tokenVaults,
    setTokenVaults
  ] = useState<TokenVaultRow[]>(
    []
  );

  const [
    proposals,
    setProposals
  ] = useState<ProposalRow[]>(
    []
  );

  const [
    loading,
    setLoading
  ] = useState(false);

  const [
    action,
    setAction
  ] = useState<string | null>(
    null
  );

  const [
    notice,
    setNotice
  ] = useState<Notice>(
    null
  );

  // --------------------------------------------------
  // CREATE MULTISIG FORM
  // --------------------------------------------------

  const [
    createWalletId,
    setCreateWalletId
  ] = useState("1");

  const [
    ownerText,
    setOwnerText
  ] = useState("");

  const [
    createThreshold,
    setCreateThreshold
  ] = useState("2");

  // --------------------------------------------------
  // SOL DEPOSIT
  // --------------------------------------------------

  const [
    solDepositAmount,
    setSolDepositAmount
  ] = useState("");

  // --------------------------------------------------
  // TOKEN VAULT CREATION
  // --------------------------------------------------

  const [
    tokenMintInput,
    setTokenMintInput
  ] = useState("");

  // --------------------------------------------------
  // TOKEN DEPOSIT
  // --------------------------------------------------

  const [
    tokenDepositMint,
    setTokenDepositMint
  ] = useState("");

  const [
    tokenDepositAmount,
    setTokenDepositAmount
  ] = useState("");

  // --------------------------------------------------
  // PROPOSAL FORM
  // --------------------------------------------------

  const [
    proposalAsset,
    setProposalAsset
  ] = useState<
    "SOL" | "TOKEN"
  >("SOL");

  const [
    proposalTokenMint,
    setProposalTokenMint
  ] = useState("");

  const [
    proposalRecipient,
    setProposalRecipient
  ] = useState("");

  const [
    proposalAmount,
    setProposalAmount
  ] = useState("");

  const rpcEndpoint =
    import.meta.env.VITE_RPC_URL ||
    "https://api.devnet.solana.com";

  const showNotice = (
    type: NoticeType,
    title: string,
    message: string
  ) => {
    setNotice({
      type,
      title,
      message
    });

    window.setTimeout(() => {
      setNotice(null);
    }, 5000);
  };

  // --------------------------------------------------
  // REFRESH WALLET DATA
  // --------------------------------------------------

  const refreshWallet =
    useCallback(
      async (
        idOverride?: anchor.BN,
        initializerOverride?: PublicKey,
        multisigOverride?: PublicKey
      ) => {
        if (
          !program
        ) {
          return;
        }

        let multisigPda: PublicKey;

        if (multisigOverride) {
          multisigPda =
            multisigOverride;
        } else {
          if (!publicKey) {
            return;
          }

          const id =
            idOverride ??
            loadedWalletId;

          if (!id) {
            return;
          }

          let initializer: PublicKey;

          try {
            initializer =
              initializerOverride ??
              (
                initializerInput.trim()
                  ? new PublicKey(
                      initializerInput.trim()
                    )
                  : publicKey
              );
          } catch {
            showNotice(
              "error",
              "Invalid initializer",
              "Enter a valid Solana public key for the multisig initializer."
            );
            return;
          }

          [
            multisigPda
          ] =
            deriveMultisigPda(
              initializer,
              id
            );
        }

        setLoading(true);

        try {
          const data =
            await (program.account as any).multisig.fetch(
              multisigPda
            );

          const [
            vaultPda
          ] =
            deriveVaultPda(
              multisigPda
            );

          let solBalance = 0;

          const vaultInfo =
            await connection.getAccountInfo(
              vaultPda
            );

          if (vaultInfo) {
            solBalance =
              await connection.getBalance(
                vaultPda
              );
          }

          const proposalCount =
            data.proposalCount.toNumber();

          const proposalPdas =
            Array.from(
              {
                length:
                  proposalCount
              },
              (_, index) =>
                deriveProposalPda(
                  multisigPda,
                  new anchor.BN(
                    index
                  )
                )[0]
            );

          const proposalAccounts =
            proposalCount > 0
              ? await (program.account as any).proposal.fetchMultiple(
                  proposalPdas
                )
              : [];

          const proposalRows: ProposalRow[] =
            proposalAccounts
              .map(
                (
                  account: any,
                  index: number
                ) => {
                  if (!account) {
                    return null;
                  }

                  return {
                    address:
                      proposalPdas[
                        index
                      ],
                    data: account
                  };
                }
              )
              .filter(
                Boolean
              ) as ProposalRow[];

          const tokenAccounts =
            await connection.getParsedTokenAccountsByOwner(
              multisigPda,
              {
                programId:
                  TOKEN_PROGRAM_ID
              }
            );

          const tokenRows: TokenVaultRow[] =
            tokenAccounts.value
              .map(
                (entry) => {
                  const parsed =
                    entry.account.data
                      .parsed;

                  return {
                    address:
                      entry.pubkey,
                    mint:
                      new PublicKey(
                        parsed.info.mint
                      ),
                    amount:
                      BigInt(
                        parsed.info.tokenAmount.amount
                      ),
                    decimals:
                      parsed.info.tokenAmount
                        .decimals
                  };
                }
              );

          setMultisigAddress(
            multisigPda
          );

          setVaultAddress(
            vaultPda
          );

          setLoadedWalletId(
            data.walletId
          );

          setInitializerInput(
            data.initializer.toBase58()
          );

          setTreasuryAddressInput(
            multisigPda.toBase58()
          );

          setMultisig(
            data
          );

          setVaultBalance(
            solBalance
          );

          setProposals(
            proposalRows.reverse()
          );

          setTokenVaults(
            tokenRows
          );
        } catch (error: any) {
          setMultisig(
            null
          );

          setMultisigAddress(
            null
          );

          setVaultAddress(
            null
          );

          setVaultBalance(
            0
          );

          setProposals(
            []
          );

          setTokenVaults(
            []
          );

          showNotice(
            "error",
            "Treasury not found",
            error?.message ||
              "No multisig exists for the supplied treasury information."
          );
        } finally {
          setLoading(false);
        }
      },
      [
        program,
        publicKey,
        loadedWalletId,
        initializerInput,
        connection
      ]
    );

  // --------------------------------------------------
  // LOAD EXISTING TREASURY
  // --------------------------------------------------

  async function handleLoadWallet() {
    if (!program) {
      showNotice(
        "info",
        "Connect a wallet",
        "Connect a Solana wallet before loading a treasury."
      );
      return;
    }

    try {
      const treasuryAddress =
        new PublicKey(
          treasuryAddressInput.trim()
        );

      await refreshWallet(
        undefined,
        undefined,
        treasuryAddress
      );

      setPage(
        "overview"
      );
    } catch (error: any) {
      showNotice(
        "error",
        "Invalid treasury address",
        error?.message ||
          "Enter a valid multisig public key."
      );
    }
  }

  // --------------------------------------------------
  // SHARE TREASURY
  // --------------------------------------------------

  async function handleShareTreasury() {
    if (!multisigAddress) {
      return;
    }

    const url =
      `${window.location.origin}/?treasury=${multisigAddress.toBase58()}`;

    try {
      await navigator.clipboard.writeText(
        url
      );

      showNotice(
        "success",
        "Treasury link copied",
        "Share this link with the other multisig owners."
      );
    } catch {
      showNotice(
        "info",
        "Treasury link",
        url
      );
    }
  }

  const awaitSafeLoadTreasury = async (
    address: PublicKey
  ) => {
    await refreshWallet(
      undefined,
      undefined,
      address
    );
  };

  useEffect(() => {
    const treasuryParam =
      new URLSearchParams(
        window.location.search
      ).get("treasury");

    if (treasuryParam) {
      setTreasuryAddressInput(
        treasuryParam
      );
    }
  }, []);

  useEffect(() => {
    const treasuryParam =
      new URLSearchParams(
        window.location.search
      ).get("treasury");

    if (
      treasuryParam &&
      program &&
      !multisig
    ) {
      try {
        awaitSafeLoadTreasury(
          new PublicKey(
            treasuryParam
          )
        );
      } catch {
        showNotice(
          "error",
          "Invalid treasury link",
          "The shared treasury address is not valid."
        );
      }
    }
  }, [
    program,
    multisig
  ]);

  // --------------------------------------------------
  // CREATE MULTISIG
  // --------------------------------------------------

  // --------------------------------------------------
  // CREATE MULTISIG
  // --------------------------------------------------

  async function handleCreateWallet() {
    if (
      !program ||
      !publicKey
    ) {
      return;
    }

    setAction(
      "create-wallet"
    );

    try {
      const walletId =
        new anchor.BN(
          createWalletId
        );

      const ownerStrings =
        ownerText
          .split(",")
          .map(
            (value) =>
              value.trim()
          )
          .filter(Boolean);

      if (
        ownerStrings.length ===
        0
      ) {
        ownerStrings.push(
          publicKey.toBase58()
        );
      }

      const owners =
        ownerStrings.map(
          (value) =>
            new PublicKey(
              value
            )
        );

      if (
        !owners.some(
          (owner) =>
            owner.equals(
              publicKey
            )
        )
      ) {
        throw new Error(
          "Connected wallet must be one of the multisig owners."
        );
      }

      const threshold =
        Number(
          createThreshold
        );

      if (
        !Number.isInteger(
          threshold
        ) ||
        threshold < 1 ||
        threshold >
          owners.length
      ) {
        throw new Error(
          "Threshold must be between 1 and the number of owners."
        );
      }

      const [
        multisigPda
      ] =
        deriveMultisigPda(
          publicKey,
          walletId
        );
        // Check whether this wallet ID already exists
        // for the connected initializer.
        const existingAccount =
          await connection.getAccountInfo(
            multisigPda
          );

        if (existingAccount) {
          throw new Error(
            `Wallet ID ${walletId.toString()} already exists for this initializer. Choose a different wallet ID.`
          );
        }

      await (program.methods as any)
        .initialize(
          walletId,
          owners,
          threshold
        )
        .accounts({
          initializer:
            publicKey,
          multisig:
            multisigPda,
          systemProgram:
            SystemProgram.programId
        })
        .rpc();

      setLoadedWalletId(
        walletId
      );

      setInitializerInput(
        publicKey.toBase58()
      );

      await refreshWallet(
        walletId,
        publicKey,
        multisigPda
      );

      showNotice(
        "success",
        "Multisig created",
        `Wallet ${walletId.toString()} is now active on Devnet.`
      );
    } catch (error: any) {
      showNotice(
        "error",
        "Creation failed",
        error?.message ||
          "The multisig could not be created."
      );
    } finally {
      setAction(null);
    }
  }

  // --------------------------------------------------
  // INITIALIZE SOL VAULT
  // --------------------------------------------------

  async function handleInitializeVault() {
    if (
      !program ||
      !publicKey ||
      !multisigAddress
    ) {
      return;
    }

    if (!connectedWalletIsInitializer) {
      showNotice(
        "error",
        "Initializer access required",
        "Only the multisig initializer can initialize the SOL vault."
      );
      return;
    }

    setAction(
      "init-vault"
    );

    try {
      const [
        vaultPda
      ] =
        deriveVaultPda(
          multisigAddress
        );

      await (program.methods as any)
        .initializeVault()
        .accounts({
          initializer:
            publicKey,

          multisig:
            multisigAddress,

          vault:
            vaultPda,

          systemProgram:
            SystemProgram.programId
        })
        .rpc();

      await refreshWallet();

      showNotice(
        "success",
        "SOL vault created",
        "The multisig SOL vault is ready."
      );
    } catch (error: any) {
      showNotice(
        "error",
        "Vault creation failed",
        error?.message ||
          "Unable to initialize the SOL vault."
      );
    } finally {
      setAction(null);
    }
  }

  // --------------------------------------------------
  // DEPOSIT SOL
  // --------------------------------------------------

  async function handleDepositSol() {
    if (
      !program ||
      !publicKey ||
      !multisigAddress ||
      !solDepositAmount
    ) {
      return;
    }

    setAction(
      "deposit-sol"
    );

    try {
      const amount =
        parseUnits(
          solDepositAmount,
          9
        );

      const [
        vaultPda
      ] =
        deriveVaultPda(
          multisigAddress
        );

      await (program.methods as any)
        .deposit(
          amount
        )
        .accounts({
          depositor:
            publicKey,

          multisig:
            multisigAddress,

          vault:
            vaultPda,

          systemProgram:
            SystemProgram.programId
        })
        .rpc();

      setSolDepositAmount(
        ""
      );

      await refreshWallet();

      showNotice(
        "success",
        "SOL deposited",
        `${solDepositAmount} SOL added to the treasury.`
      );
    } catch (error: any) {
      showNotice(
        "error",
        "Deposit failed",
        error?.message ||
          "Unable to deposit SOL."
      );
    } finally {
      setAction(null);
    }
  }

  // --------------------------------------------------
  // INITIALIZE TOKEN VAULT
  // --------------------------------------------------

  async function handleInitializeTokenVault() {
    if (
      !program ||
      !publicKey ||
      !multisigAddress ||
      !tokenMintInput
    ) {
      return;
    }

    setAction(
      "init-token-vault"
    );

    try {
      const mint =
        new PublicKey(
          tokenMintInput
        );

      const [
        tokenVaultPda
      ] =
        deriveTokenVaultPda(
          multisigAddress,
          mint
        );

      await (program.methods as any)
        .initializeTokenVault()
        .accounts({
          payer:
            publicKey,

          multisig:
            multisigAddress,

          mint,

          tokenVault:
            tokenVaultPda,

          tokenProgram:
            TOKEN_PROGRAM_ID,

          systemProgram:
            SystemProgram.programId
        })
        .rpc();

      setTokenMintInput(
        ""
      );

      await refreshWallet();

      showNotice(
        "success",
        "Token vault created",
        `Vault ${shortenAddress(tokenVaultPda.toBase58())} is ready.`
      );
    } catch (error: any) {
      showNotice(
        "error",
        "Token vault failed",
        error?.message ||
          "Unable to initialize the token vault."
      );
    } finally {
      setAction(null);
    }
  }

  // --------------------------------------------------
  // DEPOSIT TOKEN
  // --------------------------------------------------

  async function handleDepositToken() {
    if (
      !program ||
      !publicKey ||
      !multisigAddress ||
      !tokenDepositMint ||
      !tokenDepositAmount
    ) {
      return;
    }

    setAction(
      "deposit-token"
    );

    try {
      const mint =
        new PublicKey(
          tokenDepositMint
        );

      const vault =
        tokenVaults.find(
          (entry) =>
            entry.mint.equals(
              mint
            )
        );

      if (!vault) {
        throw new Error(
          "No token vault exists for this mint."
        );
      }

      const amount =
        parseUnits(
          tokenDepositAmount,
          vault.decimals
        );

      const sourceAta =
        await getAssociatedTokenAddress(
          mint,
          publicKey
        );

      const [
        tokenVaultPda
      ] =
        deriveTokenVaultPda(
          multisigAddress,
          mint
        );

      await (program.methods as any)
        .depositToken(
          amount
        )
        .accounts({
          depositor:
            publicKey,

          multisig:
            multisigAddress,

          mint,

          tokenVault:
            tokenVaultPda,

          depositorTokenAccount:
            sourceAta,

          tokenProgram:
            TOKEN_PROGRAM_ID
        })
        .rpc();

      setTokenDepositMint(
        ""
      );

      setTokenDepositAmount(
        ""
      );

      await refreshWallet();

      showNotice(
        "success",
        "Tokens deposited",
        `${tokenDepositAmount} tokens moved into the treasury.`
      );
    } catch (error: any) {
      showNotice(
        "error",
        "Token deposit failed",
        error?.message ||
          "Unable to deposit tokens."
      );
    } finally {
      setAction(null);
    }
  }

  // --------------------------------------------------
  // CREATE PROPOSAL
  // --------------------------------------------------

  async function handleCreateProposal() {
    if (
      !program ||
      !publicKey ||
      !multisigAddress
    ) {
      return;
    }

    if (!connectedWalletIsOwner) {
      showNotice(
        "error",
        "Owner access required",
        "Only a multisig owner can create proposals."
      );
      return;
    }

    setAction(
      "create-proposal"
    );

    try {
      const recipient =
        new PublicKey(
          proposalRecipient
        );

      let mint:
        | PublicKey
        | null = null;

      let decimals = 9;

      if (
        proposalAsset ===
        "TOKEN"
      ) {
        mint =
          new PublicKey(
            proposalTokenMint
          );

        const vault =
          tokenVaults.find(
            (entry) =>
              entry.mint.equals(
                mint!
              )
          );

        if (!vault) {
          throw new Error(
            "This mint does not have a token vault for the loaded multisig."
          );
        }

        decimals =
          vault.decimals;
      }

      const amount =
        parseUnits(
          proposalAmount,
          decimals
        );

      const proposalId =
        multisig.proposalCount;

      const [
        proposalPda
      ] =
        deriveProposalPda(
          multisigAddress,
          proposalId
        );

      await (program.methods as any)
        .createProposal(
          recipient,
          amount,
          mint
        )
        .accounts({
          creator:
            publicKey,

          multisig:
            multisigAddress,

          proposal:
            proposalPda,

          systemProgram:
            SystemProgram.programId
        })
        .rpc();

      setProposalRecipient(
        ""
      );

      setProposalAmount(
        ""
      );

      await refreshWallet();

      setPage(
        "proposals"
      );

      showNotice(
        "success",
        "Proposal created",
        `Proposal #${proposalId.toString()} is now pending approval.`
      );
    } catch (error: any) {
      showNotice(
        "error",
        "Proposal failed",
        error?.message ||
          "Unable to create proposal."
      );
    } finally {
      setAction(null);
    }
  }

  // --------------------------------------------------
  // APPROVE
  // --------------------------------------------------

  async function handleApprove(
    proposal:
      ProposalRow
  ) {
    if (
      !program ||
      !publicKey ||
      !multisigAddress
    ) {
      return;
    }

    if (!connectedWalletIsOwner) {
      showNotice(
        "error",
        "Owner access required",
        "Only a multisig owner can approve proposals."
      );
      return;
    }

    setAction(
      `approve-${proposal.address.toBase58()}`
    );

    try {
      await (program.methods as any)
        .approveProposal()
        .accounts({
          approver:
            publicKey,

          multisig:
            multisigAddress,

          proposal:
            proposal.address
        })
        .rpc();

      await refreshWallet();

      showNotice(
        "success",
        "Approval recorded",
        "Your multisig vote has been recorded on-chain."
      );
    } catch (error: any) {
      showNotice(
        "error",
        "Approval failed",
        error?.message ||
          "Unable to approve this proposal."
      );
    } finally {
      setAction(null);
    }
  }

  // --------------------------------------------------
  // CANCEL
  // --------------------------------------------------

  async function handleCancel(
    proposal:
      ProposalRow
  ) {
    if (
      !program ||
      !publicKey ||
      !multisigAddress
    ) {
      return;
    }

    if (!connectedWalletIsOwner) {
      showNotice(
        "error",
        "Owner access required",
        "Only a multisig owner can cancel proposals."
      );
      return;
    }

    setAction(
      `cancel-${proposal.address.toBase58()}`
    );

    try {
      await (program.methods as any)
        .cancelProposal()
        .accounts({
          canceller:
            publicKey,

          multisig:
            multisigAddress,

          proposal:
            proposal.address
        })
        .rpc();

      await refreshWallet();

      showNotice(
        "success",
        "Cancellation recorded",
        "Your cancellation vote is now on-chain."
      );
    } catch (error: any) {
      showNotice(
        "error",
        "Cancellation failed",
        error?.message ||
          "Unable to cancel this proposal."
      );
    } finally {
      setAction(null);
    }
  }

  // --------------------------------------------------
  // EXECUTE
  // --------------------------------------------------

  async function handleExecute(
    proposal:
      ProposalRow
  ) {
    if (
      !program ||
      !publicKey ||
      !multisigAddress
    ) {
      return;
    }

    setAction(
      `execute-${proposal.address.toBase58()}`
    );

    try {
      if (
        proposal.data.mint ===
        null
      ) {
        const [
          vaultPda
        ] =
          deriveVaultPda(
            multisigAddress
          );

        await (program.methods as any)
          .executeProposal()
          .accounts({
            executor:
              publicKey,

            multisig:
              multisigAddress,

            proposal:
              proposal.address,

            vault:
              vaultPda,

            recipient:
              proposal.data
                .recipient,

            systemProgram:
              SystemProgram.programId
          })
          .rpc();
      } else {
        const mint =
          new PublicKey(
            proposal.data
              .mint
          );

        const recipient =
          new PublicKey(
            proposal.data
              .recipient
          );

        const [
          tokenVaultPda
        ] =
          deriveTokenVaultPda(
            multisigAddress,
            mint
          );

        const recipientAta =
          await getAssociatedTokenAddress(
            mint,
            recipient
          );

        const recipientInfo =
          await connection.getAccountInfo(
            recipientAta
          );

        const instructions =
          recipientInfo
            ? []
            : [
                createAssociatedTokenAccountInstruction(
                  publicKey,
                  recipientAta,
                  recipient,
                  mint,
                  TOKEN_PROGRAM_ID,
                  ASSOCIATED_TOKEN_PROGRAM_ID
                )
              ];

        const builder =
          (program.methods as any)
            .executeTokenProposal();

        if (
          instructions.length >
          0
        ) {
          builder.preInstructions(
            instructions
          );
        }

        await builder
          .accounts({
            executor:
              publicKey,

            multisig:
              multisigAddress,

            mint,

            proposal:
              proposal.address,

            tokenVault:
              tokenVaultPda,

            recipientTokenAccount:
              recipientAta,

            tokenProgram:
              TOKEN_PROGRAM_ID
          })
          .rpc();
      }

      await refreshWallet();

      showNotice(
        "success",
        "Proposal executed",
        "The approved transfer has been executed on Devnet."
      );
    } catch (error: any) {
      showNotice(
        "error",
        "Execution failed",
        error?.message ||
          "Unable to execute this proposal."
      );
    } finally {
      setAction(null);
    }
  }

  // --------------------------------------------------
  // REMOVE
  // --------------------------------------------------

  async function handleRemove(
    proposal:
      ProposalRow
  ) {
    if (
      !program ||
      !publicKey ||
      !multisigAddress
    ) {
      return;
    }

    if (!connectedWalletIsOwner) {
      showNotice(
        "error",
        "Owner access required",
        "Only a multisig owner can remove terminal proposals."
      );
      return;
    }

    setAction(
      `remove-${proposal.address.toBase58()}`
    );

    try {
      await (program.methods as any)
        .removeProposal()
        .accounts({
          remover:
            publicKey,

          multisig:
            multisigAddress,

          proposal:
            proposal.address
        })
        .rpc();

      await refreshWallet();

      showNotice(
        "success",
        "Proposal removed",
        "The proposal account was closed."
      );
    } catch (error: any) {
      showNotice(
        "error",
        "Removal failed",
        error?.message ||
          "Unable to remove this proposal."
      );
    } finally {
      setAction(null);
    }
  }

  // --------------------------------------------------
  // HELPERS
  // --------------------------------------------------

  const explorer =
    (
      address: PublicKey,
      type: "address" | "tx" = "address"
    ) => {
      return `https://explorer.solana.com/${type}/${address.toBase58()}?cluster=devnet`;
    };

  const readyCount =
    proposals.filter(
      ({ data }) =>
        "ready" in data.status
    ).length;

  const pendingCount =
    proposals.filter(
      ({ data }) =>
        "pending" in data.status
    ).length;

  const tokenCount =
    tokenVaults.length;

  const connectedWalletIsOwner =
    Boolean(
      publicKey &&
      multisig?.owners?.some(
        (owner: PublicKey) =>
          owner.equals(
            publicKey
          )
      )
    );

  const connectedWalletIsInitializer =
    Boolean(
      publicKey &&
      multisig?.initializer?.equals(
        publicKey
      )
    );

  // --------------------------------------------------
  // DISCONNECTED VIEW
  // --------------------------------------------------

  if (!connected) {
    return (
      <div className="landing">
        <div className="landing-grid" />

        <div className="landing-glow landing-glow-one" />
        <div className="landing-glow landing-glow-two" />

        <header className="landing-header">
          <div className="brand">
            <div className="brand-mark">
              Q
            </div>

            <div>
              <div className="brand-name">
                QUORMESH
              </div>

              <div className="brand-subtitle">
                MULTISIG TREASURY
              </div>
            </div>
          </div>

          <div className="network-pill">
            <span className="pulse" />
            SOLANA DEVNET
          </div>
        </header>

        <main className="landing-content">
          <div className="hero-eyebrow">
            DECENTRALIZED TREASURY CONTROL
          </div>

          <h1>
            Move capital with
            <span>
              collective authority.
            </span>
          </h1>

          <p className="hero-copy">
            QuorMesh is a production-style
            Solana multisig treasury for
            coordinated SOL and SPL-token
            custody.
          </p>

          <div className="hero-actions">
            <div className="wallet-button-shell">
              <WalletMultiButton />
            </div>
          </div>

          <div className="hero-specs">
            <div>
              <span>
                PROGRAM
              </span>

              <strong>
                {shortenAddress(
                  PROGRAM_ID.toBase58(),
                  6
                )}
              </strong>
            </div>

            <div>
              <span>
                NETWORK
              </span>

              <strong>
                DEVNET
              </strong>
            </div>

            <div>
              <span>
                ASSETS
              </span>

              <strong>
                SOL + SPL
              </strong>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // --------------------------------------------------
  // MAIN DASHBOARD
  // --------------------------------------------------

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small">
            Q
          </div>

          <div>
            <div className="brand-name">
              QUORMESH
            </div>

            <div className="brand-subtitle">
              MULTISIG TREASURY
            </div>
          </div>
        </div>

        <div className="sidebar-network">
          <span className="pulse" />
          DEVNET LIVE
        </div>

        <nav className="sidebar-nav">
          <button
            className={
              page === "overview"
                ? "nav-item active"
                : "nav-item"
            }
            onClick={() =>
              setPage("overview")
            }
          >
            <span>⌂</span>
            Overview
          </button>

          <button
            className={
              page === "proposals"
                ? "nav-item active"
                : "nav-item"
            }
            onClick={() =>
              setPage("proposals")
            }
          >
            <span>◈</span>
            Proposals

            {readyCount > 0 && (
              <span className="nav-badge">
                {readyCount}
              </span>
            )}
          </button>

          <button
            className={
              page === "treasury"
                ? "nav-item active"
                : "nav-item"
            }
            onClick={() =>
              setPage("treasury")
            }
          >
            <span>◎</span>
            Treasury
          </button>

          <button
            className={
              page === "members"
                ? "nav-item active"
                : "nav-item"
            }
            onClick={() =>
              setPage("members")
            }
          >
            <span>◇</span>
            Members
          </button>

          <button
            className={
              page === "settings"
                ? "nav-item active"
                : "nav-item"
            }
            onClick={() =>
              setPage("settings")
            }
          >
            <span>⚙</span>
            Settings
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="program-mini">
            <span>
              PROGRAM
            </span>

            <strong>
              {shortenAddress(
                PROGRAM_ID.toBase58(),
                5
              )}
            </strong>
          </div>

          <a
            href={
              multisigAddress
                ? explorer(
                    multisigAddress
                  )
                : explorer(
                    PROGRAM_ID
                  )
            }
            target="_blank"
            rel="noreferrer"
            className="explorer-link"
          >
            Open Explorer ↗
          </a>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <div className="topbar-kicker">
              SOLANA MULTISIG
            </div>

            <div className="topbar-title">
              {multisigAddress
                ? `Wallet ${multisig?.walletId?.toString() ?? "—"}`
                : "QuorMesh Treasury"}
            </div>
          </div>

          <div className="topbar-actions">
            {multisig && (
              <div
                className={
                  connectedWalletIsOwner
                    ? "wallet-role owner"
                    : "wallet-role viewer"
                }
              >
                <span className="wallet-role-dot" />
                {connectedWalletIsOwner
                  ? connectedWalletIsInitializer
                    ? "OWNER · INITIALIZER"
                    : "OWNER"
                  : "VIEW ONLY"}
              </div>
            )}

            <div className="wallet-address">
              {shortenAddress(
                publicKey?.toBase58() ||
                  "",
                5
              )}
            </div>

            <div className="wallet-button-shell compact">
              <WalletMultiButton />
            </div>
          </div>
        </header>

        {notice && (
          <div
            className={`notice notice-${notice.type}`}
          >
            <div>
              <strong>
                {notice.title}
              </strong>

              <span>
                {notice.message}
              </span>
            </div>

            <button
              onClick={() =>
                setNotice(null)
              }
            >
              ×
            </button>
          </div>
        )}

        {!multisig && (
          <section className="setup-panel">
            <div className="setup-copy">
              <span className="section-eyebrow">
                FIRST CONNECTION
              </span>

              <h1>
                Load or create
                your treasury.
              </h1>

              <p>
                Load an existing multisig using
                its on-chain address, or create a
                brand-new Devnet multisig from
                this dashboard. Share the treasury
                link with the other owners when they
                need to review or approve proposals.
              </p>
            </div>

            <div className="setup-grid">
              <div className="panel">
                <div className="panel-title">
                  Load existing treasury
                </div>

                <label>
                  Multisig address
                </label>

                <input
                  value={
                    treasuryAddressInput
                  }
                  onChange={(event) =>
                    setTreasuryAddressInput(
                      event.target.value
                    )
                  }
                  placeholder="C94Ddd...pYubQV"
                />

                <button
                  className="primary-button"
                  onClick={
                    handleLoadWallet
                  }
                  disabled={
                    loading
                  }
                >
                  {loading
                    ? "Loading..."
                    : "Load Treasury"}
                </button>

                <div className="helper-text">
                  Share the multisig address with
                  other owners. Their connected wallet
                  is checked against the on-chain owner list.
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">
                  Create new multisig
                </div>

                <label>
                  Wallet ID
                </label>

                <input
                  value={
                    createWalletId
                  }
                  onChange={(event) =>
                    setCreateWalletId(
                      event.target.value
                    )
                  }
                />

                <label>
                  Owners
                </label>

                <input
                  value={ownerText}
                  onChange={(event) =>
                    setOwnerText(
                      event.target.value
                    )
                  }
                  placeholder={`${publicKey?.toBase58()}, owner2...`}
                />

                <label>
                  Threshold
                </label>

                <input
                  value={
                    createThreshold
                  }
                  onChange={(event) =>
                    setCreateThreshold(
                      event.target.value
                    )
                  }
                />

                <button
                  className="primary-button"
                  onClick={
                    handleCreateWallet
                  }
                  disabled={
                    action ===
                    "create-wallet"
                  }
                >
                  {action ===
                  "create-wallet"
                    ? "Creating..."
                    : "Create Multisig"}
                </button>
              </div>
            </div>
          </section>
        )}

        {multisig &&
          page ===
            "overview" && (
            <>
              <section className="hero-strip">
                <div>
                  <span className="section-eyebrow">
                    CONTROL CENTER
                  </span>

                  <h1>
                    Treasury overview
                  </h1>

                  <p>
                    Coordinate capital movements
                    through threshold-based
                    on-chain authorization.
                  </p>
                </div>

                <div className="hero-strip-meta">
                  <span>
                    MULTISIG
                  </span>

                  <strong>
                    {shortenAddress(
                      multisigAddress!.toBase58(),
                      6
                    )}
                  </strong>

                  <a
                    href={explorer(
                      multisigAddress!
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Explorer ↗
                  </a>

                  <button
                    className="secondary-button"
                    onClick={
                      handleShareTreasury
                    }
                  >
                    Share Treasury
                  </button>
                </div>
              </section>

              <section className="stats-grid">
                <div className="stat-card featured">
                  <div className="stat-label">
                    SOL TREASURY
                  </div>

                  <div className="stat-value">
                    {formatUnits(
                      vaultBalance,
                      9,
                      4
                    )}{" "}
                    SOL
                  </div>

                  <div className="stat-foot">
                    Spendable vault balance
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-label">
                    MEMBERS
                  </div>

                  <div className="stat-value">
                    {
                      multisig
                        .owners
                        .length
                    }
                  </div>

                  <div className="stat-foot">
                    Wallet owners
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-label">
                    THRESHOLD
                  </div>

                  <div className="stat-value">
                    {
                      multisig
                        .threshold
                    }{" "}
                    /{" "}
                    {
                      multisig
                        .owners
                        .length
                    }
                  </div>

                  <div className="stat-foot">
                    Required approvals
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-label">
                    PROPOSALS
                  </div>

                  <div className="stat-value">
                    {
                      multisig
                        .proposalCount
                        .toString()
                    }
                  </div>

                  <div className="stat-foot">
                    {pendingCount} pending
                  </div>
                </div>
              </section>

              <section className="dashboard-grid">
                <div className="panel wide">
                  <div className="panel-header">
                    <div>
                      <span className="section-eyebrow">
                        DECISION FLOW
                      </span>

                      <h2>
                        Recent proposals
                      </h2>
                    </div>

                    <button
                      className="ghost-button"
                      onClick={() =>
                        setPage(
                          "proposals"
                        )
                      }
                    >
                      View all
                    </button>
                  </div>

                  {proposals.length ===
                  0 ? (
                    <div className="empty-state">
                      No proposals yet.
                    </div>
                  ) : (
                    <div className="proposal-list">
                      {proposals
                        .slice(0, 5)
                        .map(
                          (
                            proposal
                          ) => (
                            <ProposalRowView
                              key={proposal.address.toBase58()}
                              proposal={
                                proposal
                              }
                              threshold={
                                multisig.threshold
                              }
                              onApprove={() =>
                                handleApprove(
                                  proposal
                                )
                              }
                              onCancel={() =>
                                handleCancel(
                                  proposal
                                )
                              }
                              onExecute={() =>
                                handleExecute(
                                  proposal
                                )
                              }
                              onRemove={() =>
                                handleRemove(
                                  proposal
                                )
                              }
                              action={
                                action
                              }
                            />
                          )
                        )}
                    </div>
                  )}
                </div>

                <div className="panel">
                  <div className="panel-header">
                    <div>
                      <span className="section-eyebrow">
                        SECURITY
                      </span>

                      <h2>
                        Authorization
                      </h2>
                    </div>
                  </div>

                  <div className="threshold-ring">
                    <div>
                      <strong>
                        {
                          multisig.threshold
                        }
                      </strong>

                      <span>
                        OF{" "}
                        {
                          multisig
                            .owners
                            .length
                        }
                      </span>
                    </div>
                  </div>

                  <div className="security-copy">
                    <strong>
                      Threshold secured
                    </strong>

                    <span>
                      Ready proposals can be
                      executed by any signer-capable
                      account, while authorization
                      remains owner-driven.
                    </span>
                  </div>
                </div>
              </section>
            </>
          )}

        {multisig &&
          page ===
            "proposals" && (
            <section className="content-section">
              <div className="section-heading">
                <div>
                  <span className="section-eyebrow">
                    GOVERNANCE
                  </span>

                  <h1>
                    Proposals
                  </h1>

                  <p>
                    Create, approve, cancel,
                    execute and retire treasury
                    proposals.
                  </p>
                </div>

                <button
                  className="primary-button"
                  onClick={() =>
                    setPage(
                      "treasury"
                    )
                  }
                >
                  Treasury
                </button>
              </div>

              <div className="two-column">
                <div className="panel">
                  <div className="panel-title">
                    New proposal
                  </div>

                  <div className="segmented">
                    <button
                      className={
                        proposalAsset ===
                        "SOL"
                          ? "selected"
                          : ""
                      }
                      onClick={() =>
                        setProposalAsset(
                          "SOL"
                        )
                      }
                    >
                      SOL
                    </button>

                    <button
                      className={
                        proposalAsset ===
                        "TOKEN"
                          ? "selected"
                          : ""
                      }
                      onClick={() =>
                        setProposalAsset(
                          "TOKEN"
                        )
                      }
                    >
                      SPL Token
                    </button>
                  </div>

                  {proposalAsset ===
                    "TOKEN" && (
                    <>
                      <label>
                        Token vault
                      </label>

                      <select
                        value={
                          proposalTokenMint
                        }
                        onChange={(
                          event
                        ) =>
                          setProposalTokenMint(
                            event
                              .target
                              .value
                          )
                        }
                      >
                        <option value="">
                          Select a token
                        </option>

                        {tokenVaults.map(
                          (
                            vault
                          ) => (
                            <option
                              key={vault.mint.toBase58()}
                              value={vault.mint.toBase58()}
                            >
                              {shortenAddress(
                                vault.mint.toBase58(),
                                7
                              )}
                            </option>
                          )
                        )}
                      </select>
                    </>
                  )}

                  <label>
                    Recipient wallet
                  </label>

                  <input
                    value={
                      proposalRecipient
                    }
                    onChange={(
                      event
                    ) =>
                      setProposalRecipient(
                        event.target
                          .value
                      )
                    }
                    placeholder="Solana public key"
                  />

                  <label>
                    Amount
                  </label>

                  <input
                    value={
                      proposalAmount
                    }
                    onChange={(
                      event
                    ) =>
                      setProposalAmount(
                        event.target.value
                      )
                    }
                    placeholder={
                      proposalAsset ===
                      "SOL"
                        ? "0.50"
                        : "100"
                    }
                  />

                  {!connectedWalletIsOwner && (
                    <div className="helper-text permission-note">
                      Your connected wallet is not a
                      multisig owner. You can view
                      this treasury, but proposal
                      creation requires owner authority.
                    </div>
                  )}

                  <button
                    className="primary-button"
                    onClick={
                      handleCreateProposal
                    }
                    disabled={
                      !connectedWalletIsOwner ||
                      action ===
                        "create-proposal"
                    }
                  >
                    {action ===
                    "create-proposal"
                      ? "Submitting..."
                      : "Create Proposal"}
                  </button>
                </div>

                <div className="panel">
                  <div className="panel-title">
                    Proposal lifecycle
                  </div>

                  <div className="lifecycle">
                    <div>
                      <span>
                        01
                      </span>

                      <strong>
                        Pending
                      </strong>

                      <small>
                        Proposal is collecting
                        owner votes.
                      </small>
                    </div>

                    <div>
                      <span>
                        02
                      </span>

                      <strong>
                        Ready
                      </strong>

                      <small>
                        Threshold has been reached.
                      </small>
                    </div>

                    <div>
                      <span>
                        03
                      </span>

                      <strong>
                        Executed
                      </strong>

                      <small>
                        Transfer is finalized
                        on-chain.
                      </small>
                    </div>
                  </div>
                </div>
              </div>

              <div className="panel proposal-panel">
                <div className="panel-header">
                  <div>
                    <span className="section-eyebrow">
                      ON-CHAIN
                    </span>

                    <h2>
                      All proposals
                    </h2>
                  </div>

                  <button
                    className="ghost-button"
                    onClick={() =>
                      refreshWallet()
                    }
                  >
                    Refresh
                  </button>
                </div>

                {proposals.length ===
                0 ? (
                  <div className="empty-state">
                    No proposals found.
                  </div>
                ) : (
                  <div className="proposal-list">
                    {proposals.map(
                      (
                        proposal
                      ) => (
                        <ProposalRowView
                          key={proposal.address.toBase58()}
                          proposal={
                            proposal
                          }
                          threshold={
                            multisig.threshold
                          }
                          onApprove={() =>
                            handleApprove(
                              proposal
                            )
                          }
                          onCancel={() =>
                            handleCancel(
                              proposal
                            )
                          }
                          onExecute={() =>
                            handleExecute(
                              proposal
                            )
                          }
                          onRemove={() =>
                            handleRemove(
                              proposal
                            )
                          }
                          action={
                            action
                          }
                          detailed
                          isOwner={
                            connectedWalletIsOwner
                          }
                        />
                      )
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

        {multisig &&
          page ===
            "treasury" && (
            <section className="content-section">
              <div className="section-heading">
                <div>
                  <span className="section-eyebrow">
                    ASSET CONTROL
                  </span>

                  <h1>
                    Treasury
                  </h1>

                  <p>
                    Manage SOL and SPL-token
                    vaults controlled by the
                    multisig PDA.
                  </p>
                </div>
              </div>

              <div className="treasury-hero">
                <div>
                  <span>
                    SOL VAULT
                  </span>

                  <strong>
                    {formatUnits(
                      vaultBalance,
                      9,
                      4
                    )}{" "}
                    SOL
                  </strong>

                  <code>
                    {vaultAddress
                      ? shortenAddress(
                          vaultAddress.toBase58(),
                          8
                        )
                      : "Not initialized"}
                  </code>
                </div>

                {!vaultAddress && (
                  <div className="treasury-action-stack">
                    <button
                      className="secondary-button"
                      onClick={
                        handleInitializeVault
                      }
                      disabled={
                        !connectedWalletIsInitializer ||
                        action ===
                          "init-vault"
                      }
                    >
                      {action ===
                      "init-vault"
                        ? "Initializing..."
                        : "Initialize SOL Vault"}
                    </button>

                    {!connectedWalletIsInitializer && (
                      <div className="helper-text">
                        Only the multisig initializer
                        can initialize the SOL vault.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="two-column">
                <div className="panel">
                  <div className="panel-title">
                    Deposit SOL
                  </div>

                  <input
                    value={
                      solDepositAmount
                    }
                    onChange={(
                      event
                    ) =>
                      setSolDepositAmount(
                        event.target.value
                      )
                    }
                    placeholder="0.25"
                  />

                  <button
                    className="primary-button"
                    onClick={
                      handleDepositSol
                    }
                  >
                    Deposit SOL
                  </button>
                </div>

                <div className="panel">
                  <div className="panel-title">
                    Initialize token vault
                  </div>

                  <input
                    value={
                      tokenMintInput
                    }
                    onChange={(
                      event
                    ) =>
                      setTokenMintInput(
                        event.target.value
                      )
                    }
                    placeholder="Mint public key"
                  />

                  <button
                    className="primary-button"
                    onClick={
                      handleInitializeTokenVault
                    }
                    disabled={
                      action ===
                      "init-token-vault"
                    }
                  >
                    {action ===
                    "init-token-vault"
                      ? "Creating..."
                      : "Create Token Vault"}
                  </button>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <div>
                    <span className="section-eyebrow">
                      SPL ASSETS
                    </span>

                    <h2>
                      Token vaults
                    </h2>
                  </div>

                  <span className="count-pill">
                    {tokenCount}
                  </span>
                </div>

                {tokenVaults.length ===
                0 ? (
                  <div className="empty-state">
                    No SPL-token vaults found.
                  </div>
                ) : (
                  <div className="token-grid">
                    {tokenVaults.map(
                      (
                        vault
                      ) => (
                        <div
                          className="token-card"
                          key={vault.address.toBase58()}
                        >
                          <div className="token-symbol">
                            SPL
                          </div>

                          <div className="token-main">
                            <strong>
                              {formatUnits(
                                vault.amount,
                                vault.decimals,
                                6
                              )}
                            </strong>

                            <span>
                              {shortenAddress(
                                vault.mint.toBase58(),
                                6
                              )}
                            </span>
                          </div>

                          <div className="token-foot">
                            <span>
                              {vault.decimals} decimals
                            </span>

                            <a
                              href={explorer(
                                vault.address
                              )}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View ↗
                            </a>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>

              <div className="panel">
                <div className="panel-title">
                  Deposit SPL token
                </div>

                <div className="form-grid">
                  <div>
                    <label>
                      Mint
                    </label>

                    <select
                      value={
                        tokenDepositMint
                      }
                      onChange={(
                        event
                      ) =>
                        setTokenDepositMint(
                          event.target
                            .value
                        )
                      }
                    >
                      <option value="">
                        Select token
                      </option>

                      {tokenVaults.map(
                        (
                          vault
                        ) => (
                          <option
                            key={vault.mint.toBase58()}
                            value={vault.mint.toBase58()}
                          >
                            {shortenAddress(
                              vault.mint.toBase58(),
                              7
                            )}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  <div>
                    <label>
                      Amount
                    </label>

                    <input
                      value={
                        tokenDepositAmount
                      }
                      onChange={(
                        event
                      ) =>
                        setTokenDepositAmount(
                          event.target
                            .value
                        )
                      }
                      placeholder="100"
                    />
                  </div>
                </div>

                <button
                  className="primary-button"
                  onClick={
                    handleDepositToken
                  }
                >
                  Deposit Tokens
                </button>
              </div>
            </section>
          )}

        {multisig &&
          page ===
            "members" && (
            <section className="content-section">
              <div className="section-heading">
                <div>
                  <span className="section-eyebrow">
                    GOVERNANCE
                  </span>

                  <h1>
                    Members
                  </h1>

                  <p>
                    On-chain owners and approval
                    threshold for this wallet.
                  </p>
                </div>
              </div>

              <div className="member-summary">
                <div>
                  <span>
                    OWNERS
                  </span>

                  <strong>
                    {
                      multisig.owners
                        .length
                    }
                  </strong>
                </div>

                <div>
                  <span>
                    REQUIRED
                  </span>

                  <strong>
                    {
                      multisig.threshold
                    }
                  </strong>
                </div>

                <div>
                  <span>
                    INITIALIZER
                  </span>

                  <strong>
                    {shortenAddress(
                      multisig.initializer.toBase58(),
                      7
                    )}
                  </strong>
                </div>
              </div>

              <div className="member-list">
                {multisig.owners.map(
                  (
                    owner: PublicKey,
                    index: number
                  ) => (
                    <div
                      className="member-card"
                      key={owner.toBase58()}
                    >
                      <div className="member-index">
                        {String(
                          index + 1
                        ).padStart(
                          2,
                          "0"
                        )}
                      </div>

                      <div className="member-info">
                        <strong>
                          {index ===
                          0
                            ? "Primary owner"
                            : `Owner ${index + 1}`}
                        </strong>

                        <span>
                          {owner.toBase58()}
                        </span>
                      </div>

                      <a
                        href={explorer(
                          owner
                        )}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Explorer ↗
                      </a>
                    </div>
                  )
                )}
              </div>
            </section>
          )}

        {multisig &&
          page ===
            "settings" && (
            <section className="content-section">
              <div className="section-heading">
                <div>
                  <span className="section-eyebrow">
                    CONFIGURATION
                  </span>

                  <h1>
                    Settings
                  </h1>

                  <p>
                    Network and on-chain identity
                    information for this wallet.
                  </p>
                </div>
              </div>

              <div className="settings-grid">
                <div className="panel">
                  <div className="panel-title">
                    Network
                  </div>

                  <div className="setting-row">
                    <span>
                      Cluster
                    </span>

                    <strong>
                      Devnet
                    </strong>
                  </div>

                  <div className="setting-row">
                    <span>
                      RPC
                    </span>

                    <strong>
                      {rpcEndpoint}
                    </strong>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-title">
                    Program
                  </div>

                  <div className="setting-row vertical">
                    <span>
                      Program ID
                    </span>

                    <code>
                      {PROGRAM_ID.toBase58()}
                    </code>
                  </div>

                  <a
                    className="primary-button link-button"
                    href={explorer(
                      PROGRAM_ID
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open program on Explorer ↗
                  </a>
                </div>

                <div className="panel">
                  <div className="panel-title">
                    Wallet
                  </div>

                  <div className="setting-row vertical">
                    <span>
                      Multisig PDA
                    </span>

                    <code>
                      {multisigAddress?.toBase58()}
                    </code>
                  </div>

                  <div className="setting-row">
                    <span>
                      Wallet ID
                    </span>

                    <strong>
                      {multisig.walletId.toString()}
                    </strong>
                  </div>
                </div>
              </div>
            </section>
          )}
      </main>
    </div>
  );
}

function ProposalRowView({
  proposal,
  threshold,
  onApprove,
  onCancel,
  onExecute,
  onRemove,
  action,
  detailed = false,
  isOwner = false
}: {
  proposal: ProposalRow;
  threshold: number;
  onApprove: () => void;
  onCancel: () => void;
  onExecute: () => void;
  onRemove: () => void;
  action: string | null;
  detailed?: boolean;
  isOwner?: boolean;
}) {
  const data =
    proposal.data;

  const isToken =
    data.mint !== null;

  const status =
    statusLabel(
      data.status
    );

  const approvals =
    data.approvals.length;

  const shortId =
    data.proposalId.toString();

  const busyPrefix =
    proposal.address.toBase58();

  return (
    <div className="proposal-row">
      <div className="proposal-id">
        <span>
          #
          {shortId}
        </span>

        <small>
          {isToken
            ? "SPL TOKEN"
            : "SOL"}
        </small>
      </div>

      <div className="proposal-main">
        <strong>
          Send{" "}
          {isToken
            ? "token"
            : "SOL"}
        </strong>

        <span>
          To{" "}
          {shortenAddress(
            data.recipient.toBase58(),
            5
          )}
        </span>
      </div>

      <div className="proposal-amount">
        <strong>
          {formatUnits(
            data.amount,
            isToken
              ? 6
              : 9,
            4
          )}
        </strong>

        <span>
          {isToken
            ? "base units"
            : "SOL"}
        </span>
      </div>

      <div className="proposal-votes">
        <strong>
          {approvals}
          /
          {threshold}
        </strong>

        <span>
          approvals
        </span>
      </div>

      <div
        className={`status ${statusClass(
          data.status
        )}`}
      >
        {status}
      </div>

      <div className="proposal-actions">
        {status ===
          "Pending" &&
          isOwner && (
          <>
            <button
              className="mini-button"
              onClick={
                onApprove
              }
              disabled={
                action ===
                `approve-${busyPrefix}`
              }
            >
              Approve
            </button>

            <button
              className="mini-button danger"
              onClick={
                onCancel
              }
            >
              Cancel
            </button>
          </>
        )}

        {status ===
          "Ready" && (
          <button
            className="mini-button primary"
            onClick={
              onExecute
            }
            disabled={
              action ===
              `execute-${busyPrefix}`
            }
          >
            {action ===
            `execute-${busyPrefix}`
              ? "Executing..."
              : "Execute"}
          </button>
        )}

        {(status ===
          "Executed" ||
          status ===
            "Cancelled") &&
          isOwner && (
          <button
            className="mini-button"
            onClick={
              onRemove
            }
            disabled={
              action ===
              `remove-${busyPrefix}`
            }
          >
            Remove
          </button>
        )}
      </div>

      {detailed && (
        <a
          className="proposal-link"
          href={`https://explorer.solana.com/address/${proposal.address.toBase58()}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
        >
          ↗
        </a>
      )}
    </div>
  );
}

export default App;