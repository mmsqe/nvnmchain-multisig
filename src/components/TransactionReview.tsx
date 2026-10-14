import { useMemo } from 'react'
import { formatUnits, type Address, type Hex, type PublicClient } from 'viem'
import { shortAddress } from '../chain'
import { useTokenMeta, type TokenMeta } from '../lib/hooks'
import { decodeMultiSend, isMultiSendCall, selectorOf, type PackedCall } from '../lib/decode'
import { decodeWithAbis, type AbiEntry, type DecodedWithAbi } from '../lib/contracts'
import { SAFE_ADDRESSES, type SafeTxParams } from '../lib/safe'
import { AddressLink, CopyButton } from './ui'

function isAddress(value: unknown): value is Address {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

function formatArg(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (isAddress(value)) return shortAddress(value, 4)
  if (Array.isArray(value)) return `[${value.map(formatArg).join(', ')}]`
  if (value && typeof value === 'object') {
    return `(${Object.values(value).map(formatArg).join(', ')})`
  }
  if (value === null || value === undefined) return ''
  return String(value)
}

const TOKEN_FUNCTIONS = new Set(['transfer', 'transferFrom', 'approve'])

/** A one-line human summary of a decoded call. */
function describe(decoded: DecodedWithAbi | null, selector: Hex, meta: TokenMeta | null): string {
  if (!decoded) {
    return selector === '0x' ? 'empty call' : `unknown function ${selector}`
  }
  const symbol = meta ? ` ${meta.symbol}` : ''
  const decimals = meta?.decimals ?? 6
  const args = decoded.args
  const name = decoded.fn.name
  if (name === 'transfer') {
    const [to, amount] = args as [Address, bigint]
    return `Transfer ${formatUnits(amount, decimals)}${symbol} → ${shortAddress(to, 4)}`
  }
  if (name === 'transferFrom') {
    const [from, to, amount] = args as [Address, Address, bigint]
    return `Transfer ${formatUnits(amount, decimals)}${symbol} · ${shortAddress(from, 4)} → ${shortAddress(to, 4)}`
  }
  if (name === 'approve') {
    const [spender, amount] = args as [Address, bigint]
    return `Approve ${formatUnits(amount, decimals)}${symbol} → ${shortAddress(spender, 4)}`
  }
  return `${name}(${args.map(formatArg).join(', ')})`
}

function CallRow({
  publicClient,
  abis,
  call,
  index,
  total,
}: {
  publicClient: PublicClient
  abis: readonly AbiEntry[]
  call: PackedCall
  index: number
  total: number
}) {
  const decoded = useMemo(() => decodeWithAbis(abis, call.to, call.data), [abis, call.to, call.data])
  const selector = selectorOf(call.data)
  const isTokenCall = decoded !== null && TOKEN_FUNCTIONS.has(decoded.fn.name)
  const meta = useTokenMeta(publicClient, isTokenCall ? call.to : null)
  const summary = useMemo(() => describe(decoded, selector, meta), [decoded, selector, meta])

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
        {decoded && (
          <>
            <dt>function</dt>
            <dd className="mono-sm truncate" title={decoded.signature}>
              {decoded.signature}
            </dd>
            <dt>interface</dt>
            <dd>
              {decoded.entry.name}
              {decoded.entry.address ? '' : <span className="muted"> · inferred</span>}
            </dd>
          </>
        )}
        {call.value > 0n && (
          <>
            <dt>value</dt>
            <dd className="mono">{call.value.toString()}</dd>
          </>
        )}
        <dt>calldata</dt>
        <dd className="mono-sm wrap-any" title={call.data}>
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
export function TransactionReview({
  publicClient,
  tx,
  abis,
}: {
  publicClient: PublicClient
  tx: SafeTxParams
  abis: readonly AbiEntry[]
}) {
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
        <CallRow key={index} publicClient={publicClient} abis={abis} call={call} index={index} total={calls.length} />
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
