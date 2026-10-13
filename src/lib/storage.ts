import type { Address, Hex } from 'viem'

/** Serialized (JSON-safe) form of a Safe transaction. */
export type StoredTx = {
  to: string
  value: string
  data: string
  operation: number
  safeTxGas: string
  baseGas: string
  gasPrice: string
  gasToken: string
  refundReceiver: string
  nonce: string
}

export type PendingTx = {
  /** SafeTx hash — unique per (safe, nonce, tx). */
  id: Hex
  chainId: number
  safe: Address
  createdAt: number
  /** Human label, e.g. "2 calls · 12.5 nUSD". */
  label: string
  tx: StoredTx
  /** owner (lowercase) → 65-byte signature. */
  signatures: Record<string, Hex>
  executedTxHash?: Hex
}

export type TrackedSafe = {
  address: Address
  chainId: number
  addedAt: number
  label?: string
}

const PENDING_KEY = 'nvnmchain-multisig:pending:v1'
const SAFES_KEY = 'nvnmchain-multisig:safes:v1'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore quota / privacy mode */
  }
}

export function loadPending(): PendingTx[] {
  return read<PendingTx[]>(PENDING_KEY, []).sort((a, b) => b.createdAt - a.createdAt)
}

export function savePending(list: PendingTx[]): void {
  write(PENDING_KEY, list)
}

export function upsertPending(item: PendingTx): PendingTx[] {
  const list = loadPending().filter((p) => p.id !== item.id)
  list.unshift(item)
  savePending(list)
  return list
}

export function mergeSignature(id: Hex, owner: Address, signature: Hex): PendingTx[] {
  const list = loadPending().map((p) =>
    p.id === id ? { ...p, signatures: { ...p.signatures, [owner.toLowerCase()]: signature } } : p,
  )
  savePending(list)
  return list
}

export function removePending(id: Hex): PendingTx[] {
  const list = loadPending().filter((p) => p.id !== id)
  savePending(list)
  return list
}

export function markExecuted(id: Hex, txHash: Hex): PendingTx[] {
  const list = loadPending().map((p) => (p.id === id ? { ...p, executedTxHash: txHash } : p))
  savePending(list)
  return list
}

/** Merge a list of pending transactions (from an import), newest signatures win. */
export function mergePending(imported: PendingTx[]): PendingTx[] {
  const byId = new Map(loadPending().map((p) => [p.id, p]))
  for (const item of imported) {
    const existing = byId.get(item.id)
    if (!existing) {
      byId.set(item.id, item)
    } else {
      byId.set(item.id, {
        ...existing,
        ...item,
        signatures: { ...item.signatures, ...existing.signatures },
        executedTxHash: existing.executedTxHash ?? item.executedTxHash,
      })
    }
  }
  const list = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
  savePending(list)
  return list
}

export function loadTrackedSafes(): TrackedSafe[] {
  return read<TrackedSafe[]>(SAFES_KEY, []).sort((a, b) => b.addedAt - a.addedAt)
}

export function trackSafe(entry: TrackedSafe): TrackedSafe[] {
  const list = loadTrackedSafes().filter(
    (s) => !(s.address.toLowerCase() === entry.address.toLowerCase() && s.chainId === entry.chainId),
  )
  list.unshift(entry)
  write(SAFES_KEY, list)
  return list
}

export function untrackSafe(address: Address, chainId: number): TrackedSafe[] {
  const list = loadTrackedSafes().filter(
    (s) => !(s.address.toLowerCase() === address.toLowerCase() && s.chainId === chainId),
  )
  write(SAFES_KEY, list)
  return list
}
