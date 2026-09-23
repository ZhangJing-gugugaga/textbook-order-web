import { expect, test, type Page } from '@playwright/test'
import { FORBIDDEN_MENU, MENU_BY_ROLE } from './fixtures/api'
import { seedPassword } from './fixtures/seedCredentials'

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
 * 账号口令**不入库**：运行时由 `fixtures/seedCredentials.ts` 注入（环境变量
 * `E2E_SEED_PASSWORDS` 或 gitignore 的 `e2e/.seed-credentials.local.json`）——
 * 安全扫描门禁把 `password: '…'` 字面量判为 Hardcoded password 并硬阻断 push。
 *
 * **串行执行**：多个用例共用同一批种子账号，并发时同账号的登录/刷新会互相干扰
 * （实测并发跑出现会话丢失 → 被弹回登录页），且真实后端本就是单实例共享资源。
 * 走查总时长约 25s，串行完全可接受。
 */
test.describe.configure({ mode: 'serial' })

const REAL = process.env.E2E_REAL_BACKEND === '1'

/** 种子账号（后端 README「测试账号」表，正常态账号）；口令见 seedPassword() */
const ACCOUNT = {
  ADMIN: { userNo: '900001', landing: '/dashboard' },
  SECRETARY: { userNo: '800101', landing: '/college-records' },
  TEACHER: { userNo: '700101', landing: '/my-courses' },
  STUDENT: { userNo: '20230101', landing: '/book-select' },
  SUPPLIER: { userNo: '600001', landing: '/purchase-list' },
  // 多角色：教师 + 秘书（验证切换身份与合并菜单）
  TEACHER_SECRETARY: { userNo: '700103', landing: '/my-courses' },
} as const

type RoleKey = keyof typeof ACCOUNT

/** 全部页面路径（与 src/router/routes.ts 的 children 逐项一致） */
const ALL_PAGES = [
  'profile',
  'dashboard',
  'accounts',
  'org',
  'semester-window',
  'textbooks',
  'courses',
  'people',
  'review',
  'order-data',
  'export-center',
  'notices',
  'audit',
  'roles',
  'college-records',
  'college-export',
  'window-status',
  'change-requests',
  'my-courses',
  'order-form',
  'my-submissions',
  'book-select',
  'my-orders',
  'purchase-list',
  'supplier-export',
]

/**
 * 期望可访问矩阵（显式声明，不靠菜单反推）。
 * `profile` 全员可用；其余按路由 meta 的 roles 归属。
 */
const ALLOWED_PAGES: Record<string, string[]> = {
  ADMIN: [
    'profile',
    'dashboard',
    'accounts',
    'org',
    'semester-window',
    'textbooks',
    'courses',
    'people',
    'review',
    'order-data',
    'export-center',
    'notices',
    'audit',
    'roles',
  ],
  SECRETARY: ['profile', 'college-records', 'college-export', 'window-status', 'change-requests'],
  TEACHER: ['profile', 'change-requests', 'my-courses', 'order-form', 'my-submissions'],
  STUDENT: ['profile', 'book-select', 'my-orders'],
  SUPPLIER: ['profile', 'purchase-list', 'supplier-export'],
}

