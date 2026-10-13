import type { PendingTx } from './storage'

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

/** A link that carries the given pending transactions in the URL fragment. */
export function buildShareUrl(items: PendingTx[]): string {
  const base = `${location.origin}${location.pathname}${location.search}`
  return `${base}#txs=${encodeShare(items)}`
}

/** Read a shared payload from the current URL fragment, if present and valid. */
export function readShareFromLocation(): PendingTx[] | null {
  const match = location.hash.match(/[#&]txs=([^&]+)/)
  if (!match) return null
  try {
    return decodeShare(match[1])
  } catch {
    return null
  }
}

/** Drop the share fragment from the address bar (keeps history clean). */
export function clearShareFromLocation(): void {
  try {
    history.replaceState(null, '', `${location.origin}${location.pathname}${location.search}`)
  } catch {
    /* ignore */
  }
}
