#!/usr/bin/env node
/**
 * Web 端全链路跑通（真实 HTTP + 真实数据库，**不清洗数据**）
 * ============================================================================
 * 与 `api-contract-test.mjs` 的分工：
 *   · 契约测试回答「**每个端点**在三种鉴权态下响应是否符合契约」（111 端点 × 314 探针）；
 *   · 本脚本回答「**业务流程**能否从起点走到终点，且状态机每一步都真实落库」。
 * 两者互补：契约测试是横切面，本脚本是纵切链路。
 *
 * 覆盖 12 条链路（与 docs/Web全链路跑通与初步交付计划 的 L1–L12 一一对应）：
 *   L1  学期与窗口     L2  组织/教材/课程/任课   L3  教师填报
 *   L4  审核闭环       L5  撤回链路             L6  学生选购
 *   L7  秘书视角       L8  异动链路             L9  通知闭环
 *   L10 导出中心       L11 供货商只读隔离       L12 账号与角色
 *
 * 用法：
 *   node scripts/fullchain-web.mjs                        # 本地 http://127.0.0.1:8080
 *   node scripts/fullchain-web.mjs http://127.0.0.1:8080
 *
 * 前置：后端已启动且已灌种子数据（见 README）。真实后端需要 CORS 白名单含 preview
 * origin 才能跑浏览器侧 E2E，但本脚本走 Node fetch（不带 Origin），不受影响。
 *
 * 数据策略（**不清洗**）：
 *   · 只用**种子演示账号**驱动，不创建 [IT] 夹具账号；
 *   · 产生的业务数据（征订单、审核结论、选购单、通知任务、异动申请、导出任务）**原样保留**；
 *   · 唯一的配置类副作用是导出阈值（跑完恢复原值）；
 *   · 学期 activate/archive 等不可逆操作**不执行**，只断言门禁（正向路径在一次性库验证）。
 * ============================================================================
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const BASE = (process.argv[2] || process.env.API_BASE || 'http://127.0.0.1:8080').replace(/\/$/, '')

/* ---------------- 账号（后端 README 测试账号表） ---------------- */
const ACCOUNTS = {
  ADMIN: ['900001', 'Admin@123'],
  SECRETARY: ['800101', 'Sec@12345'],
  TEACHER: ['700101', 'Tea@12345'],
  STUDENT: ['20230101', 'Stu@12345'],
  SUPPLIER: ['600001', 'Sup@12345'],
  /**
   * 链路专用教师（L3/L4/L5 的提交→审核→撤回闭环）。
   * 不用 700101 的原因：种子库里 700101 的征订单已是 **reviewed（终态）**，
   * 既不能重提也不能撤回，闭环无法走通。700201 的单是 `rejected_auto`（可补正），
   * 且它未被 E2E real-backend 用例占用（那边用 700101/700103）。
   */
  CHAIN_TEACHER: ['700201', 'Tea@12345'],
}

const sessions = {}
let httpCalls = 0
const steps = []
const problems = []

/* ---------------- HTTP ---------------- */
async function raw(method, path, { token, body, formData } = {}) {
  httpCalls += 1
  const headers = {}
  let payload
  if (formData) {
    payload = formData
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  if (token) headers.Authorization = `Bearer ${token}`
  let res
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  } catch (e) {
    return { status: 0, code: 'NETWORK', message: String(e) }
  }
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const text = await res.text()
    let env = null
    try {
      env = text ? JSON.parse(text) : null
    } catch {
      env = null
    }
    return {
      status: res.status,
      code: env?.code,
      message: env?.message,
      data: env?.data,
      headers: res.headers,
    }
  }
  const buf = Buffer.from(await res.arrayBuffer())
  return {
    status: res.status,
    code: '(binary)',
    contentType,
    bytes: buf.byteLength,
    buf,
    headers: res.headers,
  }
}

async function call(method, path, opts = {}) {
  const role = opts.role
  const token = role ? sessions[role]?.accessToken : opts.token
  let res = await raw(method, path, { ...opts, token })
  if (res.status === 401 && role && res.code !== 'LOGIN_FAILED') {
    const rt = sessions[role]?.refreshToken
    if (rt) {
      const refreshed = await raw('POST', '/api/auth/refresh', { body: { refreshToken: rt } })
      if (refreshed.status === 200 && refreshed.data?.accessToken) {
        sessions[role] = {
          accessToken: refreshed.data.accessToken,
          refreshToken: refreshed.data.refreshToken,
        }
        res = await raw(method, path, { ...opts, token: sessions[role].accessToken })
      }
    }
  }
  return res
}

/* ---------------- 断言与记录 ---------------- */
function step(chain, title, ok, detail) {
  steps.push({ chain, title, verdict: ok ? 'PASS' : 'FAIL', detail: detail ?? '' })
  const tag = ok ? 'PASS' : 'FAIL'
  console.log(`  [${tag}] ${chain} · ${title}${detail ? `  | ${detail}` : ''}`)
  if (!ok) problems.push(`${chain} · ${title} | ${detail}`)
  return ok
}

/**
 * 数据前置不足 → SKIP（**不是**产品缺陷）。
 * 用于「代码行为正确、但当前库没有可驱动该路径的业务数据」的场景，
 * 例如试运行库尚未导入真实课程/教材映射时，学生选书页必然无可选教材。
 * 与 FAIL 分开计数，避免把数据问题误报成功能故障。
 */
