import { useCallback, useState } from 'react'
import type { Address } from 'viem'
import { getNetwork } from './chain'
import { useSafeInfo } from './lib/hooks'
import { loadPending, loadTrackedSafes, trackSafe, untrackSafe, upsertPending, type PendingTx, type TrackedSafe } from './lib/storage'
import { useWallet } from './lib/wallet'
import { ConnectBar } from './components/ConnectBar'
import { ContractsPanel } from './components/ContractsPanel'
import { NewTransaction } from './components/NewTransaction'
import { Queue } from './components/Queue'
import { SafeDashboard } from './components/SafeDashboard'
import { SafePicker } from './components/SafePicker'
import { Notice } from './components/ui'

type Tab = 'safe' | 'new' | 'queue' | 'contracts'

export default function App() {
  const wallet = useWallet()
  const [tab, setTab] = useState<Tab>('safe')
  const [safe, setSafe] = useState<Address | null>(null)
  const [trackedSafes, setTrackedSafes] = useState<TrackedSafe[]>(() => loadTrackedSafes())
  const [pending, setPending] = useState<PendingTx[]>(() => loadPending())

  const { info, error: infoError, refresh: refreshInfo, loading: infoLoading } = useSafeInfo(wallet.publicClient, safe)

  const handleLoad = useCallback(
    (address: Address) => {
      setSafe(address)
      setTrackedSafes(trackSafe({ address, chainId: wallet.chainId, addedAt: Date.now() }))
      setTab('safe')
    },
    [wallet.chainId],
  )

  const handleUntrack = useCallback(
    (address: Address) => setTrackedSafes(untrackSafe(address, wallet.chainId)),
    [wallet.chainId],
  )

  const handleForget = useCallback(() => {
    setSafe(null)
    setTab('safe')
  }, [])

  const safePending = pending.filter(
    (p) => safe && p.safe.toLowerCase() === safe.toLowerCase() && p.chainId === wallet.chainId,
  )
  const openCount = safePending.filter((p) => !p.executedTxHash).length

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'safe', label: safe ? 'Safe' : 'Create / Load' },
    { key: 'new', label: 'New transaction' },
    { key: 'queue', label: 'Queue', badge: openCount || undefined },
    { key: 'contracts', label: 'Contracts' },
  ]

  return (
    <div className="app">
      <ConnectBar wallet={wallet} />

      {wallet.error && <Notice kind="warn">{wallet.error}</Notice>}

      {wallet.account && !wallet.onCorrectChain && (
        <div style={{ marginBottom: 16 }}>
          <Notice kind="warn">
            <div className="row between">
              <span>
                Your wallet is on chain {wallet.walletChainId ?? 'unknown'}, but this app expects{' '}
                {getNetwork().name} (chain {wallet.chainId}).
              </span>
              <button className="btn small" onClick={() => void wallet.switchNetwork()}>
                Switch network
              </button>
            </div>
          </Notice>
        </div>
      )}

      {!wallet.account ? (
        <section className="card" style={{ padding: 28 }}>
          <h2 style={{ fontSize: 20 }}>A lightweight Safe multisig for {getNetwork().name}</h2>
          <p className="muted">
            Deploy Safe contracts, create a Safe from any owners and threshold, then propose, sign
            and execute transactions — with fees paid in the chain's TIP-20 fee token.
          </p>
          <ul className="muted small" style={{ lineHeight: 1.9, paddingLeft: 18 }}>
            <li>One-time deterministic deployment of Safe v1.3.0 at the official eip155 addresses.</li>
            <li>Create or load a Safe; the address is known before deployment.</li>
            <li>Off-chain EIP-712 signatures collected in the browser (export/import to share).</li>
            <li>No backend, no transaction service — everything runs against the RPC.</li>
          </ul>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={wallet.connect} disabled={wallet.connecting}>
              {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
            </button>
            {!wallet.available && (
              <span className="muted small">No injected wallet detected — install MetaMask or Rabby.</span>
            )}
          </div>
        </section>
      ) : (
        <>
          <nav className="tabs">
            {tabs.map((t) => (
              <button
                key={t.key}
                className={`tab ${tab === t.key ? 'active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {t.badge ? <span className="badge info">{t.badge}</span> : null}
              </button>
            ))}
          </nav>

          {infoError && (
            <div style={{ marginBottom: 16 }}>
              <Notice kind="err">{infoError}</Notice>
            </div>
          )}

          {tab === 'contracts' && <ContractsPanel wallet={wallet} />}

          {tab === 'safe' &&
            (safe && info ? (
              <SafeDashboard
                wallet={wallet}
                safe={safe}
                info={info}
                loading={infoLoading}
                pendingCount={openCount}
                onNewTx={() => setTab('new')}
                onForget={handleForget}
                onRefresh={() => void refreshInfo()}
              />
            ) : (
              <SafePicker
                wallet={wallet}
                trackedSafes={trackedSafes}
                onLoad={handleLoad}
                onUntrack={handleUntrack}
              />
            ))}

          {tab === 'new' &&
            (safe && info ? (
              <NewTransaction wallet={wallet} safe={safe} info={info} onQueued={(item) => setPending(upsertPending(item))} />
            ) : (
              <section className="card">
                <div className="empty">Create or load a Safe first.</div>
              </section>
            ))}

          {tab === 'queue' &&
            (safe && info ? (
              <Queue wallet={wallet} safe={safe} info={info} pending={pending} onChanged={setPending} />
            ) : (
              <section className="card">
                <div className="empty">Create or load a Safe first.</div>
              </section>
            ))}
        </>
      )}

      <footer className="foot">
        NVNM Multisig · Safe v1.3.0 · {getNetwork().name} (chain {getNetwork().chainId}) ·{' '}
        <a href={getNetwork().explorerUrl} target="_blank" rel="noreferrer">
          explorer
        </a>
      </footer>
    </div>
  )
}
