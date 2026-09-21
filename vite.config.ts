import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

/**
 * 构建与环境（SPEC §3）：
 * - base：默认走环境变量 VITE_BASE；未设置时按模式取默认值
 *   （development=/，其余=/textbook/），代码零域名硬编码
 * - 接口基础地址：前端一律相对路径 '/api'（硬约束）；
 *   dev/preview 由 Vite proxy 转发到 VITE_PROXY_TARGET（真实后端），
 *   试运行/移交环境由 Nginx 反代 /api/ → 后端 8080。
 *
 * 说明：本地开发无需任何 env 文件即可开箱运行（development 模式默认 base=/ +
 * 代理到 http://127.0.0.1:8080）；trial / school 的差异见 `.env.trial` / `.env.school`。
 *
 * 浏览器兼容矩阵（SPEC §3）：Chrome ≥ 87 / Edge ≥ 88 / Firefox ≥ 78 / Safari ≥ 14，
 * 与 `package.json` 的 browserslist 及 postcss.config.js 的 autoprefixer 保持一致。
 */

/** 构建目标：与 browserslist 同源声明，避免「声明一套、产物另一套」 */
export const BUILD_TARGET = ['chrome87', 'edge88', 'firefox78', 'safari14'] as const

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isDev = mode === 'development'
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string
  }
  const base = env.VITE_BASE || (isDev ? '/' : '/textbook/')
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://127.0.0.1:8080'

  const proxy = {
    '/api': {
      target: proxyTarget,
      changeOrigin: true,
    },
  }

  return {
    base,
    // 应用版本注入：错误上报（utils/monitor.ts）带版本号，便于按版本定位问题
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      vue(),
      // Element Plus 按需引入：模板中的 <el-*> 与 v-loading 指令按需解析并注入样式，
      // 取代原先 `app.use(ElementPlus)` + 全量 `element-plus/dist/index.css`（约 1.27MB）
      AutoImport({
        resolvers: [ElementPlusResolver()],
        dts: 'src/types/auto-imports.d.ts',
      }),
      Components({
        // 本地组件仍走显式 import（可 grep、依赖清晰），此处只接管 Element Plus
        dirs: [],
        resolvers: [ElementPlusResolver()],
        dts: 'src/types/components.d.ts',
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      host: '127.0.0.1',
      proxy,
    },
    preview: {
      port: 4173,
      host: '127.0.0.1',
      proxy,
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      // 生产默认不出 sourcemap；CI/预发可用 VITE_SOURCEMAP=1 打开（配合监控上报）
      sourcemap: env.VITE_SOURCEMAP === '1',
      target: [...BUILD_TARGET],
      // 回到默认阈值：任何 chunk 超过 500KB 都应重新评估，而不是把告警压掉
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        output: {
          /**
           * 只对「确定被使用」的基础库做显式分包，用对象形式而非函数形式。
           *
           * 实测（rollup 4.63）：函数形式 `manualChunks(id) => 'vendor-element-plus'` 会把
           * 命中该规则的模块标记为「显式纳入」，**绕过 tree-shaking** —— Element Plus
           * 未被使用的 800+ 个模块（ElCascader / ElCarousel / …）会整体进包，
           * 产物体积从 205KB 反弹到 951KB。对象形式只提升列出的入口模块，不影响摇树。
           *
           * Element Plus 不在此列：它由路由级动态 import 自然切分（el-table 等公共
           * 依赖由 Vite 自动拆为共享 chunk）。
           */
          manualChunks: {
            'vendor-vue': ['vue', 'vue-router', 'pinia'],
            'vendor-axios': ['axios'],
          },
        },
      },
    },
  }
})
