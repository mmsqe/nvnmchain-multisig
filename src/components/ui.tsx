import { useState, type ReactNode } from 'react'
import { explorerAddressUrl, explorerTxUrl, shortAddress } from '../chain'

export function CopyButton({ value, label = 'copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="copy"
      title="Copy to clipboard"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? 'copied ✓' : label}
    </button>
  )
}

export function AddressLink({
  address,
  short = true,
  size = 4,
}: {
  address: string
  short?: boolean
  size?: number
}) {
  return (
    <a
      className="mono-sm"
      href={explorerAddressUrl(address)}
      target="_blank"
      rel="noreferrer"
      title={address}
    >
      {short ? shortAddress(address, size) : address}
    </a>
  )
}

export function TxLink({ hash }: { hash: string }) {
  return (
    <a className="mono-sm" href={explorerTxUrl(hash)} target="_blank" rel="noreferrer" title={hash}>
      {shortAddress(hash, 6)}
    </a>
  )
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'err' | 'ok'; children: ReactNode }) {
  return <div className={`notice ${kind}`}>{children}</div>
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label className="lbl">{label}</label>
      {children}
      {hint && <div className="muted small" style={{ marginTop: 6 }}>{hint}</div>}
    </div>
  )
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="muted small" style={{ marginBottom: 2 }}>{label}</div>
      <div>{children}</div>
    </div>
  )
}
