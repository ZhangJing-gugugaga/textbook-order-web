import { expect, test } from '@playwright/test'
import { LANDING_BY_ROLE, ROLES, loginAs, mockApi, type RoleCode } from './fixtures/api'

/**
 * 落地页解析（评审 Q2 回归用例）。
 *
 * 缺陷背景：根路径 `/` 原先是静态 `redirect: '/dashboard'`，而 `dashboard` 需要
 * `dashboard:stat:view` 权限，教师/学生/秘书/供货商打开部署根路径会落到 `/403`。
 * 修复后由守卫调用 `resolveLandingPath()` 按权限码解析。
 */
const ALL_ROLES = Object.values(ROLES) as RoleCode[]

test.describe('根路径按角色解析落地页（Q2 回归）', () => {
  for (const role of ALL_ROLES) {
    test(`${role} 打开部署根路径进入 ${LANDING_BY_ROLE[role]}`, async ({ page }) => {
      await mockApi(page, role)
      await loginAs(page, role)
      await expect(page).toHaveURL(new RegExp(`${LANDING_BY_ROLE[role]}$`))

      // 已登录后再访问根路径，应重新解析到同一落地页而不是 403
      await page.goto('./')
      await expect(page).toHaveURL(new RegExp(`${LANDING_BY_ROLE[role]}$`))
      await expect(page.locator('body')).not.toContainText('无权访问该页面')
    })
  }

  test('已登录用户访问 /login 直接回落地页', async ({ page }) => {
    await mockApi(page, ROLES.TEACHER)
    await loginAs(page, ROLES.TEACHER)
    await page.goto('./login')
    await expect(page).toHaveURL(/\/my-courses$/)
  })
})

test.describe('部署子路径与路由 base 一致（防止刷新 404）', () => {
  test('子路径下的深链接可直接打开', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN)
    await loginAs(page, ROLES.ADMIN)
    // 直接以 URL 打开子路由（等价于用户刷新页面），应正常渲染而非 404
    await page.goto('./accounts')
    await expect(page).toHaveURL(/\/accounts$/)
    await expect(page.getByRole('button', { name: '查询' })).toBeVisible()
  })
})
