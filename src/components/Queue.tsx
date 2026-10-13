import { useCallback, useEffect, useState } from 'react'
import type { Address, Hex, PublicClient } from 'viem'
import { chainFor, errorMessage, shortAddress } from '../chain'
import { safeAbi } from '../lib/abi'
import {
  computeSafeTxHash,
  deserializeTx,
  normalizeSignatureV,
  packSignatures,
  preApprovedSignature,
  recoverSigner,
  safeTxTypedData,
} from '../lib/safe'
import { buildShareUrl } from '../lib/share'
import type { SafeInfo } from '../lib/hooks'
import { markExecuted, mergePending, mergeSignature, removePending, type PendingTx } from '../lib/storage'
import type { Wallet } from '../lib/wallet'
import { Notice, TxLink } from './ui'

/** On-chain `approveHash` status for every owner of a Safe. */
function useApprovals(publicClient: PublicClient, safe: Address, hash: Hex, owners: Address[]) {
  const [approved, setApproved] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const ownersKey = owners.map((o) => o.toLowerCase()).join(',')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = ownersKey ? ownersKey.split(',') : []
      const entries = await Promise.all(
        list.map(async (owner) => {
          const value = await publicClient.readContract({
            address: safe,
            abi: safeAbi,
            functionName: 'approvedHashes',
            args: [owner as Address, hash],
          })
          return [owner, value === 1n] as const
        }),
      )
      setApproved(Object.fromEntries(entries))
    } catch {
      /* approvals are optional — ignore read failures */
    } finally {
      setLoading(false)
    }
  }, [publicClient, safe, hash, ownersKey])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { approved, loading, refresh }
}

