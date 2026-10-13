import { getAddress, isAddress, type Address } from 'viem'
import type { PendingTx } from './storage'

/** Everything a link can carry: a Safe to open and/or transactions to import. */
export type ShareLink = {
  safe?: Address
  chainId?: number
  txs?: PendingTx[]
}

/** Percent-free base64url of a UTF-8 string. */
function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const base64 = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function assertPending(value: unknown): PendingTx[] {
  const list = Array.isArray(value) ? value : [value]
  return list.map((item) => {
    const tx = item as PendingTx
    if (
      !tx ||
      typeof tx !== 'object' ||
      typeof tx.id !== 'string' ||
      !tx.id.startsWith('0x') ||
      typeof tx.safe !== 'string' ||
      typeof tx.chainId !== 'number' ||
      typeof tx.tx !== 'object' ||
      tx.tx === null ||
      typeof tx.signatures !== 'object' ||
      tx.signatures === null
    ) {
      throw new Error('Unrecognised payload')
    }
    return { ...tx, signatures: { ...tx.signatures }, label: tx.label ?? 'Shared transaction' }
  })
}

/** Encode pending transactions into a URL-safe fragment value. */
export function encodeShare(items: PendingTx[]): string {
  return toBase64Url(JSON.stringify(items))
}

export function decodeShare(encoded: string): PendingTx[] {
  return assertPending(JSON.parse(fromBase64Url(encoded)))
}

function baseUrl(): string {
  return `${location.origin}${location.pathname}${location.search}`
}

/** A link that opens a Safe by address. */
export function buildSafeUrl(address: Address, chainId: number): string {
  const params = new URLSearchParams()
  params.set('safe', getAddress(address))
  params.set('chain', String(chainId))
  return `${baseUrl()}#${params.toString()}`
}

/** A link that opens a Safe and carries transactions/signatures to import. */
export function buildShareUrl(items: PendingTx[]): string {
  if (items.length === 0) return baseUrl()
  const params = new URLSearchParams()
  params.set('safe', items[0].safe)
  params.set('chain', String(items[0].chainId))
  params.set('txs', encodeShare(items))
  return `${baseUrl()}#${params.toString()}`
}

/** Parse the current URL fragment into a {@link ShareLink} (never throws). */
export function readShareLink(): ShareLink {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash
  if (!raw) return {}
  const params = new URLSearchParams(raw)
  const link: ShareLink = {}

  const safe = params.get('safe')
  if (safe && isAddress(safe)) link.safe = getAddress(safe)

  const chain = params.get('chain')
  if (chain && /^\d+$/.test(chain)) link.chainId = Number(chain)

  const txs = params.get('txs')
  if (txs) {
    try {
      link.txs = decodeShare(txs)
    } catch {
      /* ignore malformed payloads */
    }
  }

  // Fall back to the address/chain carried inside the transaction payload.
  if (!link.safe && link.txs?.[0]) link.safe = link.txs[0].safe
  if (!link.chainId && link.txs?.[0]) link.chainId = link.txs[0].chainId
  return link
}

/** Drop the link fragment from the address bar (keeps history clean). */
export function clearShareFromLocation(): void {
  try {
    history.replaceState(null, '', baseUrl())
  } catch {
    /* ignore */
  }
}
