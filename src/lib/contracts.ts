import {
  decodeFunctionData,
  isAddress,
  parseAbi,
  toFunctionSelector,
  toFunctionSignature,
  type Abi,
  type AbiFunction,
  type Address,
  type Hex,
} from 'viem'

/**
 * A contract interface described as a **human-readable ABI**
 * (https://oxlib.sh/guides/abi#human-readable-abis) — one item per line,
 * e.g. `function transfer(address to, uint256 amount) returns (bool)`.
 *
 * Entries are either shipped with the app (`builtin`) or added by the user
 * (`user`, persisted in localStorage). An entry may be bound to an address so
 * the builder can auto-detect the interface for a given target.
 */
export type AbiEntry = {
  id: string
  name: string
  /** Optional address this interface describes (enables auto-detection). */
  address?: Address
  source: 'builtin' | 'user'
  /** Human-readable ABI items — one signature per line. */
  items: string[]
}

const KNOWN_COMMON: AbiEntry[] = [
  {
    id: 'builtin:tip20',
    name: 'TIP-20',
    source: 'builtin',
    items: [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
      'function currency() view returns (string)',
      'function totalSupply() view returns (uint256)',
      'function balanceOf(address account) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
      'function transferWithMemo(address to, uint256 amount, bytes32 memo) returns (bool)',
      'function approve(address spender, uint256 amount) returns (bool)',
      'function transferFrom(address from, address to, uint256 amount) returns (bool)',
      'function mint(address to, uint256 amount)',
      'function burn(uint256 amount)',
      'event Transfer(address indexed from, address indexed to, uint256 amount)',
      'event Approval(address indexed owner, address indexed spender, uint256 amount)',
    ],
  },
  {
    id: 'builtin:erc20',
    name: 'ERC-20',
    source: 'builtin',
    items: [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
      'function totalSupply() view returns (uint256)',
      'function balanceOf(address account) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
      'function approve(address spender, uint256 amount) returns (bool)',
      'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    ],
  },
  {
    id: 'builtin:erc721',
    name: 'ERC-721',
    source: 'builtin',
    items: [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function balanceOf(address owner) view returns (uint256)',
      'function ownerOf(uint256 tokenId) view returns (address)',
      'function getApproved(uint256 tokenId) view returns (address)',
      'function isApprovedForAll(address owner, address operator) view returns (bool)',
      'function approve(address to, uint256 tokenId)',
      'function setApprovalForAll(address operator, bool approved)',
      'function transferFrom(address from, address to, uint256 tokenId)',
      'function safeTransferFrom(address from, address to, uint256 tokenId)',
      'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
    ],
  },
  {
    id: 'builtin:erc1155',
    name: 'ERC-1155',
    source: 'builtin',
    items: [
      'function balanceOf(address account, uint256 id) view returns (uint256)',
      'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
      'function isApprovedForAll(address account, address operator) view returns (bool)',
      'function setApprovalForAll(address operator, bool approved)',
      'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
      'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
    ],
  },
  {
    id: 'builtin:weth',
    name: 'Wrapped native (WETH)',
    source: 'builtin',
    items: [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
      'function totalSupply() view returns (uint256)',
      'function balanceOf(address account) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function deposit() payable',
      'function withdraw(uint256 amount)',
      'function transfer(address to, uint256 amount) returns (bool)',
      'function approve(address spender, uint256 amount) returns (bool)',
      'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    ],
  },
  {
    id: 'builtin:ownable',
    name: 'Ownable',
    source: 'builtin',
    items: [
      'function owner() view returns (address)',
      'function transferOwnership(address newOwner)',
      'function renounceOwnership()',
    ],
  },
  {
    id: 'builtin:multicall3',
    name: 'Multicall3',
    source: 'builtin',
    items: [
      'function aggregate((address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes[] returnData)',
      'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
      'function aggregate3Value((address target, bool allowFailure, uint256 value, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
    ],
  },
  {
    id: 'builtin:safe',
    name: 'Safe v1.3.0',
    source: 'builtin',
    items: [
      'function VERSION() view returns (string)',
      'function getOwners() view returns (address[])',
      'function getThreshold() view returns (uint256)',
      'function isOwner(address owner) view returns (bool)',
      'function nonce() view returns (uint256)',
      'function addOwnerWithThreshold(address owner, uint256 _threshold)',
      'function removeOwner(address prevOwner, address owner, uint256 _threshold)',
      'function swapOwner(address prevOwner, address oldOwner, address newOwner)',
      'function changeThreshold(uint256 _threshold)',
      'function enableModule(address module)',
      'function disableModule(address prevModule, address module)',
      'function approveHash(bytes32 hash)',
    ],
  },
  {
    // https://github.com/NVNM-Chain/nvnmchain-contracts/blob/main/src/IAnchoring.sol
    id: 'builtin:anchoring',
    name: 'NVNM Anchoring',
    // The x/anchoring contract, behind an ERC-1967 proxy at the precompile's old address.
    address: '0x0000000000000000000000000000000000000A00' as Address,
    source: 'builtin',
    items: [
      'function owner() view returns (address)',
      'function hasRole(bytes32 role, address account) view returns (bool)',
      'function roleMemberCount(bytes32 role) view returns (uint256)',
      'function getRoleAdmin(bytes32 role) view returns (bytes32)',
      'function addRegistry(string name, string description, string metadata) returns (uint64 registryId)',
      'function addRecord((string uri, string checksum, string checksumAlgo, string metadata, string timestamp, string status, uint64 recordId, uint64 index, bool isLatest, uint64 registryId) record) returns (uint64 recordId)',
      'function updateRecordStatus(uint64 registryId, uint64 recordId, uint64 index, string status)',
      'function records(uint64 registryId, string checksum, uint64 recordId, uint64 index, (bytes key, uint64 offset, uint64 limit, bool countTotal, bool reverse) pagination) view returns ((string uri, string checksum, string checksumAlgo, string metadata, string timestamp, string status, uint64 recordId, uint64 index, bool isLatest, uint64 registryId)[] recordsOut, (bytes nextKey, uint64 total) paginationOut)',
      'function registries(uint64 registryId, (bytes key, uint64 offset, uint64 limit, bool countTotal, bool reverse) pagination) view returns ((uint64 id, string name, string description, string creator, string createdAt, string metadata)[] registriesOut, (bytes nextKey, uint64 total) paginationOut)',
      'function registriesByName(string name, uint8 matchMode, (bytes key, uint64 offset, uint64 limit, bool countTotal, bool reverse) pagination) view returns ((uint64 id, string name, string description, string creator, string createdAt, string metadata)[] registriesOut, (bytes nextKey, uint64 total) paginationOut)',
      'function grantRole(uint64 registryId, string checksum, address account, string role)',
      'function revokeRole(uint64 registryId, string checksum, address account, string role)',
      'function transferOwnership(address newOwner)',
      'function upgradeToAndCall(address newImplementation, bytes data) payable',
      'function proxiableUUID() view returns (bytes32)',
      'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)',
      'event Upgraded(address indexed implementation)',
      'event AddRegistry(address indexed caller, uint64 registryId, string name)',
      'event AddRecord(address indexed caller, uint64 registryId, uint64 recordId, uint64 index, string checksum)',
      'event UpdateRecordStatus(address indexed caller, uint64 registryId, uint64 recordId, uint64 index, string status)',
      'event GrantRole(address indexed caller, uint64 registryId, string checksum, address account, string role)',
      'event RevokeRole(address indexed caller, uint64 registryId, string checksum, address account, string role)',
    ],
  },
]

/** Interfaces every build ships with. */
export const BUILTIN_ABIS: readonly AbiEntry[] = KNOWN_COMMON

const USER_ABI_KEY = 'nvnmchain-multisig:abis:v1'

function isUserEntry(value: unknown): value is AbiEntry {
  const entry = value as AbiEntry
  return (
    Boolean(entry) &&
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    Array.isArray(entry.items) &&
    entry.items.every((item) => typeof item === 'string')
  )
}

/** Load user-provided interfaces from localStorage. */
export function loadUserAbis(): AbiEntry[] {
  try {
    const raw = localStorage.getItem(USER_ABI_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isUserEntry).map((entry) => ({ ...entry, source: 'user' as const }))
  } catch {
    return []
  }
}

export function saveUserAbis(list: AbiEntry[]): void {
  try {
    localStorage.setItem(USER_ABI_KEY, JSON.stringify(list.filter((e) => e.source === 'user')))
  } catch {
    /* ignore quota / privacy mode */
  }
}

/** Builtins first, then user entries. */
export function allAbis(userAbis: AbiEntry[] = loadUserAbis()): AbiEntry[] {
  return [...BUILTIN_ABIS, ...userAbis]
}

/** Insert or replace a user interface, newest first. Returns the new user list. */
export function upsertUserAbi(entry: AbiEntry): AbiEntry[] {
  const next: AbiEntry = { ...entry, source: 'user' }
  const list = [next, ...loadUserAbis().filter((e) => e.id !== next.id)]
  saveUserAbis(list)
  return list
}

export function removeUserAbi(id: string): AbiEntry[] {
  const list = loadUserAbis().filter((e) => e.id !== id)
  saveUserAbis(list)
  return list
}

export function newAbiId(): string {
  return `user:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ---------------------------------------------------------------------------
// Parsing & lookup
// ---------------------------------------------------------------------------

export type AbiParse = { ok: true; abi: Abi } | { ok: false; error: string }

const parseCache = new Map<string, AbiParse>()

/** Item keywords that keep a line as-is; anything else is treated as a function. */
const ITEM_KEYWORDS = new Set(['function', 'event', 'error', 'constructor', 'receive', 'fallback'])

/**
 * Normalize one human-readable ABI line. The `function` keyword and parameter
 * names are optional, so `transfer(address,uint256)` becomes
 * `function transfer(address,uint256)`; a trailing `;` is dropped.
 */
export function normalizeAbiItem(line: string): string {
  const trimmed = line.trim().replace(/;\s*$/, '').trim()
  if (!trimmed) return ''
  const first = trimmed.split(/[\s(]/, 1)[0]
  return ITEM_KEYWORDS.has(first) ? trimmed : `function ${trimmed}`
}

function cleanItems(items: readonly string[]): string[] {
  return items
    .flatMap((item) => item.split('\n'))
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//') && !line.startsWith('#'))
    .map(normalizeAbiItem)
    .filter(Boolean)
}

function parseHuman(items: readonly string[]): AbiParse {
  try {
    return { ok: true, abi: parseAbi([...items] as string[]) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Parse an entry's human-readable items, caching the result. */
export function parseEntry(entry: AbiEntry): AbiParse {
  const items = cleanItems(entry.items)
  const key = `${entry.id}|${items.join('\n')}`
  const cached = parseCache.get(key)
  if (cached) return cached
  const result = parseHuman(items)
  parseCache.set(key, result)
  return result
}

/** Parse a free-form human-readable ABI (live validation in the editor — not cached). */
export function parseItems(items: readonly string[]): AbiParse {
  return parseHuman(cleanItems(items))
}

export type AbiFunctionRef = { fn: AbiFunction; signature: string; selector: Hex }

/** Every function in an ABI with its canonical signature and 4-byte selector. */
export function functionRefs(abi: Abi): AbiFunctionRef[] {
  return abi
    .filter((item): item is AbiFunction => item.type === 'function')
    .map((fn) => ({ fn, signature: toFunctionSignature(fn), selector: toFunctionSelector(fn) }))
}

export function findFunctionBySignature(abi: Abi, signature: string): AbiFunction | undefined {
  return abi.find(
    (item): item is AbiFunction => item.type === 'function' && toFunctionSignature(item as AbiFunction) === signature,
  )
}

export function findFunctionBySelector(abi: Abi, selector: Hex): AbiFunction | undefined {
  return abi.find((item): item is AbiFunction => {
    if (item.type !== 'function') return false
    try {
      return toFunctionSelector(item as AbiFunction).toLowerCase() === selector.toLowerCase()
    } catch {
      return false
    }
  })
}

/** Entry bound to `address` (case-insensitive), if any. User entries win. */
export function entryForAddress(entries: readonly AbiEntry[], address: string): AbiEntry | undefined {
  if (!isAddress(address)) return undefined
  const target = address.toLowerCase()
  const matches = entries.filter((entry) => entry.address?.toLowerCase() === target)
  // Later entries (user-provided) take precedence over builtins.
  return matches.length ? matches[matches.length - 1] : undefined
}

export type DecodedWithAbi = {
  entry: AbiEntry
  fn: AbiFunction
  signature: string
  args: readonly unknown[]
}

/**
 * Decode `data` for `to` using the registered ABIs. Address-bound interfaces
 * are tried first so a selector collision can't pick the wrong one.
 */
export function decodeWithAbis(entries: readonly AbiEntry[], to: string, data: Hex): DecodedWithAbi | null {
  if (!data || data === '0x' || data.length < 10) return null
  const bound = isAddress(to)
    ? entries.filter((entry) => entry.address?.toLowerCase() === to.toLowerCase())
    : []
  const rest = entries.filter((entry) => !bound.includes(entry))

  const candidates: { entry: AbiEntry; abi: Abi }[] = []
  for (const entry of [...bound, ...rest]) {
    const parsed = parseEntry(entry)
    if (parsed.ok) candidates.push({ entry, abi: parsed.abi })
  }

  for (const { entry, abi } of candidates) {
    try {
      const decoded = decodeFunctionData({ abi, data })
      const fn = findFunctionBySelector(abi, data.slice(0, 10) as Hex)
      if (!fn) continue
      return { entry, fn, signature: toFunctionSignature(fn), args: decoded.args ?? [] }
    } catch {
      /* try the next interface */
    }
  }
  return null
}
