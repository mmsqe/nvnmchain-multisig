import { encodeAbiParameters, parseAbi, toFunctionSelector, type AbiFunction, type AbiParameter } from 'viem'
import { BUILTIN_ABIS, decodeWithAbis, entryForAddress, functionRefs, parseEntry, parseItems, type AbiEntry } from '../src/lib/contracts'
import { arrayInfo, coerceArgs, componentsOf, paramError, type ParamValue } from '../src/lib/abiparams'

let failures = 0
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) {
    failures++
    console.error('FAIL', name, detail ?? '')
  } else {
    console.log('ok  ', name)
  }
}

// 1. Every builtin parses and exposes functions.
for (const entry of BUILTIN_ABIS) {
  const parsed = parseEntry(entry)
  check(`builtin ${entry.id} parses`, parsed.ok, parsed.ok ? undefined : parsed.error)
  if (parsed.ok) check(`builtin ${entry.id} has functions`, functionRefs(parsed.abi).length > 0)
}

// 1b. The Anchoring selectors must match the precompile (pinned upstream in test/Selectors.t.sol).
const anchoring = BUILTIN_ABIS.find((entry) => entry.id === 'builtin:anchoring')
if (anchoring) {
  const parsed = parseEntry(anchoring)
  const expected: Record<string, string> = {
    addRegistry: '0x318b38b1',
    addRecord: '0x64d25295',
    updateRecordStatus: '0x97b40c25',
    records: '0xc7be5e37',
    registries: '0x17bd3e65',
    registriesByName: '0x5522e6c6',
    grantRole: '0xb8fdd1a7',
    revokeRole: '0xacd58bc7',
  }
  if (parsed.ok) {
    for (const [name, selector] of Object.entries(expected)) {
      const ref = functionRefs(parsed.abi).find((r) => r.fn.name === name)
      check(`anchoring selector ${name}`, ref?.selector === selector, ref?.selector)
    }
  }
  check(
    'anchoring auto-detected at 0x…0A00',
    entryForAddress(BUILTIN_ABIS, '0x0000000000000000000000000000000000000A00')?.id === 'builtin:anchoring',
  )
}

// 1c. Bare method signatures (no `function` keyword, no parameter names) are accepted.
const bare = parseItems([
  'transfer(address,uint256)',
  'approve(address,uint256)',
  'name() view returns (string)',
  'event Transfer(address indexed, address indexed, uint256)',
])
check('bare signatures parse', bare.ok, bare.ok ? undefined : bare.error)
if (bare.ok) {
  const refs = functionRefs(bare.abi)
  check('bare transfer selector', refs.find((r) => r.fn.name === 'transfer')?.selector === '0xa9059cbb')
  check('bare name parsed', Boolean(refs.find((r) => r.fn.name === 'name')))
  check('bare event kept as event', bare.abi.some((item) => item.type === 'event' && item.name === 'Transfer'))
}

// 2. Build valid values for every parameter type, then encode + decode.
function fillParam(param: AbiParameter): ParamValue {
  const array = arrayInfo(param)
  if (array) {
    const n = array.length ?? 1
    return { kind: 'array', items: Array.from({ length: n }, () => fillParam(array.inner)) }
  }
  if (param.type === 'tuple') {
    return { kind: 'tuple', fields: componentsOf(param).map(fillParam) }
  }
  if (param.type === 'address') return { kind: 'primitive', value: '0x0000000000000000000000000000000000000001' }
  if (param.type === 'bool') return { kind: 'primitive', value: 'true' }
  if (param.type === 'bytes') return { kind: 'primitive', value: '0xdead' }
  if (/^bytes\d+$/.test(param.type)) return { kind: 'primitive', value: '0x' + '11'.repeat(Number(param.type.slice(5))) }
  if (param.type === 'string') return { kind: 'primitive', value: 'hi' }
  return { kind: 'primitive', value: '1' }
}

const signatures = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable',
  'function setApprovalForAll(address operator, bool approved)',
  'function fixedArray(uint256[2] xs)',
]
const abi = parseAbi(signatures)
const entry: AbiEntry = { id: 'test', name: 'Test', source: 'user', items: signatures }

function roundTrip(label: string, subject: AbiEntry, functions: AbiFunction[]) {
  for (const fn of functions) {
    const params = fn.inputs.map(fillParam)
    const errors = fn.inputs.map((input, i) => paramError(input, params[i], input.name || `arg${i}`))
    check(`params valid: ${label}.${fn.name}`, errors.every((e) => e === null), errors)

    const args = coerceArgs(fn.inputs, params)
    const data = (toFunctionSelector(fn) + encodeAbiParameters(fn.inputs, args).slice(2)) as `0x${string}`
    const decoded = decodeWithAbis([subject], '0x', data)
    check(`decodes back: ${label}.${fn.name}`, decoded?.fn.name === fn.name, decoded?.fn.name)
  }
}

roundTrip('sample', entry, abi.filter((i): i is AbiFunction => i.type === 'function'))

if (anchoring) {
  const parsed = parseEntry(anchoring)
  if (parsed.ok) roundTrip('anchoring', anchoring, parsed.abi.filter((i): i is AbiFunction => i.type === 'function'))
}

console.log(failures === 0 ? '\nALL ABI CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
