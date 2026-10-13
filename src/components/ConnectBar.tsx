import { NETWORKS, NETWORK_KEYS, getNetwork, shortAddress, type NetworkKey } from '../chain'
import { useTokenBalance } from '../lib/hooks'
import { useTheme } from '../lib/theme'
import type { Wallet } from '../lib/wallet'
import { FEE_TOKEN, feeTokenSymbol, formatUnits } from '../chain'
import { MoonIcon, SunIcon } from './ui'

export function ConnectBar({ wallet }: { wallet: Wallet }) {
  const net = getNetwork()
  const { balance } = useTokenBalance(wallet.publicClient, FEE_TOKEN, wallet.account)
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
          <button className="btn ghost" onClick={wallet.disconnect} title="Disconnect">
            <span className="dot ok" />
            <span className="mono">{shortAddress(wallet.account, 5)}</span>
            <span className="muted small">
              {balance == null ? '' : `${formatUnits(balance)} ${feeTokenSymbol()}`}
            </span>
          </button>
        ) : (
          <button className="btn primary" onClick={wallet.connect} disabled={wallet.connecting}>
            {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
          </button>
        )}
      </div>
    </header>
  )
}
