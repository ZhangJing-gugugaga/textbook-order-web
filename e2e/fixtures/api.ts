import type { Page, Route } from '@playwright/test'

/**
 * E2E 接口桩：在浏览器网络层拦截 `/api/**`，按角色返回固定响应。
 *
 * 这样 E2E 无需后端与数据库即可覆盖前端的真实逻辑：
 * 路由守卫、落地页解析、菜单过滤、按钮级权限、错误码分流、阻塞通知弹窗。
 * 桩数据只保留断言所需的字段（其余字段前端不读）。
 */

export const ROLES = {
  ADMIN: 'ADMIN',
  SECRETARY: 'SECRETARY',
  TEACHER: 'TEACHER',
  STUDENT: 'STUDENT',
  SUPPLIER: 'SUPPLIER',
} as const

export type RoleCode = (typeof ROLES)[keyof typeof ROLES]

/** 各角色的权限码（与后端 sys_permission 冻结值一致；取值见 src/utils/constants.ts） */
export const PERMISSIONS_BY_ROLE: Record<RoleCode, string[]> = {
  ADMIN: [
    'dashboard:stat:view',
    'user:account:manage',
    'user:account:reset',
    'org:college:manage',
    'org:major:manage',
    'org:class:manage',
    'semester:semester:manage',
    'semester:semester:activate',
    'semester:window:manage',
    'semester:window:view',
    'textbook:book:manage',
    'textbook:book:import',
    'course:course:manage',
    'course:teacher:manage',
    'people:student:import',
    'people:teacher:import',
    'import:batch:view',
    'order:form:view:all',
    'order:form:review',
    'student:order:view:all',
    'change:request:review',
    'export:order:create',
    'export:student:create',
    'export:notice:create',
    'notice:task:manage',
    'notice:task:view',
    'config:config:manage',
    'audit:log:view',
  ],
  SECRETARY: [
    'semester:window:view',
    'order:form:view:college',
    'export:signature:create',
    'change:request:submit',
    'order:form:view:self',
  ],
  TEACHER: ['semester:window:view', 'order:form:submit', 'order:form:view:self'],
  STUDENT: ['semester:window:view', 'student:order:submit', 'student:order:view:self'],
  SUPPLIER: ['supplier:order:view', 'supplier:order:export'],
}

/** 各角色登录后的预期落地页（router/guards.ts 的 resolveLandingPath） */
export const LANDING_BY_ROLE: Record<RoleCode, string> = {
  ADMIN: '/dashboard',
  TEACHER: '/my-courses',
  STUDENT: '/book-select',
  SECRETARY: '/college-records',
  SUPPLIER: '/purchase-list',
}

/** 各角色侧边栏**应当**出现的菜单项标题 */
export const MENU_BY_ROLE: Record<RoleCode, string[]> = {
  ADMIN: ['数据看板', '账号管理', '组织管理', '教材库', '征订数据', '导出中心'],
  SECRETARY: ['本院征订记录', '本院导出（签字版）', '窗口状态', '异动申请'],
  TEACHER: ['我的课程', '填报教材', '我的提交记录'],
  STUDENT: ['选书', '我的选购记录'],
  SUPPLIER: ['订购清单', '清单导出'],
}

/** 各角色**不应**出现的菜单项（越权可见性回归） */
export const FORBIDDEN_MENU: Record<RoleCode, string[]> = {
  ADMIN: [],
  SECRETARY: ['数据看板', '账号管理', '教材库'],
  TEACHER: ['数据看板', '账号管理', '本院征订记录'],
  STUDENT: ['数据看板', '我的课程', '订购清单'],
  SUPPLIER: ['数据看板', '选书', '我的课程'],
}

export const USER_NO_BY_ROLE: Record<RoleCode, string> = {
  ADMIN: 'admin001',
  SECRETARY: 'sec001',
  TEACHER: 't1001',
  STUDENT: 's2023001',
  SUPPLIER: 'sup001',
}

export const NAME_BY_ROLE: Record<RoleCode, string> = {
  ADMIN: '教材室管理员',
  SECRETARY: '学院秘书',
  TEACHER: '任课教师',
  STUDENT: '学生甲',
  SUPPLIER: '供货商',
}

export interface MockOptions {
  /** 首登未改密（验证强制改密拦截） */
  mustChangePassword?: boolean
  /** 未确认通知条数（验证阻塞弹窗） */
  unconfirmedNotices?: number
  /** 窗口状态 */
  windowStatus?: 'not_open' | 'open' | 'closed'
  /** 业务接口统一失败（验证错误态与重试入口） */
  failBusiness?: boolean
}

interface Session {
  role: RoleCode
  accessToken: string
}

function ok(data: unknown) {
  return { code: '0', message: 'ok', data }
}

function page1(list: unknown[] = []) {
  return { list, total: list.length, page: 1, size: 10 }
}

/** 返回一页与业务无关的空结果，够页面渲染出「暂无数据」 */
function emptyForPath(pathname: string): unknown {
  if (pathname.endsWith('/me/permissions')) return []
  if (pathname.endsWith('/semester/window/status')) return null
  return page1()
}

/**
 * 安装接口桩。`loginRole` 指定登录成功后返回的身份；
 * 未登录时所有业务接口返回 401 TOKEN_EXPIRED 的包络。
 */
