# QuorMesh

**QuorMesh** is a decentralized Solana multisig treasury for managing SOL and SPL tokens through threshold-based authorization.

> Collective authority. On-chain execution.

## Live Demo

🌐 **QuorMesh:** [https://quormesh.vercel.app](https://quormesh.vercel.app)

**Network:** Solana Devnet

**Program ID:**

```text
6kAdP7S1poZufGSxJ63LHr2KuLNjgmwNomjhu7WgAv8B
```

## Overview

QuorMesh enables multiple owners to securely manage a shared treasury on Solana.

Instead of allowing a single wallet to control funds, QuorMesh uses a configurable approval threshold. A proposal must collect enough owner approvals before it can be executed.

For example:

- 3 owners
- 2-of-3 threshold
- any 2 owners can approve a proposal
- once the threshold is reached, the proposal becomes ready for execution

QuorMesh currently runs on **Solana Devnet**.

## Features

- Multi-owner multisig treasury
- Configurable approval threshold
- SOL vault support
- SPL token vault support
- SOL deposits
- SPL token deposits
- Transfer proposal creation
- Owner approvals
- Double-voting prevention
- Proposal cancellation
- Permissionless execution after threshold approval
- Proposal cleanup
- Shareable treasury links
- Direct treasury loading using multisig address
- Phantom wallet support through Wallet Standard
- Solflare wallet support
- Owner / initializer / viewer role detection
- Solana Explorer integration

## Multisig Architecture

Each multisig treasury is derived using a Program Derived Address (PDA).

### Multisig PDA

```text
["multisig", initializer_pubkey, wallet_id]
```

The combination of the initializer public key and wallet ID identifies a multisig for that initializer.

### SOL Vault PDA

```text
["vault", multisig_pda]
```

The SOL vault stores the treasury's native SOL balance.

### SPL Token Vault PDA

```text
["token_vault", multisig_pda, mint_pubkey]
```

Each supported token mint has its own token vault controlled by the multisig PDA.

### Proposal PDA

```text
["proposal", multisig_pda, proposal_id]
```

Each transfer request is stored in its own proposal account.

## Proposal Lifecycle

A proposal moves through the following states:

```text
Pending
   ↓
Ready
   ↓
Executed
```

A pending proposal collects owner approvals.

Once the configured threshold is reached, the proposal becomes ready.

Ready proposals can then be executed on-chain.

Proposals can also be cancelled according to the multisig voting rules.

## Supported Assets

QuorMesh currently supports:

- SOL
- SPL tokens

## Frontend Flow

```text
Connect Wallet
      ↓
Create or Load Multisig
      ↓
Initialize Vault
      ↓
Deposit SOL / SPL Tokens
      ↓
Create Proposal
      ↓
Owners Approve
      ↓
Threshold Reached
      ↓
Execute Proposal
```

## Tech Stack

### Solana Program

- Rust
- Anchor 0.32.1
- Solana
- SPL Token Program

### Frontend

- React
- TypeScript
- Vite
- Anchor TypeScript client
- Solana Web3.js
- Solana Wallet Adapter
- SPL Token JavaScript SDK

## Network

QuorMesh is currently deployed on:

```text
Solana Devnet
```

Program ID:

```text
6kAdP7S1poZufGSxJ63LHr2KuLNjgmwNomjhu7WgAv8B
```

## Project Structure

```text
multisig-wallet/
│
├── programs/
│   └── multisig-wallet/
│       └── src/
│
├── tests/
│
├── app/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── styles.css
│   │   ├── idl/
│   │   └── lib/
│   │
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
│
├── Anchor.toml
├── Cargo.toml
└── README.md
```

## Running the Frontend

Go to the frontend directory:

```bash
cd app
```

Install dependencies:

```bash
yarn install
```

Start the development server:

```bash
yarn dev
```

Build for production:

```bash
yarn build
```

Preview the production build:

```bash
yarn preview
```

## Environment Variables

Create an `app/.env` file:

```env
VITE_PROGRAM_ID=6kAdP7S1poZufGSxJ63LHr2KuLNjgmwNomjhu7WgAv8B
VITE_RPC_URL=https://api.devnet.solana.com
```

An example configuration is available in:

```text
app/.env.example
```

Do not commit private credentials or sensitive RPC keys.

## Running Anchor Tests

From the project root:

```bash
anchor test
```

The project includes coverage for:

- multisig creation
- owner validation
- threshold validation
- duplicate owner prevention
- SOL vault initialization
- SOL deposits
- SPL token vault initialization
- SPL deposits
- proposal creation
- approvals
- double-voting prevention
- cancellation
- SOL execution
- SPL token execution
- insufficient balance handling
- recipient validation
- permissionless execution
- proposal cleanup

## Security Model

Treasury assets are not controlled by a single wallet.

Authorization depends on the multisig owner set and configured approval threshold.

SOL and SPL token vaults are controlled using Program Derived Addresses.

Only valid owners can participate in approval and cancellation decisions.

Execution becomes available only after the required approval threshold has been reached.

## Devnet Status

Current project status:

- Anchor program deployed to Devnet
- SOL treasury flow tested
- SPL token treasury flow tested
- Multisig proposal lifecycle tested
- Frontend wallet integration working
- Treasury sharing working
- Production frontend build passing

## Disclaimer

QuorMesh is currently deployed on **Solana Devnet** and is intended for development, testing, demonstration, and educational purposes.

It has not been audited for production mainnet use.

## License

This project is currently provided for development and educational use.
