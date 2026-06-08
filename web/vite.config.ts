import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In production the Go binary serves this build under /_app/ (so the UI's own
// JS/CSS never collide with the blog's site-root content assets like /posts/...
// or /assets/uploads/...). Dev keeps base '/' and proxies to the Go service.
export default defineConfig(({ command }) => ({
    base: command === 'build' ? '/_app/' : '/',
    plugins: [react()],
    server: {
        port: 4330,
        host: true, // bind 0.0.0.0 so phones/other devices on the LAN can reach it
        proxy: {
            // API + the blog's site-relative assets (served from repo/public by
            // the Go service) so images like /posts/<slug>/x.svg resolve here.
            '/api': 'http://localhost:8080',
            '/posts': 'http://localhost:8080',
            '/assets': 'http://localhost:8080',
        },
    },
}))
