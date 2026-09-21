import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteMockServe } from 'vite-plugin-mock'

/**
 * 构建与环境（SPEC §3）：
 * - base：默认走环境变量 VITE_BASE；未设置时按模式取默认值
 *   （development=/，其余=/textbook/），代码零域名硬编码
 * - dev 代理 '/api' → VITE_PROXY_TARGET（仅真实后端时启用）
 * - vite-plugin-mock 仅本地开发环境挂 /api 前缀，支撑 M1 契约冻结期开发；
 *   契约冻结后 Vite proxy 切真实后端，页面代码零改动（Q5）
 *
 * 说明：本地开发不需要任何 env 文件即可开箱运行（development 模式默认挂 mock + 根路径），
 * 因此仓库不落 `.env` / `.env.development`；trial / school 的差异见 `.env.trial` / `.env.school`。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isDev = mode === 'development'
  const base = env.VITE_BASE || (isDev ? '/' : '/textbook/')
  // 显式配置优先；未配置时仅本地开发环境启用 mock
  const useMock = env.VITE_MOCK ? env.VITE_MOCK === 'true' : isDev
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://127.0.0.1:8080'

  return {
    base,
    plugins: [
      vue(),
      useMock
        ? viteMockServe({
            mockPath: 'mock',
            configPath: 'vite.mock.config.ts',
            enable: true,
            logger: true,
            ignore: /^_/,
          })
        : undefined,
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      host: '127.0.0.1',
      proxy: useMock
        ? undefined
        : {
            '/api': {
              target: proxyTarget,
              changeOrigin: true,
            },
          },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: false,
      chunkSizeWarningLimit: 1600,
    },
  }
})
