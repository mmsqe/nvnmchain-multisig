import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  getCreate2Address,
  keccak256,
  pad,
  recoverAddress,
  toEventSelector,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import { SAFE_ADDRESSES, SAFE_CREATION_CODE, CREATE2_FACTORY } from './safeArtifacts'
import { multiSendCallOnlyAbi, safeAbi } from './abi'
import type { StoredTx } from './storage'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
export const ZERO32 = `0x${'00'.repeat(32)}` as const

export type Operation = 0 | 1

/** Safe transaction parameters (per Safe v1.3.0 `execTransaction`). */
export type SafeTxParams = {
  to: Address
  value: bigint
  data: Hex
  operation: Operation
  safeTxGas: bigint
  baseGas: bigint
  gasPrice: bigint
  gasToken: Address
  refundReceiver: Address
  nonce: bigint
}

export const SAFE_TX_DEFAULTS = {
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: ZERO_ADDRESS,
  refundReceiver: ZERO_ADDRESS,
} as const

/** Artifacts the UI can deploy (Safe v1.3.0 "eip155" addresses). */
export const DEPLOYABLE_ARTIFACTS = [
  { key: 'safeL2', label: 'SafeL2 singleton', address: SAFE_ADDRESSES.safeL2 },
  { key: 'safeProxyFactory', label: 'SafeProxyFactory', address: SAFE_ADDRESSES.safeProxyFactory },
  {
    key: 'compatibilityFallbackHandler',
    label: 'CompatibilityFallbackHandler',
    address: SAFE_ADDRESSES.compatibilityFallbackHandler,
  },
  { key: 'multiSendCallOnly', label: 'MultiSendCallOnly', address: SAFE_ADDRESSES.multiSendCallOnly },
] as const

export type DeployableKey = (typeof DEPLOYABLE_ARTIFACTS)[number]['key']

export { SAFE_ADDRESSES, CREATE2_FACTORY }

/**
 * Encode the `setup(...)` initializer stored in a Safe proxy. This is exactly
 * what the Safe SDK produces for a fresh v1.3.0 Safe (no payment, no
 * delegatecall setup).
 */
export function encodeSafeSetup(params: {
  owners: Address[]
  threshold: bigint
  fallbackHandler?: Address
  to?: Address
  data?: Hex
}): Hex {
  // Safe's `setup` requires owners to be unique and strictly ascending by address.
  const byAddress = new Map<string, Address>()
  for (const owner of params.owners) {
    const address = getAddress(owner)
    byAddress.set(address.toLowerCase(), address)
  }
  const owners = [...byAddress.values()].sort((a, b) => {
    const av = BigInt(a)
    const bv = BigInt(b)
    return av < bv ? -1 : av > bv ? 1 : 0
  })
  return encodeFunctionData({
    abi: safeAbi,
    functionName: 'setup',
    args: [
      owners,
      params.threshold,
      params.to ?? ZERO_ADDRESS,
      params.data ?? '0x',
      params.fallbackHandler ?? SAFE_ADDRESSES.compatibilityFallbackHandler,
      ZERO_ADDRESS,
      0n,
      ZERO_ADDRESS,
    ],
  })
}

/**
 * Predict the address of the Safe proxy that `createProxyWithNonce` will
 * deploy (Safe v1.3.0 factory CREATE2 scheme).
 */
export function predictSafeAddress(params: {
  singleton?: Address
  factory?: Address
  initializer: Hex
  saltNonce: bigint
}): Address {
  const singleton = params.singleton ?? SAFE_ADDRESSES.safeL2
  const factory = params.factory ?? SAFE_ADDRESSES.safeProxyFactory
  const salt = keccak256(concat([keccak256(params.initializer), pad(toHex(params.saltNonce), { size: 32 })]))
  const deploymentData = concat([SAFE_CREATION_CODE.safeProxy as Hex, pad(singleton, { size: 32 })])
  return getCreate2Address({ from: factory, salt, bytecodeHash: keccak256(deploymentData) })
}

/** A single call to be executed by the Safe (directly or through MultiSend). */
export type SafeCall = { to: Address; value: bigint; data: Hex }

/**
 * Pack calls the way Safe's `MultiSendCallOnly.multiSend` expects:
 * `operation (uint8) || to (20) || value (32) || dataLen (32) || data`.
 * Only Call operations are allowed by MultiSendCallOnly.
 */
export function packMultiSend(calls: SafeCall[]): Hex {
  return concat(
    calls.map(
      (call) =>
        encodePacked(
          ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
          [0, call.to, call.value, BigInt(call.data === '0x' ? 0 : (call.data.length - 2) / 2), call.data],
        ) as Hex,
    ),
  )
}

/** Turn a list of calls into Safe transaction parameters (batches via MultiSend). */
export function buildSafeTx(calls: SafeCall[], nonce: bigint): SafeTxParams {
  if (calls.length === 1) {
    const [call] = calls
    return { ...SAFE_TX_DEFAULTS, ...call, operation: 0, nonce }
  }
  const data = encodeFunctionData({ abi: multiSendCallOnlyAbi, functionName: 'multiSend', args: [packMultiSend(calls)] })
  return {
    ...SAFE_TX_DEFAULTS,
    to: SAFE_ADDRESSES.multiSendCallOnly,
    value: 0n,
    data,
    operation: 1,
    nonce,
  }
}

const SAFE_TX_TYPEHASH = keccak256(
  toHex(
    'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)',
  ),
)
const DOMAIN_TYPEHASH = keccak256(toHex('EIP712Domain(uint256 chainId,address verifyingContract)'))

