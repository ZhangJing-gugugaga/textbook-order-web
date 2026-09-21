import { expect, test } from '@playwright/test'
import { ROLES, loginAs, mockApi } from './fixtures/api'

/** 认证与授权（SPEC §4 / §5）：未登录跳转、越权 403、首登强制改密 */
test.describe('认证与授权', () => {
  test('未登录访问业务页 → 跳登录页并带回跳地址', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN)
    await page.goto('./accounts')
    await expect(page).toHaveURL(/\/login\?redirect=/)
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
  })

  test('登录后回跳原目标页（redirect 生效）', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN)
    await page.goto('./accounts')
    await expect(page).toHaveURL(/\/login\?redirect=/)
    await page.getByPlaceholder('学号 / 工号').fill('admin001')
    await page.getByPlaceholder('密码').fill('E2e@12345')
    await page.getByRole('button', { name: '登录' }).click()
    await expect(page).toHaveURL(/\/accounts$/)
  })

  test('越权访问受限路由 → 403 页', async ({ page }) => {
    await mockApi(page, ROLES.STUDENT)
    await loginAs(page, ROLES.STUDENT)
    await page.goto('./accounts')
    await expect(page).toHaveURL(/\/403$/)
    await expect(page.getByText('无权访问该页面')).toBeVisible()
  })

  test('首登未改密 → 强制跳个人中心并弹出改密弹窗', async ({ page }) => {
    await mockApi(page, ROLES.TEACHER, { mustChangePassword: true })
    await loginAs(page, ROLES.TEACHER)
    await expect(page).toHaveURL(/\/profile\?forceChange=1/)
    await expect(page.getByText('首次登录，请完成校验并修改初始密码')).toBeVisible()
  })

  test('未知路径 → 404 页', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN)
    await loginAs(page, ROLES.ADMIN)
    await page.goto('./no-such-page')
    await expect(page).toHaveURL(/\/404$/)
  })
})
