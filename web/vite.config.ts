import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server proxies /api to the Go service once it exists; today the app runs
// on the mock layer in src/mock.ts and the proxy is just a no-op target.
export default defineConfig({
    plugins: [react()],
    server: {
        port: 4330,
        proxy: {
            '/api': 'http://localhost:8080',
        },
    },
})
