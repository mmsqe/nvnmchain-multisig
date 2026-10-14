/* End-to-end verification against real Safe v1.3.0 contracts on anvil. */
import { createPublicClient, createWalletClient, http, hashTypedData, encodeFunctionData, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { multiSendCallOnlyAbi, safeAbi, safeProxyFactoryAbi } from '../src/lib/abi'
import { SAFE_ADDRESSES, SAFE_CREATION_CODE } from '../src/lib/safeArtifacts'
import {
  buildSafeTx,
  computeSafeTxHash,
  encodeSafeSetup,
  packMultiSend,
  packSignatures,
  preApprovedSignature,
  predictSafeAddress,
  recoverSigner,
  safeTxTypedData,
  serializeTx,
  type SafeCall,
  type SafeTxParams,
} from '../src/lib/safe'
import {
  buildSafeUrl,
  buildShareUrl,
  buildSignatureUrl,
  decodeShare,
  decodeSignatureShare,
  encodeShare,
  encodeSignatureShare,
  parseSignatureShare,
  readShareLink,
} from '../src/lib/share'
import { importSignatureShare } from '../src/lib/coordinate'
import { decodeMultiSend, isMultiSendCall } from '../src/lib/decode'
import { BUILTIN_ABIS, decodeWithAbis } from '../src/lib/contracts'
import { upsertPending, type PendingTx } from '../src/lib/storage'

// localStorage shim so the pending-transaction store works under bun.
const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
}

const RPC = process.env.RPC ?? 'http://127.0.0.1:8545'
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const pub = createPublicClient({ transport: http(RPC) })
const wallet = createWalletClient({ account, transport: http(RPC) })

let failures = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}

async function deploy(data: `0x${string}`) {
  const hash = await wallet.sendTransaction({ data })
  const r = await pub.waitForTransactionReceipt({ hash })
  if (!r.contractAddress) throw new Error('no contract address')
  return r.contractAddress
}

async function readHash(safe: `0x${string}`, tx: SafeTxParams) {
  return pub.readContract({
    address: safe,
    abi: safeAbi,
    functionName: 'getTransactionHash',
    args: [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, tx.nonce],
  })
}

async function signTx(safe: `0x${string}`, tx: SafeTxParams) {
  const typed = safeTxTypedData(31337, safe, tx)
  return wallet.signTypedData({ domain: typed.domain, types: typed.types, primaryType: 'SafeTx', message: typed.message })
}

async function exec(safe: `0x${string}`, tx: SafeTxParams, signature: `0x${string}`) {
  const hash = await wallet.writeContract({
    address: safe,
    abi: safeAbi,
    functionName: 'execTransaction',
    args: [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, packSignatures([{ owner: account.address, signature }])],
  })
  return (await pub.waitForTransactionReceipt({ hash })).status
}

// --- deploy the suite (regular CREATE; address derivation is verified separately) ---
const safeL2 = await deploy(SAFE_CREATION_CODE.safeL2 as `0x${string}`)
const factory = await deploy(SAFE_CREATION_CODE.safeProxyFactory as `0x${string}`)
const fallback = await deploy(SAFE_CREATION_CODE.compatibilityFallbackHandler as `0x${string}`)
const multiSendLocal = await deploy(SAFE_CREATION_CODE.multiSendCallOnly as `0x${string}`)

const initializer = encodeSafeSetup({ owners: [account.address], threshold: 1n, fallbackHandler: fallback })
const predicted = predictSafeAddress({ singleton: safeL2, factory, initializer, saltNonce: 0n })
const createHash = await wallet.writeContract({ address: factory, abi: safeProxyFactoryAbi, functionName: 'createProxyWithNonce', args: [safeL2, initializer, 0n] })
const createR = await pub.waitForTransactionReceipt({ hash: createHash })
const proxyLog = createR.logs.find((l) => l.address.toLowerCase() === factory.toLowerCase())
if (!proxyLog) throw new Error('ProxyCreation log not found')
const safe = ('0x' + proxyLog.data.slice(26, 66)) as `0x${string}`

check('predictSafeAddress == factory proxy', predicted.toLowerCase() === safe.toLowerCase(), `${predicted} / ${safe}`)
const owners = await pub.readContract({ address: safe, abi: safeAbi, functionName: 'getOwners' })
check('proxy owners/threshold', owners.length === 1 && owners[0]!.toLowerCase() === account.address.toLowerCase() && (await pub.readContract({ address: safe, abi: safeAbi, functionName: 'getThreshold' })) === 1n)

