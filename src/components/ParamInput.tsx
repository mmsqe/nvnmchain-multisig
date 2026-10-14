import type { AbiParameter } from 'viem'
import {
  arrayInfo,
  componentsOf,
  emptyParam,
  isTuple,
  paramError,
  paramLabel,
  paramPlaceholder,
  type ParamValue,
} from '../lib/abiparams'

/**
 * Recursively render an input for one ABI parameter. The fields are derived
 * from the parsed human-readable ABI — primitives, tuples and (nested) arrays
 * all work, and every change replaces the value immutably.
 */
export function ParamInput({
  param,
  value,
  onChange,
  label,
  depth = 0,
}: {
  param: AbiParameter
  value: ParamValue
  onChange: (value: ParamValue) => void
  label: string
  depth?: number
}) {
  const error = paramError(param, value, label)
  const hint = error ? <span style={{ color: 'var(--red)' }}>{error}</span> : null

  const array = arrayInfo(param)
  if (array) {
    const items = value.kind === 'array' ? value.items : []
    const fixed = array.length !== null
    const elementName = paramLabel(array.inner, 'item')
    return (
      <div className="param-group" style={{ borderLeft: depth > 0 ? '2px solid var(--border)' : undefined, paddingLeft: depth > 0 ? 10 : 0 }}>
        <div className="row between" style={{ marginTop: depth > 0 ? 8 : 0 }}>
          <label className="lbl" style={{ margin: '6px 0 0' }}>
            {label} <span className="muted">· {param.type}</span>
          </label>
          {!fixed && (
            <button
              type="button"
              className="btn small ghost"
              onClick={() => onChange({ kind: 'array', items: [...items, emptyParam(array.inner)] })}
            >
              + item
            </button>
          )}
        </div>
        {items.length === 0 && <div className="muted small" style={{ marginTop: 6 }}>Empty list — add an item.</div>}
        {items.map((item, index) => (
          <div key={index} className="row" style={{ alignItems: 'flex-start', gap: 6 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ParamInput
                param={array.inner}
                value={item}
                onChange={(next) => {
                  const copy = [...items]
                  copy[index] = next
                  onChange({ kind: 'array', items: copy })
                }}
                label={`${elementName} [${index}]`}
                depth={depth + 1}
              />
            </div>
            {!fixed && (
              <button
                type="button"
                className="copy"
                style={{ marginTop: 18 }}
                title="Remove"
                onClick={() => onChange({ kind: 'array', items: items.filter((_, i) => i !== index) })}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {hint && <div className="small" style={{ marginTop: 4 }}>{hint}</div>}
      </div>
    )
  }

  if (isTuple(param)) {
    const components = componentsOf(param)
    const fields = value.kind === 'tuple' ? value.fields : []
    return (
      <div className="param-group" style={{ borderLeft: depth > 0 ? '2px solid var(--border)' : undefined, paddingLeft: depth > 0 ? 10 : 0 }}>
        <label className="lbl" style={{ margin: '6px 0 0' }}>
          {label} <span className="muted">· {param.type}</span>
        </label>
        {components.length === 0 && <div className="muted small">No components.</div>}
        {components.map((component, index) => (
          <ParamInput
            key={index}
            param={component}
            value={fields[index] ?? emptyParam(component)}
            onChange={(next) => {
              const copy = components.map((_, i) => fields[i] ?? emptyParam(components[i]))
              copy[index] = next
              onChange({ kind: 'tuple', fields: copy })
            }}
            label={paramLabel(component, `${label}.${index}`)}
            depth={depth + 1}
          />
        ))}
        {hint && <div className="small" style={{ marginTop: 4 }}>{hint}</div>}
      </div>
    )
  }

  const primitive = value.kind === 'primitive' ? value.value : ''
  return (
    <div>
      <label className="lbl">
        {label} <span className="muted">· {param.type}</span>
      </label>
      {param.type === 'bool' ? (
        <select value={primitive === 'true' ? 'true' : 'false'} onChange={(e) => onChange({ kind: 'primitive', value: e.target.value })}>
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      ) : (
        <input
          className={/^bytes/.test(param.type) || param.type === 'address' ? 'mono' : undefined}
          value={primitive}
          placeholder={paramPlaceholder(param)}
          spellCheck={false}
          onChange={(e) => onChange({ kind: 'primitive', value: e.target.value })}
        />
      )}
      {hint && <div className="small" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  )
}