function QueuedTxCard({
  wallet,
  safe,
  info,
  item,
  onChanged,
  onError,
}: {
  wallet: Wallet
  safe: Address
  info: SafeInfo
  item: PendingTx
  onChanged: (list: PendingTx[]) => void
  onError: (message: string | null) => void
}) {
  const [busy, setBusy] = useState<'sign' | 'approve' | 'execute' | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const { approved, refresh: refreshApprovals } = useApprovals(wallet.publicClient, safe, item.id, info.owners)

  const tx = deserializeTx(item.tx)
  const threshold = Number(info.threshold)
  const offchain = Object.keys(item.signatures)
  const onchain = info.owners
    .map((o) => o.toLowerCase())
    .filter((o) => approved[o] && !offchain.includes(o))
  const total = offchain.length + onchain.length
  const executed = Boolean(item.executedTxHash)
  const nonceOk = tx.nonce === info.nonce
  const ready = total >= threshold && nonceOk && !executed
  const me = wallet.account?.toLowerCase()
  const iAmOwner = me ? info.owners.some((o) => o.toLowerCase() === me) : false
  const signed = me ? offchain.includes(me) : false
  const approvedByMe = me ? Boolean(approved[me]) : false
  const dataBytes = tx.data === '0x' ? 0 : (tx.data.length - 2) / 2

  const run = async (kind: 'sign' | 'approve' | 'execute', fn: () => Promise<void>) => {
    setBusy(kind)
    onError(null)
    try {
      await fn()
    } catch (e) {
      onError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const sign = () =>
    run('sign', async () => {
      if (!wallet.walletClient || !wallet.account) return
      const hash = computeSafeTxHash(BigInt(wallet.chainId), safe, tx)
      if (hash.toLowerCase() !== item.id.toLowerCase()) throw new Error('Stored transaction does not match this Safe.')
      const typed = safeTxTypedData(wallet.chainId, safe, tx)
      const raw = await wallet.walletClient.signTypedData({
        account: wallet.account,
        domain: typed.domain,
        types: typed.types,
        primaryType: 'SafeTx',
        message: typed.message,
      })
      const signature = normalizeSignatureV(raw)
      const owner = await recoverSigner(hash, signature)
      if (!info.owners.some((o) => o.toLowerCase() === owner.toLowerCase())) {
        throw new Error(`The signature recovered ${owner}, which is not an owner.`)
      }
      onChanged(mergeSignature(item.id, owner, signature))
    })

  const approveOnChain = () =>
    run('approve', async () => {
      if (!wallet.walletClient || !wallet.account) return
      const hash = await wallet.walletClient.writeContract({
        account: wallet.account,
        chain: chainFor(wallet.networkKey),
        address: safe,
        abi: safeAbi,
        functionName: 'approveHash',
        args: [item.id],
      })
      await wallet.publicClient.waitForTransactionReceipt({ hash })
      await refreshApprovals()
    })

  const execute = () =>
    run('execute', async () => {
      if (!wallet.walletClient || !wallet.account) return
      const entries: { owner: Address; signature: Hex }[] = []
      const seen = new Set<string>()
      for (const [owner, signature] of Object.entries(item.signatures)) {
        entries.push({ owner: owner as Address, signature: signature as Hex })
        seen.add(owner)
      }
      for (const owner of info.owners) {
        const key = owner.toLowerCase()
        if (seen.has(key) || !approved[key]) continue
        entries.push({ owner, signature: preApprovedSignature(owner) })
      }
      if (entries.length < threshold) throw new Error('Not enough approvals yet.')
      const packed = packSignatures(entries)
      const hash = await wallet.walletClient.writeContract({
        account: wallet.account,
        chain: chainFor(wallet.networkKey),
        address: safe,
        abi: safeAbi,
        functionName: 'execTransaction',
        args: [
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver,
          packed,
        ],
      })
      await wallet.publicClient.waitForTransactionReceipt({ hash })
      onChanged(markExecuted(item.id, hash))
    })

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(buildShareUrl([item]))
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 1500)
    } catch {
      onError('Clipboard unavailable — copy the URL manually.')
    }
  }

  return (
    <div className="tx-call">
      <div className="row between">
        <strong>{item.label}</strong>
        {executed ? (
          <span className="badge ok"><span className="dot ok" /> executed</span>
        ) : !nonceOk ? (
          <span className="badge bad">stale nonce</span>
        ) : ready ? (
          <span className="badge info">ready to execute</span>
        ) : (
          <span className="badge warn">
            {total}/{threshold} approvals
          </span>
        )}
      </div>

      <div className="muted small" style={{ marginTop: 6 }}>
        nonce <span className="mono">{tx.nonce.toString()}</span> · to{' '}
        <span className="mono-sm">{shortAddress(tx.to, 5)}</span> · operation{' '}
        {tx.operation === 1 ? 'delegatecall' : 'call'}
        {dataBytes > 0 ? ` · ${dataBytes} bytes calldata` : ''}
      </div>
      <div className="muted small">
        SafeTx <span className="mono-sm">{item.id}</span>
      </div>

      <div className="row" style={{ marginTop: 8, gap: 6 }}>
        {info.owners.map((owner) => {
          const key = owner.toLowerCase()
          const off = offchain.includes(key)
          const on = approved[key]
          const cls = off ? 'ok' : on ? 'info' : ''
          const mark = off ? '✓ ' : on ? '⛓ ' : ''
          return (
            <span className={`badge ${cls}`} key={owner} title={`${owner}${off ? ' · signed off-chain' : on ? ' · approved on-chain' : ''}`}>
              {mark}
              {shortAddress(owner, 3)}
            </span>
          )
        })}
      </div>

      {!nonceOk && !executed && (
        <div className="notice warn" style={{ marginTop: 10 }}>
          The Safe nonce is now <span className="mono">{info.nonce.toString()}</span>. These approvals
          were made for nonce <span className="mono">{tx.nonce.toString()}</span> and can no longer be
          executed.
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        {!executed && nonceOk && iAmOwner && !signed && (
          <button className="btn small primary" onClick={sign} disabled={busy !== null}>
            {busy === 'sign' ? 'Signing…' : 'Sign (off-chain)'}
          </button>
        )}
        {!executed && nonceOk && iAmOwner && !approvedByMe && (
          <button className="btn small" onClick={approveOnChain} disabled={busy !== null}>
            {busy === 'approve' ? 'Approving…' : 'Approve on-chain'}
          </button>
        )}
        {!executed && !iAmOwner && (
          <span className="muted small">Connected account is not an owner.</span>
        )}
        {ready && (
          <button className="btn small primary" onClick={execute} disabled={busy !== null}>
            {busy === 'execute' ? 'Executing…' : 'Execute'}
          </button>
        )}
        {executed && item.executedTxHash && (
          <span className="muted small">
            Confirmed <TxLink hash={item.executedTxHash} />
          </span>
        )}
        <div className="spacer" />
        <button className="btn small ghost" onClick={copyShare}>
          {shareCopied ? 'Link copied ✓' : 'Share link'}
        </button>
        <button
          className="btn small ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(JSON.stringify([item], null, 2))
            } catch {
              /* ignore */
            }
          }}
        >
          Copy JSON
        </button>
        <button className="btn small ghost danger" onClick={() => onChanged(removePending(item.id))}>
          Remove
        </button>
      </div>
    </div>
  )
}

