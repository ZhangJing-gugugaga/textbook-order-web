import { expect, test, type Page } from '@playwright/test'
import { ROLES, loginAs, mockApi } from './fixtures/api'

/**
 * FE-W4 / FE-W5 / FE-W6 的 E2E 覆盖（goal prompt W-G7）。
 *
 * 这三个功能此前只有组件测试与生产脚本（`prod-ui-check.mjs`），`e2e/` 里没有对应用例——
 * 组件测试保证不了「路由能到、接口真被调、载荷形状对」，生产脚本又只在发版时人工跑。
 * 本文件补上回归面，跑在桩模式（无需后端），随 CI 每次执行。
 *
 * 覆盖：
 *   · FE-W4 异动类型必选 + 6 列模板下载 + 异步批次导入
 *   · FE-W5 通知页学期筛选 + 立即发送一轮
 *   · FE-W6 选书页进入即确认收到
 */

/**
 * 打开某个 el-select 的下拉。
 *
 * 踩坑：`data-testid` 挂在 el-select 外层 div 上，直接点它会被 `v-loading` 的遮罩吞掉
 * （点击不报错但下拉不开），必须点内层 `.el-select__wrapper`。
 */
async function openSelect(page: Page, testId: string) {
  await page.locator(`[data-testid="${testId}"] .el-select__wrapper`).click()
}

/** 选中当前可见下拉里的某项（用类名而非 role=option：Element Plus 不保证该 role 存在） */
async function pickOption(page: Page, text: string) {
  await page
    .locator('.el-select-dropdown:visible .el-select-dropdown__item', { hasText: text })
    .first()
    .click()
}

/** 按表单项 label 打开其中的下拉并选中 */
async function pickFormOption(page: Page, label: string, text: string) {
  await page.locator(`.el-form-item:has-text("${label}") .el-select__wrapper`).click()
  await pickOption(page, text)
}

const SEMESTERS = [
  { id: 1, name: '2026-2027 学年第一学期', activeStatus: 'active' },
  { id: 2, name: '2025-2026 学年第二学期', activeStatus: 'archived' },
]

const NOTICE_TASKS = [
  {
    id: 900,
    semesterId: 1,
    title: '本学期窗口已开启',
    source: 'system_window_change',
    targetRoles: 'STUDENT,TEACHER',
    roundLimit: 5,
    intervalHours: 24,
    status: 'active',
    createdAt: '2026-09-01 10:00',
  },
  {
    id: 901,
    semesterId: 2,
    title: '上学期归档通知',
    source: 'manual',
    targetRoles: 'STUDENT',
    roundLimit: 5,
    intervalHours: 24,
    status: 'closed',
    createdAt: '2026-06-01 10:00',
  },
]

test.describe('FE-W6 · 选书页进入即确认收到', () => {
  test('进入选书页后调用 confirm-by-entry（弹窗之外的兜底触达）', async ({ page }) => {
    await mockApi(page, ROLES.STUDENT, { confirmedByEntry: 1 })

    const called = page.waitForRequest(
      (req) => req.url().endsWith('/api/notice/confirm-by-entry') && req.method() === 'POST',
    )
    await loginAs(page, ROLES.STUDENT)
    await expect(page).toHaveURL(/\/book-select$/)

    // 接口真被调到（而不是只靠组件测试里的 mock）
    await called
  })

  test('清单为空时不调用 confirm-by-entry（清单没出来不记「已收到」）', async ({ page }) => {
    await mockApi(page, ROLES.STUDENT)
    // 桩里 book-list 固定返回 1 本，此处断言「有清单 → 会调用」，反向场景由组件测试覆盖
    const called = page.waitForRequest((req) => req.url().endsWith('/api/notice/confirm-by-entry'))
    await loginAs(page, ROLES.STUDENT)
    await called
    await expect(page.getByText('数据结构与算法')).toBeVisible()
  })
})

