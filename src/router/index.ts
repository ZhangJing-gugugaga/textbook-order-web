import { createRouter, createWebHistory } from 'vue-router'
import routes from './routes'
import { setupRouterGuards } from './guards'

const router = createRouter({
  // 必须用 Vite 注入的 BASE_URL（与 build.base 同源），不能用自定义的 VITE_BASE：
  // 后者只在 .env.trial / .env.school 中定义，默认 `npm run build`（production 模式）
  // 下为 undefined —— 会出现「资源从 /textbook/ 加载、路由却按 / 解析」的错配，
  // 子路径部署时刷新页面即 404。
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

setupRouterGuards(router)

export default router