/**
 * Safe's EIP-712 domain separator. Safe does **not** use the standard
 * name/version domain — just `chainId` and `verifyingContract`.
 */
export function safeDomainSeparator(chainId: bigint, safe: Address): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [DOMAIN_TYPEHASH, chainId, safe],
    ),
  )
}

/** Compute the SafeTx hash (the digest owners sign). */
export function computeSafeTxHash(chainId: bigint, safe: Address, tx: SafeTxParams): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'uint8' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [
        SAFE_TX_TYPEHASH,
        tx.to,
        tx.value,
        keccak256(tx.data),
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        tx.nonce,
      ],
    ),
  )
  return keccak256(concat(['0x1901', safeDomainSeparator(chainId, safe), structHash]))
}

/** EIP-712 typed data for `eth_signTypedData_v4`. */
export function safeTxTypedData(chainId: number, safe: Address, tx: SafeTxParams) {
  return {
    domain: { chainId, verifyingContract: safe },
    types: {
      SafeTx: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'operation', type: 'uint8' },
        { name: 'safeTxGas', type: 'uint256' },
        { name: 'baseGas', type: 'uint256' },
        { name: 'gasPrice', type: 'uint256' },
        { name: 'gasToken', type: 'address' },
        { name: 'refundReceiver', type: 'address' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
    primaryType: 'SafeTx',
    message: {
      to: tx.to,
      value: tx.value,
      data: tx.data,
      operation: tx.operation,
      safeTxGas: tx.safeTxGas,
      baseGas: tx.baseGas,
      gasPrice: tx.gasPrice,
      gasToken: tx.gasToken,
      refundReceiver: tx.refundReceiver,
      nonce: tx.nonce,
    },
  } as const
}

/** Some wallets return `v = 0/1`; Safe's `ecrecover` expects 27/28. */
export function normalizeSignatureV(signature: Hex): Hex {
  const v = Number.parseInt(signature.slice(-2), 16)
  if (v === 0 || v === 1) return (signature.slice(0, -2) + (v + 27).toString(16).padStart(2, '0')) as Hex
  return signature
}

/** Recover the owner address that produced a SafeTx signature. */
export async function recoverSigner(safeTxHash: Hex, signature: Hex): Promise<Address> {
  return recoverAddress({ hash: safeTxHash, signature: normalizeSignatureV(signature) })
}

/** Concatenate approvals ordered ascending by owner (Safe requires this). */
export function packSignatures(signatures: { owner: Address; signature: Hex }[]): Hex {
  const sorted = [...signatures].sort((a, b) => {
    const av = BigInt(a.owner)
    const bv = BigInt(b.owner)
    return av < bv ? -1 : av > bv ? 1 : 0
  })
  return concat(sorted.map((s) => s.signature))
}

/**
 * Safe signature for an owner who approved the hash on-chain via
 * `approveHash` — encoded as `r = owner`, `s = 0`, `v = 1`. Such signatures
 * are checked against `approvedHashes` rather than `ecrecover`.
 */
export function preApprovedSignature(owner: Address): Hex {
  return concat([pad(owner, { size: 32 }), ZERO32, '0x01'])
}

const EXECUTION_SUCCESS = toEventSelector('ExecutionSuccess(bytes32,uint256)')

/** True when a receipt's logs carry the Safe's ExecutionSuccess; being mined does not mean the call ran. */
export function executionSucceeded(safe: Address, logs: readonly { address: Address; topics: readonly Hex[] }[]): boolean {
  return logs.some((log) => log.address.toLowerCase() === safe.toLowerCase() && log.topics[0] === EXECUTION_SUCCESS)
}

/** Read the deployed Safe suite status. */
export async function safeSuiteStatus(
  readCode: (address: Address) => Promise<Hex | undefined>,
): Promise<Record<DeployableKey, boolean>> {
  const entries = await Promise.all(
    DEPLOYABLE_ARTIFACTS.map(async ({ key, address }) => {
      const code = await readCode(address)
      return [key, Boolean(code && code !== '0x')] as const
    }),
  )
  return Object.fromEntries(entries) as Record<DeployableKey, boolean>
}

/** Calldata that deploys an artifact through the pre-deployed CREATE2 factory. */
export function deployCalldata(key: DeployableKey): Hex {
  return concat([ZERO32, SAFE_CREATION_CODE[key] as Hex])
}

/** JSON-safe serialization for localStorage / export. */
export function serializeTx(tx: SafeTxParams): StoredTx {
  return {
    to: tx.to,
    value: tx.value.toString(),
    data: tx.data,
    operation: tx.operation,
    safeTxGas: tx.safeTxGas.toString(),
    baseGas: tx.baseGas.toString(),
    gasPrice: tx.gasPrice.toString(),
    gasToken: tx.gasToken,
    refundReceiver: tx.refundReceiver,
    nonce: tx.nonce.toString(),
  }
}

export function deserializeTx(t: StoredTx): SafeTxParams {
  return {
    to: t.to as Address,
    value: BigInt(t.value),
    data: t.data as Hex,
    operation: t.operation as Operation,
    safeTxGas: BigInt(t.safeTxGas),
    baseGas: BigInt(t.baseGas),
    gasPrice: BigInt(t.gasPrice),
    gasToken: t.gasToken as Address,
    refundReceiver: t.refundReceiver as Address,
    nonce: BigInt(t.nonce),
  }
}

/** Short human summary of an encoded call for labels / lists. */
export function describeCall(call: SafeCall): string {
  if (call.data === '0x' || call.data === '0x0') {
    return `send ${call.value.toString()} wei → ${call.to}`
  }
  const selector = call.data.slice(0, 10)
  return `${call.to} ${selector}…`
}