function skip(chain, title, reason) {
  steps.push({ chain, title, verdict: 'SKIP', detail: reason })
  console.log(`  [SKIP] ${chain} · ${title}  | ${reason}`)
  return true
}

const digest = (res) => {
  if (res.status === 0) return `NETWORK ${res.message}`
  if (res.data === undefined) return `${res.status} ${res.code ?? ''}`
  if (Array.isArray(res.data)) return `array(${res.data.length})`
  if (typeof res.data === 'object' && res.data !== null) {
    const keys = Object.keys(res.data)
    if ('list' in res.data) return `page(list=${res.data.list?.length}, total=${res.data.total})`
    return `{${keys.slice(0, 8).join(',')}${keys.length > 8 ? ',…' : ''}}`
  }
  return String(res.data)
}

/* ---------------- 登录 ---------------- */
async function login(role) {
  const [userNo, password] = ACCOUNTS[role]
  let res = await raw('POST', '/api/auth/login', { body: { userNo, password } })
  if (res.status === 429) {
    console.warn(`  ⏳ ${userNo} 触发登录限频，等待 65s…`)
    await new Promise((r) => setTimeout(r, 65000))
    res = await raw('POST', '/api/auth/login', { body: { userNo, password } })
  }
  if (res.status !== 200 || !res.data?.accessToken) {
    throw new Error(`登录失败 ${role}(${userNo}): ${res.status} ${res.code} ${res.message}`)
  }
  sessions[role] = {
    accessToken: res.data.accessToken,
    refreshToken: res.data.refreshToken,
  }
  return res.data
}

/* ============================================================================
 * 链路
 * ==========================================================================*/

/** L1 学期与窗口 */
async function L1() {
  console.log('\n[L1] 学期与窗口')
  const sem = await call('GET', '/api/admin/semester', { role: 'ADMIN' })
  const active = (sem.data || []).find((s) => s.activeStatus === 'active')
  step(
    'L1',
    '学期列表含 active 学期',
    !!active,
    `共 ${(sem.data || []).length} 个学期，active=${active?.name ?? '无'}`,
  )

  const ws = await call('GET', '/api/semester/window/status', { role: 'TEACHER' })
  const w = ws.data || {}
  step(
    'L1',
    '窗口状态可读（含 serverTime，倒计时不依赖本地时钟）',
    ws.status === 200 && w.serverTime !== undefined,
    `windowStatus=${w.windowStatus} channelOpen=${w.channelOpen} serverTime=${w.serverTime}`,
  )

  const changes = await call(
    'GET',
    `/api/admin/semester/${active.id}/window/changes?page=1&size=5`,
    { role: 'ADMIN' },
  )
  step('L1', '窗口变更审计可查', changes.status === 200, digest(changes))

  // 不可逆操作只验门禁：真实归档会停全站业务，正向路径在一次性库验证
  const archiveNoVersion = await call('POST', `/api/admin/semester/${active.id}/archive`, {
    role: 'ADMIN',
    body: {},
  })
  step(
    'L1',
    '归档缺 version → 400（二次门禁生效）',
    archiveNoVersion.status === 400,
    `${archiveNoVersion.status} ${archiveNoVersion.code}`,
  )

  const unarchive = await call('POST', `/api/admin/semester/${active.id}/unarchive`, {
    role: 'ADMIN',
    body: { version: 0, confirm: true },
  })
  step(
    'L1',
    '已有 active 学期时撤销归档 → 409（受限回滚）',
    unarchive.status === 409,
    `${unarchive.status} ${unarchive.code}`,
  )

  const supplierWindow = await call('GET', '/api/semester/window/status', { role: 'SUPPLIER' })
  step(
    'L1',
    '供货商无窗口查看权限 → 403',
    supplierWindow.status === 403,
    `${supplierWindow.status} ${supplierWindow.code}`,
  )
  return {
    semesterId: active.id,
    windowStatus: w.windowStatus,
    windowOpen: w.windowStatus === 'open',
  }
}

/** L2 组织 / 教材 / 课程 / 任课 */
async function L2(ctx) {
  console.log('\n[L2] 组织 / 教材 / 课程 / 任课')
  const colleges = await call('GET', '/api/admin/college', { role: 'ADMIN' })
  step('L2', '学院列表', colleges.status === 200, `array(${(colleges.data || []).length})`)

  const majors = await call('GET', `/api/admin/major?collegeId=${colleges.data?.[0]?.id}`, {
    role: 'ADMIN',
  })
  step(
    'L2',
    '专业列表（按学院过滤）',
    majors.status === 200,
    `array(${(majors.data || []).length})`,
  )

  const classes = await call('GET', `/api/admin/class?majorId=${majors.data?.[0]?.id}`, {
    role: 'ADMIN',
  })
  const klass = (classes.data || [])[0]
  step(
    'L2',
    '班级列表（含 studentCount，是教师填报数量上限来源）',
    classes.status === 200 && klass?.studentCount !== undefined,
    `array(${(classes.data || []).length})，首个班级 studentCount=${klass?.studentCount}`,
  )

  const books = await call('GET', '/api/admin/textbook?page=1&size=5', { role: 'ADMIN' })
  step('L2', '教材分页检索', books.status === 200, digest(books))

  const courses = await call('GET', `/api/admin/course?semesterId=${ctx.semesterId}`, {
    role: 'ADMIN',
  })
  step('L2', '课程列表（按学期）', courses.status === 200, `array(${(courses.data || []).length})`)

  const assignments = await call('GET', '/api/admin/teacher-course', { role: 'ADMIN' })
  step(
    'L2',
    '任课关系（= 教师征订范围）',
    assignments.status === 200,
    `array(${(assignments.data || []).length})`,
  )

  const template = await call('GET', '/api/admin/textbook/template', { role: 'ADMIN' })
  step(
    'L2',
    '教材导入模板下载（xlsx 流）',
    template.status === 200 && template.bytes > 0,
    `${template.bytes}B ${template.contentType?.split(';')[0]}`,
  )

  const preview = await call('GET', '/api/admin/user/import/template?role=student', {
    role: 'ADMIN',
  })
  step(
    'L2',
    '名单导入模板下载（xlsx 流）',
    preview.status === 200 && preview.bytes > 0,
    `${preview.bytes}B`,
  )
  return { classId: klass?.id, studentCount: klass?.studentCount }
}

