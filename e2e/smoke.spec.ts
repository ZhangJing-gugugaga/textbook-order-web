import { expect, test } from '@playwright/test'
import { ROLES, loginAs, mockApi } from './fixtures/api'

/**
 * 五角色主链路走查（SPEC §10 / 评审 P0-3）：
 * 登录 → 工作台渲染 → 关键页面可交互，覆盖窗口横幅、空态、错误态与阻塞通知。
 */
test.describe('主链路走查', () => {
  test('任课教师：我的课程 → 填报教材入口受窗口状态控制', async ({ page }) => {
    await mockApi(page, ROLES.TEACHER, { windowStatus: 'open' })
    await loginAs(page, ROLES.TEACHER)
    await expect(page.getByText('软件工程 2301')).toBeVisible()
    await expect(page.getByRole('button', { name: '填报教材' }).first()).toBeEnabled()
  })

  test('窗口未开始：填报入口禁用', async ({ page }) => {
    await mockApi(page, ROLES.TEACHER, { windowStatus: 'not_open' })
    await loginAs(page, ROLES.TEACHER)
    await expect(page.getByRole('button', { name: '填报教材' }).first()).toBeDisabled()
  })

  test('全局窗口横幅展示三态文案', async ({ page }) => {
    await mockApi(page, ROLES.TEACHER, { windowStatus: 'closed' })
    await loginAs(page, ROLES.TEACHER)
    const banner = page.getByTestId('window-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('本期征订已截止')
  })

  test('供货商无窗口查看权限：不展示横幅', async ({ page }) => {
    await mockApi(page, ROLES.SUPPLIER)
    await loginAs(page, ROLES.SUPPLIER)
    await expect(page.getByTestId('window-banner')).toHaveCount(0)
  })

  test('学生：选书页渲染本班教材清单', async ({ page }) => {
    await mockApi(page, ROLES.STUDENT)
    await loginAs(page, ROLES.STUDENT)
    await expect(page.getByText('数据结构与算法')).toBeVisible()
  })

  test('超管：列表页空态由 ServerTable 基座统一渲染', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN)
    await loginAs(page, ROLES.ADMIN)
    await page.goto('./textbooks')
    await expect(page.getByTestId('server-table-empty')).toBeVisible()
  })

  test('列表接口失败：展示错误态与重试入口（不吞错）', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN, { failBusiness: true })
    await loginAs(page, ROLES.ADMIN)
    await page.goto('./textbooks')
    await expect(page.getByText('服务开小差了，请稍后重试')).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  })

  test('未确认通知：阻塞弹窗逐条确认后放行', async ({ page }) => {
    await mockApi(page, ROLES.STUDENT, { unconfirmedNotices: 1 })
    await loginAs(page, ROLES.STUDENT)
    const dialog = page.getByTestId('blocking-notice')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('E2E 通知 1')
    await dialog.getByRole('button', { name: '收到' }).click()
    await expect(dialog).toHaveCount(0)
  })
})
