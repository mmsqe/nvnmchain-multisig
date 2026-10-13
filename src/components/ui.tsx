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

export function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

export function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}
