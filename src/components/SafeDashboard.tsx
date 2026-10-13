import { useState } from 'react'
import type { Address } from 'viem'
import { FEE_TOKEN, feeTokenSymbol, formatUnits, shortAddress } from '../chain'
import { useNativeBalance, useTokenBalance, type SafeInfo } from '../lib/hooks'
import { buildSafeUrl } from '../lib/share'
import type { Wallet } from '../lib/wallet'
import { AddressLink, CopyButton, Stat } from './ui'

export function SafeDashboard({
  wallet,
  safe,
  info,
  pendingCount,
  onNewTx,
  onForget,
  onRefresh,
  loading,
}: {
  wallet: Wallet
  safe: Address
  info: SafeInfo
  pendingCount: number
  onNewTx: () => void
  onForget: () => void
  onRefresh: () => void
  loading?: boolean
}) {
  const { balance: feeBalance } = useTokenBalance(wallet.publicClient, FEE_TOKEN, safe)
  const { balance: nativeBalance } = useNativeBalance(wallet.publicClient, safe)
  const [linkCopied, setLinkCopied] = useState(false)
  const me = wallet.account?.toLowerCase()
  const iAmOwner = Boolean(me && info.owners.some((o) => o.toLowerCase() === me))
  const thresholdNum = Number(info.threshold)

  return (
    <section className="card">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h2>Safe</h2>
          <div className="row" style={{ gap: 8 }}>
            <span className="mono-sm">{safe}</span>
            <CopyButton value={safe} />
          </div>
        </div>
        <div className="row">
          {iAmOwner ? (
            <span className="badge ok"><span className="dot ok" /> you are an owner</span>
          ) : (
            <span className="badge">not an owner</span>
          )}
          <button
            className="btn small ghost"
            title="Copy a link that opens this Safe"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(buildSafeUrl(safe, wallet.chainId))
                setLinkCopied(true)
                setTimeout(() => setLinkCopied(false), 1500)
              } catch {
                /* clipboard unavailable */
              }
            }}
          >
            {linkCopied ? 'Link copied ✓' : 'Copy link'}
          </button>
          <button className="btn small ghost" onClick={onRefresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 18, gap: 18 }}>
        <div className="stack">
          <Stat label="Threshold">
            {thresholdNum} of {info.owners.length}
          </Stat>
          <Stat label="Current nonce">
            <span className="mono">{info.nonce.toString()}</span>
          </Stat>
          <Stat label="Safe version">v{info.version}</Stat>
        </div>
        <div className="stack">
          <Stat label={`${feeTokenSymbol()} balance (fee token)`}>
            <span className="mono">{formatUnits(feeBalance)}</span>
          </Stat>
          <Stat label="Native placeholder">
            <span className="mono-sm muted" title="Tempo has no native gas token">
              {nativeBalance == null ? '—' : formatUnits(nativeBalance, 18)}
            </span>
          </Stat>
          <Stat label="Queued transactions">
            {pendingCount > 0 ? <span className="badge info">{pendingCount} pending</span> : <span className="muted">none</span>}
          </Stat>
        </div>
      </div>

      <label className="lbl">Owners</label>
      <div className="list">
        {info.owners.map((owner) => (
          <div className="item" key={owner}>
            <div className="grow">
              <AddressLink address={owner} short={false} />
            </div>
            {me === owner.toLowerCase() && <span className="badge info">you</span>}
            <CopyButton value={owner} label="⧉" />
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn primary" onClick={onNewTx}>
          New transaction
        </button>
        <button className="btn ghost danger" onClick={onForget}>
          Forget Safe
        </button>
      </div>

      {!iAmOwner && wallet.account && (
        <div className="notice warn" style={{ marginTop: 14 }}>
          The connected account {shortAddress(wallet.account, 5)} is not an owner. You can still
          propose and execute once enough owner signatures are collected.
        </div>
      )}
    </section>
  )
}
