import { expect, test, type Page } from '@playwright/test'
import { FORBIDDEN_MENU, MENU_BY_ROLE } from './fixtures/api'

/**
 * 真实后端端到端走查（**无任何接口桩**）。
 *
 * 与 `permission.spec.ts` 的区别：那里用 `page.route` 把 `/api/**` 换成内存桩，
 * 跑得快、CI 无需后端；这里**直接打真实后端 + 真实 MySQL**，登录拿真实 JWT、
 * 权限码来自 `sys_role_permission` 表，用于验证「后端授权 → 前端菜单」的真实链路。
 *
 * 为什么必须有这一层（2026-09-22 教训）：桩里的超管权限清单比真实后端少 7 条，
 * 于是「超管只看到本角色菜单」在 CI 全绿、生产却渲染出 4 个角色分组。
 * 桩只能验证「给定权限时前端表现正确」，**无法验证「真实授权是什么」**。
 *
 * 运行前提：
 *   1. 后端在 127.0.0.1:8080 运行（trial/local profile 均可），且已灌种子数据；
 *   2. `E2E_REAL_BACKEND=1 npm run test:e2e -- real-backend`（不设该变量则整体跳过，
 *      保证 CI 与本地常规回归不依赖后端）。
 *
/**
 * 账号口令取后端 README 的种子清单（仅本地/试运行环境）。
 *
 * **串行执行**：多个用例共用同一批种子账号，并发时同账号的登录/刷新会互相干扰
 * （实测并发跑出现会话丢失 → 被弹回登录页），且真实后端本就是单实例共享资源。
 * 走查总时长约 25s，串行完全可接受。
 */
test.describe.configure({ mode: 'serial' })

const REAL = process.env.E2E_REAL_BACKEND === '1'

/** 种子账号（后端 README「测试账号」表，正常态账号） */
const ACCOUNT = {
  ADMIN: { userNo: '900001', password: 'Admin@123', landing: '/dashboard' },
  SECRETARY: { userNo: '800101', password: 'Sec@12345', landing: '/college-records' },
  TEACHER: { userNo: '700101', password: 'Tea@12345', landing: '/my-courses' },
  STUDENT: { userNo: '20230101', password: 'Stu@12345', landing: '/book-select' },
  SUPPLIER: { userNo: '600001', password: 'Sup@12345', landing: '/purchase-list' },
  // 多角色：教师 + 秘书（验证切换身份与合并菜单）
  TEACHER_SECRETARY: { userNo: '700103', password: 'Tea@12345', landing: '/my-courses' },
} as const

type RoleKey = keyof typeof ACCOUNT

/** 登录并消费掉可能出现的阻塞通知弹窗（种子库可能存在未确认通知） */
async function realLogin(page: Page, key: RoleKey) {
  const { userNo, password } = ACCOUNT[key]
  await page.goto('./login')
  await page.getByPlaceholder('学号 / 工号').fill(userNo)
  await page.getByPlaceholder('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()

  // 必须等登录真正完成再返回：否则调用方的 page.goto 会与登录流程竞态
  // （实测表现为整页刷新时 refresh token 尚未落盘 → 会话丢失 → 弹回登录页）
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 })

  // 阻塞通知：逐条点「收到」直到消失（最多 10 条，防死循环）
  for (let i = 0; i < 10; i += 1) {
    const notice = page.locator('[data-testid="blocking-notice"]')
    if ((await notice.count()) === 0) break
    await notice.getByRole('button', { name: '收到' }).click()
    await page.waitForTimeout(300)
  }
}

/** 侧边栏实际渲染的菜单项标题（顺序即 DOM 顺序） */
async function menuTitles(page: Page): Promise<string[]> {
  return page.locator('.app-menu .el-menu-item').allInnerTexts()
}

/** 侧边栏实际渲染的分组标题 */
async function groupTitles(page: Page): Promise<string[]> {
  return page.locator('.app-menu .el-menu-item-group__title').allInnerTexts()
}

