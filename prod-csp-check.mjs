/* eslint-disable no-console */
// 生产环境浏览器实测：安全头加固后 SPA 是否仍能正常加载与登录（含 CSP 违规与控制台错误捕获）
// 用法：node prod-csp-check.mjs   （需真实生产网络与演示账号口令，故不入 CI）
import { chromium } from '@playwright/test'

const SITE = 'https://textbooksorder.moonzj.com/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ locale: 'zh-CN' })
const page = await ctx.newPage()

const consoleErrors = []
const cspViolations = []
const failedRequests = []
const apiCalls = []

page.on('console', (m) => {
  const t = m.text()
  if (m.type() === 'error') consoleErrors.push(t)
  if (/Content Security Policy|Refused to/i.test(t)) cspViolations.push(t)
})
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
page.on('requestfailed', (r) =>
  failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`),
)
page.on('response', (r) => {
  const u = r.url()
  if (u.includes('/api/'))
    apiCalls.push(`${r.status()} ${r.request().method()} ${u.replace(SITE.replace(/\/$/, ''), '')}`)
})

console.log('--- 1) 打开站点 ---')
await page.goto(SITE, { waitUntil: 'load' })
await page.waitForTimeout(1500)
console.log('   url:', page.url())
console.log('   title:', await page.title())

console.log('--- 2) 登录页渲染 ---')
const hasUser = await page.getByPlaceholder('学号 / 工号').count()
const hasPwd = await page.getByPlaceholder('密码').count()
console.log('   学号输入框:', hasUser, '密码输入框:', hasPwd)

console.log('--- 3) 真实登录（超管 900001）---')
await page.getByPlaceholder('学号 / 工号').fill('900001')
await page.getByPlaceholder('密码').fill('Admin@123')
await page.getByRole('button', { name: '登录' }).click()
await page.waitForTimeout(6000)
console.log('   url after login:', page.url())

console.log('--- 4) 落地页渲染断言 ---')
const bodyText = await page
  .locator('body')
  .innerText()
  .catch(() => '')
console.log('   页面文本长度:', bodyText.length)
console.log('   含「教材征订」:', bodyText.includes('教材征订'))
const menuCount = await page
  .locator('.app-menu .el-menu-item')
  .count()
  .catch(() => 0)
const groupCount = await page
  .locator('.app-menu .el-menu-item-group__title')
  .count()
  .catch(() => 0)
console.log('   侧边栏菜单项:', menuCount, '分组标题:', groupCount)
const groups = await page
  .locator('.app-menu .el-menu-item-group__title')
  .allInnerTexts()
  .catch(() => [])
console.log('   分组:', JSON.stringify(groups))

console.log('--- 5) 关键子页面可达（真实路由 + 真实接口）---')
for (const p of ['/dashboard', '/accounts', '/roles', '/audit', '/notices']) {
  await page.goto(SITE.replace(/\/$/, '') + p, { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  const txt = await page
    .locator('body')
    .innerText()
    .catch(() => '')
  const is403 = page.url().includes('/403')
  console.log(
    `   ${p} → url=${new URL(page.url()).pathname} 文本=${txt.length} ${is403 ? '⚠ 落 403' : ''}`,
  )
}

console.log('\n=== 汇总 ===')
console.log('控制台错误:', consoleErrors.length)
for (const e of consoleErrors.slice(0, 8)) console.log('   -', e.slice(0, 160))
console.log('CSP 违规:', cspViolations.length)
for (const e of cspViolations.slice(0, 8)) console.log('   -', e.slice(0, 200))
console.log('失败请求:', failedRequests.length)
for (const e of failedRequests.slice(0, 8)) console.log('   -', e.slice(0, 160))
console.log('API 调用:', apiCalls.length)
for (const e of apiCalls.slice(0, 12)) console.log('   -', e)

await browser.close()
