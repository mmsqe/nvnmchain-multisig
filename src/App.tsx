import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import { getNetwork, getNetworkKey, networkKeyForChainId, setNetworkKey as persistNetwork, errorMessage } from './chain'
import { useSafeInfo } from './lib/hooks'
import { allAbis, type AbiEntry } from './lib/contracts'
import { loadPending, loadTrackedSafes, mergePending, trackSafe, untrackSafe, upsertPending, type PendingTx, type TrackedSafe } from './lib/storage'
import { clearShareFromLocation, readShareLink, type SignatureShare } from './lib/share'
import { importSignatureShare } from './lib/coordinate'
import { useWallet } from './lib/wallet'
import { ConnectBar } from './components/ConnectBar'
import { ContractsPanel } from './components/ContractsPanel'
import { AbiManager } from './components/AbiManager'
import { NewTransaction } from './components/NewTransaction'
import { Queue } from './components/Queue'
import { SafeDashboard } from './components/SafeDashboard'
import { SafePicker } from './components/SafePicker'
import { Notice } from './components/ui'

type Tab = 'safe' | 'new' | 'queue' | 'contracts' | 'abis'

export default function App() {
  const wallet = useWallet()
  // Parsed once from the URL fragment (a deep link can open a Safe and carry txs).
  const [link] = useState(() => readShareLink())
  const [tab, setTab] = useState<Tab>(link.txs?.length ? 'queue' : 'safe')
  const [safe, setSafe] = useState<Address | null>(link.safe ?? null)
  const [trackedSafes, setTrackedSafes] = useState<TrackedSafe[]>(() => loadTrackedSafes())
  const [pending, setPending] = useState<PendingTx[]>(() => loadPending())
  const [shared, setShared] = useState<PendingTx[] | null>(link.txs ?? null)
  const [sharedSig, setSharedSig] = useState<SignatureShare | null>(link.sig ?? null)
  const [sigError, setSigError] = useState<string | null>(null)
  const [abis, setAbis] = useState<AbiEntry[]>(() => allAbis())
  const refreshAbis = useCallback(() => setAbis(allAbis()), [])

  const { info, error: infoError, refresh: refreshInfo, loading: infoLoading } = useSafeInfo(wallet.publicClient, safe)

  const linkChainKey = link.chainId ? networkKeyForChainId(link.chainId) : null
  const switchingNetwork = Boolean(linkChainKey && linkChainKey !== wallet.networkKey)

  // Apply the deep link once: switch to the linked network, remember and open the Safe.
  useEffect(() => {
    if (link.chainId) {
      const key = networkKeyForChainId(link.chainId)
      if (key && key !== getNetworkKey()) persistNetwork(key)
    }
    if (link.safe) {
      setTrackedSafes(trackSafe({ address: link.safe, chainId: link.chainId ?? getNetwork().chainId, addedAt: Date.now() }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const importShared = useCallback(() => {
    if (!shared || shared.length === 0) return
    setPending(mergePending(shared))
    if (!safe) setSafe(shared[0].safe)
    setTab('queue')
    clearShareFromLocation()
    setShared(null)
  }, [shared, safe])

  const dismissShared = useCallback(() => {
    clearShareFromLocation()
    setShared(null)
    setSharedSig(null)
  }, [])

  const importSharedSig = useCallback(async () => {
    if (!sharedSig) return
    setSigError(null)
    try {
      const result = await importSignatureShare(wallet.publicClient, sharedSig)
      setPending(result.list)
      if (!safe) setSafe(result.safe)
      setTab('queue')
      clearShareFromLocation()
      setSharedSig(null)
    } catch (e) {
      setSigError(errorMessage(e))
    }
  }, [sharedSig, wallet.publicClient, safe])

  const safePending = pending.filter(
    (p) => safe && p.safe.toLowerCase() === safe.toLowerCase() && p.chainId === wallet.chainId,
  )
  const openCount = safePending.filter((p) => !p.executedTxHash).length

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'safe', label: safe ? 'Safe' : 'Create / Load' },
    { key: 'new', label: 'New transaction' },
    { key: 'queue', label: 'Queue', badge: openCount || undefined },
    { key: 'contracts', label: 'Contracts' },
    { key: 'abis', label: 'Interfaces' },
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

      {shared && shared.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Notice kind="info">
            <div className="row between">
              <span>
                {shared.length} shared transaction{shared.length === 1 ? '' : 's'} in this link
                {safe ? ' — the Safe is open below.' : '.'}
              </span>
              <div className="row">
                <button className="btn small primary" onClick={importShared}>
                  Import to queue
                </button>
                <button className="btn small ghost" onClick={dismissShared}>
                  Dismiss
                </button>
              </div>
            </div>
          </Notice>
        </div>
      )}

      {sharedSig && (
        <div style={{ marginBottom: 16 }}>
          <Notice kind="info">
            <div className="row between">
              <span>
                A single signature for <span className="mono-sm">{sharedSig.owner.slice(0, 10)}…</span> was
                shared — it matches a transaction in your queue.
              </span>
              <div className="row">
                <button className="btn small primary" onClick={() => void importSharedSig()}>
                  Add signature
                </button>
                <button className="btn small ghost" onClick={dismissShared}>
                  Dismiss
                </button>
              </div>
            </div>
            {sigError && <div style={{ marginTop: 8, color: 'var(--red)' }}>{sigError}</div>}
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
            <li>Off-chain EIP-712 signatures or on-chain approvals, shared by link or JSON.</li>
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

          {infoError && !switchingNetwork && (
            <div style={{ marginBottom: 16 }}>
              <Notice kind="err">{infoError}</Notice>
            </div>
          )}

          {tab === 'contracts' && <ContractsPanel wallet={wallet} />}

          {tab === 'abis' && <AbiManager abis={abis} onChanged={refreshAbis} />}

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
                trackedSafes={trackedSafes.filter((s) => s.chainId === wallet.chainId)}
                onLoad={handleLoad}
                onUntrack={handleUntrack}
              />
            ))}

          {tab === 'new' &&
            (safe && info ? (
              <NewTransaction
                wallet={wallet}
                safe={safe}
                info={info}
                abis={abis}
                onQueued={(item) => setPending(upsertPending(item))}
              />
            ) : (
              <section className="card">
                <div className="empty">Create or load a Safe first.</div>
              </section>
            ))}

          {tab === 'queue' &&
            (safe && info ? (
              <Queue wallet={wallet} safe={safe} info={info} pending={pending} abis={abis} onChanged={setPending} onExecuted={() => void refreshInfo()} />
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
