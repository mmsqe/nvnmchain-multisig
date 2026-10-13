import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages sub-path (repo name). Empty for local dev / custom domains.
const base = process.env.GH_PAGES ? '/nvnmchain-multisig/' : '/'

export default defineConfig({
  plugins: [react()],
  base,
  server: {
    port: 5174,
    host: true,
  },
})