// --- single transaction: hash + sign + execute ---
const tx: SafeTxParams = {
  to: '0x000000000000000000000000000000000000dEaD',
  value: 0n,
  data: '0xdeadbeef',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: '0x0000000000000000000000000000000000000000',
  refundReceiver: '0x0000000000000000000000000000000000000000',
  nonce: 0n,
}
const mine = computeSafeTxHash(31337n, safe, tx)
const onchain = await readHash(safe, tx)
check('computeSafeTxHash == Safe.getTransactionHash', mine.toLowerCase() === onchain.toLowerCase(), mine)
const typed = safeTxTypedData(31337, safe, tx)
check('hashTypedData == computeSafeTxHash', hashTypedData({ domain: typed.domain, types: typed.types, primaryType: 'SafeTx', message: typed.message }).toLowerCase() === mine.toLowerCase())
const signature = await signTx(safe, tx)
check('recoverSigner == signer', (await recoverSigner(mine, signature)).toLowerCase() === account.address.toLowerCase())
check('execTransaction succeeded', (await exec(safe, tx, signature)) === 'success')
check('nonce incremented', (await pub.readContract({ address: safe, abi: safeAbi, functionName: 'nonce' })) === 1n)

// --- MultiSend batch: place MultiSendCallOnly at its configured address, then execute ---
const runtime = await pub.getCode({ address: multiSendLocal })
await pub.request({ method: 'anvil_setCode', params: [SAFE_ADDRESSES.multiSendCallOnly, runtime] } as never)
const calls: SafeCall[] = [
  { to: '0x000000000000000000000000000000000000dEaD', value: 0n, data: '0x' },
  { to: '0x000000000000000000000000000000000000bEEF', value: 0n, data: '0x1234' },
]
const batchTx = buildSafeTx(calls, 1n)
check('batch targets MultiSendCallOnly + delegatecall', batchTx.to.toLowerCase() === SAFE_ADDRESSES.multiSendCallOnly.toLowerCase() && batchTx.operation === 1)
check('batch calldata == multiSend(packMultiSend)', batchTx.data.toLowerCase() === encodeFunctionData({ abi: multiSendCallOnlyAbi, functionName: 'multiSend', args: [packMultiSend(calls)] }).toLowerCase())
check('batch SafeTx hash matches on-chain', computeSafeTxHash(31337n, safe, batchTx).toLowerCase() === (await readHash(safe, batchTx)).toLowerCase())
check('batch MultiSend execution succeeded', (await exec(safe, batchTx, await signTx(safe, batchTx))) === 'success')

// --- transaction review decoding ---
const transferAbi = parseAbi(['function transfer(address to, uint256 amount)'])
const transferData = encodeFunctionData({ abi: transferAbi, functionName: 'transfer', args: [account.address, 1234567n] })
const decoded = decodeWithAbis(BUILTIN_ABIS, account.address, transferData)
check(
  'review decodes transfer',
  decoded?.fn.name === 'transfer' &&
    (decoded.args[0] as string).toLowerCase() === account.address.toLowerCase() &&
    decoded.args[1] === 1234567n,
)
const unpacked = decodeMultiSend(batchTx.data)
check(
  'decodeMultiSend round-trips the batch',
  unpacked.length === 2 &&
    unpacked[0]!.to.toLowerCase() === calls[0]!.to.toLowerCase() &&
    unpacked[1]!.data === calls[1]!.data &&
    isMultiSendCall(batchTx, SAFE_ADDRESSES.multiSendCallOnly),
)

// --- owner sorting: pass owners in descending order, expect ascending on-chain ---
const secondOwner = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const
const init2 = encodeSafeSetup({ owners: [account.address, secondOwner], threshold: 1n, fallbackHandler: fallback })
const pred2 = predictSafeAddress({ singleton: safeL2, factory, initializer: init2, saltNonce: 1n })
const create2 = await wallet.writeContract({ address: factory, abi: safeProxyFactoryAbi, functionName: 'createProxyWithNonce', args: [safeL2, init2, 1n] })
const createR2 = await pub.waitForTransactionReceipt({ hash: create2 })
const log2 = createR2.logs.find((l) => l.address.toLowerCase() === factory.toLowerCase())!
const safe2 = ('0x' + log2.data.slice(26, 66)) as `0x${string}`
check('multi-owner prediction matches', pred2.toLowerCase() === safe2.toLowerCase())
const owners2 = await pub.readContract({ address: safe2, abi: safeAbi, functionName: 'getOwners' })
check(
  'setup sorts owners ascending',
  owners2[0]!.toLowerCase() === secondOwner.toLowerCase() && owners2[1]!.toLowerCase() === account.address.toLowerCase(),
  owners2.join(', '),
)

