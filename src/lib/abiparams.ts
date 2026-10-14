import { getAddress, isAddress, type AbiParameter } from 'viem'

/**
 * Editable value for one ABI parameter. Kept as plain JSON so a draft can be
 * held in React state (and survived a re-render) without carrying bigints.
 */
export type ParamValue =
  | { kind: 'primitive'; value: string }
  | { kind: 'tuple'; fields: ParamValue[] }
  | { kind: 'array'; items: ParamValue[] }

const ARRAY_RE = /^(.*)\[(\d*)\]$/

/** Tuple components, typed for the union `AbiParameter`. */
export function componentsOf(param: AbiParameter): readonly AbiParameter[] {
  return (param as { components?: readonly AbiParameter[] }).components ?? []
}

/** If `param` is an array, the element type and its fixed length (null = dynamic). */
export function arrayInfo(param: AbiParameter): { inner: AbiParameter; length: number | null } | null {
  const match = ARRAY_RE.exec(param.type)
  if (!match) return null
  const inner: AbiParameter = { ...param, type: match[1] }
  return { inner, length: match[2] ? Number(match[2]) : null }
}

export function isTuple(param: AbiParameter): boolean {
  return param.type === 'tuple' || componentsOf(param).length > 0
}

/** A fresh, empty value for a parameter (arrays of fixed length start filled). */
export function emptyParam(param: AbiParameter): ParamValue {
  const array = arrayInfo(param)
  if (array) {
    const count = array.length ?? 0
    return { kind: 'array', items: Array.from({ length: count }, () => emptyParam(array.inner)) }
  }
  if (isTuple(param)) {
    return { kind: 'tuple', fields: componentsOf(param).map((component) => emptyParam(component)) }
  }
  return { kind: 'primitive', value: param.type === 'bool' ? 'false' : '' }
}

export function emptyParams(params: readonly AbiParameter[]): ParamValue[] {
  return params.map(emptyParam)
}

export function primitiveValue(value: string): ParamValue {
  return { kind: 'primitive', value }
}

/** A short, human label for a parameter: its name, else its type. */
export function paramLabel(param: AbiParameter, fallback: string): string {
  return param.name && param.name.length > 0 ? param.name : fallback
}

export function paramPlaceholder(param: AbiParameter): string {
  const type = param.type
  if (type === 'address') return '0x…'
  if (type === 'bool') return 'true / false'
  if (type === 'string') return 'text'
  if (/^bytes(\d+)?$/.test(type)) return type === 'bytes' ? '0x…' : `0x… (${type.slice(5)} bytes)`
  if (/^u?int\d*$/.test(type)) return '0'
  return type
}

const INT_RE = /^-?\d+$/
const HEX_RE = /^0x([0-9a-fA-F]{2})*$/

/** Convert one primitive text field into the value viem expects. Throws on bad input. */
function coercePrimitive(type: string, raw: string, label: string): unknown {
  if (type === 'bool') {
    if (raw !== 'true' && raw !== 'false') throw new Error(`${label}: expected true or false`)
    return raw === 'true'
  }
  if (type === 'address') {
    if (!isAddress(raw)) throw new Error(`${label}: invalid address`)
    return getAddress(raw)
  }
  if (/^u?int\d*$/.test(type)) {
    const hex = raw.startsWith('0x') || raw.startsWith('0X')
    if (!hex && !INT_RE.test(raw)) throw new Error(`${label}: expected an integer`)
    let value: bigint
    try {
      value = BigInt(raw)
    } catch {
      throw new Error(`${label}: expected an integer`)
    }
    if (type.startsWith('uint') && value < 0n) throw new Error(`${label}: unsigned integer cannot be negative`)
    return value
  }
  if (/^bytes(\d+)?$/.test(type)) {
    if (raw === '') return '0x'
    if (!HEX_RE.test(raw)) throw new Error(`${label}: expected hex bytes`)
    const fixed = /^bytes(\d+)$/.exec(type)
    if (fixed && raw.length !== 2 + Number(fixed[1]) * 2) {
      throw new Error(`${label}: expected ${fixed[1]} bytes`)
    }
    return raw
  }
  // string and anything exotic (e.g. function) pass through.
  return raw
}

/** Convert an editable value into the argument viem should encode. Throws on bad input. */
export function coerceParam(param: AbiParameter, value: ParamValue, label = param.type): unknown {
  const array = arrayInfo(param)
  if (array) {
    if (value.kind !== 'array') throw new Error(`${label}: expected a list`)
    if (array.length !== null && value.items.length !== array.length) {
      throw new Error(`${label}: expected ${array.length} items`)
    }
    return value.items.map((item, index) => coerceParam(array.inner, item, `${label}[${index}]`))
  }
  if (isTuple(param)) {
    if (value.kind !== 'tuple') throw new Error(`${label}: expected a tuple`)
    return componentsOf(param).map((component, index) =>
      coerceParam(component, value.fields[index] ?? emptyParam(component), paramLabel(component, `${label}[${index}]`)),
    )
  }
  if (value.kind !== 'primitive') throw new Error(`${label}: expected a value`)
  return coercePrimitive(param.type, value.value.trim(), label)
}

/** Coerce every argument of a function call. */
export function coerceArgs(params: readonly AbiParameter[], values: readonly ParamValue[]): unknown[] {
  return params.map((param, index) => {
    const fallback = paramLabel(param, `arg${index}`)
    return coerceParam(param, values[index] ?? emptyParam(param), fallback)
  })
}

/** `null` when the value is valid, else a human error message (for inline display). */
export function paramError(param: AbiParameter, value: ParamValue, label = param.type): string | null {
  try {
    coerceParam(param, value, label)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** Compact one-line rendering of a value for the review preview. */
export function previewValue(param: AbiParameter, value: ParamValue): string {
  const array = arrayInfo(param)
  if (array) {
    if (value.kind !== 'array') return '[]'
    return `[${value.items.map((item) => previewValue(array.inner, item)).join(', ')}]`
  }
  if (isTuple(param)) {
    if (value.kind !== 'tuple') return '()'
    return `(${componentsOf(param)
      .map((component, index) => previewValue(component, value.fields[index] ?? emptyParam(component)))
      .join(', ')})`
  }
  const raw = value.kind === 'primitive' ? value.value.trim() : ''
  if (raw === '') return '_'
  return raw
}