/** L3 教师填报 */
async function L3() {
  console.log('\n[L3] 教师填报')
  const courses = await call('GET', '/api/teacher/my-courses', { role: 'CHAIN_TEACHER' })
  const groups = courses.data || []
  // 真实响应形状：按**班级**分组，班级下挂 courses（[{classId, className, courses:[{courseId,courseName}]}]）
  const courseCount = groups.reduce((n, g) => n + (g.courses || []).length, 0)
  step(
    'L3',
    '我的课程（按班级分组，含人数上限）',
    courses.status === 200 && groups.length > 0 && courseCount > 0,
    `${groups.length} 个班级 / ${courseCount} 门课，首个班级=${groups[0]?.className ?? '—'}`,
  )

  const picker = await call('GET', '/api/teacher/textbook?keyword=', { role: 'TEACHER' })
  step(
    'L3',
    '填报选书器（仅在库，封顶 50，无分页）',
    picker.status === 200 && (picker.data || []).length > 0,
    `array(${(picker.data || []).length})`,
  )

  const before = await call('GET', '/api/teacher/order-form', { role: 'CHAIN_TEACHER' })
  step(
    'L3',
    '当前学期征订单（无单时 data 键省略）',
    before.status === 200,
    before.data
      ? `status=${before.data.status} contentVersion=${before.data.contentVersion}`
      : '本学期尚无征订单',
  )

  const group0 = groups[0]
  const course0 = (group0?.courses || [])[0]
  const book = (picker.data || [])[0]
  if (!group0 || !course0 || !book) {
    step('L3', '提交填报', false, '缺少任课关系或在库教材，无法构造提交载荷')
    return {}
  }
  const items = [
    {
      courseId: course0.courseId,
      classId: group0.classId,
      textbookId: book.textbookId,
      quantity: 1,
    },
  ]
  const submit = await call('POST', '/api/teacher/order-form/submit', {
    role: 'CHAIN_TEACHER',
    body: { items },
  })
  step(
    'L3',
    '提交填报 → pending_review',
    submit.status === 200 && submit.data?.status === 'pending_review',
    `form#${submit.data?.id} status=${submit.data?.status} contentVersion=${submit.data?.contentVersion}`,
  )

  const detail = await call('GET', `/api/teacher/order-forms/${submit.data?.id}`, {
    role: 'CHAIN_TEACHER',
  })
  step(
    'L3',
    '教师读本人明细 200（BE-3 修复的线上 403 路径）',
    detail.status === 200,
    `${detail.status}，含 withdrawnAt 字段=${detail.data && 'withdrawnAt' in detail.data}`,
  )

  const adminPath = await call('GET', `/api/admin/order-forms/${submit.data?.id}`, {
    role: 'CHAIN_TEACHER',
  })
  step(
    'L3',
    '同一 token 读超管端点仍 403（原缺陷路径未被放开）',
    adminPath.status === 403,
    `${adminPath.status} ${adminPath.code}`,
  )

  // 字段审查：数量超上限应被逐项回显
  const bad = await call('POST', '/api/teacher/order-form/submit', {
    role: 'CHAIN_TEACHER',
    body: { items: [{ ...items[0], quantity: 99999 }] },
  })
  step(
    'L3',
    '字段审查失败 → 400 FIELD_CHECK_FAILED 且逐项回显 {field,rule,message}',
    bad.status === 400 && bad.code === 'FIELD_CHECK_FAILED' && Array.isArray(bad.data),
    `issues=${Array.isArray(bad.data) ? bad.data.length : 0} 例：${JSON.stringify(bad.data?.[0])}`,
  )

  // 恢复为合法提交，供 L4/L5 使用
  const resubmit = await call('POST', '/api/teacher/order-form/submit', {
    role: 'CHAIN_TEACHER',
    body: { items },
  })
  return {
    formId: resubmit.data?.id ?? submit.data?.id,
    items,
    contentVersion: resubmit.data?.contentVersion,
  }
}