// --- on-chain approval path: approveHash + pre-approved signature ---
const tx2: SafeTxParams = { ...tx, data: '0x1234', nonce: 2n }
check('approve tx hash matches on-chain', computeSafeTxHash(31337n, safe, tx2).toLowerCase() === (await readHash(safe, tx2)).toLowerCase())
const approveHashTx = await wallet.writeContract({ address: safe, abi: safeAbi, functionName: 'approveHash', args: [computeSafeTxHash(31337n, safe, tx2)] })
await pub.waitForTransactionReceipt({ hash: approveHashTx })
const approvedValue = await pub.readContract({ address: safe, abi: safeAbi, functionName: 'approvedHashes', args: [account.address, computeSafeTxHash(31337n, safe, tx2)] })
check('approvedHashes == 1 after approveHash', approvedValue === 1n)
const preSig = preApprovedSignature(account.address)
const exec2 = await wallet.writeContract({
  address: safe,
  abi: safeAbi,
  functionName: 'execTransaction',
  args: [tx2.to, tx2.value, tx2.data, tx2.operation, tx2.safeTxGas, tx2.baseGas, tx2.gasPrice, tx2.gasToken, tx2.refundReceiver, packSignatures([{ owner: account.address, signature: preSig }])],
})
check('execTransaction with pre-approved signature succeeded', (await pub.waitForTransactionReceipt({ hash: exec2 })).status === 'success')

// --- share link round-trip ---
const sample: PendingTx = {
  id: computeSafeTxHash(31337n, safe, tx2),
  chainId: 31337,
  safe,
  createdAt: Date.now(),
  label: 'shared',
  tx: serializeTx(tx2),
  signatures: { [account.address.toLowerCase()]: preSig },
}
const round = decodeShare(encodeShare([sample]))
check('share encode/decode round-trip', round.length === 1 && round[0]!.id === sample.id && round[0]!.signatures[account.address.toLowerCase()] === preSig)

// --- deep link: carries the Safe address (and chain), loads it immediately ---
;(globalThis as unknown as { location: unknown }).location = { hash: '', origin: 'https://app.example', pathname: '/', search: '' }
const loc = (globalThis as unknown as { location: { hash: string } }).location
loc.hash = new URL(buildSafeUrl(account.address, 31337)).hash
const safeLink = readShareLink()
check('deep link parses safe + chain', safeLink.safe?.toLowerCase() === account.address.toLowerCase() && safeLink.chainId === 31337 && safeLink.txs === undefined)
loc.hash = new URL(buildShareUrl([sample])).hash
const txLink = readShareLink()
check('deep link parses safe + chain + txs', txLink.safe?.toLowerCase() === safe.toLowerCase() && txLink.chainId === 31337 && txLink.txs?.length === 1 && txLink.txs[0]!.id === sample.id)

// --- single-signature sharing: signer copies just their signature ---
const tx3: SafeTxParams = { ...tx, data: '0xabcd', nonce: 3n }
const hash3 = computeSafeTxHash(31337n, safe, tx3)
const sig3 = await signTx(safe, tx3)
upsertPending({ id: hash3, chainId: 31337, safe, createdAt: Date.now(), label: 'single sig', tx: serializeTx(tx3), signatures: {} })
const shareSig = { id: hash3, owner: account.address, signature: sig3 }
const sigCode = encodeSignatureShare(shareSig)
check('signature share round-trip', decodeSignatureShare(sigCode).signature === sig3 && parseSignatureShare(buildSignatureUrl(shareSig)).id === hash3)
const imported = await importSignatureShare(pub, decodeSignatureShare(sigCode))
check(
  'importSignatureShare adds the single signature',
  imported.owner.toLowerCase() === account.address.toLowerCase() &&
    imported.list.find((p) => p.id === hash3)?.signatures[account.address.toLowerCase()] === sig3,
)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
