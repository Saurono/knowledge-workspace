import path from "path"
import { readFileSync } from "fs"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { viteSingleFile } from "vite-plugin-singlefile"
import tailwindcss from "@tailwindcss/vite"

const host = process.env.TAURI_DEV_HOST

// Read version from package.json at config-load time so the Settings
// UI can show the running app version without duplicating the string.
const pkgJson = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"))

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === "demo" ? [viteSingleFile()] : [])],

  build: mode === "demo"
    ? {
        outDir: "dist-preview",
        rolldownOptions: { input: path.resolve(__dirname, "preview.html") },
      }
    : undefined,

  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },

  define: {
    __APP_VERSION__: JSON.stringify(pkgJson.version),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/.git/**", "**/mcp-server/**", "**/dist/**"],
    // 默认 5s 在 CI runner 上不够：server 测试大量走真实 HTTP + SQLite，
    // Windows runner 上写 200 条、登录限流这类用例会超 5s（不是挂死，是机器慢）。
    // 断言语义不变，只是给足执行时间。
    testTimeout: 20_000,
    // Loads .env.test.local into process.env for real-LLM tests.
    // The loader itself is a no-op if the file is absent, so this is
    // safe to keep on for every test run.
    setupFiles: ["./src/test-helpers/load-test-env.ts"],
  },
}))