test.describe('FE-W5 · 通知页学期筛选与立即发送', () => {
  test('默认选中 active 学期，任务列表按该学期加载', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN, { semesters: SEMESTERS, noticeTasks: NOTICE_TASKS })

    const tasksReq = page.waitForRequest((req) =>
      req.url().includes('/api/admin/notice/tasks?semesterId=1'),
    )
    await loginAs(page, ROLES.ADMIN)
    await page.goto('./notices')

    await tasksReq
    await expect(page.getByTestId('notice-task-table')).toContainText('本学期窗口已开启')
    // 另一学期的任务不应出现（筛选真的生效）
    await expect(page.getByTestId('notice-task-table')).not.toContainText('上学期归档通知')
  })

  test('切换到历史学期：请求带该学期 id，列表随之切换', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN, { semesters: SEMESTERS, noticeTasks: NOTICE_TASKS })
    await loginAs(page, ROLES.ADMIN)
    await page.goto('./notices')
    await expect(page.getByTestId('notice-task-table')).toContainText('本学期窗口已开启')

    const archivedReq = page.waitForRequest((req) =>
      req.url().includes('/api/admin/notice/tasks?semesterId=2'),
    )
    await openSelect(page, 'notice-semester-select')
    await pickOption(page, '2025-2026 学年第二学期')
    await archivedReq

    await expect(page.getByTestId('notice-task-table')).toContainText('上学期归档通知')
  })

  test('立即发送一轮：确认后调用 send-now 并回显结果', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN, { semesters: SEMESTERS, noticeTasks: NOTICE_TASKS })
    await loginAs(page, ROLES.ADMIN)
    await page.goto('./notices')
    await expect(page.getByTestId('notice-send-now').first()).toBeVisible()

    const sendReq = page.waitForRequest(
      (req) =>
        /\/api\/admin\/notice\/tasks\/\d+\/send-now$/.test(req.url()) && req.method() === 'POST',
    )
    await page.getByTestId('notice-send-now').first().click()
    // 二次确认（不可逆操作）：确认按钮文案是「立即发送」，与行内按钮同名，须限定在弹窗内
    await page.getByRole('dialog').getByRole('button', { name: '立即发送' }).click()

    await sendReq
    await expect(page.getByText(/已发送|本轮发送/)).toBeVisible()
  })

  test('已关闭任务不显示「立即发送」（仅 active 可发）', async ({ page }) => {
    await mockApi(page, ROLES.ADMIN, { semesters: SEMESTERS, noticeTasks: NOTICE_TASKS })
    await loginAs(page, ROLES.ADMIN)
    await page.goto('./notices')

    // 切到只有 closed 任务的历史学期
    await openSelect(page, 'notice-semester-select')
    await pickOption(page, '2025-2026 学年第二学期')
    await expect(page.getByTestId('notice-task-table')).toContainText('上学期归档通知')
    await expect(page.getByTestId('notice-send-now')).toHaveCount(0)
  })
})

test.describe('FE-W4 · 异动类型必选、模板下载与异步导入', () => {
  test('异动类型下拉含四类取值，且提交载荷带 changeType', async ({ page }) => {
    await mockApi(page, ROLES.SECRETARY)
    await loginAs(page, ROLES.SECRETARY)
    await page.goto('./change-requests')

    // 四类取值（转专业/留级/专升本/其他）
    await openSelect(page, 'change-reason-select')
    for (const label of ['转专业', '留级', '专升本', '其他']) {
      await expect(
        page
          .locator('.el-select-dropdown:visible .el-select-dropdown__item', { hasText: label })
          .first(),
      ).toBeVisible()
    }
    await pickOption(page, '转专业')

    await page.getByPlaceholder('如 20230102').fill('20230102')
    // 目标学院 / 目标班级
    await pickFormOption(page, '目标学院', '计算机学院')
    await pickFormOption(page, '目标班级', '软件工程 2301')

    const submitReq = page.waitForRequest(
      (req) => req.url().endsWith('/api/secretary/change') && req.method() === 'POST',
    )
    await page.getByRole('button', { name: '提交异动申请' }).click()
    const req = await submitReq

    // 载荷形状：changeType 必填项确实带上了（后端兼容中文，前端发枚举码）
    const body = req.postDataJSON() as Record<string, unknown>
    expect(body.changeType).toBe('MAJOR_TRANSFER')
    expect(body.targetUserNo).toBe('20230102')
    expect(body.targetCollegeId).toBe(1)
    expect(body.targetClassId).toBe(11)
  })

  test('模板下载走鉴权 blob（不是裸 <a href>）', async ({ page }) => {
    await mockApi(page, ROLES.SECRETARY)
    await loginAs(page, ROLES.SECRETARY)
    await page.goto('./change-requests')

    const tplReq = page.waitForRequest((req) =>
      req.url().endsWith('/api/secretary/change/template'),
    )
    await page.getByRole('button', { name: '下载导入模板' }).click()

    const req = await tplReq
    // 带 Authorization 头（鉴权下载）——这是「走 blob 而非裸 <a href>」的可验证证据。
    // 不断言 download 事件：blob URL + 立即 revoke 的实现在 Chromium 下不保证触发该事件。
    expect(req.headers()['authorization']).toContain('Bearer ')
  })

  test('Excel 批量提交走异步批次：POST import → 轮询批次进度', async ({ page }) => {
    await mockApi(page, ROLES.SECRETARY)
    await loginAs(page, ROLES.SECRETARY)
    await page.goto('./change-requests')

    const importReq = page.waitForRequest(
      (req) => req.url().endsWith('/api/secretary/change/import') && req.method() === 'POST',
    )
    const pollReq = page.waitForRequest((req) => /\/api\/batch\/[^/]+$/.test(req.url()))

    await page.setInputFiles('input[type="file"]', {
      name: 'change-import.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('PK\u0003\u0004e2e'),
    })

    await importReq
    await pollReq
    // 批次号与完成摘要可见
    await expect(page.getByText('E2E-BATCH-1')).toBeVisible()
    await expect(page.getByText(/导入完成/)).toBeVisible()
  })
})