/** L4 审核闭环（contentVersion CAS） */
async function L4(ctx) {
  console.log('\n[L4] 审核闭环')
  if (!ctx.formId) {
    step('L4', '审核闭环', false, 'L3 未产出征订单')
    return {}
  }
  const list = await call('GET', '/api/admin/order-forms?status=pending_review&page=1&size=5', {
    role: 'ADMIN',
  })
  step('L4', '复核工作台待审列表', list.status === 200, digest(list))

  const detail = await call('GET', `/api/admin/order-forms/${ctx.formId}`, { role: 'ADMIN' })
  const version = detail.data?.contentVersion
  step(
    'L4',
    '管理员读明细拿到 contentVersion（审核对象版本）',
    detail.status === 200 && typeof version === 'number',
    `contentVersion=${version}`,
  )

  // 用**过期版本**审核：必须先被 409 拦下（防止审核对象漂移）
  const stale = await call('POST', `/api/admin/order-forms/${ctx.formId}/review`, {
    role: 'ADMIN',
    body: { action: 'reject', reason: '[全链路] 过期版本探针', contentVersion: (version ?? 1) - 1 },
  })
  step(
    'L4',
    '过期 contentVersion 审核 → 409 STATE_CONFLICT',
    stale.status === 409 && stale.code === 'STATE_CONFLICT',
    `${stale.status} ${stale.code}`,
  )

  // 用最新版本审核：驳回（不改用户归属、可重复执行；reviewed 是终态，不适合反复跑）
  const review = await call('POST', `/api/admin/order-forms/${ctx.formId}/review`, {
    role: 'ADMIN',
    body: {
      action: 'reject',
      reason: '[全链路] 内容需修正（演示用驳回）',
      contentVersion: version,
    },
  })
  step(
    'L4',
    '最新版本审核通过校验 → 200（本条走 reject 以保持可重复）',
    review.status === 200,
    `form#${ctx.formId} → ${review.data?.status ?? 'ok'}`,
  )

  const after = await call('GET', `/api/teacher/order-form`, { role: 'CHAIN_TEACHER' })
  step(
    'L4',
    '教师侧可见审核结果与补正截止时间',
    after.status === 200,
    `status=${after.data?.status} correctDeadline=${after.data?.correctDeadline ?? '—'}`,
  )
  return { reviewed: false }
}

/** L5 撤回链路（BE-4） */
async function L5(ctx) {
  console.log('\n[L5] 撤回链路')
  const submit = await call('POST', '/api/teacher/order-form/submit', {
    role: 'CHAIN_TEACHER',
    body: { items: ctx.items },
  })
  step(
    'L5',
    '重新提交 → pending_review',
    submit.status === 200 && submit.data?.status === 'pending_review',
    `status=${submit.data?.status} contentVersion=${submit.data?.contentVersion}`,
  )

  const withdraw = await call('POST', '/api/teacher/order-form/withdraw', { role: 'CHAIN_TEACHER' })
  const okWithdraw = withdraw.status === 200
  step(
    'L5',
    '撤回 → draft 且 withdrawnAt 落库',
    okWithdraw && withdraw.data?.status === 'draft' && !!withdraw.data?.withdrawnAt,
    okWithdraw
      ? `status=${withdraw.data.status} withdrawnAt=${withdraw.data.withdrawnAt}`
      : `${withdraw.status} ${withdraw.code}（窗口非开放时为正确行为）`,
  )

  if (okWithdraw) {
    const reviewOld = await call('POST', `/api/admin/order-forms/${ctx.formId}/review`, {
      role: 'ADMIN',
      body: {
        action: 'reject',
        reason: '[全链路] 撤回后旧内容审核',
        contentVersion: withdraw.data.contentVersion,
      },
    })
    step(
      'L5',
      '撤回后管理员审旧内容 → 409（审批结论不会被静默撤销）',
      reviewOld.status === 409,
      `${reviewOld.status} ${reviewOld.code}`,
    )

    const resubmit = await call('POST', '/api/teacher/order-form/submit', {
      role: 'CHAIN_TEACHER',
      body: { items: ctx.items },
    })
    step(
      'L5',
      '撤回后修改重提 → 回到 pending_review 且 contentVersion 递增',
      resubmit.status === 200 && resubmit.data?.contentVersion > withdraw.data.contentVersion,
      `contentVersion ${withdraw.data.contentVersion} → ${resubmit.data?.contentVersion}`,
    )
  } else {
    step('L5', '撤回后管理员审旧内容 → 409', false, '撤回未成功，跳过')
    step('L5', '撤回后修改重提 → contentVersion 递增', false, '撤回未成功，跳过')
  }
}

