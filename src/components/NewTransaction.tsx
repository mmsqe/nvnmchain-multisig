import { useState } from 'react'
import { encodeFunctionData, getAddress, isAddress, type Address, type Hex, type PublicClient } from 'viem'
import { errorMessage, FEE_TOKEN, feeTokenSymbol, parseUnits, shortAddress } from '../chain'
import { tip20Abi } from '../lib/abi'
import {
  buildSafeTx,
  computeSafeTxHash,
  normalizeSignatureV,
  recoverSigner,
  safeTxTypedData,
  serializeTx,
  type SafeCall,
  type SafeTxParams,
} from '../lib/safe'
import { useTokenMeta, type SafeInfo } from '../lib/hooks'
import type { PendingTx } from '../lib/storage'
import type { Wallet } from '../lib/wallet'
import { Field, Notice } from './ui'

type Draft = {
  id: string
  kind: 'transfer' | 'raw'
  token: string
  recipient: string
  amount: string
  to: string
  data: string
}

let seq = 0
const nextId = () => `d${++seq}`
const blank = (): Draft => ({
  id: nextId(),
  kind: 'transfer',
  token: FEE_TOKEN,
  recipient: '',
  amount: '',
  to: '',
  data: '0x',
})

function TokenHint({ publicClient, token }: { publicClient: PublicClient; token: string }) {
  const meta = useTokenMeta(publicClient, isAddress(token) ? getAddress(token) : null)
  if (!meta) return <span className="muted small">Enter a TIP-20 token address.</span>
  return (
    <span className="muted small">
      {meta.name || meta.symbol} · {meta.decimals} decimals
    </span>
  )
}

