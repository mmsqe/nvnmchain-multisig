import { Fragment, useMemo, useState } from 'react'
import { getAddress, isAddress } from 'viem'
import {
  functionRefs,
  newAbiId,
  parseEntry,
  parseItems,
  removeUserAbi,
  upsertUserAbi,
  type AbiEntry,
} from '../lib/contracts'
import { errorMessage } from '../chain'
import { AddressLink, Notice } from './ui'

type Draft = { id: string | null; name: string; address: string; text: string }

const emptyDraft = (): Draft => ({ id: null, name: '', address: '', text: '' })

function entrySummary(entry: AbiEntry) {
  const parsed = parseEntry(entry)
  if (!parsed.ok) return { functions: 0, error: parsed.error }
  return { functions: functionRefs(parsed.abi).length, error: null }
}

function EntryRow({
  entry,
  onEdit,
  onDelete,
}: {
  entry: AbiEntry
  onEdit: (entry: AbiEntry) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const parsed = useMemo(() => parseEntry(entry), [entry])
  const summary = entrySummary(entry)
  const functions = parsed.ok ? functionRefs(parsed.abi) : []

  return (
    <div className="item" style={{ display: 'block' }}>
      <div className="row between">
        <div className="grow row" style={{ gap: 8 }}>
          <strong>{entry.name}</strong>
          <span className={`badge ${entry.source === 'builtin' ? '' : 'info'}`}>{entry.source}</span>
          {entry.address && <AddressLink address={entry.address} short />}
        </div>
        <div className="row">
          <span className="muted small">
            {summary.error ? 'invalid' : `${summary.functions} fn${summary.functions === 1 ? '' : 's'}`}
          </span>
          <button className="btn small ghost" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'View'}
          </button>
          {entry.source === 'user' && (
            <button className="btn small ghost" onClick={() => onEdit(entry)}>
              Edit
            </button>
          )}
          {entry.source === 'user' && (
            <button className="btn small ghost danger" onClick={() => onDelete(entry.id)}>
              Delete
            </button>
          )}
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 8 }}>
          {summary.error ? (
            <Notice kind="err">{summary.error}</Notice>
          ) : (
            <dl className="kv">
              {functions.map(({ fn, signature, selector }) => (
                <Fragment key={signature}>
                  <dt className="mono-sm">{selector}</dt>
                  <dd className="mono-sm truncate" title={signature}>
                    {fn.name}({fn.inputs.map((i) => i.type).join(', ')})
                  </dd>
                </Fragment>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Manage the calldata interfaces used by the builder and the review view.
 * Interfaces are written in the human-readable ABI format — one item per line.
 */
export function AbiManager({ abis, onChanged }: { abis: AbiEntry[]; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const userAbis = abis.filter((entry) => entry.source === 'user')

  const preview = useMemo(() => (draft ? parseItems(draft.text.split('\n')) : null), [draft])

  const startAdd = () => {
    setError(null)
    setDraft(emptyDraft())
  }

  const startEdit = (entry: AbiEntry) => {
    setError(null)
    setDraft({ id: entry.id, name: entry.name, address: entry.address ?? '', text: entry.items.join('\n') })
  }

  /** Re-render after an edit or delete mutates the stored interfaces. */
  const handleDelete = (id: string) => {
    removeUserAbi(id)
    if (draft?.id === id) setDraft(null)
    onChanged()
  }

  const save = () => {
    if (!draft) return
    setError(null)
    if (draft.address.trim() && !isAddress(draft.address.trim())) {
      setError('The contract address is not a valid address.')
      return
    }
    const parsed = parseItems(draft.text.split('\n'))
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (functionRefs(parsed.abi).length === 0) {
      setError('Add at least one function to the interface.')
      return
    }
    try {
      upsertUserAbi({
        id: draft.id ?? newAbiId(),
        name: draft.name.trim() || 'Untitled interface',
        address: draft.address.trim() ? getAddress(draft.address.trim()) : undefined,
        source: 'user',
        items: draft.text.split('\n'),
      })
      setDraft(null)
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <section className="card">
      <div className="row between">
        <div>
          <h2>Contract interfaces</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Calldata is built and reviewed with <strong>human-readable ABIs</strong> — one item per
            line, e.g. <span className="mono-sm">function transfer(address to, uint256 amount)</span>.
            Known interfaces ship with the app; add your own and optionally bind one to a contract
            address to auto-detect it.
          </p>
        </div>
        <button className="btn primary" onClick={startAdd} disabled={draft !== null}>
          + Add interface
        </button>
      </div>

      {draft && (
        <div className="tx-call" style={{ marginTop: 14 }}>
          <div className="grid2">
            <div>
              <label className="lbl">Name</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="My token"
              />
            </div>
            <div>
              <label className="lbl">Contract address (optional)</label>
              <input
                className="mono"
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                placeholder="0x… — enables auto-detection"
                spellCheck={false}
              />
            </div>
          </div>

          <label className="lbl">Human-readable ABI</label>
          <textarea
            className="mono"
            rows={8}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            placeholder={'transfer(address,uint256)\napprove(address,uint256)\nname() view returns (string)'}
            spellCheck={false}
          />
          <div className="muted small" style={{ marginTop: 6 }}>
            {preview?.ok
              ? `${functionRefs(preview.abi).length} function(s) parsed.`
              : preview
                ? <span style={{ color: 'var(--red)' }}>{preview.error}</span>
                : 'One method per line — the function keyword and parameter names are optional.'}
          </div>

          {error && <div style={{ marginTop: 10 }}><Notice kind="err">{error}</Notice></div>}

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={save} disabled={!draft.text.trim()}>
              {draft.id ? 'Save changes' : 'Add interface'}
            </button>
            <button className="btn ghost" onClick={() => { setDraft(null); setError(null) }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <h3 style={{ marginTop: 20 }}>Built-in</h3>
      <div className="list">
        {abis.filter((entry) => entry.source === 'builtin').map((entry) => (
          <EntryRow key={entry.id} entry={entry} onEdit={startEdit} onDelete={handleDelete} />
        ))}
      </div>

      <h3 style={{ marginTop: 20 }}>Your interfaces</h3>
      {userAbis.length === 0 ? (
        <div className="empty">No custom interfaces yet. Add one to build calldata from an ABI.</div>
      ) : (
        <div className="list">
          {userAbis.map((entry) => (
            <EntryRow key={entry.id} entry={entry} onEdit={startEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </section>
  )
}
