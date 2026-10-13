import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type EIP1193Provider,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { chainFor, errorMessage, getNetwork, getNetworkKey, NETWORKS, setNetworkKey as persistNetwork, type NetworkKey } from '../chain'

type InjectedProvider = EIP1193Provider & {
  on?: (event: string, handler: (...args: any[]) => void) => void
  removeListener?: (event: string, handler: (...args: any[]) => void) => void
}

export function getInjectedProvider(): InjectedProvider | undefined {
  return (globalThis as { ethereum?: InjectedProvider }).ethereum
}

function chainParams(key: NetworkKey) {
  const n = NETWORKS[key]
  return {
    chainId: `0x${n.chainId.toString(16)}`,
    chainName: n.name,
    nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 18 },
    rpcUrls: [n.rpcUrl],
    blockExplorerUrls: [n.explorerUrl],
  }
}

async function ensureChain(provider: InjectedProvider, key: NetworkKey): Promise<void> {
  const net = chainFor(key)
  const current = (await provider.request({ method: 'eth_chainId' })) as string
  if (Number.parseInt(current, 16) === net.id) return
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${net.id.toString(16)}` }],
    })
  } catch (e) {
    const code = (e as { code?: number }).code
    if (code === 4902 || code === -32603) {
      await provider.request({ method: 'wallet_addEthereumChain', params: [chainParams(key)] })
    } else {
      throw e
    }
  }
}

export type Wallet = {
  provider?: InjectedProvider
  available: boolean
  account: Address | null
  connecting: boolean
  error: string | null
  networkKey: NetworkKey
  chainId: number
  walletChainId: number | null
  onCorrectChain: boolean
  publicClient: PublicClient
  walletClient: WalletClient | null
  connect: () => Promise<void>
  disconnect: () => void
  switchNetwork: () => Promise<void>
  setNetworkKey: (key: NetworkKey) => void
}

export function useWallet(): Wallet {
  const [networkKey, setKey] = useState<NetworkKey>(getNetworkKey())
  const [account, setAccount] = useState<Address | null>(null)
  const [walletChainId, setWalletChainId] = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const provider = getInjectedProvider()

  useEffect(() => {
    const handler = () => setKey(getNetworkKey())
    window.addEventListener('nvnm:network-changed', handler)
    return () => window.removeEventListener('nvnm:network-changed', handler)
  }, [])

  useEffect(() => {
    if (!provider) return
    let cancelled = false
    const readChain = () => {
      provider
        .request({ method: 'eth_chainId' })
        .then((id) => {
          if (!cancelled) setWalletChainId(Number.parseInt(id as string, 16))
        })
        .catch(() => {})
    }
    readChain()
    provider
      .request({ method: 'eth_accounts' })
      .then((accounts) => {
        if (!cancelled) setAccount((accounts as Address[])[0] ?? null)
      })
      .catch(() => {})
    const onAccounts = (accounts: Address[]) => setAccount(accounts?.[0] ?? null)
    const onChain = () => readChain()
    provider.on?.('accountsChanged', onAccounts)
    provider.on?.('chainChanged', onChain)
    return () => {
      cancelled = true
      provider.removeListener?.('accountsChanged', onAccounts)
      provider.removeListener?.('chainChanged', onChain)
    }
  }, [provider])

  const publicClient = useMemo(
    () => createPublicClient({ chain: chainFor(networkKey), transport: http(getNetwork().rpcUrl) }),
    [networkKey],
  )

  const walletClient = useMemo(() => {
    if (!provider) return null
    return createWalletClient({
      account: account ?? undefined,
      chain: chainFor(networkKey),
      transport: custom(provider),
    })
  }, [provider, account, networkKey])

  const connect = useCallback(async () => {
    if (!provider) {
      setError('No EVM wallet detected. Install MetaMask, Rabby, or another injected wallet.')
      return
    }
    setConnecting(true)
    setError(null)
    try {
      await ensureChain(provider, getNetworkKey())
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as Address[]
      setAccount(accounts[0] ?? null)
      const id = (await provider.request({ method: 'eth_chainId' })) as string
      setWalletChainId(Number.parseInt(id, 16))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setConnecting(false)
    }
  }, [provider])

  const switchNetwork = useCallback(async () => {
    if (!provider) return
    setError(null)
    try {
      await ensureChain(provider, getNetworkKey())
      const id = (await provider.request({ method: 'eth_chainId' })) as string
      setWalletChainId(Number.parseInt(id, 16))
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [provider])

  const disconnect = useCallback(() => setAccount(null), [])

  const setNetworkKey = useCallback((key: NetworkKey) => persistNetwork(key), [])

  return {
    provider,
    available: Boolean(provider),
    account,
    connecting,
    error,
    networkKey,
    chainId: getNetwork().chainId,
    walletChainId,
    onCorrectChain: walletChainId === getNetwork().chainId,
    publicClient,
    walletClient,
    connect,
    disconnect,
    switchNetwork,
    setNetworkKey,
  }
}
