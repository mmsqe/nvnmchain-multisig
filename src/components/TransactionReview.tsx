import { useMemo } from 'react'
import { formatUnits, type Address, type PublicClient } from 'viem'
import { shortAddress } from '../chain'
import { useTokenMeta, type TokenMeta } from '../lib/hooks'
import { decodeCall, decodeMultiSend, isMultiSendCall, type DecodedCall, type PackedCall } from '../lib/decode'
import { SAFE_ADDRESSES, type SafeTxParams } from '../lib/safe'
import { AddressLink, CopyButton } from './ui'

function isAddress(value: unknown): value is Address {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

function formatArg(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (isAddress(value)) return shortAddress(value, 4)
  if (Array.isArray(value)) return `[${value.map(formatArg).join(', ')}]`
  return String(value)
}

/** A one-line human summary of a decoded call. */
function describe(decoded: DecodedCall, meta: TokenMeta | null): string {
  if (decoded.name === null) {
    return decoded.selector === '0x' ? 'empty call' : `unknown function ${decoded.selector}`
  }
  const symbol = meta ? ` ${meta.symbol}` : ''
  const decimals = meta?.decimals ?? 6
  const args = decoded.args
  if (decoded.name === 'transfer') {
    const [to, amount] = args as [Address, bigint]
    return `Transfer ${formatUnits(amount, decimals)}${symbol} → ${shortAddress(to, 4)}`
  }
  if (decoded.name === 'transferFrom') {
    const [from, to, amount] = args as [Address, Address, bigint]
    return `Transfer ${formatUnits(amount, decimals)}${symbol} · ${shortAddress(from, 4)} → ${shortAddress(to, 4)}`
  }
  if (decoded.name === 'approve') {
    const [spender, amount] = args as [Address, bigint]
    return `Approve ${formatUnits(amount, decimals)}${symbol} → ${shortAddress(spender, 4)}`
  }
  return `${decoded.name}(${args.map(formatArg).join(', ')})`
}

function CallRow({ publicClient, call, index, total }: { publicClient: PublicClient; call: PackedCall; index: number; total: number }) {
  const decoded = useMemo(() => decodeCall(call.data), [call.data])
  const token = decoded.name === 'transfer' || decoded.name === 'transferFrom' || decoded.name === 'approve' ? call.to : null
  const meta = useTokenMeta(publicClient, token)
  const summary = useMemo(() => describe(decoded, meta), [decoded, meta])

  return (
    <div className="tx-call">
      <div className="row between">
        <span className="badge">{total > 1 ? `call ${index + 1}/${total}` : 'call'}</span>
        <span className="mono-sm">{summary}</span>
      </div>
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>target</dt>
        <dd>
          <AddressLink address={call.to} short={false} />
        </dd>
        <dt>operation</dt>
        <dd>{call.operation === 1 ? 'delegatecall' : 'call'}</dd>
        {call.value > 0n && (
          <>
            <dt>value</dt>
            <dd className="mono">{call.value.toString()}</dd>
          </>
        )}
        <dt>calldata</dt>
        <dd className="mono-sm truncate" title={call.data}>
          {call.data === '0x' ? <span className="muted">(none)</span> : call.data}
        </dd>
      </dl>
      {call.data !== '0x' && (
        <div className="row" style={{ marginTop: 8 }}>
          <CopyButton value={call.data} label="copy calldata" />
        </div>
      )}
    </div>
  )
}

/** Decoded, human-readable review of a Safe transaction. */
export function TransactionReview({ publicClient, tx }: { publicClient: PublicClient; tx: SafeTxParams }) {
  const batch = isMultiSendCall(tx, SAFE_ADDRESSES.multiSendCallOnly)
  const calls = useMemo<PackedCall[]>(() => {
    if (batch) {
      try {
        return decodeMultiSend(tx.data)
      } catch {
        /* fall through to a single raw call */
      }
    }
    return [{ operation: tx.operation, to: tx.to, value: tx.value, data: tx.data }]
  }, [batch, tx])

  return (
    <div className="review">
      <div className="muted small" style={{ marginBottom: 8 }}>
        {batch ? `Batch of ${calls.length} calls via MultiSendCallOnly` : 'Single call'}
      </div>

      {calls.map((call, index) => (
        <CallRow key={index} publicClient={publicClient} call={call} index={index} total={calls.length} />
      ))}

      <details style={{ marginTop: 10 }}>
        <summary className="muted small">Raw transaction parameters</summary>
        <dl className="kv" style={{ marginTop: 8 }}>
          <dt>nonce</dt>
          <dd className="mono">{tx.nonce.toString()}</dd>
          <dt>safeTxGas</dt>
          <dd className="mono">{tx.safeTxGas.toString()}</dd>
          <dt>baseGas</dt>
          <dd className="mono">{tx.baseGas.toString()}</dd>
          <dt>gasPrice</dt>
          <dd className="mono">{tx.gasPrice.toString()}</dd>
          <dt>gasToken</dt>
          <dd className="mono-sm">{tx.gasToken}</dd>
          <dt>refundReceiver</dt>
          <dd className="mono-sm">{tx.refundReceiver}</dd>
        </dl>
        <div className="muted small" style={{ marginTop: 4 }}>
          data: <span className="mono-sm">{tx.data === '0x' ? '(none)' : `${tx.data.length / 2 - 1} bytes`}</span>
        </div>
      </details>
    </div>
  )
}
