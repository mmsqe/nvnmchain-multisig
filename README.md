# NVNM Multisig

**A lightweight, backend-less [Safe](https://safe.global) multisig for NVNM Chain** — a Tempo-compatible L1.

### ▶ [Open the app](https://yihuang.github.io/nvnmchain-multisig/)

A *Safe* is an on-chain account owned by a set of addresses: a transaction executes
once a **threshold** of those owners approve it. This app creates and manages Safes
on NVNM Chain.

There is no server, no Safe Transaction Service and no indexer — the app talks
straight to the chain RPC and keeps proposals, approvals and Safes in the browser.
The multisig rules live in Safe on-chain, so a backend could only ever be a
bulletin board; this one does without.

| | |
| --- | --- |
| **Network** | NVNM Testnet · chain id `787223` |
| **RPC** | `https://rpc.nvnm.testnet.nvnmchain.io` |
| **Fees** | paid in the TIP-20 fee token (`nUSD` on testnet, `pathUSD` on canary) — NVNM has no native gas token |
| **Safe** | v1.3.0 (SafeL2 singleton) at the official **eip155** addresses |

## What you can do

- **Set up the Safe contracts** once (singleton, proxy factory, fallback handler, MultiSend).
- **Create a Safe** from any owners and threshold — the address is derived and shown *before* you deploy.
- **Load a Safe** by address and see its owners, threshold, nonce and fee-token balance.
- **Build transactions** — TIP-20 transfers or raw contract calls, batched through MultiSend.
- **Describe contracts with human-readable ABIs** — known interfaces (TIP-20, ERC-20/721/1155, WETH, Multicall3, Safe, NVNM Anchoring, …) ship with the app, and you can add your own; parameter fields are generated from the ABI.
- **Review before signing or executing** — a decoded view of every call (target, calldata, token amounts, batch contents), plus a pre-sign preview.
- **Collect approvals without a backend** — off-chain EIP-712 signatures, on-chain `approveHash`, or a single signature sent out-of-band. All three mix and count toward the threshold.
- **Execute** once the threshold is met — anyone can submit.
- Light/dark theme that follows your OS.

## Using it

1. Connect an injected wallet (MetaMask, Rabby, …). The app offers to add the NVNM network.
2. **Contracts** → *Deploy missing contracts* — one-time, a few transactions.
3. **Create / Load** → create a Safe or open an existing one.
4. **New transaction** → build a transfer or call, *Preview* it, then sign.
5. **Queue** → collect the remaining approvals and *Execute*.

## Contract interfaces (human-readable ABI)

The calldata builder and the review view share one registry of **human-readable
ABIs** ([ox docs](https://oxlib.sh/guides/abi#human-readable-abis)) — one method
per line. The `function` keyword and parameter names are optional, so a bare
signature is enough:

```
transfer(address,uint256)
approve(address,uint256)
name() view returns (string)
```

(Full items like `function transfer(address to, uint256 amount) returns (bool)`
and `event …` lines work too; a trailing `;` is dropped.)

- **Interfaces** tab: browse the built-ins (TIP-20, ERC-20, ERC-721,
  ERC-1155, WETH, Ownable, Multicall3, Safe v1.3.0, NVNM Anchoring) and add your own. A custom
  interface can be bound to a contract address so the builder auto-detects it.
  Custom interfaces are stored in `localStorage`. The **NVNM Anchoring**
  interface is bound to its fixed precompile address
  `0x0000000000000000000000000000000000000A00`, so calls to it are detected and
  decoded automatically.
- **New transaction → Contract call**: pick a target and an interface, choose a
  function and the parameter fields are derived from the ABI — including
  arrays, fixed-length arrays and (nested) tuples. The encoded calldata is
  shown live; **Raw calldata** stays available as a fallback.
- **Type a method inline**: in the builder, pick **Custom method** and enter a
  single signature like `transfer(address,uint256)` — no name or interface
  needed; the parameter fields and calldata are derived from it.
- **Review**: every call is decoded against the registered interfaces
  (address-bound ones first), so a queued transaction shows its function name
  and arguments instead of an opaque hex blob.

## Coordinating signers (no backend)

Any channel that moves a proposed transaction between signers works. The app supports three:

**1. Share link.** After signing, *Share link* encodes the Safe, its chain and the proposal (plus any signatures so far) into the URL fragment — `#safe=0x…&chain=787223&txs=<base64url>`. Opening it switches to the right network, opens the Safe and offers to import. *Copy link* on the dashboard shares a Safe on its own; *Export/Import JSON* does the same via paste or file.

**2. On-chain approvals.** An owner can call `Safe.approveHash(safeTxHash)` from the queue. Nothing needs to be handed back: approvals are read from `approvedHashes` and, at execution time, turned into Safe's pre-approved signature form (`r = owner`, `s = 0`, `v = 1`).

**3. Single signature, out-of-band.** A signer clicks *Copy signature* to get a compact code (base64url of `{id, owner, signature}`) and sends just that to the coordinator, who pastes it into *Add signature* (or opens a `#sig=…` link). The app recovers the signer and verifies they are an owner before merging — no need to exchange the whole transaction.

Off-chain and on-chain approvals are merged and deduplicated per owner, then counted against the threshold. A fully-approved transaction is executable by **anyone**, so treat share links and exported JSON as sensitive until it runs. URL fragments get long for big batches; fall back to JSON if a chat app truncates them.

## Safe contract deployment

NVNM pre-deploys the deterministic **Safe singleton factory** (the "SafeDeployer"; calldata = `salt ‖ initcode`) at `0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7`. Deploying the Safe v1.3.0 bytecode through it with a zero salt reproduces Safe's official **eip155** addresses:

| Contract | Address |
| --- | --- |
| SafeL2 singleton | `0xfb1bffC9d739B8D520DaF37dF666da4C687191EA` |
| SafeProxyFactory | `0xC22834581EbC8527d974F8a1c97E1bEA4EF910BC` |
| CompatibilityFallbackHandler | `0x017062a1dE2FE6b99BE3d9d37841FeD19F573804` |
| MultiSendCallOnly | `0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B` |

The exact `@gnosis.pm/safe-contracts@1.3.0` creation bytecode is bundled in `src/lib/safeArtifacts.ts`; runtime code hashes match `@safe-global/safe-deployments` and each CREATE2 address is re-derived from factory + bytecode. (The same bytecode via the Arachnid factory `0x4e59b448…` lands on Safe's *canonical* set instead; switching is a one-line change in that file.)

## Develop

```bash
npm install
npm run dev      # http://localhost:5174
npm run build    # type-check + production bundle in dist/
```

Push to `main` deploys to GitHub Pages via [`.github/workflows/pages.yml`](.github/workflows/pages.yml); [`ci.yml`](.github/workflows/ci.yml) type-checks and builds, runs the ABI checks, then runs the Safe integration checks against anvil. Enable **Settings → Pages → Source: GitHub Actions** once (the workflow can also do it). The base path is derived from the repo name — set `BASE_PATH=/…/` to override.

### Verify

`scripts/check-abis.ts` parses every built-in interface, pins the Anchoring selectors and round-trips encode/decode across the parameter model (slowest: none — no chain needed):

```bash
npm run verify:abis   # requires bun
```

`scripts/verify-safe.ts` deploys the real Safe v1.3.0 contracts to a local [anvil](https://book.getfoundry.sh/anvil/) node and exercises the whole pipeline: address prediction, owner sorting, EIP-712 hashing, signature recovery, `execTransaction`, MultiSend and single-signature import.

```bash
anvil --port 8546 &
RPC=http://127.0.0.1:8546 npm run verify:safe   # requires bun
```

Both end with `ALL ABI CHECKS PASSED` / `ALL CHECKS PASSED`.

## Project layout

```
src/
  chain.ts               network config, explorer links, formatting
  lib/
    safeArtifacts.ts     eip155 addresses + v1.3.0 creation bytecode (generated)
    safe.ts              setup encoding, address prediction, SafeTx hash, sig packing
    decode.ts            calldata decoding + MultiSend unpacking for the review view
    contracts.ts         human-readable ABI registry (built-ins + user, localStorage)
    abiparams.ts         ABI parameter model: derive fields, validate, coerce to args
    share.ts             share links, signature codes, deep links
    coordinate.ts        import a single out-of-band owner signature
    storage.ts           localStorage: queued transactions + tracked Safes
    abi.ts, hooks.ts, wallet.ts, theme.ts
  components/            ConnectBar, ContractsPanel, SafePicker, SafeDashboard,
                         NewTransaction, ContractCallFields, ParamInput, AbiManager,
                         TransactionReview, Queue
```

## Security

- **Testnet software, unaudited.** Use at your own risk.
- Signatures are collected off-chain and stored in this browser's `localStorage`.
  A threshold-signed transaction can be executed by anyone, so treat exported
  signatures and share links as sensitive until it runs.
- A queued transaction is only executable while the Safe's nonce still matches;
  the queue flags stale nonces.
- Always verify the Safe address, target and calldata in your wallet before signing.
