import { describe, expect, it } from 'vitest'
import { resolveLandingPath } from '@/router/guards'

/**
 * 落地页解析（SPEC §4 / PRD 功能 1：按角色进入对应工作台）。
 *
 * `resolveLandingPath` 是「按角色进入工作台」的唯一真源：根路径 `/` 不做静态
 * redirect，否则教师/学生登录后会被静态 redirect 到 /dashboard 再被权限守卫
 * 拦到 /403（回归点，见下方「教师不得落到 /dashboard」）。
 */
describe('resolveLandingPath 按角色解析落地页', () => {
  it('超级管理员（含 dashboard:stat:view）→ /dashboard', () => {
    expect(
      resolveLandingPath([
        'dashboard:stat:view',
        'user:account:manage',
        'semester:semester:manage',
        'order:form:view:all',
      ]),
    ).toBe('/dashboard')
  })

  it('任课教师（含 order:form:submit）→ /my-courses', () => {
    expect(resolveLandingPath(['order:form:submit', 'order:form:view:self'])).toBe('/my-courses')
  })

  it('学生（含 student:order:submit）→ /book-select', () => {
    expect(resolveLandingPath(['student:order:submit', 'student:order:view:self'])).toBe(
      '/book-select',
    )
  })

  it('学院秘书（含 order:form:view:college）→ /college-records', () => {
    expect(
      resolveLandingPath([
        'order:form:view:college',
        'export:signature:create',
        'semester:window:view',
      ]),
    ).toBe('/college-records')
  })

  it('供货商（含 supplier:order:view）→ /purchase-list', () => {
    expect(resolveLandingPath(['supplier:order:view', 'supplier:order:export'])).toBe(
      '/purchase-list',
    )
  })

  it('无首选工作台权限时：兜底到第一个可访问的可见路由（/my-courses）', () => {
    // 仅 order:form:view:self：不在 HOME_BY_PERMISSION 内，
    // 兜底扫描可见路由时首个命中项即 /my-courses（profile 为 hidden 被跳过）
    expect(resolveLandingPath(['order:form:view:self'])).toBe('/my-courses')
  })

  it('权限为空数组：无任何可访问路由 → /403', () => {
    expect(resolveLandingPath([])).toBe('/403')
  })

  it('多个首选权限同时命中时按 HOME_BY_PERMISSION 优先级取先者', () => {
    // 教师 + 学生双身份：order:form:submit 在优先级表中排在 student:order:submit 之前
    expect(resolveLandingPath(['student:order:submit', 'order:form:submit'])).toBe('/my-courses')
  })

  it('回归：教师权限集不得解析到 /dashboard（否则被权限守卫拦到 /403）', () => {
    const teacherPermissions = ['order:form:submit', 'order:form:view:self']
    expect(teacherPermissions).not.toContain('dashboard:stat:view')
    expect(resolveLandingPath(teacherPermissions)).not.toBe('/dashboard')
  })
})
