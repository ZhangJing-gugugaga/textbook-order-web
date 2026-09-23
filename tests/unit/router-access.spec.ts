import { describe, expect, it } from 'vitest'
import { canAccessRoute } from '@/router/access'
import { routes, type AppRouteMeta } from '@/router/routes'

/**
 * 页面可访问判定（守卫 / 侧边栏菜单 / 落地页解析三处共用）。
 *
 * 回归背景（2026-09-22 线上缺陷）：教材室超管在后端持有「除供货商外全部」权限，
 * 其中含 `order:form:submit`（教师填报）、`student:order:submit`（学生选购）、
 * `export:signature:create`（秘书签字版）等角色专属权限。只按权限码过滤，
 * 超管侧边栏就会渲染出「学院秘书 / 任课老师 / 学生」三个别角色分组。
 */

/** 后端 data-permission.sql 中 ADMIN 的实际权限集（= 37 条 − 供货商 2 条） */
const ADMIN_PERMISSIONS = [
  'semester:semester:manage',
  'semester:semester:activate',
  'semester:window:manage',
  'semester:window:view',
  'user:account:manage',
  'user:account:reset',
  'org:college:manage',
  'org:major:manage',
  'org:class:manage',
  'textbook:book:manage',
  'textbook:book:import',
  'course:course:manage',
  'course:teacher:manage',
  'people:student:import',
  'people:teacher:import',
  'order:form:submit',
  'order:form:view:self',
  'order:form:view:college',
  'order:form:view:all',
  'order:form:review',
  'student:order:submit',
  'student:order:view:self',
  'student:order:view:all',
  'change:request:submit',
  'change:request:review',
  'import:batch:view',
  'export:order:create',
  'export:signature:create',
  'export:student:create',
  'export:notice:create',
  'notice:task:manage',
  'notice:task:view',
  'dashboard:stat:view',
  'config:config:manage',
  'audit:log:view',
]

/** 取路由 meta 的辅助（按 path 定位） */
function metaOf(path: string): AppRouteMeta | undefined {
  for (const top of routes) {
    for (const child of (top.children ?? []) as { path: string; meta?: AppRouteMeta }[]) {
      if (child.path === path) return child.meta
    }
  }
  return undefined
}

describe('canAccessRoute 权限码 + 角色归属双重校验', () => {
  it('未声明 permission / roles 的页面：任何人可访问', () => {
    expect(canAccessRoute(undefined, [], [])).toBe(true)
    expect(canAccessRoute({ title: 'x' }, [], [])).toBe(true)
  })

  it('仅声明 permission：按权限码放行，不限角色', () => {
    const meta: AppRouteMeta = { title: 'x', permission: 'a:b:c' }
    expect(canAccessRoute(meta, ['a:b:c'], [])).toBe(true)
    expect(canAccessRoute(meta, [], [])).toBe(false)
  })

  it('仅声明 roles：按角色放行，不限权限码', () => {
    const meta: AppRouteMeta = { title: 'x', roles: ['TEACHER'] }
    expect(canAccessRoute(meta, [], ['TEACHER'])).toBe(true)
    expect(canAccessRoute(meta, [], ['ADMIN'])).toBe(false)
  })

  it('同时声明：两条都满足才放行（有权限无角色 → 拒绝）', () => {
    const meta: AppRouteMeta = { title: 'x', permission: 'order:form:submit', roles: ['TEACHER'] }
    expect(canAccessRoute(meta, ['order:form:submit'], ['TEACHER'])).toBe(true)
    expect(canAccessRoute(meta, ['order:form:submit'], ['ADMIN'])).toBe(false)
    expect(canAccessRoute(meta, [], ['TEACHER'])).toBe(false)
  })

  it('roles 数组为多角色时任一命中即放行（异动申请：秘书 + 教师）', () => {
    const meta = metaOf('change-requests')
    expect(canAccessRoute(meta, ['change:request:submit'], ['SECRETARY'])).toBe(true)
    expect(canAccessRoute(meta, ['change:request:submit'], ['TEACHER'])).toBe(true)
    expect(canAccessRoute(meta, ['change:request:submit'], ['ADMIN'])).toBe(false)
  })
})