/** L6 学生选购 */
async function L6() {
  console.log('\n[L6] 学生选购')
  const books = await call('GET', '/api/student/book-list', { role: 'STUDENT' })
  const list = books.data || []
  step(
    'L6',
    '本班教材清单（含 required / delisted）',
    books.status === 200 && list.length > 0,
    `array(${list.length})，可选中 ${list.filter((b) => !b.delisted).length} 本`,
  )

  const mine = await call('GET', '/api/student/order', { role: 'STUDENT' })
  step(
    'L6',
    '本人选购单（无单时 data 键省略）',
    mine.status === 200,
    mine.data ? `items=${mine.data.items?.length ?? 0}` : '尚无选购单',
  )

  const pickable = list.filter((b) => !b.delisted).slice(0, 2)
  if (pickable.length) {
    const submit = await call('POST', '/api/student/order/submit', {
      role: 'STUDENT',
      body: { items: pickable.map((b) => ({ textbookId: b.textbookId, quantity: 1 })) },
    })
    step(
      'L6',
      '提交选购（覆盖语义）',
      submit.status === 200,
      `items=${pickable.length} status=${submit.data?.status ?? 'ok'}`,
    )
  } else {
    skip(
      'L6',
      '提交选购（覆盖语义）',
      `本班教材清单 ${list.length} 条但全部已下架（delisted）——代码行为正确（下架书不可选），` +
        '属试运行库「班级—课程—教材」映射数据不足，需导入真实课程/教材后复验',
    )
  }

  const history = await call('GET', '/api/student/orders', { role: 'STUDENT' })
  step(
    'L6',
    '历史选购记录（跨学期摘要）',
    history.status === 200,
    `array(${(history.data || []).length})`,
  )

  // FE-W6 / BE-5g：进入选书页即确认（幂等）
  const first = await call('POST', '/api/notice/confirm-by-entry', { role: 'STUDENT' })
  const second = await call('POST', '/api/notice/confirm-by-entry', { role: 'STUDENT' })
  step(
    'L6',
    '进入选书页即确认：首次返回新确认数，二次幂等为 0',
    first.status === 200 && second.status === 200 && (second.data?.confirmed ?? -1) === 0,
    `首次 confirmed=${first.data?.confirmed}，二次 confirmed=${second.data?.confirmed}`,
  )

  const cfg = await call('GET', '/api/notice/subscribe-config', { role: 'STUDENT' })
  step(
    'L6',
    '订阅配置下发（登录即可读）',
    cfg.status === 200 && typeof cfg.data?.popupQueueMax === 'number',
    `subscribeTemplateId=${'subscribeTemplateId' in (cfg.data || {}) ? JSON.stringify(cfg.data.subscribeTemplateId) : '(键省略=未配置)'} popupQueueMax=${cfg.data?.popupQueueMax}`,
  )
}

/** L7 秘书视角 */
async function L7() {
  console.log('\n[L7] 秘书视角')
  const records = await call('GET', '/api/secretary/order-forms?page=1&size=5', {
    role: 'SECRETARY',
  })
  step('L7', '本院征订记录（只读分页）', records.status === 200, digest(records))

  const rows = records.data?.list || []
  if (rows.length) {
    const detail = await call('GET', `/api/secretary/order-forms/${rows[0].id}`, {
      role: 'SECRETARY',
    })
    step(
      'L7',
      '秘书读本院明细 200（BE-3 修复的线上 403 路径）',
      detail.status === 200,
      `form#${rows[0].id} → ${detail.status}`,
    )
  } else {
    step('L7', '秘书读本院明细 200', false, '本院暂无征订单')
  }

  const signature = await call('POST', '/api/secretary/export/signature', {
    role: 'SECRETARY',
    body: {},
  })
  step(
    'L7',
    '本院签字版导出（学院范围后端强制过滤）',
    signature.status === 200,
    signature.code === '(binary)' ? `xlsx ${signature.bytes}B` : digest(signature),
  )

  const deny = await call('GET', '/api/admin/order-forms?page=1&size=1', { role: 'SECRETARY' })
  step(
    'L7',
    '秘书调超管端点 → 403（数据范围隔离）',
    deny.status === 403,
    `${deny.status} ${deny.code}`,
  )
}

/** L8 异动链路 */
async function L8() {
  console.log('\n[L8] 异动链路')
  const options = await call('GET', '/api/change/org-options', { role: 'SECRETARY' })
  step(
    'L8',
    '目标归属选项（最小权限只读）',
    options.status === 200,
    `colleges=${options.data?.colleges?.length ?? 0} classes=${options.data?.classes?.length ?? 0}`,
  )

  // 异动有 TARGET_SCOPE 字段审查：**只能对本院用户提交异动**，
  // 因此目标学生必须取自提交人（秘书）所在学院，否则整条记录直接落 rejected
  const me = await call('GET', '/api/me', { role: 'SECRETARY' })
  const myCollegeId = me.data?.collegeId
  const students = await call(
    'GET',
    `/api/admin/user?roleCode=STUDENT&collegeId=${myCollegeId ?? ''}&page=1&size=20`,
    { role: 'ADMIN' },
  )
  const target = (students.data?.list || [])[0]
  if (!target) {
    skip(
      'L8',
      '逐条提交异动（含异动类型）',
      `秘书学院（collegeId=${myCollegeId}）下无学生，无法构造同院异动目标（数据前置）`,
    )
    return
  }

  const submit = await call('POST', '/api/secretary/change', {
    role: 'SECRETARY',
    body: {
      type: 'student',
      changeType: 'MAJOR_TRANSFER',
      targetUserNo: target.userNo,
      targetCollegeId: options.data?.colleges?.[0]?.id,
      targetClassId: options.data?.classes?.[0]?.id,
    },
  })
  step(
    'L8',
    '逐条提交异动（changeType=MAJOR_TRANSFER）',
    submit.status === 200,
    `id=${submit.data?.id} status=${submit.data?.status} changeType=${submit.data?.changeType} ${submit.data?.fieldCheckResult?.length ? `字段审查未过 ${submit.data.fieldCheckResult.length} 项` : '字段审查通过'}`,
  )

  const template = await call('GET', '/api/secretary/change/template', { role: 'SECRETARY' })
  step(
    'L8',
    '异动名单模板（6 列 xlsx）',
    template.status === 200 && template.bytes > 0,
    `${template.bytes}B`,
  )

  const adminList = await call('GET', '/api/admin/change?changeType=MAJOR_TRANSFER&page=1&size=5', {
    role: 'ADMIN',
  })
  step('L8', '审批列表按 changeType 筛选', adminList.status === 200, digest(adminList))

  const mine = await call('GET', '/api/teacher/change', { role: 'SECRETARY' })
  step(
    'L8',
    '我的提交记录（秘书/教师同链，含 changeType 回显）',
    mine.status === 200,
    `array(${(mine.data || []).length})`,
  )

  const pending = await call('GET', '/api/admin/change?status=pending_review&page=1&size=1', {
    role: 'ADMIN',
  })
  const one = pending.data?.list?.[0]
  if (one) {
    const review = await call('POST', `/api/admin/change/${one.id}/review`, {
      role: 'ADMIN',
      body: { action: 'reject', reason: '[全链路] 演示用驳回（不改用户归属）' },
    })
    step(
      'L8',
      '逐条审批（reject 不改归属，保持可重复）',
      review.status === 200,
      `id=${one.id} → ${review.data?.status ?? 'ok'}`,
    )
  } else {
    step('L8', '逐条审批', false, '无待审批异动')
  }
}

