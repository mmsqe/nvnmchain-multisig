import { useMemo } from 'react'
import { concat, encodeAbiParameters, toFunctionSelector, type Abi, type Hex } from 'viem'
import {
  entryForAddress,
  findFunctionBySignature,
  functionRefs,
  parseEntry,
  parseItems,
  type AbiEntry,
} from '../lib/contracts'
import { coerceArgs, emptyParam, emptyParams, type ParamValue } from '../lib/abiparams'
import { ParamInput } from './ParamInput'
import { Notice } from './ui'

/** The calldata-builder part of a draft. */
export type ContractCallValue = {
  to: string
  /** 'auto' | 'raw' | 'custom' | a registered `AbiEntry.id`. */
  abiId: string
  /** A single human-readable method signature typed into the builder (`abiId === 'custom'`). */
  customMethod: string
  /** Canonical function signature, e.g. `transfer(address,uint256)`. */
  functionSig: string
  params: ParamValue[]
  /** Raw calldata, used when `abiId === 'raw'` (or no interface matches). */
  data: string
}

export function emptyContractCall(): ContractCallValue {
  return { to: '', abiId: 'auto', customMethod: '', functionSig: '', params: [], data: '0x' }
}

/** The interface selected for a draft, if any. */
function resolveEntry(abis: readonly AbiEntry[], abiId: string, to: string): AbiEntry | undefined {
  if (abiId === 'raw' || abiId === 'custom') return undefined
  if (abiId === 'auto') return entryForAddress(abis, to)
  return abis.find((entry) => entry.id === abiId)
}

export type CallInterface = { abi: Abi | null; name: string; error: string | null }

/**
 * Resolve the parsed interface for a draft, whether it comes from the registry,
 * an address match, or a single method signature typed into the builder.
 */
export function interfaceFor(abis: readonly AbiEntry[], value: ContractCallValue): CallInterface {
  if (value.abiId === 'raw') return { abi: null, name: 'Raw calldata', error: null }

  if (value.abiId === 'custom') {
    const name = 'Custom method'
    if (!value.customMethod.trim()) return { abi: null, name, error: null }
    const parsed = parseItems([value.customMethod])
    if (!parsed.ok) return { abi: null, name, error: parsed.error }
    if (parsed.abi.length === 0) return { abi: null, name, error: null }
    return { abi: parsed.abi, name, error: null }
  }

  const entry = resolveEntry(abis, value.abiId, value.to)
  if (!entry) return { abi: null, name: '', error: null }
  const parsed = parseEntry(entry)
  return parsed.ok ? { abi: parsed.abi, name: entry.name, error: null } : { abi: null, name: entry.name, error: parsed.error }
}

/** Encode a call from an interface + generated parameter values. Throws on bad input. */
export function encodeWithEntry(abi: Abi, functionSig: string, params: readonly ParamValue[]): Hex {
  const fn = findFunctionBySignature(abi, functionSig)
  if (!fn) throw new Error('Select a function.')
  const args = coerceArgs(fn.inputs, params)
  return concat([toFunctionSelector(fn), encodeAbiParameters(fn.inputs, args)])
}

