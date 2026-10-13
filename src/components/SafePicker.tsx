import { useMemo, useState } from 'react'
import { getAddress, isAddress, type Address } from 'viem'
import { chainFor, errorMessage } from '../chain'
import type { Wallet } from '../lib/wallet'
import { SAFE_ADDRESSES, encodeSafeSetup, predictSafeAddress } from '../lib/safe'
import { safeProxyFactoryAbi } from '../lib/abi'
import type { TrackedSafe } from '../lib/storage'
import { AddressLink, Field, Notice } from './ui'

function parseOwners(text: string): { list: Address[]; invalid: string[] } {
  const parts = text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const invalid: string[] = []
  const list: Address[] = []
  for (const part of parts) {
    if (!isAddress(part)) {
      invalid.push(part)
      continue
    }
    const address = getAddress(part)
    if (!list.some((o) => o.toLowerCase() === address.toLowerCase())) list.push(address)
  }
  return { list, invalid }
}

export function SafePicker({
  wallet,
  trackedSafes,
  onLoad,
  onUntrack,
}: {
  wallet: Wallet
  trackedSafes: TrackedSafe[]
  onLoad: (safe: Address) => void
  onUntrack: (safe: Address) => void
}) {
  const [loadAddress, setLoadAddress] = useState('')
  const [ownersText, setOwnersText] = useState('')
  const [threshold, setThreshold] = useState('1')
  const [saltNonce, setSaltNonce] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Address | null>(null)

  const owners = useMemo(() => parseOwners(ownersText), [ownersText])

  const thresholdNum = Math.trunc(Number(threshold))
  const thresholdValid = Number.isFinite(thresholdNum) && thresholdNum >= 1 && thresholdNum <= owners.list.length

  const initializer = useMemo(() => {
    if (owners.invalid.length > 0 || owners.list.length === 0 || !thresholdValid) return null
    try {
      return encodeSafeSetup({ owners: owners.list, threshold: BigInt(thresholdNum) })
    } catch {
      return null
    }
  }, [owners, thresholdNum, thresholdValid])

  const predicted = useMemo(() => {
    if (!initializer) return null
    try {
      return predictSafeAddress({ initializer, saltNonce: BigInt(saltNonce.trim() || '0') })
    } catch {
      return null
    }
  }, [initializer, saltNonce])

  const create = async () => {
    if (!wallet.walletClient || !wallet.account || !initializer || !predicted) return
    setBusy(true)
    setError(null)
    try {
      const factoryCode = await wallet.publicClient.getCode({ address: SAFE_ADDRESSES.safeProxyFactory })
      if (!factoryCode || factoryCode === '0x') {
        throw new Error('SafeProxyFactory is not deployed. Open the Contracts tab and deploy the Safe suite first.')
      }
      const existing = await wallet.publicClient.getCode({ address: predicted })
      if (existing && existing !== '0x') {
        throw new Error('A Safe already exists at the predicted address. Adjust owners, threshold or salt nonce.')
      }
      const hash = await wallet.walletClient.writeContract({
        account: wallet.account,
        chain: chainFor(wallet.networkKey),
        address: SAFE_ADDRESSES.safeProxyFactory,
        abi: safeProxyFactoryAbi,
        functionName: 'createProxyWithNonce',
        args: [SAFE_ADDRESSES.safeL2, initializer, BigInt(saltNonce.trim() || '0')],
      })
      await wallet.publicClient.waitForTransactionReceipt({ hash })
      setCreated(predicted)
      onLoad(predicted)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const load = () => {
    const value = loadAddress.trim()
    if (!isAddress(value)) {
      setError('Enter a valid Safe address (0x…).')
      return
    }
    setError(null)
    onLoad(getAddress(value))
  }

  return (
    <>
      <section className="card">
        <h2>Create a Safe</h2>
        <p className="muted small">
          The Safe address is derived from the owners, threshold and salt nonce — it is known before
          deployment. Use the same values later to re-derive it.
        </p>

        <Field
          label="Owners (one address per line or comma-separated)"
          hint={
            ownersText.trim() === '' ? (
              'Add at least one owner — e.g. the connected wallet. Owners are sorted ascending before encoding (required by Safe).'
            ) : owners.invalid.length > 0 ? (
              <span style={{ color: 'var(--red)' }}>Invalid: {owners.invalid.join(', ')}</span>
            ) : (
              `${owners.list.length} owner${owners.list.length === 1 ? '' : 's'} parsed.`
            )
          }
        >
          <textarea
            className="mono"
            rows={4}
            value={ownersText}
            onChange={(e) => setOwnersText(e.target.value)}
            placeholder={'0xabc…\n0xdef…'}
            spellCheck={false}
            disabled={busy}
          />
        </Field>

        {wallet.account && (
          <button
            className="btn small ghost"
            style={{ marginTop: 8 }}
            onClick={() =>
              setOwnersText((t) => (t.trim() ? `${t.trim()}\n${wallet.account}` : (wallet.account as string)))
            }
            disabled={busy}
          >
            + Add connected wallet
          </button>
        )}

        <div className="grid2" style={{ marginTop: 4 }}>
          <Field label="Threshold" hint="Confirmations required to execute.">
            <input
              type="number"
              min={1}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="Salt nonce" hint="Change to derive a different address for the same owners.">
            <input
              className="mono"
              value={saltNonce}
              onChange={(e) => setSaltNonce(e.target.value)}
              disabled={busy}
            />
          </Field>
        </div>

        {owners.list.length > 0 && !thresholdValid && (
          <Notice kind="warn">
            Threshold must be between 1 and {owners.list.length}.
          </Notice>
        )}

        {predicted && (
          <div className="item" style={{ marginTop: 12 }}>
            <div className="grow">
              <div className="muted small">Predicted Safe address</div>
              <div className="mono-sm truncate" title={predicted}>
                {predicted}
              </div>
            </div>
            <AddressLink address={predicted} short={false} />
          </div>
        )}

        {error && <div style={{ marginTop: 12 }}><Notice kind="err">{error}</Notice></div>}
        {created && (
          <div style={{ marginTop: 12 }}>
            <Notice kind="ok">
              Safe deployed at <span className="mono-sm">{created}</span>.
            </Notice>
          </div>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={create} disabled={busy || !predicted || !wallet.account}>
            {busy ? 'Creating…' : 'Create Safe'}
          </button>
          {!wallet.account && <span className="muted small">Connect a wallet to create a Safe.</span>}
        </div>
      </section>

      <section className="card">
        <h2>Load an existing Safe</h2>
        <Field label="Safe address">
          <input
            className="mono"
            value={loadAddress}
            onChange={(e) => setLoadAddress(e.target.value)}
            placeholder="0x…"
            onKeyDown={(e) => e.key === 'Enter' && load()}
            spellCheck={false}
          />
        </Field>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={load} disabled={!loadAddress.trim()}>
            Load Safe
          </button>
        </div>

        {trackedSafes.length > 0 && (
          <>
            <label className="lbl">Recently used</label>
            <div className="list">
              {trackedSafes.map((safe) => (
                <div className="item" key={`${safe.chainId}:${safe.address}`}>
                  <div className="grow">
                    <AddressLink address={safe.address} short={false} />
                  </div>
                  <button className="btn small" onClick={() => onLoad(safe.address)}>
                    Open
                  </button>
                  <button className="btn small ghost danger" onClick={() => onUntrack(safe.address)}>
                    Forget
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  )
}
