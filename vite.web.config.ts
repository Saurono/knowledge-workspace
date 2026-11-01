import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: { outDir: "dist-web", rolldownOptions: { input: path.resolve(__dirname, "web.html") } },
  server: { port: 1422, strictPort: true, proxy: { "/api": { target: "http://127.0.0.1:4317", changeOrigin: false } } },
})
