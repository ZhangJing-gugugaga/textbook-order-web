import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { configureHttp } from './api/http'
import { useAuthStore } from './stores/auth'
import { useConfigStore } from './stores/config'
import { useNoticeStore } from './stores/notice'
import { useTaskStore } from './stores/task'
import { useWindowStore } from './stores/window'
import { registerAppIcons } from './utils/icons'
import { installGlobalErrorHandlers } from './utils/monitor'
import { getRefreshToken, onRefreshTokenChange, setRefreshToken } from './utils/session'
import './styles/index.css'

/**
 * 应用入口（SPEC §3 / §8）：
 * - Element Plus 走按需引入（unplugin-vue-components / unplugin-auto-import，见 vite.config.ts）：
 *   入口不再 `app.use(ElementPlus)`，也不再引入全量 `element-plus/dist/index.css`（约 356KB）
 * - 图标按需注册（src/utils/icons.ts），不再全量注册约 2000 个图标
 * - 本地组件一律在页面内显式 import，不做全局注册（可 grep、依赖清晰）
 */
// 未捕获错误与未处理 Promise 拒绝的全局兜底（可替换上报实现，见 utils/monitor.ts）
installGlobalErrorHandlers()

const app = createApp(App)

app.use(createPinia())
app.use(router)
registerAppIcons(app)

/* ---------------- 接口消费层钩子装配（SPEC §5 / §6） ---------------- */
const auth = useAuthStore()
const notice = useNoticeStore()
const task = useTaskStore()
const windowStore = useWindowStore()
const config = useConfigStore()

/** 强制登出：清全部 store → 提示 → 跳登录页 */
function forceLogout(hint: string) {
  notice.reset()
  task.stopAll()
  windowStore.stopPolling()
  config.$reset()
  auth.resetSession()
  ElMessage.error(hint)
  if (router.currentRoute.value.path !== '/login') {
    void router.replace({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } })
  }
}

configureHttp({
  getAccessToken: () => auth.accessToken,
  // 多标签页：始终读持久层，避免 A 页轮换后 B 页仍用陈旧 refresh token 被强制登出
  getRefreshToken,
  onTokens: (tokens) => {
    auth.accessToken = tokens.accessToken
    if (tokens.refreshToken) {
      auth.refreshToken = tokens.refreshToken
      setRefreshToken(tokens.refreshToken)
    }
  },
  onForceLogout: (message) => forceLogout(message),
  onForbidden: () => {
    if (router.currentRoute.value.path !== '/403') void router.replace('/403')
  },
  onFirstLoginRequired: () => {
    // 首登拦截：跳首登引导（改密弹窗），不跳登录页也不跳 403
    auth.mustChangePassword = true
    if (router.currentRoute.value.path !== '/profile') {
      void router.replace({ path: '/profile', query: { forceChange: '1' } })
    }
  },
})

// 其他标签页轮换 refresh token 时同步内存态（避免本页继续用旧值）
onRefreshTokenChange((token) => {
  if (!token) {
    auth.resetSession()
    return
  }
  auth.refreshToken = token
})

app.mount('#app')

// 开发期联调入口：便于在浏览器控制台核对会话态与权限码（生产构建不注入）
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__app = {
    auth,
    notice,
    task,
    windowStore,
    config,
    router,
  }
}