describe('回归（2026-09-22 线上缺陷）：超管的侧边栏不得出现别角色菜单', () => {
  /** 侧边栏可见项 = 非 hidden 且通过 canAccessRoute */
  function visibleMenuTitles(permissions: string[], roles: string[]): string[] {
    return routes
      .flatMap((top) => (top.children ?? []) as { path: string; meta?: AppRouteMeta }[])
      .filter((child) => !child.meta?.hidden && canAccessRoute(child.meta, permissions, roles))
      .map((child) => child.meta!.title)
  }

  const ADMIN_ONLY_TITLES = [
    '数据看板',
    '账号管理',
    '组织管理',
    '学期与窗口引擎',
    '教材库',
    '课程与任课管理',
    '学生/教师管理',
    '复核工作台',
    '征订数据',
    '导出中心',
    '通知管理',
    '审计日志',
  ]

  it('超管（真实后端权限集）只看到教材室管理台菜单，共 12 项', () => {
    const titles = visibleMenuTitles(ADMIN_PERMISSIONS, ['ADMIN'])
    expect(titles).toEqual(ADMIN_ONLY_TITLES)
  })

  it('超管不得看到教师/学生/秘书的自助页（缺陷原样复现点）', () => {
    const titles = visibleMenuTitles(ADMIN_PERMISSIONS, ['ADMIN'])
    for (const forbidden of [
      '我的课程',
      '填报教材',
      '我的提交记录',
      '选书',
      '我的选购记录',
      '本院征订记录',
      '本院导出（签字版）',
      '窗口状态',
      '异动申请',
      '订购清单',
      '清单导出',
    ]) {
      expect(titles).not.toContain(forbidden)
    }
  })

  it('超管仍保留窗口横幅所需的 semester:window:view（仅隐藏「窗口状态」页面，不撤权限）', () => {
    // 窗口横幅依赖该权限（stores/window.ts 的 canView），因此后端不得收回，
    // 前端用 roles 约束把「窗口状态」页面从超管菜单里摘掉
    expect(ADMIN_PERMISSIONS).toContain('semester:window:view')
    expect(visibleMenuTitles(ADMIN_PERMISSIONS, ['ADMIN'])).not.toContain('窗口状态')
  })

  it('各角色菜单项与 SPEC §4 页面归属一致', () => {
    // 秘书即便持有 export:order:create，也不得看到「导出中心」——该页归属超管，
    // 秘书进入会因页面拉取超管专属数据而吃 403 被弹走（矩阵走查发现）
    expect(
      visibleMenuTitles(
        [
          'semester:window:view',
          'order:form:view:college',
          'export:signature:create',
          'change:request:submit',
          'export:order:create',
        ],
        ['SECRETARY'],
      ),
    ).toEqual(['本院征订记录', '本院导出（签字版）', '窗口状态', '异动申请'])
    expect(
      visibleMenuTitles(
        ['semester:window:view', 'order:form:submit', 'order:form:view:self'],
        ['TEACHER'],
      ),
    ).toEqual(['我的课程', '填报教材', '我的提交记录'])
    expect(
      visibleMenuTitles(
        ['semester:window:view', 'student:order:submit', 'student:order:view:self'],
        ['STUDENT'],
      ),
    ).toEqual(['选书', '我的选购记录'])
    expect(
      visibleMenuTitles(['supplier:order:view', 'supplier:order:export'], ['SUPPLIER']),
    ).toEqual(['订购清单', '清单导出'])
  })

  it('多角色（教师+秘书）同时看到两组菜单', () => {
    const titles = visibleMenuTitles(
      [
        'semester:window:view',
        'order:form:submit',
        'order:form:view:self',
        'change:request:submit',
      ],
      ['TEACHER', 'SECRETARY'],
    )
    expect(titles).toContain('我的课程')
    expect(titles).toContain('异动申请')
    expect(titles).not.toContain('账号管理')
  })
})