export function NewTransaction({
  wallet,
  safe,
  info,
  onQueued,
}: {
  wallet: Wallet
  safe: Address
  info: SafeInfo
  onQueued: (item: PendingTx) => void
}) {
  const [drafts, setDrafts] = useState<Draft[]>([blank()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Hex | null>(null)

  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  const add = () => setDrafts((ds) => [...ds, blank()])
  const remove = (id: string) => setDrafts((ds) => (ds.length === 1 ? ds : ds.filter((d) => d.id !== id)))

  const encodeDraft = async (d: Draft): Promise<SafeCall> => {
    if (d.kind === 'transfer') {
      if (!isAddress(d.token)) throw new Error('Invalid token address.')
      if (!isAddress(d.recipient)) throw new Error('Invalid recipient address.')
      if (!d.amount.trim()) throw new Error('Enter an amount.')
      const decimals = await wallet.publicClient
        .readContract({ address: getAddress(d.token), abi: tip20Abi, functionName: 'decimals' })
        .catch(() => 6)
      const data = encodeFunctionData({
        abi: tip20Abi,
        functionName: 'transfer',
        args: [getAddress(d.recipient), parseUnits(d.amount.trim(), Number(decimals))],
      })
      return { to: getAddress(d.token), value: 0n, data }
    }
    if (!isAddress(d.to)) throw new Error('Invalid target address.')
    return {
      to: getAddress(d.to),
      value: 0n,
      data: (d.data.trim() || '0x') as Hex,
    }
  }

  const labelFor = (calls: SafeCall[]) => {
    if (calls.length === 1) {
      const d = drafts[0]
      if (d.kind === 'transfer') return `Transfer ${d.amount} → ${shortAddress(d.recipient, 4)}`
      return `Call ${shortAddress(calls[0].to, 4)}`
    }
    return `${calls.length} calls (MultiSend)`
  }

  const sign = async () => {
    if (!wallet.walletClient || !wallet.account) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const calls: SafeCall[] = []
      for (const d of drafts) calls.push(await encodeDraft(d))
      const safeTx: SafeTxParams = buildSafeTx(calls, info.nonce)
      const hash = computeSafeTxHash(BigInt(wallet.chainId), safe, safeTx)
      const typed = safeTxTypedData(wallet.chainId, safe, safeTx)
      const rawSignature = await wallet.walletClient.signTypedData({
        account: wallet.account,
        domain: typed.domain,
        types: typed.types,
        primaryType: 'SafeTx',
        message: typed.message,
      })
      const signature = normalizeSignatureV(rawSignature)
      const owner = await recoverSigner(hash, signature)
      if (!info.owners.some((o) => o.toLowerCase() === owner.toLowerCase())) {
        throw new Error(`The signature recovered ${owner}, which is not an owner of this Safe.`)
      }
      onQueued({
        id: hash,
        chainId: wallet.chainId,
        safe,
        createdAt: Date.now(),
        label: labelFor(calls),
        tx: serializeTx(safeTx),
        signatures: { [owner.toLowerCase()]: signature },
      })
      setDone(hash)
      setDrafts([blank()])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>New transaction</h2>
      <p className="muted small">
        Build one or more calls. With more than one call the batch is executed through{' '}
        MultiSendCallOnly. Fees for <em>executing</em> are paid by whoever submits. Signing is
        off-chain (EIP-712) and stored in this browser.
      </p>

      <div className="row" style={{ margin: '8px 0 4px' }}>
        <span className="muted small">
          Safe nonce: <span className="mono">{info.nonce.toString()}</span> · threshold{' '}
          {info.threshold.toString()} of {info.owners.length}
        </span>
      </div>

      {drafts.map((draft, index) => (
        <div className="tx-call" key={draft.id} style={{ marginTop: 12 }}>
          <div className="row between">
            <div className="seg">
              <button
                className={draft.kind === 'transfer' ? 'active' : ''}
                onClick={() => update(draft.id, { kind: 'transfer' })}
                disabled={busy}
              >
                Token transfer
              </button>
              <button
                className={draft.kind === 'raw' ? 'active' : ''}
                onClick={() => update(draft.id, { kind: 'raw' })}
                disabled={busy}
              >
                Contract call
              </button>
            </div>
            <div className="row">
              <span className="muted small">#{index + 1}</span>
              {drafts.length > 1 && (
                <button className="btn small ghost danger" onClick={() => remove(draft.id)} disabled={busy}>
                  Remove
                </button>
              )}
            </div>
          </div>

          {draft.kind === 'transfer' ? (
            <>
              <Field label="Token (TIP-20)" hint={<TokenHint publicClient={wallet.publicClient} token={draft.token} />}>
                <input
                  className="mono"
                  value={draft.token}
                  onChange={(e) => update(draft.id, { token: e.target.value })}
                  placeholder={FEE_TOKEN}
                  spellCheck={false}
                  disabled={busy}
                />
              </Field>
              <div className="grid2" style={{ marginTop: 4 }}>
                <Field label="Recipient">
                  <input
                    className="mono"
                    value={draft.recipient}
                    onChange={(e) => update(draft.id, { recipient: e.target.value })}
                    placeholder="0x…"
                    spellCheck={false}
                    disabled={busy}
                  />
                </Field>
                <Field label={`Amount (${feeTokenSymbol()} if the fee token)`}>
                  <input
                    value={draft.amount}
                    onChange={(e) => update(draft.id, { amount: e.target.value })}
                    placeholder="1.5"
                    inputMode="decimal"
                    disabled={busy}
                  />
                </Field>
              </div>
            </>
          ) : (
            <>
              <Field label="Target">
                <input
                  className="mono"
                  value={draft.to}
                  onChange={(e) => update(draft.id, { to: e.target.value })}
                  placeholder="0x…"
                  spellCheck={false}
                  disabled={busy}
                />
              </Field>
              <Field label="Calldata" hint="Encoded function call, e.g. a TIP-20 transfer() or any contract method.">
                <input
                  className="mono"
                  value={draft.data}
                  onChange={(e) => update(draft.id, { data: e.target.value })}
                  placeholder="0x"
                  spellCheck={false}
                  disabled={busy}
                />
              </Field>
            </>
          )}
        </div>
      ))}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn small ghost" onClick={add} disabled={busy}>
          + Add call
        </button>
      </div>

      {error && <div style={{ marginTop: 14 }}><Notice kind="err">{error}</Notice></div>}
      {done && (
        <div style={{ marginTop: 14 }}>
          <Notice kind="ok">
            Signed and queued. SafeTx hash <span className="mono-sm">{done}</span>. Open the{' '}
            <strong>Queue</strong> tab to collect the remaining signatures and execute.
          </Notice>
        </div>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn primary" onClick={sign} disabled={busy || !wallet.account}>
          {busy ? 'Waiting for signature…' : 'Sign & queue'}
        </button>
        {!wallet.account && <span className="muted small">Connect a wallet to sign.</span>}
      </div>
    </section>
  )
}