/** 登录并消费掉可能出现的阻塞通知弹窗（种子库可能存在未确认通知） */
async function realLogin(page: Page, key: RoleKey) {
  const { userNo } = ACCOUNT[key]
  const password = seedPassword(userNo)
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

  /**
   * 回归（决策 FE-W1，线上实测 2026-09-23 缺陷）：教师/秘书点「明细」被 403 弹到 /403 页。
   *
   * 根因是两者都复用了 `/admin/order-forms/{id}`（要求 `order:form:view:all`，教师/秘书
   * 都不持有）→ 必然 403 → 全局 onForbidden 跳 /403。修复后教师走
   * `/teacher/order-forms/{id}`、秘书走 `/secretary/order-forms/{id}`。
   *
   * 这两条用例只读（打开弹窗看明细），不改任何业务数据。
   */
  test('回归 FE-W1：教师「明细与轨迹」正常出弹窗，不再被弹到 /403', async ({ page }) => {
    await realLogin(page, 'TEACHER')
    await page.goto('./my-submissions')
    await expect(page.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: '明细与轨迹' }).first().click()

    // 弹窗出现即说明详情接口通了；若仍走旧端点会 403 并被弹到 /403 页
    await expect(page.getByText('提交明细与审查轨迹')).toBeVisible({ timeout: 15_000 })
    await expect(page).not.toHaveURL(/\/403$/)
  })

  test('回归 FE-W1：秘书「查看明细」正常出弹窗，不再被弹到 /403', async ({ page }) => {
    await realLogin(page, 'SECRETARY')
    await page.goto('./college-records')
    await expect(page.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: '查看明细' }).first().click()

    await expect(page.getByText('表单明细（只读）')).toBeVisible({ timeout: 15_000 })
    await expect(page).not.toHaveURL(/\/403$/)
  })

  /**
   * FE-W3 撤回入口的**只读**回归：种子库里教师 700101 的单已通过审核（终态），
   * 该状态下不得出现「撤回修改」按钮。
   *
   * 完整的「提交→撤回→重提→管理员 409」链路需要一张 pending_review 的单，
   * 属写操作，未纳入本套只读走查（见测试报告「未覆盖项」）。
   */
  test('FE-W3：已通过审核的单不显示「撤回修改」（终态无撤回入口）', async ({ page }) => {
    await realLogin(page, 'TEACHER')
    await page.goto('./my-submissions')
    await expect(page.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 })

    // 种子库教师 700101 的表单状态为 reviewed（终态）
    await expect(page.getByText('已通过').first()).toBeVisible()
    await expect(page.getByRole('button', { name: '撤回修改' })).toHaveCount(0)
  })

  /** FE-W7 审计日志页：渲染真实审计数据（该接口此前已存在但全仓无消费页面） */
  test('FE-W7：审计日志页渲染真实审计记录', async ({ page }) => {
    await realLogin(page, 'ADMIN')
    await page.goto('./audit')
    await expect(page).toHaveURL(/\/audit$/)

    // 种子库有登录/审核等审计记录；等首屏落地后行数应 > 0
    await expect(page.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 })
    expect(await page.locator('.el-table__row').count()).toBeGreaterThan(0)
  })

  /**
   * FE-W2 角色管理页（只读部分）：渲染真实角色表，且内置角色受保护。
   *
   * 完整的「建角色→配权限→加挂账号→删除」链路是**写操作**，会往共享种子库写数据，
   * 未纳入本只读走查；该链路的载荷正确性由 `tests/components/RoleView.spec.ts` 覆盖，
   * 并在交付说明中给出一次真实后端的实测记录。
   */
  test('FE-W2：角色管理页渲染真实角色表，内置角色受保护', async ({ page }) => {
    await realLogin(page, 'ADMIN')
    await page.goto('./roles')
    await expect(page).toHaveURL(/\/roles$/)

    // 种子库有 5 个内置角色（ADMIN/SECRETARY/TEACHER/STUDENT/SUPPLIER）
    await expect(page.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 })
    expect(await page.locator('.el-table__row').count()).toBeGreaterThanOrEqual(5)

    const body = await page.locator('body').innerText()
    expect(body).toContain('教材室')
    expect(body).toContain('内置')

    // ADMIN 行的「配置权限」不可点（超管权限由系统内置）
    const adminRow = page.locator('.el-table__row', { hasText: 'ADMIN' }).first()
    await expect(adminRow.getByRole('button', { name: '配置权限' })).toBeDisabled()
    // 内置角色不可删除
    await expect(adminRow.getByRole('button', { name: '删除' })).toBeDisabled()
  })

  /**
   * 全角色 × 全页面矩阵（25 页面 × 5 角色）。
   *
   * 断言每个页面在「有权角色」下正常渲染（不出现错误态），在「无权角色」下落 403。
   * 2026-09-22 用同款矩阵发现过一处「菜单能点、进去被拦」的缺陷（秘书进导出中心
   * 因页面拉取超管专属数据而吃 403 被弹走），故固化为常驻用例。
   *
   * 期望矩阵显式列出（不靠菜单反推）：`profile` 全员可用，其余按角色归属。
   */
  test('全角色 × 全页面矩阵：有权页面正常渲染、无权页面落 403', async ({ browser }) => {
    // 125 次页面加载（25 页 × 5 角色），远超默认 30s 用例超时
    test.setTimeout(600_000)
    const baseURL = test.info().project.use.baseURL as string

    for (const { key, role } of CASES) {
      // 每个角色用**全新上下文**：同一上下文里 localStorage 共享，
      // 带着上一个角色的会话访问 /login 会被守卫弹到它的落地页，登录表单根本不渲染
      const context = await browser.newContext({ baseURL })
      const page = await context.newPage()

      await realLogin(page, key)
      for (const path of ALL_PAGES) {
        // 不用 networkidle（每页多等约 1s，115 次会拖到 5 分钟以上）：
        // 等到「布局已渲染」或「已被守卫拦走」这个确定性条件即可
        await page.goto(`./${path}`, { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(
          () =>
            document.querySelector('.app-wrapper') !== null ||
            /\/403$|\/404$|\/login$/.test(location.pathname),
          undefined,
          { timeout: 20_000 },
        )
        const landed = new URL(page.url()).pathname.split('/').pop() ?? ''
        const shouldBeAllowed = ALLOWED_PAGES[role].includes(path)

        if (shouldBeAllowed) {
          const bodyText = await page.locator('body').innerText()
          expect(landed, `${role} 访问 /${path} 应正常打开，实际落到 ${landed}`).toBe(path)
          expect(
            /服务开小差|网络异常|加载失败/.test(bodyText),
            `${role} 的 /${path} 出现错误态`,
          ).toBe(false)
        } else {
          expect(landed, `${role} 访问 /${path} 应落 403，实际 ${landed}`).toBe('403')
        }
      }

      await context.close()
    }
  })
})
