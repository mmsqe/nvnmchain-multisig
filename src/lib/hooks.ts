import { useCallback, useEffect, useState } from 'react'
import type { Address, PublicClient } from 'viem'
import { safeAbi, tip20Abi } from './abi'
import { errorMessage } from '../chain'

export type SafeInfo = {
  version: string
  owners: Address[]
  threshold: bigint
  nonce: bigint
}

/** Read a Safe's version, owners, threshold and current nonce. */
export function useSafeInfo(publicClient: PublicClient, safe: Address | null) {
  const [info, setInfo] = useState<SafeInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!safe) {
      setInfo(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const code = await publicClient.getCode({ address: safe })
      if (!code || code === '0x') throw new Error('No contract code at this address on the selected network.')
      const [version, owners, threshold, nonce] = await Promise.all([
        publicClient.readContract({ address: safe, abi: safeAbi, functionName: 'VERSION' }),
        publicClient.readContract({ address: safe, abi: safeAbi, functionName: 'getOwners' }),
        publicClient.readContract({ address: safe, abi: safeAbi, functionName: 'getThreshold' }),
        publicClient.readContract({ address: safe, abi: safeAbi, functionName: 'nonce' }),
      ])
      setInfo({ version, owners: [...owners], threshold, nonce })
    } catch (e) {
      setInfo(null)
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [publicClient, safe])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { info, loading, error, refresh }
}

export type TokenMeta = { name: string; symbol: string; decimals: number }

/** Resolve TIP-20 metadata (falls back to ERC-20 selectors). */
export function useTokenMeta(publicClient: PublicClient, token: Address | null) {
  const [meta, setMeta] = useState<TokenMeta | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!token) {
      setMeta(null)
      return
    }
    ;(async () => {
      try {
        const [symbol, decimals, name] = await Promise.all([
          publicClient.readContract({ address: token, abi: tip20Abi, functionName: 'symbol' }).catch(() => ''),
          publicClient.readContract({ address: token, abi: tip20Abi, functionName: 'decimals' }).catch(() => 6),
          publicClient.readContract({ address: token, abi: tip20Abi, functionName: 'name' }).catch(() => ''),
        ])
        if (!cancelled) setMeta({ symbol: symbol || 'TOKEN', decimals: Number(decimals), name })
      } catch {
        if (!cancelled) setMeta(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [publicClient, token])

  return meta
}

/** Read a TIP-20 balance and expose a refresh function. */
export function useTokenBalance(publicClient: PublicClient, token: Address | null, owner: Address | null) {
  const [balance, setBalance] = useState<bigint | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!token || !owner) {
      setBalance(null)
      return
    }
    setLoading(true)
    try {
      const value = await publicClient.readContract({
        address: token,
        abi: tip20Abi,
        functionName: 'balanceOf',
        args: [owner],
      })
      setBalance(value)
    } catch {
      setBalance(null)
    } finally {
      setLoading(false)
    }
  }, [publicClient, token, owner])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { balance, loading, refresh }
}

/** Read the native (placeholder) balance. */
export function useNativeBalance(publicClient: PublicClient, owner: Address | null) {
  const [balance, setBalance] = useState<bigint | null>(null)

  const refresh = useCallback(async () => {
    if (!owner) {
      setBalance(null)
      return
    }
    try {
      setBalance(await publicClient.getBalance({ address: owner }))
    } catch {
      setBalance(null)
    }
  }, [publicClient, owner])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { balance, refresh }
}
