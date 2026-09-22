import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

/**
 * 单测配置：与 vite.config.ts 保持同一套按需引入插件，
 * 否则组件测试里 `<el-*>` 与 Element Plus 程序式 API 会解析失败。
 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

export default defineConfig({
  // 与 vite.config.ts 同源注入，测试环境与产物一致（utils/monitor.ts 读取）
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: 'src/types/auto-imports.d.ts',
    }),
    Components({
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
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.spec.ts'],
    // Element Plus 按需引入会注入 `element-plus/es/components/*/style/css` 副作用导入；
    // 若把 element-plus 外部化交给 Node 加载，会因 .css 扩展名报错。内联后走 Vite 管道。
    server: {
      deps: {
        inline: ['element-plus'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      /**
       * 覆盖率门禁的**适用范围**（SPEC §10）：
       * 单测负责的是可独立断言的逻辑层（接口层 / store / 工具 / 组合式函数 / 路由 / 组件），
       * 26 个页面视图（约 5.4k 行）由 Playwright E2E 覆盖（`npm run test:e2e`），
       * 不纳入单测覆盖率门禁——否则数字只会反映「视图有没有被 import 过」，
       * 既不诚实也不驱动质量。
       */
      include: [
        // 接口层只统计 http.ts（拦截器/401 分流/包络解包等真实逻辑）；
        // src/api 下其余模块是 http 的一行转发，无逻辑可断言，由 E2E 端到端覆盖
        'src/api/http.ts',
        'src/stores/**/*.ts',
        'src/utils/**/*.ts',
        'src/composables/**/*.ts',
        'src/router/**/*.ts',
        'src/components/**/*.vue',
      ],
      exclude: ['src/types/**', 'src/env.d.ts'],
      /**
       * 门禁锁定实测基线（2026-09-22：statements 50.5% / branches 46.4% / functions 45.3% / lines 51.4%），
       * 各留约 2 个百分点余量。门槛的作用是**防回归**：新增未测逻辑会把比例拉下来并让 CI 变红。
       * （上一版基线 45/42/41/45，本次补齐 A1–A7 契约适配的单测后上调，**只许上调不得下调**。）
       *
       * 数字偏低的已知原因（不是「门禁形同虚设」，是当前覆盖面的事实）：
       * - 26 个页面视图不在此范围（由 Playwright E2E 覆盖，见 `npm run test:e2e`）；
       * - `router/routes.ts` 是纯路由表、`router/index.ts` 是装配代码，无逻辑可断言；
       * - `ExportButton` / `RoleSwitcher` / `WindowBanner` / `ForceChangePasswordModal` /
       *   `useCountdown` 尚无单测（其行为由 E2E 覆盖），属待补项（见 SPEC §10 待办）。
       */
      thresholds: {
        statements: 48,
        branches: 44,
        functions: 43,
        lines: 49,
      },
    },
  },
})
