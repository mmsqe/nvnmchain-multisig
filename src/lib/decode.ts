import { decodeFunctionData, getAddress, parseAbi, toFunctionSelector, type Address, type Hex } from 'viem'

/** MultiSendCallOnly / MultiSend batch entry. */
export type PackedCall = {
  operation: number
  to: Address
  value: bigint
  data: Hex
}

export const multiSendAbi = parseAbi(['function multiSend(bytes transactions)'])

export const MULTISEND_SELECTOR = toFunctionSelector('multiSend(bytes)')

export function selectorOf(data: Hex): Hex {
  return (data.length >= 10 ? data.slice(0, 10) : data) as Hex
}

/** Unpack the `MultiSend.multiSend` byte blob into individual calls. */
export function unpackMultiSend(packed: Hex): PackedCall[] {
  const hex = packed.slice(2)
  const calls: PackedCall[] = []
  let i = 0
  while (i < hex.length) {
    if (i + 2 + 40 + 64 + 64 > hex.length) throw new Error('Truncated MultiSend data')
    const operation = Number.parseInt(hex.slice(i, i + 2), 16)
    i += 2
    const to = getAddress(`0x${hex.slice(i, i + 40)}`)
    i += 40
    const value = BigInt(`0x${hex.slice(i, i + 64)}`)
    i += 64
    const dataLen = Number(BigInt(`0x${hex.slice(i, i + 64)}`))
    i += 64
    if (i + dataLen * 2 > hex.length) throw new Error('Truncated MultiSend call data')
    const data = (`0x${hex.slice(i, i + dataLen * 2)}`) as Hex
    i += dataLen * 2
    calls.push({ operation, to, value, data })
  }
  return calls
}

/** Decode a `multiSend(bytes)` call into its individual calls. */
export function decodeMultiSend(data: Hex): PackedCall[] {
  const { args } = decodeFunctionData({ abi: multiSendAbi, data })
  return unpackMultiSend(args[0] as Hex)
}

/** True when a transaction is a `MultiSendCallOnly.multiSend` delegatecall. */
export function isMultiSendCall(tx: { to: Address; operation: number; data: Hex }, multiSendAddress: Address): boolean {
  return (
    tx.operation === 1 &&
    tx.to.toLowerCase() === multiSendAddress.toLowerCase() &&
    tx.data.length >= 10 &&
    selectorOf(tx.data).toLowerCase() === MULTISEND_SELECTOR.toLowerCase()
  )
}
