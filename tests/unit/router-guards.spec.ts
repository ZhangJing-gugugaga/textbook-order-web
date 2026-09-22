import { describe, expect, it } from 'vitest'
import { resolveLandingPath } from '@/router/guards'
import type { RoleCode } from '@/types'

/**
 * 落地页解析（SPEC §4 / PRD 功能 1：按角色进入对应工作台）。
 *
 * `resolveLandingPath` 是「按角色进入工作台」的唯一真源：根路径 `/` 不做静态
 * redirect，否则教师/学生登录后会被静态 redirect 到 /dashboard 再被权限守卫
 * 拦到 /403（回归点，见下方「教师不得落到 /dashboard」）。
 *
 * 2026-09-22 线上缺陷后补：落地页解析与守卫、菜单共用 `canAccessRoute`，
 * 因此**权限码 + 角色归属**双条件缺一不可（超管持有教师权限也不得落到教师工作台）。
 */
describe('resolveLandingPath 按角色解析落地页', () => {
  it('超级管理员（含 dashboard:stat:view + ADMIN 角色）→ /dashboard', () => {
    expect(
      resolveLandingPath(
        [
          'dashboard:stat:view',
          'user:account:manage',
          'semester:semester:manage',
          'order:form:view:all',
        ],
        ['ADMIN'],
      ),
    ).toBe('/dashboard')
  })

  it('任课教师（含 order:form:submit + TEACHER 角色）→ /my-courses', () => {
    expect(resolveLandingPath(['order:form:submit', 'order:form:view:self'], ['TEACHER'])).toBe(
      '/my-courses',
    )
  })

  it('学生（含 student:order:submit + STUDENT 角色）→ /book-select', () => {
    expect(
      resolveLandingPath(['student:order:submit', 'student:order:view:self'], ['STUDENT']),
    ).toBe('/book-select')
  })

  it('学院秘书（含 order:form:view:college + SECRETARY 角色）→ /college-records', () => {
    expect(
      resolveLandingPath(
        ['order:form:view:college', 'export:signature:create', 'semester:window:view'],
        ['SECRETARY'],
      ),
    ).toBe('/college-records')
  })

  it('供货商（含 supplier:order:view + SUPPLIER 角色）→ /purchase-list', () => {
    expect(resolveLandingPath(['supplier:order:view', 'supplier:order:export'], ['SUPPLIER'])).toBe(
      '/purchase-list',
    )
  })

  it('多角色（教师+秘书）按 HOME_BY_PERMISSION 优先级取先者 → /my-courses', () => {
    expect(
      resolveLandingPath(
        ['order:form:view:college', 'export:signature:create', 'order:form:submit'],
        ['TEACHER', 'SECRETARY'],
      ),
    ).toBe('/my-courses')
  })

  it('权限为空数组：无任何可访问路由 → /403', () => {
    expect(resolveLandingPath([], [])).toBe('/403')
  })

  it('回归：教师权限集不得解析到 /dashboard（否则被权限守卫拦到 /403）', () => {
    const teacherPermissions = ['order:form:submit', 'order:form:view:self']
    expect(teacherPermissions).not.toContain('dashboard:stat:view')
    expect(resolveLandingPath(teacherPermissions, ['TEACHER'])).not.toBe('/dashboard')
  })

  it('回归（2026-09-22 线上）：超管持有教师/学生权限时不得落到教师或学生工作台', () => {
    // 后端 ADMIN = 除供货商外全部（含 order:form:submit / student:order:submit），
    // 若无角色归属约束，落地页会按权限码命中 /my-courses —— 与线上缺陷同源
    const adminPermissions = [
      'dashboard:stat:view',
      'order:form:submit',
      'order:form:view:self',
      'student:order:submit',
      'student:order:view:self',
      'order:form:view:college',
    ]
    const adminRoles: RoleCode[] = ['ADMIN']
    expect(resolveLandingPath(adminPermissions, adminRoles)).toBe('/dashboard')
    expect(resolveLandingPath(adminPermissions, adminRoles)).not.toBe('/my-courses')
    expect(resolveLandingPath(adminPermissions, adminRoles)).not.toBe('/book-select')
  })

  it('兜底扫描同样受角色约束：超管不得兜底到教师页', () => {
    // 去掉管理台权限后，超管仅剩教师/学生权限：管理台页面不可达，教师/学生页因
    // 角色不归属也不可达 → 无路可走落 /403（而非错误地进教师页）
    expect(resolveLandingPath(['order:form:submit', 'order:form:view:self'], ['ADMIN'])).toBe(
      '/403',
    )
  })
})
