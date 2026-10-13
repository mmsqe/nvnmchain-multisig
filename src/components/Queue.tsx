import { useState } from 'react'
import type { Address, Hex } from 'viem'
import { chainFor, errorMessage, shortAddress } from '../chain'
import { safeAbi } from '../lib/abi'
import {
  computeSafeTxHash,
  deserializeTx,
  packSignatures,
  recoverSigner,
  safeTxTypedData,
} from '../lib/safe'
import type { SafeInfo } from '../lib/hooks'
import { markExecuted, mergePending, mergeSignature, removePending, type PendingTx } from '../lib/storage'
import type { Wallet } from '../lib/wallet'
import { Notice, TxLink } from './ui'

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
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importText, setImportText] = useState('')
  const [showImport, setShowImport] = useState(false)

  const mine = pending.filter(
    (p) => p.safe.toLowerCase() === safe.toLowerCase() && p.chainId === wallet.chainId,
  )
  const threshold = Number(info.threshold)

  const sign = async (item: PendingTx) => {
    if (!wallet.walletClient || !wallet.account) return
    setBusyId(item.id)
    setError(null)
    try {
      const tx = deserializeTx(item.tx)
      const hash = computeSafeTxHash(BigInt(wallet.chainId), safe, tx)
      if (hash.toLowerCase() !== item.id.toLowerCase()) throw new Error('Stored transaction does not match this Safe.')
      const typed = safeTxTypedData(wallet.chainId, safe, tx)
      const signature = await wallet.walletClient.signTypedData({
        account: wallet.account,
        domain: typed.domain,
        types: typed.types,
        primaryType: 'SafeTx',
        message: typed.message,
      })
      const owner = await recoverSigner(hash, signature)
      if (!info.owners.some((o) => o.toLowerCase() === owner.toLowerCase())) {
        throw new Error(`The signature recovered ${owner}, which is not an owner.`)
      }
      onChanged(mergeSignature(item.id, owner, signature))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const execute = async (item: PendingTx) => {
    if (!wallet.walletClient || !wallet.account) return
    setBusyId(item.id)
    setError(null)
    try {
      const tx = deserializeTx(item.tx)
      const signatures = Object.entries(item.signatures).map(([owner, signature]) => ({
        owner: owner as Address,
        signature: signature as Hex,
      }))
      if (signatures.length < threshold) throw new Error('Not enough signatures yet.')
      const packed = packSignatures(signatures)
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
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const exportAll = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(mine, null, 2))
      setError(null)
    } catch {
      setError('Clipboard unavailable — copy the text manually.')
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

  const me = wallet.account?.toLowerCase()

  return (
    <section className="card">
      <div className="row between">
        <div>
          <h2>Queue</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Off-chain EIP-712 signatures for Safe <span className="mono-sm">{shortAddress(safe, 5)}</span>.
            Share signatures between signers with Export / Import.
          </p>
        </div>
        <div className="row">
          <button className="btn small ghost" onClick={exportAll} disabled={mine.length === 0}>
            Export
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
          {mine.map((item) => {
            const tx = deserializeTx(item.tx)
            const owners = Object.keys(item.signatures)
            const signed = me ? owners.includes(me) : false
            const iAmOwner = me ? info.owners.some((o) => o.toLowerCase() === me) : false
            const ready = owners.length >= threshold
            const nonceOk = tx.nonce === info.nonce
            const executed = Boolean(item.executedTxHash)
            const dataBytes = tx.data === '0x' ? 0 : (tx.data.length - 2) / 2

            return (
              <div className="tx-call" key={item.id}>
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
                      {owners.length}/{threshold} signatures
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
                    const has = owners.includes(owner.toLowerCase())
                    return (
                      <span className={`badge ${has ? 'ok' : ''}`} key={owner} title={owner}>
                        {has ? '✓ ' : ''}
                        {shortAddress(owner, 3)}
                      </span>
                    )
                  })}
                </div>

                {!nonceOk && !executed && (
                  <div className="notice warn" style={{ marginTop: 10 }}>
                    The Safe nonce is now <span className="mono">{info.nonce.toString()}</span>. These
                    signatures were made for nonce <span className="mono">{tx.nonce.toString()}</span>{' '}
                    and can no longer be executed.
                  </div>
                )}

                <div className="row" style={{ marginTop: 12 }}>
                  {!executed && !signed && iAmOwner && nonceOk && (
                    <button className="btn small primary" onClick={() => sign(item)} disabled={busyId === item.id}>
                      {busyId === item.id ? 'Signing…' : 'Sign'}
                    </button>
                  )}
                  {!executed && signed && !ready && (
                    <span className="muted small">Your signature is recorded.</span>
                  )}
                  {!executed && !iAmOwner && (
                    <span className="muted small">Connected account is not an owner — ask an owner to sign.</span>
                  )}
                  {!executed && ready && nonceOk && (
                    <button className="btn small primary" onClick={() => execute(item)} disabled={busyId === item.id}>
                      {busyId === item.id ? 'Executing…' : 'Execute'}
                    </button>
                  )}
                  {executed && item.executedTxHash && (
                    <span className="muted small">
                      Confirmed <TxLink hash={item.executedTxHash} />
                    </span>
                  )}
                  <div className="spacer" />
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
          })}
        </div>
      )}
    </section>
  )
}