export async function mockApi(page: Page, loginRole: RoleCode, options: MockOptions = {}) {
  const session: Session | null = null
  let current: Session | null = session
  let loggedIn = false

  await page.route('**/api/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api/, '')
    const method = request.method()

    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })

    // ---- 认证 ----
    if (path === '/auth/login' && method === 'POST') {
      loggedIn = true
      current = { role: loginRole, accessToken: `e2e-access-${loginRole}` }
      return json(
        200,
        ok({
          accessToken: current.accessToken,
          refreshToken: `e2e-refresh-${loginRole}`,
          expiresIn: 1800,
          roles: [loginRole],
          currentRole: loginRole,
          mustChangePassword: options.mustChangePassword ? 1 : 0,
          firstLoginVerified: options.mustChangePassword ? 0 : 1,
        }),
      )
    }

    if (path === '/auth/refresh' && method === 'POST') {
      loggedIn = true
      current = { role: loginRole, accessToken: `e2e-access-${loginRole}-refreshed` }
      return json(
        200,
        ok({
          accessToken: current.accessToken,
          refreshToken: `e2e-refresh-${loginRole}`,
          expiresIn: 1800,
          roles: [loginRole],
          currentRole: loginRole,
          mustChangePassword: 0,
          firstLoginVerified: 1,
        }),
      )
    }

    if (path === '/auth/logout') {
      loggedIn = false
      current = null
      return json(200, ok(null))
    }

    if (path === '/me') {
      if (!loggedIn) return json(401, { code: 'TOKEN_EXPIRED', message: '登录已过期' })
      const role = current?.role ?? loginRole
      return json(
        200,
        ok({
          id: 1,
          userNo: USER_NO_BY_ROLE[role],
          name: NAME_BY_ROLE[role],
          roles: [role],
          currentRole: role,
          permissions: PERMISSIONS_BY_ROLE[role],
          mustChangePassword: options.mustChangePassword ? 1 : 0,
          firstLoginVerified: options.mustChangePassword ? 0 : 1,
        }),
      )
    }

    if (path === '/me/permissions') {
      const role = current?.role ?? loginRole
      return json(200, ok(PERMISSIONS_BY_ROLE[role]))
    }

    // ---- 未登录：业务接口一律 401（与真实后端一致） ----
    if (!loggedIn) {
      return json(401, { code: 'TOKEN_EXPIRED', message: '登录已过期，请重新登录' })
    }

    if (options.failBusiness) {
      return json(500, { code: 'SERVER_ERROR', message: '服务开小差了，请稍后重试' })
    }

    // ---- 全局展示依赖 ----
    if (path === '/semester/window/status') {
      const status = options.windowStatus ?? 'open'
      const now = Date.now()
      return json(
        200,
        ok({
          semesterId: 1,
          semesterName: '2026-2027 学年第一学期',
          windowStatus: status,
          windowStart: new Date(now - 86_400_000).toISOString(),
          windowEnd: new Date(now + 86_400_000).toISOString(),
          serverTime: new Date(now).toISOString(),
          channelOpen: 1,
        }),
      )
    }

    if (path === '/notice/unconfirmed') {
      const count = options.unconfirmedNotices ?? 0
      return json(
        200,
        ok(
          Array.from({ length: count }, (_, index) => ({
            taskId: 900 + index,
            title: `E2E 通知 ${index + 1}`,
            content: '请在窗口期内完成填报。',
            source: 'manual',
            createdAt: '2026-09-01 10:00',
          })),
        ),
      )
    }

    if (path === '/admin/config') {
      return json(200, ok([]))
    }

    if (path === '/admin/semester') {
      return json(200, ok([]))
    }

    if (path === '/admin/college' || path === '/admin/major' || path === '/admin/class') {
      return json(200, ok([]))
    }

    if (path === '/teacher/my-courses') {
      return json(
        200,
        ok([
          {
            classId: 11,
            className: '软件工程 2301',
            courses: [{ courseId: 501, courseName: '数据结构' }],
          },
        ]),
      )
    }

    if (path === '/teacher/order-forms') {
      return json(200, ok([]))
    }

    if (path === '/student/book-list') {
      return json(
        200,
        ok([
          {
            textbookId: 1,
            title: '数据结构与算法',
            isbn: '9787111000001',
            price: 59,
            required: true,
            delisted: false,
          },
        ]),
      )
    }

    if (path === '/student/orders') {
      return json(200, ok([]))
    }

    if (path === '/supplier/orders') {
      return json(
        200,
        ok([
          { collegeId: 1, collegeName: '计算机学院', items: [{ title: '数据结构', quantity: 30 }] },
        ]),
      )
    }

    // 其余业务接口统一回一页空结果
    return json(200, ok(emptyForPath(path)))
  })
}

/** 通过 UI 登录（走真实登录页表单） */
export async function loginAs(page: Page, role: RoleCode) {
  await page.goto('./login')
  await page.getByPlaceholder('学号 / 工号').fill(USER_NO_BY_ROLE[role])
  await page.getByPlaceholder('密码').fill('E2e@12345')
  await page.getByRole('button', { name: '登录' }).click()
}
