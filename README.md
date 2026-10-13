# NVNM Multisig

A **lightweight [Safe](https://safe.global) multisig UI** for **NVNM Chain** — a
Tempo-compatible L1 (EVM + Tempo transactions), with **no backend**: it talks
directly to the chain RPC and keeps pending transactions in the browser.

- **Network:** NVNM Testnet — chain id `787223`, RPC `https://rpc.nvnm.testnet.nvnmchain.io`
- **Fee token:** `nUSD` / `pathUSD` (`0x20c0…0000`, TIP-20, 6 decimals). There is
  no native gas token — the protocol FeeManager charges a TIP-20 and plain
  EIP-1559 transactions default to the fee token.
- **Safe version:** v1.3.0 (SafeL2 singleton), deployed at the official **eip155** addresses.

## Features

- **One-time contract setup** — deploys the Safe v1.3.0 singleton, proxy factory,
  compatibility fallback handler and MultiSendCallOnly at the official **eip155**
  addresses.
- **Create a Safe** — owners + threshold + salt nonce; the Safe address is
  derived and shown *before* deployment.
- **Load a Safe** — read version, owners, threshold, nonce and balances.
- **New transaction** — token transfers or raw contract calls; multiple calls
  are batched through `MultiSendCallOnly` (delegatecall).
- **Off-chain signatures** — owners sign the SafeTx EIP-712 payload in their
  wallet; signatures are collected locally and shared as a **link** or as
  **JSON**.
- **On-chain approvals** — owners can instead (or additionally) call
  `approveHash` on-chain; both kinds count toward the threshold and can be
  mixed.
- **Single-signature sharing** — a signer can send just their signature code
  out-of-band; the coordinator imports it without exchanging the transaction.
- **Execute** — once the threshold is reached, anyone can submit
  `execTransaction`.
- **Queue** — pending transactions, approval status, stale-nonce detection.
- **Light / dark theme** — follows the OS preference by default, with a header
  toggle that persists the choice (`localStorage`).

## How the Safe contracts get deployed

The chain pre-deploys the deterministic **Safe singleton factory** (a.k.a.
"SafeDeployer"; calldata = `salt ‖ initcode`):

| Factory | Address |
| --- | --- |
| Safe singleton factory ("SafeDeployer") | `0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7` |

Safe contracts are deployed **once**, through it with a zero salt, which
reproduces the official Safe v1.3.0 **"eip155"** addresses:

| Contract | Address |
| --- | --- |
| SafeL2 singleton | `0xfb1bffC9d739B8D520DaF37dF666da4C687191EA` |
| SafeProxyFactory | `0xC22834581EbC8527d974F8a1c97E1bEA4EF910BC` |
| CompatibilityFallbackHandler | `0x017062a1dE2FE6b99BE3d9d37841FeD19F573804` |
| MultiSendCallOnly | `0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B` |

The exact creation bytecode from `@gnosis.pm/safe-contracts@1.3.0` is bundled in
`src/lib/safeArtifacts.ts`; the runtime code hashes match
`@safe-global/safe-deployments` and every CREATE2 address was re-derived from the
factory + bytecode.

> **Note.** The same bytecode deployed through the Arachnid factory
> (`0x4e59b44847b379578588920cA78FbF26c0B4956C`) instead lands on Safe's
> **"canonical"** address set (`SafeL2 0x3E5c6364…`, `SafeProxyFactory 0xa6B71E26…`).
> This app targets the eip155 set; switching is only a matter of changing
> `CREATE2_FACTORY` + `SAFE_ADDRESSES` in `src/lib/safeArtifacts.ts`.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5174
npm run build    # production bundle in dist/
```

The interface ships with the NVNM logo (also the favicon) and a light/dark theme:
no stored preference means it tracks `prefers-color-scheme`, and the sun/moon
button in the header pins an explicit choice.

Then:

1. Connect an injected wallet (MetaMask / Rabby) and confirm the NVNM network
   (the UI offers to add it).
2. **Contracts** tab → *Deploy missing contracts* (one-time, a few transactions
   paid in the fee token).
3. **Create / Load** tab → create a Safe, or load an existing address.
4. **New transaction** tab → build a transfer / call, sign it (EIP-712).
5. **Queue** tab → collect the remaining signatures (Export / Import to share)
   and *Execute*.

## Coordinating signers (backend-less)

Safe enforces owners and the threshold on-chain, so no server is required — any
channel that moves a proposed transaction between signers works.

1. **Share link.** The proposer builds and signs a transaction, then clicks
   *Share link*: the link carries the Safe address, its chain and the proposal
   (plus any signatures collected so far) in the URL fragment
   (`#safe=0x…&chain=787223&txs=<base64url>`). Opening the link **switches to the
   right network and opens the Safe immediately**, and offers to import the
   transactions into the queue. The Safe dashboard's *Copy link* button produces
   the same link without any transactions, so you can hand someone a Safe to
   open. *Export JSON* / *Import* carry the payload as a paste/file.

2. **On-chain approvals.** An owner can instead (or additionally) call
   `Safe.approveHash(safeTxHash)` from the queue. This is public and needs no
   hand-off: approvals are read from `approvedHashes` and, at execution time,
   converted to Safe's pre-approved signature form (`r = owner`, `s = 0`,
   `v = 1`). Off-chain and on-chain approvals are merged, deduplicated per
   owner, and counted against the threshold.

