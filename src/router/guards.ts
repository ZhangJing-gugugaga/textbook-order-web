import type { Router } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import { useNoticeStore } from '@/stores/notice'
import { useWindowStore } from '@/stores/window'
import { routes, type AppRouteMeta } from './routes'
import { APP_NAME, PERMISSIONS } from '@/utils/constants'

/** 各角色的工作台首页（PRD 功能 1：按角色进入对应工作台） */
const HOME_BY_PERMISSION: { permission: string; path: string }[] = [
  { permission: PERMISSIONS.DASHBOARD_VIEW, path: '/dashboard' },
  { permission: PERMISSIONS.ORDER_FORM_SUBMIT, path: '/my-courses' },
  { permission: PERMISSIONS.STUDENT_ORDER_SUBMIT, path: '/book-select' },
  { permission: PERMISSIONS.ORDER_FORM_VIEW_COLLEGE, path: '/college-records' },
  { permission: PERMISSIONS.SUPPLIER_ORDER_VIEW, path: '/purchase-list' },
]

/** 全部可见（非 hidden、非分组外）路由，用于兜底解析 */
function visibleRoutes(): { path: string; meta?: AppRouteMeta }[] {
  return routes.flatMap(
    (route) => (route.children ?? []) as { path: string; meta?: AppRouteMeta }[],
  )
}

/**
 * 首个可访问的落地页（登录 / 刷新根路径 / 切换身份后统一使用）。
 *
 * 这是「按角色进入对应工作台」的唯一真源：根路径 `/` 不再做静态 redirect
 * （静态 redirect 到 /dashboard 会让教师/学生被权限守卫拦到 /403）。
 */
export function resolveLandingPath(permissions: string[]): string {
  const preferred = HOME_BY_PERMISSION.find((item) => permissions.includes(item.permission))
  if (preferred) return preferred.path

  const first = visibleRoutes().find((child) => {
    const perm = child.meta?.permission
    return !child.meta?.hidden && (!perm || permissions.includes(perm))
  })
  return first ? `/${first.path}` : '/403'
}

/** 当前路径对应的页面标题（document.title） */
function resolveTitle(path: string): string {
  const match = visibleRoutes().find((child) => `/${child.path}` === path)
  return match?.meta?.title ? `${match.meta.title} · ${APP_NAME}` : APP_NAME
}

/**
 * 路由守卫（SPEC §4）：
 * 首屏先 bootstrap（用 refresh token 静默恢复会话）→ 未登录跳 /login；
 * 首登未改密 → 强制 /profile（业务接口一律 403 FIRST_LOGIN_REQUIRED，前置拦截更友好）；
 * 根路径 → 按权限解析落地页；
 * 权限码缺失 → /403。
 */
export function setupRouterGuards(router: Router) {
  router.beforeEach(async (to) => {
    const auth = useAuthStore()
    const notice = useNoticeStore()
    const config = useConfigStore()
    const windowStore = useWindowStore()

    // 首屏会话恢复：access token 仅在内存，刷新页面须用 refresh token 换新
    if (!auth.ready) {
      await auth.bootstrap()
      if (auth.isLoggedIn) {
        // system_config 为全局展示依赖，登录后先取（失败回内置默认值）
        void config.load()
      }
    }

    if (to.path === '/login') {
      if (auth.isLoggedIn && !auth.mustChangePassword) return resolveLandingPath(auth.permissions)
      return true
    }

    if (!auth.isLoggedIn) {
      return { path: '/login', query: { redirect: to.fullPath } }
    }

    // 首登强制改密：未改密只允许 /profile，其余一律强制跳转（不可跳过）
    if (auth.mustChangePassword && to.path !== '/profile') {
      return { path: '/profile', query: { forceChange: '1' } }
    }

    // 根路径 / 部署子路径：按权限码解析落地页（教师→我的课程，学生→选书，供货商→订购清单…）
    if (to.path === '/') {
      return resolveLandingPath(auth.permissions)
    }

    const permission = (to.meta as unknown as AppRouteMeta | undefined)?.permission
    if (permission && !auth.has(permission)) {
      return { path: '/403' }
    }

    // 进入页面拉取窗口状态（PRD 功能 2：进入页面拉取 + 轮询）
    void windowStore.fetch()
    // 未确认通知：打开即拉取（失败 fail-open，见 store）
    if (!notice.loaded) void notice.fetchUnconfirmed()

    return true
  })

  // 页面标题（此前 meta.title 只用于侧边栏，浏览器标签页始终显示 index.html 的静态标题）
  router.afterEach((to) => {
    document.title = resolveTitle(to.path)
  })
}

export default setupRouterGuards
