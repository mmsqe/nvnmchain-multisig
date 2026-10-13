import { defineChain, formatUnits as viemFormatUnits } from 'viem'

/**
 * NVNM Chain — a Tempo-compatible L1 (EVM + Tempo transactions).
 *
 * There is no native gas token: `eth_getBalance` returns a documented Tempo
 * placeholder and fees are charged by the protocol FeeManager in a USD TIP-20.
 * Plain EIP-1559 / legacy transactions are accepted and, with no explicit fee
 * token, default to `pathUSD` (`0x20c0…0000`).
 */
export const NETWORKS = {
  testnet: {
    key: 'testnet',
    name: 'NVNM Testnet',
    chainId: 787223,
    rpcUrl: 'https://rpc.nvnm.testnet.nvnmchain.io',
    explorerUrl: 'https://explorer.nvnm.testnet.nvnmchain.io',
    explorerName: 'nvnmchain Testnet Explorer',
    feeTokenSymbol: 'nUSD',
  },
  canary: {
    key: 'canary',
    name: 'NVNM Canary',
    chainId: 787222,
    rpcUrl: 'https://rpc.nvnm.canary.mantrachain.dev',
    explorerUrl: 'https://explorer.nvnm.canary.mantrachain.dev',
    explorerName: 'nvnmchain Explorer',
    feeTokenSymbol: 'pathUSD',
  },
} as const

export type NetworkKey = keyof typeof NETWORKS

export const NETWORK_KEYS = Object.keys(NETWORKS) as NetworkKey[]

/** Default network for this UI. */
export const DEFAULT_NETWORK: NetworkKey = 'testnet'

const STORAGE_KEY = 'nvnmchain-multisig:network:v1'

let activeKey: NetworkKey | null = null

export function getNetworkKey(): NetworkKey {
  if (activeKey) return activeKey
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    /* storage unavailable */
  }
  activeKey = stored && stored in NETWORKS ? (stored as NetworkKey) : DEFAULT_NETWORK
  return activeKey
}

export function getNetwork() {
  return NETWORKS[getNetworkKey()]
}

export function setNetworkKey(key: NetworkKey): void {
  activeKey = key
  try {
    localStorage.setItem(STORAGE_KEY, key)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('nvnm:network-changed'))
}

const chainCache = new Map<NetworkKey, ReturnType<typeof makeChain>>()

function makeChain(net: (typeof NETWORKS)[NetworkKey]) {
  return defineChain({
    id: net.chainId,
    name: net.name,
    nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 18 },
    rpcUrls: { default: { http: [net.rpcUrl] } },
    blockExplorers: { default: { name: net.explorerName, url: net.explorerUrl } },
    testnet: net.key === 'testnet',
  })
}

export function chainFor(key: NetworkKey = getNetworkKey()) {
  const cached = chainCache.get(key)
  if (cached) return cached
  const chain = makeChain(NETWORKS[key])
  chainCache.set(key, chain)
  return chain
}

/** pathUSD / nUSD — the fee token TIP-20 predeploy (6 decimals). */
export const FEE_TOKEN = '0x20c0000000000000000000000000000000000000' as const

export function feeTokenSymbol(): string {
  return getNetwork().feeTokenSymbol
}

export function explorerTxUrl(hash: string): string {
  return `${getNetwork().explorerUrl}/tx/${hash}`
}

export function explorerAddressUrl(address: string): string {
  return `${getNetwork().explorerUrl}/address/${address}`
}

export function shortAddress(address: string, size = 4): string {
  if (!address) return ''
  return `${address.slice(0, size + 2)}…${address.slice(-size)}`
}

/** Format a base-unit integer with `decimals` (drops trailing zeros). */
export function formatUnits(value: bigint | null | undefined, decimals = 6): string {
  if (value == null) return '—'
  return viemFormatUnits(value, decimals)
}

export function parseUnits(value: string, decimals = 6): bigint {
  const neg = value.trim().startsWith('-')
  const [whole, frac = ''] = value.trim().replace('-', '').split('.')
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  const n = BigInt((whole || '0') + padded || '0')
  return neg ? -n : n
}

export function errorMessage(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; details?: string; cause?: { message?: string } }
  return err?.shortMessage ?? err?.message ?? err?.cause?.message ?? String(e)
}