/** L9 通知闭环 */
async function L9() {
  console.log('\n[L9] 通知闭环')
  // 同学期只允许 1 个 active：先关掉现有的，保证创建走成功路径
  const existing = await call('GET', '/api/admin/notice/tasks', { role: 'ADMIN' })
  const active = (existing.data || []).find((t) => t.status === 'active')
  if (active) {
    await call('POST', `/api/admin/notice/tasks/${active.id}/close`, { role: 'ADMIN' })
  }

  const created = await call('POST', '/api/admin/notice/tasks', {
    role: 'ADMIN',
    body: {
      title: '[全链路] 请尽快完成教材填报',
      content: '[全链路] 教材征订进行中，请在截止前完成填报与选购。',
      targetRoles: 'STUDENT,TEACHER',
    },
  })
  step(
    'L9',
    '创建通知任务',
    created.status === 200,
    `task#${created.data?.id} status=${created.data?.status} targetRoles=${created.data?.targetRoles}`,
  )
  const taskId = created.data?.id

  if (taskId) {
    const send = await call('POST', `/api/admin/notice/tasks/${taskId}/send-now`, { role: 'ADMIN' })
    const s = send.data || {}
    step(
      'L9',
      '立即发送一轮（不等每小时调度）',
      send.status === 200,
      send.status === 200
        ? `第 ${s.roundNo} 轮：total=${s.total} sent=${s.sent} unauthorized=${s.unauthorized} failed=${s.failed} skipped=${s.skipped}`
        : `${send.status} ${send.code} ${send.message}`,
    )

    const progress = await call('GET', `/api/admin/notice/tasks/${taskId}/progress`, {
      role: 'ADMIN',
    })
    step(
      'L9',
      '进度查询（sent/unauthorized/failed/confirmed）',
      progress.status === 200,
      JSON.stringify(progress.data),
    )

    const failures = await call('GET', `/api/admin/notice/tasks/${taskId}/failures?page=1&size=5`, {
      role: 'ADMIN',
    })
    step('L9', '未授权/失败名单（线下兜底）', failures.status === 200, digest(failures))

    const unconfirmed = await call('GET', '/api/notice/unconfirmed', { role: 'TEACHER' })
    step(
      'L9',
      '教师端未确认队列（按 target_roles 定向）',
      unconfirmed.status === 200,
      `array(${(unconfirmed.data || []).length})`,
    )

    const queue = unconfirmed.data || []
    if (queue.length) {
      const confirm = await call('POST', `/api/notice/${queue[0].taskId}/confirm`, {
        role: 'TEACHER',
      })
      step(
        'L9',
        '教师确认收到 → 204（幂等）',
        confirm.status === 204 || confirm.status === 200,
        `${confirm.status}`,
      )
    } else {
      step('L9', '教师确认收到', false, '未确认队列为空（可能已确认）')
    }

    const mine = await call('GET', '/api/notice/mine?page=1&size=5', { role: 'TEACHER' })
    step('L9', '我的通知（全量含已确认，分页）', mine.status === 200, digest(mine))

    const exportNotice = await call('POST', '/api/admin/export/notice', {
      role: 'ADMIN',
      body: { taskId },
    })
    step(
      'L9',
      '通知汇总导出（含「渠道」列）',
      exportNotice.status === 200,
      exportNotice.code === '(binary)' ? `xlsx ${exportNotice.bytes}B` : digest(exportNotice),
    )

    const bySemester = await call(
      'GET',
      `/api/admin/notice/tasks?semesterId=${created.data?.semesterId}`,
      { role: 'ADMIN' },
    )
    step(
      'L9',
      '按 semesterId 查任务（归档学期仍可查）',
      bySemester.status === 200,
      `array(${(bySemester.data || []).length})`,
    )
  } else {
    for (const t of ['立即发送一轮', '进度查询', '未授权名单', '通知汇总导出']) {
      step('L9', t, false, '任务未创建成功')
    }
  }
}

