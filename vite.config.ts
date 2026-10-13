import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Resolve the public base path.
 *
 * GitHub Pages serves a project site under `/<repo>/`, while user/org sites
 * (`<user>.github.io`) and custom domains serve from the root. We derive it from
 * the repo so no per-repo edit is needed, and allow an explicit override via
 * `BASE_PATH` (e.g. a custom domain sub-path).
 */
function resolveBase(): string {
  if (process.env.BASE_PATH) return process.env.BASE_PATH
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
  if (repo && !repo.endsWith('.github.io')) return `/${repo}/`
  return '/'
}

export default defineConfig({
  plugins: [react()],
  base: resolveBase(),
  server: {
    port: 5174,
    host: true,
  },
})
