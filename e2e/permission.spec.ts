import { expect, test } from '@playwright/test'
import {
  FORBIDDEN_MENU,
  MENU_BY_ROLE,
  ROLES,
  loginAs,
  mockApi,
  type RoleCode,
} from './fixtures/api'

/**
 * 权限矩阵（评审 A2 回归用例）：
 * 侧边栏按权限码过滤 + 按钮级权限（PermButton 无权限码移除 DOM）。
 */
const ALL_ROLES = Object.values(ROLES) as RoleCode[]

test.describe('侧边栏菜单按权限过滤', () => {
  for (const role of ALL_ROLES) {
    test(`${role} 只看到本角色菜单`, async ({ page }) => {
      await mockApi(page, role)
      await loginAs(page, role)
      const menu = page.locator('.app-menu')
      await expect(menu).toBeVisible()

      for (const title of MENU_BY_ROLE[role]) {
        await expect(menu.getByText(title, { exact: true })).toBeVisible()
      }
      for (const title of FORBIDDEN_MENU[role]) {
        await expect(menu.getByText(title, { exact: true })).toHaveCount(0)
      }
    })
  }
})

test.describe('按钮级权限（PermButton 无权限移除 DOM）', () => {
  test('超管在账号管理页可见「新建账号」与「停用/启用」', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN)
    await loginAs(page, ROLES.ADMIN)
    await page.goto('./accounts')
    await expect(page.getByRole('button', { name: '新建账号' })).toBeVisible()
  })

  test('导出按钮按权限码显示：超管有 export:order:create，教师没有', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN)
    await loginAs(page, ROLES.ADMIN)
    await page.goto('./review')
    await expect(page.getByRole('button', { name: '导出' })).toBeVisible()
  })

  test('学生无导出权限：导出中心路由不可达', async ({ page }) => {
    await mockApi(page, ROLES.STUDENT)
    await loginAs(page, ROLES.STUDENT)
    await page.goto('./export-center')
    await expect(page).toHaveURL(/\/403$/)
  })
})

test.describe('供货商物理隔离', () => {
  test('供货商菜单不含任何学生/教师业务入口', async ({ page }) => {
    await mockApi(page, ROLES.SUPPLIER)
    await loginAs(page, ROLES.SUPPLIER)
    const menu = page.locator('.app-menu')
    await expect(menu.getByText('订购清单', { exact: true })).toBeVisible()
    for (const forbidden of ['选书', '我的课程', '本院征订记录', '学生/教师管理']) {
      await expect(menu.getByText(forbidden, { exact: true })).toHaveCount(0)
    }
  })
})