export function Queue({
  wallet,
  safe,
  info,
  pending,
  onChanged,
}: {
  wallet: Wallet
  safe: Address
  info: SafeInfo
  pending: PendingTx[]
  onChanged: (list: PendingTx[]) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [importText, setImportText] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

  const mine = pending.filter(
    (p) => p.safe.toLowerCase() === safe.toLowerCase() && p.chainId === wallet.chainId,
  )

  const exportAll = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(mine, null, 2))
      setError(null)
    } catch {
      setError('Clipboard unavailable — copy the text manually.')
    }
  }

  const shareAll = async () => {
    try {
      await navigator.clipboard.writeText(buildShareUrl(mine))
      setShareCopied(true)
      setError(null)
      setTimeout(() => setShareCopied(false), 1500)
    } catch {
      setError('Clipboard unavailable — copy the URL manually.')
    }
  }

  const doImport = () => {
    try {
      const parsed = JSON.parse(importText) as PendingTx[]
      const list = Array.isArray(parsed) ? parsed : [parsed]
      onChanged(mergePending(list))
      setImportText('')
      setShowImport(false)
    } catch {
      setError('Could not parse the imported JSON.')
    }
  }

  return (
    <section className="card">
      <div className="row between">
        <div>
          <h2>Queue</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Approvals for Safe <span className="mono-sm">{shortAddress(safe, 5)}</span>. Owners can
            sign off-chain (<span className="badge ok small">✓</span>) or approve the hash on-chain
            (<span className="badge info small">⛓</span>) — either counts toward the threshold.
          </p>
        </div>
        <div className="row">
          <button className="btn small ghost" onClick={shareAll} disabled={mine.length === 0}>
            {shareCopied ? 'Link copied ✓' : 'Share all'}
          </button>
          <button className="btn small ghost" onClick={exportAll} disabled={mine.length === 0}>
            Export JSON
          </button>
          <button className="btn small ghost" onClick={() => setShowImport((v) => !v)}>
            Import
          </button>
        </div>
      </div>

      {showImport && (
        <div style={{ marginTop: 14 }}>
          <textarea
            className="mono"
            rows={4}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='[{"id":"0x…","safe":"0x…", …}]'
            spellCheck={false}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small primary" onClick={doImport} disabled={!importText.trim()}>
              Merge
            </button>
            <button className="btn small ghost" onClick={() => setShowImport(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <div style={{ marginTop: 14 }}><Notice kind="err">{error}</Notice></div>}

      {mine.length === 0 ? (
        <div className="empty">
          No queued transactions. Create one from the <strong>New transaction</strong> tab.
        </div>
      ) : (
        <div className="stack" style={{ marginTop: 14 }}>
          {mine.map((item) => (
            <QueuedTxCard
              key={item.id}
              wallet={wallet}
              safe={safe}
              info={info}
              item={item}
              onChanged={onChanged}
              onError={setError}
            />
          ))}
        </div>
      )}
    </section>
  )
}
