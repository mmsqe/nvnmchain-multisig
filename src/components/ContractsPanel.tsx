import { useCallback, useEffect, useState } from 'react'
import { CREATE2_FACTORY, DEPLOYABLE_ARTIFACTS, deployCalldata, safeSuiteStatus, type DeployableKey } from '../lib/safe'
import { chainFor, errorMessage } from '../chain'
import type { Wallet } from '../lib/wallet'
import { AddressLink, Notice } from './ui'

/**
 * One-time deployment of the Safe v1.3.0 suite through the
 * pre-deployed deterministic CREATE2 factory (salt = 0).
 */
export function ContractsPanel({ wallet, onDeployed }: { wallet: Wallet; onDeployed?: () => void }) {
  const [status, setStatus] = useState<Record<DeployableKey, boolean> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  const refresh = useCallback(async () => {
    try {
      setStatus(await safeSuiteStatus((address) => wallet.publicClient.getCode({ address })))
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [wallet.publicClient])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const deploy = async () => {
    if (!wallet.walletClient || !wallet.account) return
    setBusy(true)
    setError(null)
    setLogs([])
    try {
      for (const artifact of DEPLOYABLE_ARTIFACTS) {
        const existing = await wallet.publicClient.getCode({ address: artifact.address })
        if (existing && existing !== '0x') {
          setLogs((l) => [...l, `✓ ${artifact.label} already deployed`])
          continue
        }
        setLogs((l) => [...l, `→ deploying ${artifact.label}…`])
        const hash = await wallet.walletClient.sendTransaction({
          account: wallet.account,
          chain: chainFor(wallet.networkKey),
          to: CREATE2_FACTORY,
          data: deployCalldata(artifact.key),
        })
        setLogs((l) => [...l, `   tx ${hash}`])
        const receipt = await wallet.publicClient.waitForTransactionReceipt({ hash })
        const after = await wallet.publicClient.getCode({ address: artifact.address })
        if (receipt.status !== 'success' || !after || after === '0x') {
          throw new Error(`${artifact.label} did not deploy — transaction ${hash}`)
        }
        setLogs((l) => [...l, `✓ ${artifact.label} → ${artifact.address}`])
        await refresh()
      }
      await refresh()
      onDeployed?.()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const allDeployed = status != null && Object.values(status).every(Boolean)
  const anyDeployed = status != null && Object.values(status).some(Boolean)

  return (
    <section className="card">
      <h2>Safe contracts</h2>
      <p className="muted small">
        The Safe v1.3.0 singleton, proxy factory, fallback handler and MultiSend are deployed once,
        deterministically, through the pre-deployed Safe singleton factory{' '}
        <span className="mono-sm">{CREATE2_FACTORY}</span> using a zero salt. This reproduces the
        official <strong>Safe v1.3.0 “eip155” addresses</strong>.
      </p>

      {status && allDeployed && (
        <Notice kind="ok">All Safe contracts are deployed on this network. ✅</Notice>
      )}
      {status && !allDeployed && anyDeployed && (
        <Notice kind="warn">Some Safe contracts are missing — deploy the rest to continue.</Notice>
      )}
      {status && !anyDeployed && (
        <Notice kind="info">
          Nothing deployed yet. This is a one-time setup (a handful of transactions) paid in{' '}
          the fee token — after that, creating Safes is cheap.
        </Notice>
      )}

      <div className="list" style={{ marginTop: 14 }}>
        {DEPLOYABLE_ARTIFACTS.map((artifact) => (
          <div className="item" key={artifact.key}>
            <div className="grow">
              <div style={{ fontSize: 14 }}>{artifact.label}</div>
              <AddressLink address={artifact.address} short={false} />
            </div>
            {status?.[artifact.key] ? (
              <span className="badge ok"><span className="dot ok" /> deployed</span>
            ) : (
              <span className="badge warn">missing</span>
            )}
          </div>
        ))}
      </div>

      {error && <div style={{ marginTop: 12 }}><Notice kind="err">{error}</Notice></div>}

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn primary" onClick={deploy} disabled={busy || allDeployed || !wallet.account}>
          {busy ? 'Deploying…' : allDeployed ? 'All deployed' : 'Deploy missing contracts'}
        </button>
        <button className="btn ghost" onClick={() => void refresh()} disabled={busy}>
          Refresh
        </button>
        {!wallet.account && <span className="muted small">Connect a wallet to deploy.</span>}
      </div>

      {logs.length > 0 && (
        <div className="log" style={{ marginTop: 14 }}>
          {logs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </section>
  )
}
