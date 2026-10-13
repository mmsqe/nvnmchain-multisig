import { useState } from 'react'
import type { Address } from 'viem'
import { NETWORKS, NETWORK_KEYS, getNetwork, shortAddress, type NetworkKey } from '../chain'
import { useTheme } from '../lib/theme'
import type { Wallet } from '../lib/wallet'
import { MoonIcon, SunIcon } from './ui'

function AccountChip({ account }: { account: Address }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="account-chip">
      <span className="dot ok" />
      <button className="account-address" onClick={copy} title={copied ? 'Copied' : `Copy ${account}`}>
        <span className="mono">{shortAddress(account, 5)}</span>
        <span className="copy-icon">{copied ? '✓' : '⧉'}</span>
      </button>
    </div>
  )
}

export function ConnectBar({ wallet }: { wallet: Wallet }) {
  const net = getNetwork()
  const { theme, toggle } = useTheme()

  return (
    <header className="topbar">
      <div className="brand">
        <img className="logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="NVNM" width={40} height={40} />
        <div>
          <h1>NVNM Multisig</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Safe multisig · {net.name} · chain {net.chainId}
          </p>
        </div>
      </div>
      <div className="topbar-right">
        <button
          className="btn ghost icon-btn"
          onClick={toggle}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          aria-label="Toggle color theme"
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <select
          value={wallet.networkKey}
          onChange={(e) => wallet.setNetworkKey(e.target.value as NetworkKey)}
          title="Network"
        >
          {NETWORK_KEYS.map((key) => (
            <option key={key} value={key}>
              {NETWORKS[key].name}
            </option>
          ))}
        </select>
        {wallet.account ? (
          <>
            <AccountChip account={wallet.account} />
            <button className="btn ghost small" onClick={wallet.disconnect} title="Disconnect wallet">
              Disconnect
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={wallet.connect} disabled={wallet.connecting}>
            {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
          </button>
        )}
      </div>
    </header>
  )
}