3. **Single signature (out-of-band).** A signer who has the transaction can
   click **Copy signature** to get a compact code (base64url of
   `{id, owner, signature}`) and send *just that* to the coordinator over any
   channel — no need to exchange the whole transaction. The coordinator pastes
   it into **Add signature** on the queue (or opens a `#sig=…` link); the app
   recovers the signer, verifies it is an owner of the Safe, and merges only
   that approval.

A fully-approved transaction is executable by **anyone**, so treat share links
and exported JSON as sensitive until it is executed. URL fragments can get long
for MultiSend batches; fall back to JSON if a chat app truncates the link.

## Verifying the Safe integration

`scripts/verify-safe.ts` deploys the real Safe v1.3.0 contracts to a local
[anvil](https://book.getfoundry.sh/anvil/) node and checks the whole pipeline:
address prediction, owner sorting, EIP-712 hashing, signature recovery,
`execTransaction` and a MultiSend batch executed through the Safe.

```bash
anvil --port 8546 &
RPC=http://127.0.0.1:8546 npm run verify:safe   # requires bun
```

Expected output ends with `ALL CHECKS PASSED`.

## Project layout

```
src/
  chain.ts               network config, formatting, explorer links
  lib/
    safeArtifacts.ts     eip155 addresses + v1.3.0 creation bytecode (generated)
    safe.ts              setup encoding, address prediction, SafeTx hash, sig packing, MultiSend
    abi.ts               minimal Safe / factory / TIP-20 ABIs
    hooks.ts             useSafeInfo / useTokenMeta / useTokenBalance
    storage.ts           localStorage: queued transactions + tracked Safes
    share.ts             share/signature codes + deep links (base64url)
    coordinate.ts        import a single out-of-band owner signature
    wallet.ts            injected-wallet hook (viem)
  components/            ConnectBar, ContractsPanel, SafePicker, SafeDashboard, NewTransaction, Queue
```

## Security notes

- **Testnet software.** Not audited; use at your own risk.
- Signatures are collected **off-chain** and stored in this browser's
  `localStorage`. Treat exported signature JSON as sensitive until the
  transaction is executed (a signed SafeTx can be executed by anyone once the
  threshold is met).
- A queued transaction is only executable while the Safe's nonce still matches;
  the Queue flags stale nonces.
- Always verify the Safe address, target, value and calldata in your wallet
  before signing.