function InterfaceSelect({
  abis,
  value,
  onChange,
}: {
  abis: readonly AbiEntry[]
  value: string
  onChange: (id: string) => void
}) {
  const builtins = abis.filter((entry) => entry.source === 'builtin')
  const user = abis.filter((entry) => entry.source === 'user')
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }}>
      <option value="auto">Auto-detect from address</option>
      <option value="custom">Custom method (type a signature)…</option>
      <option value="raw">Raw calldata</option>
      <optgroup label="Built-in">
        {builtins.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </optgroup>
      {user.length > 0 && (
        <optgroup label="Yours">
          {user.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )
}

/**
 * Contract-call editor: pick a target and an interface, and the function's
 * parameter fields are generated directly from its human-readable ABI. For a
 * one-off call, type a single method signature instead of registering an
 * interface.
 */
export function ContractCallFields({
  value,
  onChange,
  abis,
}: {
  value: ContractCallValue
  onChange: (patch: Partial<ContractCallValue>) => void
  abis: readonly AbiEntry[]
}) {
  const interf = useMemo(
    () => interfaceFor(abis, value),
    [abis, value.abiId, value.to, value.customMethod],
  )
  const abi = interf.abi
  const functions = useMemo(() => (abi ? functionRefs(abi) : []), [abi])

  const fn = functions.find((ref) => ref.signature === value.functionSig)?.fn ?? functions[0]?.fn ?? null
  const signature = fn ? functions.find((ref) => ref.fn === fn)?.signature ?? '' : ''

  // Normalize the parameter values to the selected function so the form works
  // even before the user touches a field (values live in the parent draft).
  const values = fn ? fn.inputs.map((input, index) => value.params[index] ?? emptyParam(input)) : []

  const preview = useMemo(() => {
    if (!abi || !fn) return null
    try {
      return encodeWithEntry(abi, signature, values)
    } catch {
      return null
    }
  }, [abi, fn, signature, values])

  return (
    <>
      <label className="lbl">Target</label>
      <input
        className="mono"
        value={value.to}
        onChange={(e) =>
          onChange({
            to: e.target.value,
            // Auto-detection is by address, so clear the function when it may change.
            ...(value.abiId === 'auto' ? { functionSig: '', params: [] as ParamValue[] } : {}),
          })
        }
        placeholder="0x…"
        spellCheck={false}
      />

      <label className="lbl">Interface</label>
      <InterfaceSelect
        abis={abis}
        value={value.abiId}
        onChange={(abiId) => onChange({ abiId, functionSig: '', params: [] })}
      />

      {value.abiId === 'custom' && (
        <>
          <label className="lbl">Method signature</label>
          <input
            className="mono"
            value={value.customMethod}
            onChange={(e) => onChange({ customMethod: e.target.value })}
            placeholder="transfer(address,uint256)"
            spellCheck={false}
          />
          <div className="muted small" style={{ marginTop: 6 }}>
            {interf.error ? (
              <span style={{ color: 'var(--red)' }}>{interf.error}</span>
            ) : abi ? (
              'Method parsed.'
            ) : (
              'A single method — the function keyword and parameter names are optional.'
            )}
          </div>
        </>
      )}

      {interf.error && value.abiId !== 'custom' && (
        <div style={{ marginTop: 10 }}>
          <Notice kind="err">Interface “{interf.name}” could not be parsed: {interf.error}</Notice>
        </div>
      )}

      {value.abiId === 'auto' && !abi && !interf.error && (
        <div style={{ marginTop: 10 }}>
          <Notice kind="info">
            No interface is registered for this target — enter raw calldata below, add one on the{' '}
            <strong>Interfaces</strong> tab, or pick <strong>Custom method</strong> to type one now.
          </Notice>
        </div>
      )}

      {abi && fn && (
        <>
          {value.abiId !== 'custom' && (
            <>
              <label className="lbl">Function</label>
              <select
                value={signature}
                onChange={(e) => {
                  const next = functions.find((ref) => ref.signature === e.target.value)
                  onChange({ functionSig: e.target.value, params: next ? emptyParams(next.fn.inputs) : [] })
                }}
                style={{ width: '100%' }}
              >
                {functions.map((ref) => (
                  <option key={ref.signature} value={ref.signature}>
                    {ref.fn.name}
                    {ref.fn.inputs.length > 0 ? `(${ref.fn.inputs.map((i) => i.type).join(', ')})` : '()'}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className="muted small mono-sm" style={{ marginTop: 4 }}>
            selector {toFunctionSelector(fn)}
          </div>

          {fn.inputs.length === 0 ? (
            <div className="muted small" style={{ marginTop: 10 }}>This function takes no arguments.</div>
          ) : (
            <div style={{ marginTop: 6 }}>
              {fn.inputs.map((input, index) => (
                <ParamInput
                  key={index}
                  param={input}
                  value={values[index]}
                  label={input.name || `arg${index}`}
                  onChange={(next) => {
                    const copy = [...values]
                    copy[index] = next
                    onChange({ params: copy })
                  }}
                />
              ))}
            </div>
          )}

          <label className="lbl">Calldata</label>
          <div className="mono-sm wrap-any" title={preview ?? undefined}>
            {preview ? preview : <span className="muted">Fill the parameters to encode the call.</span>}
          </div>
        </>
      )}

      {!fn && (
        <>
          <label className="lbl">Calldata</label>
          <input
            className="mono"
            value={value.data}
            onChange={(e) => onChange({ data: e.target.value })}
            placeholder="0x"
            spellCheck={false}
          />
        </>
      )}

      {abi && !fn && (
        <div style={{ marginTop: 10 }}>
          <Notice kind="warn">This method is not a function call.</Notice>
        </div>
      )}
    </>
  )
}
