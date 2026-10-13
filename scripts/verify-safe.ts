/* End-to-end verification against real Safe v1.3.0 contracts on anvil. */
import { createPublicClient, createWalletClient, http, hashTypedData, encodeFunctionData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { multiSendCallOnlyAbi, safeAbi, safeProxyFactoryAbi } from '../src/lib/abi'
import { SAFE_ADDRESSES, SAFE_CREATION_CODE } from '../src/lib/safeArtifacts'
import {
  buildSafeTx,
  computeSafeTxHash,
  encodeSafeSetup,
  packMultiSend,
  packSignatures,
  predictSafeAddress,
  recoverSigner,
  safeTxTypedData,
  type SafeCall,
  type SafeTxParams,
} from '../src/lib/safe'

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

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