test.describe('真实后端走查：五角色落地页与菜单（无桩）', () => {
  test.skip(!REAL, '需要真实后端：设置 E2E_REAL_BACKEND=1 后运行')

  const CASES: { key: RoleKey; role: keyof typeof MENU_BY_ROLE }[] = [
    { key: 'ADMIN', role: 'ADMIN' },
    { key: 'SECRETARY', role: 'SECRETARY' },
    { key: 'TEACHER', role: 'TEACHER' },
    { key: 'STUDENT', role: 'STUDENT' },
    { key: 'SUPPLIER', role: 'SUPPLIER' },
  ]

  for (const { key, role } of CASES) {
    test(`${key}（${ACCOUNT[key].userNo}）登录 → 落地页正确且菜单与真实授权一致`, async ({
      page,
    }) => {
      await realLogin(page, key)
      await expect(page).toHaveURL(new RegExp(`${ACCOUNT[key].landing}$`))

      const titles = await menuTitles(page)
      for (const expected of MENU_BY_ROLE[role]) {
        expect(titles, `${key} 菜单应含「${expected}」`).toContain(expected)
      }
      for (const forbidden of FORBIDDEN_MENU[role]) {
        expect(titles, `${key} 菜单不得含「${forbidden}」`).not.toContain(forbidden)
      }
    })
  }

  test('回归（2026-09-22 线上缺陷）：真实超管的侧边栏只有教材室一组，无别角色分组', async ({
    page,
  }) => {
    await realLogin(page, 'ADMIN')
    await expect(page).toHaveURL(/\/dashboard$/)

    const groups = await groupTitles(page)
    // 缺陷表征：菜单出现「学院秘书 / 任课老师 / 学生」分组标题
    expect(groups).not.toContain('学院秘书')
    expect(groups).not.toContain('任课老师')
    expect(groups).not.toContain('学生')
    expect(groups).not.toContain('教材供货商')
    // 超管的 11 项全在「教材室」一组内
    expect(groups).toEqual(['教材室'])

    const titles = await menuTitles(page)
    expect(titles).toEqual(MENU_BY_ROLE.ADMIN)
  })

  test('回归：真实超管不得进入教师/学生自助页（守卫按角色归属拦截）', async ({ page }) => {
    await realLogin(page, 'ADMIN')
    for (const path of ['./my-courses', './book-select', './window-status', './college-records']) {
      await page.goto(path)
      await expect(page, `${path} 应被拦到 403`).toHaveURL(/\/403$/)
    }
  })

  test('多角色账号（教师+秘书）：落地为当前身份的入口，切换身份后菜单与落地页随之切换', async ({
    page,
  }) => {
    await realLogin(page, 'TEACHER_SECRETARY')

    // 后端按「当前身份」下发权限码（不是所有角色的并集），
    // 700103 的当前身份由后端决定（SECRETARY 排序在前）→ 落本院征订记录
    await expect(page).toHaveURL(/\/college-records$/)
    const asSecretary = await menuTitles(page)
    expect(asSecretary).toContain('本院征订记录')
    expect(asSecretary).toContain('异动申请')
    expect(asSecretary).not.toContain('我的课程') // 秘书身份没有填报权限
    expect(asSecretary).not.toContain('账号管理')

    // 切换到教师身份 → 菜单与落地页按新身份重算
    await page.getByRole('button', { name: '切换身份' }).click()
    // el-radio 的内层 span 会拦截 pointer 事件，故点整行容器
    await page.locator('.role-radio-group .el-radio', { hasText: '任课教师' }).click()
    await page.getByRole('button', { name: '确认切换' }).click()
    await expect(page).toHaveURL(/\/my-courses$/, { timeout: 15_000 })

    const asTeacher = await menuTitles(page)
    expect(asTeacher).toContain('我的课程')
    expect(asTeacher).toContain('填报教材')
    expect(asTeacher).not.toContain('本院征订记录') // 教师身份没有本院查看权限
    expect(asTeacher).not.toContain('账号管理')
  })

  test('超管管理台页面渲染真实数据（账号管理）', async ({ page }) => {
    await realLogin(page, 'ADMIN')
    await page.goto('./accounts')
    await expect(page).toHaveURL(/\/accounts$/)
    // 种子库有 18+ 个账号；等首屏数据落地后行数应 > 0
    await expect(page.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 })
    const rows = await page.locator('.el-table__row').count()
    expect(rows).toBeGreaterThan(0)
  })

  test('教师：我的课程渲染真实任课关系', async ({ page }) => {
    await realLogin(page, 'TEACHER')
    await expect(page.getByText('我的课程').first()).toBeVisible()
    await expect(page.locator('.el-table__row, .course-card').first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test('学生：选书页渲染真实教材清单', async ({ page }) => {
    await realLogin(page, 'STUDENT')
    // 选书页是卡片列表（不是 el-table）：断言渲染出教材条目与「数量」输入
    await expect(page.getByText('数量（1-9）').first()).toBeVisible({ timeout: 15_000 })
    const cards = await page.locator('.book-card, .el-card, [class*="book"]').count()
    expect(cards).toBeGreaterThan(0)
  })

  test('供货商：订购清单渲染且无任何学生字段', async ({ page }) => {
    await realLogin(page, 'SUPPLIER')
    await expect(page.getByText('订购清单').first()).toBeVisible()
    const body = await page.locator('body').innerText()
    for (const studentField of ['学号', '学生姓名', '班级人数']) {
      expect(body).not.toContain(studentField)
    }
  })
})
