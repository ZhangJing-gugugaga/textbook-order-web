/* eslint-disable no-console */
// 生产环境新功能 UI 实测（FE-W4/W5/W6）：真实浏览器 + 真实后端 + 真实数据
// 用法：node prod-ui-check.mjs
import { chromium } from '@playwright/test'

const SITE = 'https://textbooksorder.moonzj.com'
const browser = await chromium.launch()
const results = []
const apiCalls = []

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? `  | ${detail}` : ''}`)
}

async function login(ctx, userNo, password) {
  const page = await ctx.newPage()
  page.on('response', (r) => {
    if (r.url().includes('/api/'))
      apiCalls.push(`${r.status()} ${r.request().method()} ${r.url().replace(SITE, '')}`)
  })
  await page.goto(`${SITE}/login`, { waitUntil: 'load' })
  await page.getByPlaceholder('学号 / 工号').fill(userNo)
  await page.getByPlaceholder('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForTimeout(4000)
  await dismissNotices(page)
  return page
}

/**
 * 消费阻塞通知弹窗（「收到」逐条点掉，最多 10 条）。
 * 这是**产品设计的主触达通道**——未确认通知会以 modal 阻断操作，因此任何
 * 后续交互前必须先确认掉，否则 Playwright 的 click 会被 mask 拦截。
 */
async function dismissNotices(page) {
  for (let i = 0; i < 10; i += 1) {
    const notice = page.locator('[data-testid="blocking-notice"]')
    if ((await notice.count()) === 0) break
    await notice
      .getByRole('button', { name: '收到' })
      .click()
      .catch(() => {})
    await page.waitForTimeout(400)
  }
}

console.log('=== 超管：通知页（FE-W4）===')
{
  const ctx = await browser.newContext({ locale: 'zh-CN' })
  const page = await login(ctx, '900001', 'Admin@123')
  await page.goto(`${SITE}/notices`, { waitUntil: 'load' })
  await page.waitForTimeout(3000)

  check(
    '通知页渲染学期下拉',
    (await page.locator('[data-testid="notice-semester-select"]').count()) > 0,
  )
  const rows = await page.locator('[data-testid="notice-task-table"] tbody tr').count()
  check('通知任务表有真实数据行', rows > 0, `${rows} 行`)
  const sendNow = await page.locator('[data-testid="notice-send-now"]').count()
  check('active 任务显示「立即发送」按钮', sendNow > 0, `${sendNow} 个`)
  const exportDisabled = await page
    .locator('.export-button button')
    .first()
    .isDisabled()
    .catch(() => null)
  check(
    '未选任务时导出按钮禁用（防导错对象）',
    exportDisabled === true,
    `disabled=${exportDisabled}`,
  )

  // 选中一行后导出应可用，且出现「导出对象」提示
  await page.locator('[data-testid="notice-task-table"] tbody tr').first().click()
  await page.waitForTimeout(800)
  const exportEnabled = await page
    .locator('.export-button button')
    .first()
    .isEnabled()
    .catch(() => false)
  const hint = await page
    .locator('.el-alert__title')
    .allInnerTexts()
    .catch(() => [])
  check('选中任务后导出可用', exportEnabled, `enabled=${exportEnabled}`)
  check(
    '出现「导出对象：任务 #N」提示',
    hint.some((t) => t.includes('导出对象')),
    hint.find((t) => t.includes('导出对象')) ?? '',
  )

  // 创建通知页：按钮文案应为「创建并立即发送」
  await page.getByRole('tab', { name: '创建通知' }).click()
  await page.waitForTimeout(600)
  const createBtn = await page
    .locator('[data-testid="notice-create-submit"]')
    .innerText()
    .catch(() => '')
  check('创建按钮文案为「创建并立即发送」', createBtn.includes('创建并立即发送'), createBtn.trim())
  await ctx.close()
}

console.log('=== 超管：角色管理 / 审计页（FE-W2 / FE-W7）===')
{
  const ctx = await browser.newContext({ locale: 'zh-CN' })
  const page = await login(ctx, '900001', 'Admin@123')
  await page.goto(`${SITE}/roles`, { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  const roleRows = await page.locator('.el-table__body tbody tr').count()
  check('角色管理页渲染真实角色表', roleRows >= 5, `${roleRows} 行`)

  await page.goto(`${SITE}/audit`, { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  const auditRows = await page.locator('.el-table__body tbody tr').count()
  check('审计日志页渲染真实记录', auditRows > 0, `${auditRows} 行`)
  await ctx.close()
}

console.log('=== 秘书：异动页（FE-W5）===')
{
  const ctx = await browser.newContext({ locale: 'zh-CN' })
  const page = await login(ctx, '800101', 'Sec@12345')
  await page.goto(`${SITE}/change-requests`, { waitUntil: 'load' })
  await page.waitForTimeout(3000)
  const reasonSelect = await page.locator('[data-testid="change-reason-select"]').count()
  check('提交表单有「异动类型」下拉', reasonSelect > 0)
  const labels = await page
    .locator('label')
    .allInnerTexts()
    .catch(() => [])
  check(
    '原「异动类型」已改名为「异动对象」',
    labels.some((t) => t.includes('异动对象')),
    labels.filter((t) => t.includes('异动')).join(' / '),
  )
  const tplBtn = await page
    .getByRole('button', { name: '下载导入模板' })
    .count()
    .catch(() => 0)
  check('导入区有「下载导入模板」按钮', tplBtn > 0)
  const progressTab = await page.getByRole('tab', { name: '审批进度' }).count()
  check('审批进度 tab 存在', progressTab > 0)
  await page.getByRole('tab', { name: '审批进度' }).click()
  await page.waitForTimeout(1500)
  const reasonFilter = await page.locator('[data-testid="change-reason-filter"]').count()
  check('进度页有「异动类型」筛选', reasonFilter > 0)
  const headerCells = await page
    .locator('.el-table__header th')
    .allInnerTexts()
    .catch(() => [])
  check(
    '列表含「异动对象」与「异动类型」两列',
    headerCells.some((t) => t.includes('异动对象')) &&
      headerCells.some((t) => t.includes('异动类型')),
    headerCells.filter((t) => t.includes('异动')).join(' / '),
  )
  await ctx.close()
}

console.log('=== 学生：选书页入口确认（FE-W6）===')
{
  const ctx = await browser.newContext({ locale: 'zh-CN' })
  const page = await login(ctx, '20230101', 'Stu@12345')
  apiCalls.length = 0
  await page.goto(`${SITE}/book-select`, { waitUntil: 'load' })
  await page.waitForTimeout(3500)
  const called = apiCalls.some((c) => c.includes('/api/notice/confirm-by-entry'))
  check(
    '进入选书页调用 POST /api/notice/confirm-by-entry',
    called,
    apiCalls.filter((c) => c.includes('confirm-by-entry')).join(' ; '),
  )
  const subscribed = apiCalls.some((c) => c.includes('/api/notice/subscribe-config'))
  check(
    '非超管改走 /api/notice/subscribe-config 取弹窗队列上限',
    subscribed,
    apiCalls.filter((c) => c.includes('subscribe-config')).join(' ; '),
  )
  const noAdminConfig = !apiCalls.some((c) => c.includes('/api/admin/config'))
  check('非超管不再调用超管配置端点（避免 403 跳 /403）', noAdminConfig)
  await ctx.close()
}

const pass = results.filter((r) => r.ok).length
const fail = results.length - pass
console.log('\n' + '='.repeat(70))
console.log(`生产 UI 实测：断言 ${results.length} ｜ PASS ${pass} ｜ FAIL ${fail}`)
if (fail) {
  console.log('失败明细：')
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name} | ${r.detail}`)
}
console.log('='.repeat(70))
await browser.close()
process.exit(fail ? 1 : 0)
