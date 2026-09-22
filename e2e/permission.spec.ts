import { expect, test } from '@playwright/test'
import {
  FORBIDDEN_MENU,
  MENU_BY_ROLE,
  OVER_GRANTED_ADMIN_PERMISSIONS,
  ROLES,
  loginAs,
  mockApi,
  type RoleCode,
} from './fixtures/api'

/**
 * 权限矩阵（评审 A2 回归用例）：
 * 侧边栏按「权限码 + 角色归属」过滤 + 按钮级权限（PermButton 无权限码移除 DOM）。
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

/**
 * 回归：2026-09-22 线上缺陷（超管菜单里冒出学院秘书/任课老师/学生三个分组）。
 *
 * 触发条件是「后端把角色专属权限也授给了超管」——当时 ADMIN = 除供货商外全部。
 * 本组用例故意下发**授权过宽**的权限集，断言前端侧边栏仍然干净：
 * 角色归属约束是继后端收权之后的第二道防线。
 */
test.describe('回归：超管授权过宽时菜单仍不得泄漏别角色分组', () => {
  test('授权过宽的超管：菜单只有教材室管理台，且无别角色分组标题', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN, { permissions: OVER_GRANTED_ADMIN_PERMISSIONS })
    await loginAs(page, ROLES.ADMIN)
    const menu = page.locator('.app-menu')
    await expect(menu).toBeVisible()

    // 应当可见：教材室管理台全部 11 项
    for (const title of MENU_BY_ROLE.ADMIN) {
      await expect(menu.getByText(title, { exact: true })).toBeVisible()
    }
    // 不得可见：教师/学生/秘书自助页 + 供货商页
    for (const title of FORBIDDEN_MENU.ADMIN) {
      await expect(menu.getByText(title, { exact: true })).toHaveCount(0)
    }
    // 不得出现别角色的分组标题（缺陷的直接表征）
    for (const groupTitle of ['学院秘书', '任课老师', '学生', '教材供货商']) {
      await expect(menu.getByText(groupTitle, { exact: true })).toHaveCount(0)
    }
  })

  test('授权过宽的超管：直接访问教师/学生页被守卫拦到 403', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN, { permissions: OVER_GRANTED_ADMIN_PERMISSIONS })
    await loginAs(page, ROLES.ADMIN)
    for (const path of ['./my-courses', './book-select', './window-status']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/403$/)
    }
  })

  test('未授权过宽的超管（收权后）：菜单与分组同样干净', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN)
    await loginAs(page, ROLES.ADMIN)
    const menu = page.locator('.app-menu')
    await expect(menu.getByText('数据看板', { exact: true })).toBeVisible()
    for (const groupTitle of ['学院秘书', '任课老师', '学生']) {
      await expect(menu.getByText(groupTitle, { exact: true })).toHaveCount(0)
    }
  })
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