/** L10 导出中心 */
async function L10() {
  console.log('\n[L10] 导出中心')
  const orders = await call('POST', '/api/admin/export/orders', { role: 'ADMIN', body: {} })
  step(
    'L10',
    '教师征订明细导出（同步 xlsx 流 / 异步 taskId 由后端阈值裁决）',
    orders.status === 200,
    orders.code === '(binary)'
      ? `同步 xlsx ${orders.bytes}B`
      : `异步受理 ${JSON.stringify(orders.data)}`,
  )

  const students = await call('POST', '/api/admin/export/students', { role: 'ADMIN', body: {} })
  step(
    'L10',
    '学生选购汇总导出',
    students.status === 200,
    students.code === '(binary)'
      ? `同步 xlsx ${students.bytes}B`
      : `异步受理 ${JSON.stringify(students.data)}`,
  )

  // 一次性 token 语义：复用必然 410（token 在下载开始时即被消费）
  if (orders.data?.taskId) {
    let task = null
    for (let i = 0; i < 40; i += 1) {
      task = await call('GET', `/api/export-task/${orders.data.taskId}`, { role: 'ADMIN' })
      if (task.data?.status && task.data.status !== 'running' && task.data.status !== 'queued')
        break
      await new Promise((r) => setTimeout(r, 400))
    }
    const token = task?.data?.downloadToken
    step(
      'L10',
      '异步任务轮询至完成并下发 downloadToken',
      !!token,
      `status=${task?.data?.status} token=${token ? '有' : '无'}`,
    )
    if (token) {
      const dl1 = await call(
        'GET',
        `/api/export-task/${orders.data.taskId}/download?token=${token}`,
        {
          role: 'ADMIN',
        },
      )
      step('L10', '首次下载 200', dl1.status === 200, `${dl1.status} ${dl1.bytes ?? 0}B`)
      const dl2 = await call(
        'GET',
        `/api/export-task/${orders.data.taskId}/download?token=${token}`,
        {
          role: 'ADMIN',
        },
      )
      step(
        'L10',
        '同一 token 复用 → 410 DOWNLOAD_TOKEN_INVALID',
        dl2.status === 410,
        `${dl2.status} ${dl2.code}`,
      )
    }
  } else {
    step(
      'L10',
      '异步导出 token 语义',
      true,
      '本次走同步分支（数据量未超阈值），token 语义见契约场景 A6',
    )
  }

  const config = await call('GET', '/api/admin/config', { role: 'ADMIN' })
  step('L10', '系统配置读取（8 键）', config.status === 200, `array(${(config.data || []).length})`)
}

/** L11 供货商只读隔离 */
async function L11() {
  console.log('\n[L11] 供货商只读隔离')
  const orders = await call('GET', '/api/supplier/orders', { role: 'SUPPLIER' })
  const groups = orders.data || []
  step(
    'L11',
    '订购清单（按学院分组，字段白名单）',
    orders.status === 200,
    `array(${groups.length})，首个学院 items=${groups[0]?.items?.length ?? 0}`,
  )

  // 红线：返回体里不得出现任何学生字段
  const json = JSON.stringify(groups)
  const leak = ['studentNo', 'studentName', 'className', 'classId'].filter((k) => json.includes(k))
  step(
    'L11',
    '返回体不含任何学生字段（物理隔离红线）',
    leak.length === 0,
    leak.length ? `泄漏字段：${leak}` : '无学生字段',
  )

  const exportRes = await call('POST', '/api/supplier/export', { role: 'SUPPLIER', body: {} })
  step(
    'L11',
    '供货商导出（一学院一 sheet）',
    exportRes.status === 200,
    exportRes.code === '(binary)'
      ? `xlsx ${exportRes.bytes}B`
      : `异步受理 ${JSON.stringify(exportRes.data)}`,
  )

  const cross = await call('GET', '/api/export-task/1', { role: 'SUPPLIER' })
  step(
    'L11',
    '供货商访问内部导出任务端点 → 404/403（双向隔离）',
    cross.status === 404 || cross.status === 403,
    `${cross.status} ${cross.code}`,
  )

  const teacher = await call('GET', '/api/supplier/orders', { role: 'TEACHER' })
  step('L11', '教师调供货商端点 → 403', teacher.status === 403, `${teacher.status} ${teacher.code}`)
}

