import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'nvnmchain-multisig:theme:v1'

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

function initialTheme(): Theme {
  const applied = document.documentElement.dataset.theme
  if (applied === 'light' || applied === 'dark') return applied
  return storedTheme() ?? systemTheme()
}

let current: Theme = initialTheme()
const listeners = new Set<() => void>()

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0d13' : '#f5f7fb')
}

function emit(): void {
  for (const listener of listeners) listener()
}

export function getTheme(): Theme {
  return current
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setTheme(theme: Theme): void {
  current = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* ignore */
  }
  applyTheme(theme)
  emit()
}

export function toggleTheme(): void {
  setTheme(current === 'dark' ? 'light' : 'dark')
}

// Follow the OS preference until the user makes an explicit choice.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!storedTheme()) {
      current = systemTheme()
      applyTheme(current)
      emit()
    }
  })
}

/** Current theme plus a toggle, shared across all subscribers. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme)
  return { theme, toggle: toggleTheme }
}
