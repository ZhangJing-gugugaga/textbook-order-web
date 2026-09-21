import { defineConfig, devices } from '@playwright/test'

/**
 * 端到端测试（SPEC §10 / 评审 P0-3）。
 *
 * 范围：真实构建产物（`vite build` + `vite preview`，走部署子路径 `/textbook/`）
 * + 真实路由/守卫/store/组件，**接口层用 Playwright 路由拦截替换为内存桩**
 * （`e2e/fixtures/api.ts`）。这样 CI 无需后端与数据库即可验证：
 * 五角色登录 → 落地页解析 → 侧边栏菜单过滤 → 按钮级权限 → 主链路走查 → 越权矩阵。
 *
 * 后端联调的真实数据校验仍由跨仓库脚手架 `integration.mjs` 承担（见 README）。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 8_000 },

  use: {
    // 与部署一致：子路径 /textbook/（vite.config.ts 的 base 默认值）
    baseURL: 'http://127.0.0.1:4173/textbook/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'zh-CN',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // 先构建再预览：E2E 跑的是可交付产物，同时验证 base 子路径配置
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/textbook/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