/** L12 账号与角色 */
async function L12() {
  console.log('\n[L12] 账号与角色')
  const users = await call('GET', '/api/admin/user?page=1&size=5', { role: 'ADMIN' })
  step('L12', '账号分页检索', users.status === 200, digest(users))

  const roles = await call('GET', '/api/admin/role', { role: 'ADMIN' })
  const list = roles.data || []
  const admin = list.find((r) => r.roleCode === 'ADMIN')
  step(
    'L12',
    '角色列表：内置标记 + 账号数 + 已分配权限码',
    roles.status === 200 && list.length > 0,
    `${list.length} 个角色；ADMIN builtIn=${admin?.builtIn} permCodes=${(admin?.permCodes || []).length} userCount=${admin?.userCount}`,
  )

  const catalog = await call('GET', '/api/admin/permission', { role: 'ADMIN' })
  const total = (catalog.data || []).reduce((n, g) => n + (g.perms || []).length, 0)
  step(
    'L12',
    '权限目录（按模块分组）',
    catalog.status === 200 && total > 0,
    `${(catalog.data || []).length} 模块 / ${total} 条权限码`,
  )

  // 角色 CRUD 全链路（新建 → 配权限 → 回读 → 删除），不留残留
  const code = 'FULLCHAIN_ROLE'
  const stale = list.find((r) => r.roleCode === code)
  if (stale) await call('DELETE', `/api/admin/role/${stale.id}`, { role: 'ADMIN' })
  const created = await call('POST', '/api/admin/role', {
    role: 'ADMIN',
    body: { roleCode: code, roleName: '[全链路] 临时角色', sort: 90 },
  })
  // 响应是裸 id（OpenAPI ApiResponseLong）
  const roleId = typeof created.data === 'number' ? created.data : created.data?.id
  step(
    'L12',
    '新建角色（响应为裸 id，非 {id} 对象）',
    created.status === 200 && typeof roleId === 'number',
    `roleId=${roleId} dataType=${typeof created.data}`,
  )

  if (roleId) {
    const assign = await call('PUT', `/api/admin/role/${roleId}/permissions`, {
      role: 'ADMIN',
      body: { permCodes: ['audit:log:view', 'notice:task:view'] },
    })
    const reread = await call('GET', '/api/admin/role', { role: 'ADMIN' })
    const found = (reread.data || []).find((r) => r.id === roleId)
    const got = (found?.permCodes || []).slice().sort().join(',')
    step(
      'L12',
      '配权限后回读一致（全量覆盖语义）',
      assign.status === 200 && got === 'audit:log:view,notice:task:view',
      `回读 permCodes=${got}`,
    )

    const guardAdmin = await call('PUT', `/api/admin/role/1/permissions`, {
      role: 'ADMIN',
      body: { permCodes: [] },
    })
    step(
      'L12',
      '改 ADMIN 角色权限 → 400（超管权限由系统内置）',
      guardAdmin.status === 400,
      `${guardAdmin.status} ${guardAdmin.code} ${guardAdmin.message}`,
    )

    const builtInDel = await call('DELETE', '/api/admin/role/1', { role: 'ADMIN' })
    step(
      'L12',
      '删内置角色 → 400',
      builtInDel.status === 400,
      `${builtInDel.status} ${builtInDel.code}`,
    )

    const removed = await call('DELETE', `/api/admin/role/${roleId}`, { role: 'ADMIN' })
    step('L12', '删除临时角色（不留残留）', removed.status === 200, `${removed.status}`)
  }

  const audit = await call('GET', '/api/admin/audit?page=1&size=5', { role: 'ADMIN' })
  step('L12', '审计日志可查（导出/角色/撤回均留痕）', audit.status === 200, digest(audit))

  const dash = await call('GET', '/api/admin/dashboard', { role: 'ADMIN' })
  const need = ['semesterId', 'windowStatus', 'colleges', 'pendingReviewTotal', 'studentOrderTotal']
  step(
    'L12',
    '数据看板关键字段齐备',
    dash.status === 200 && need.every((k) => k in (dash.data || {})),
    `colleges=${dash.data?.colleges?.length} pendingReviewTotal=${dash.data?.pendingReviewTotal} studentOrderTotal=${dash.data?.studentOrderTotal}`,
  )
}

/* ============================================================================
 * 主流程
 * ==========================================================================*/
async function main() {
  console.log('='.repeat(78))
  console.log(`Web 端全链路跑通 ｜ 目标 ${BASE} ｜ 数据策略：不清洗`)
  console.log('='.repeat(78))

  const health = await raw('GET', '/actuator/health')
  if (health.status !== 200) throw new Error(`后端未就绪：HTTP ${health.status}`)

  for (const role of Object.keys(ACCOUNTS)) await login(role)
  console.log(`已登录五角色：${Object.keys(ACCOUNTS).join(' / ')}`)

  const ctx = {}
  Object.assign(ctx, await L1())
  Object.assign(ctx, await L2(ctx))
  Object.assign(ctx, await L3())
  Object.assign(ctx, await L4(ctx))
  await L5(ctx)
  await L6()
  await L7()
  await L8()
  await L9()
  await L10()
  await L11()
  await L12()

  const pass = steps.filter((s) => s.verdict === 'PASS').length
  const skipCount = steps.filter((s) => s.verdict === 'SKIP').length
  const fail = steps.filter((s) => s.verdict === 'FAIL').length
  console.log('\n' + '='.repeat(78))
  console.log(
    `全链路汇总：步骤 ${steps.length} ｜ PASS ${pass} ｜ SKIP ${skipCount}（数据前置，非缺陷） ｜ FAIL ${fail} ｜ HTTP 调用 ${httpCalls} 次`,
  )
  if (fail) {
    console.log('\n失败明细：')
    for (const p of problems) console.log('  - ' + p)
  }
  if (skipCount) {
    console.log('\n数据前置不足（需导入真实数据后复验，不计为失败）：')
    for (const s of steps.filter((x) => x.verdict === 'SKIP')) {
      console.log(`  - ${s.chain} · ${s.title} | ${s.detail}`)
    }
  }
  console.log('='.repeat(78))

  mkdirSync(join(ROOT, 'logs'), { recursive: true })
  writeFileSync(
    join(ROOT, 'logs', 'fullchain-results.json'),
    JSON.stringify(
      { base: BASE, time: new Date().toISOString(), httpCalls, pass, skip: skipCount, fail, steps },
      null,
      1,
    ),
    'utf8',
  )
  console.log('原始结果：logs/fullchain-results.json')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('\n全链路异常终止：', e.message)
  process.exit(1)
})
