import type { Router } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useNoticeStore } from '@/stores/notice'
import { useWindowStore } from '@/stores/window'
import { routes, type AppRouteMeta } from './routes'
import { PERMISSIONS } from '@/utils/constants'

/** 各角色的工作台首页（PRD 功能 1：按角色进入对应工作台） */
const HOME_BY_PERMISSION: { permission: string; path: string }[] = [
  { permission: PERMISSIONS.DASHBOARD_VIEW, path: '/dashboard' },
  { permission: PERMISSIONS.ORDER_FORM_VIEW, path: '/my-courses' },
  { permission: PERMISSIONS.STUDENT_ORDER_FILL, path: '/book-select' },
  { permission: PERMISSIONS.COLLEGE_DATA_VIEW, path: '/college-records' },
  { permission: PERMISSIONS.SUPPLIER_LIST_VIEW, path: '/purchase-list' },
]

/** 首个可访问的落地页（登录/切换身份后使用） */
export function resolveLandingPath(permissions: string[]): string {
  const preferred = HOME_BY_PERMISSION.find((item) => permissions.includes(item.permission))
  if (preferred) return preferred.path

  const first = routes
    .flatMap((route) => (route.children ?? []) as { path: string; meta?: AppRouteMeta }[])
    .find((child) => {
      const perm = child.meta?.permission
      return !child.meta?.hidden && (!perm || permissions.includes(perm))
    })
  return first ? `/${first.path}` : '/403'
}

/**
 * 路由守卫（SPEC §4）：
 * 未登录 → /login；must_change_password → 强制改密（不可跳过）；
 * 权限码缺失 → /403。
 */
export function setupRouterGuards(router: Router) {
  router.beforeEach(async (to) => {
    const auth = useAuthStore()
    const notice = useNoticeStore()
    const windowStore = useWindowStore()

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
}

export default setupRouterGuards
