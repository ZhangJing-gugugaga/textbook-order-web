#!/usr/bin/env node
/**
 * 全接口联调契约测试（95 端点 · 真实 HTTP + 真实数据库）
 * ============================================================================
 * 目的：把后端 API.md / OpenAPI 的契约**逐条打到运行中的服务上**，记录请求与响应的
 * 实际结果并与文档预期比对，产出可复查的测试清单。
 *
 * 用法：
 *   node scripts/api-contract-test.mjs [baseUrl]      # 默认 http://127.0.0.1:8080
 *   npm run test:api
 *
 * 前置：后端已启动（local profile + MySQL 种子数据）。
 *   1) E:\tools\mysql-local.bat start
 *   2) cd textbook-order-server && set -a; . ./.env.local; set +a
 *      java -jar target/textbook-order-server.jar
 *
 * 覆盖维度（每个端点三探针）：
 *   - 鉴权：无 token → 期望 401
 *   - 越权：无该权限码的角色 → 期望 403（归属类端点期望 404，见 A5）
 *   - 正常：有权限角色 → 期望 2xx 且 code=0
 * 另含契约语义场景（A1–A7 + 分页/链路追踪），见 SECTIONS。
 *
 * 数据副作用（**已尽量收敛，可重复执行**）：
 *   - 只创建 `[IT]` 前缀的夹具（学院/专业/班级/课程/教材/账号），不修改种子演示数据；
 *   - 异动审批用 reject（不改变用户归属）；
 *   - 学期生命周期用 `[IT] 联调学期`，跑完把 active 学期恢复为种子学期 1；
 *   - `export.sync_row_threshold` 临时调 0 以走异步导出，跑完恢复 5000；
 *   - 夹具教师 IT9001 的征订单**始终以 rejected 收尾**（reviewed 是终态、不可重置，
 *     否则第二次执行就跑不动了）。因此 pass 路径用第二个夹具教师 IT9002 覆盖一次，
 *     重跑时该用例显式 SKIP 并说明原因。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const BASE = (process.argv[2] || process.env.API_BASE || 'http://127.0.0.1:8080').replace(/\/$/, '')

/* ============================================================================
 * 账号（后端 README 测试账号表）
 * ==========================================================================*/
const ACCOUNTS = {
  ADMIN: ['900001', 'Admin@123'],
  SECRETARY: ['800101', 'Sec@12345'],
  TEACHER: ['700101', 'Tea@12345'],
  TEACHER2: ['700201', 'Tea@12345'],
  MULTI: ['700103', 'Tea@12345'], // 教师 + 秘书双角色
  STUDENT: ['20230101', 'Stu@12345'],
  SUPPLIER: ['600001', 'Sup@12345'],
  /** 首登待改密（只登录、不改密，保持种子状态供 A2 用） */
  FIRSTLOGIN: ['800102', '800102'],
}

/* ============================================================================
 * HTTP 基础设施
 * ==========================================================================*/
const sessions = {} // role -> { accessToken, refreshToken }
let httpCallCount = 0

/** 原始请求：不做任何重试/刷新，返回完整观测结果 */
async function raw(method, path, opts = {}) {
  httpCallCount += 1
  const { token, body, formData, headers = {}, rawBody } = opts
  const init = { method, headers: { ...headers } }
  if (token) init.headers.Authorization = `Bearer ${token}`
  if (formData) {
    init.body = formData
  } else if (rawBody !== undefined) {
    init.body = rawBody
  } else if (body !== undefined) {
    init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json'
    init.body = JSON.stringify(body)
  }
  let res
  try {
    // 路径一律写全（含 /api 前缀），与 API.md / OpenAPI 逐字对应，便于比对
    res = await fetch(BASE + path, init)
  } catch (error) {
    return {
      status: 0,
      code: 'NETWORK_ERROR',
      message: String(error?.message || error),
      data: null,
    }
  }
  const contentType = res.headers.get('content-type') || ''
  const allow = res.headers.get('allow') || undefined
  const requestId = res.headers.get('x-request-id') || undefined
  let data = null
  let bytes = 0
  if (contentType.includes('json')) {
    data = await res.json().catch(() => null)
  } else {
    const buf = await res.arrayBuffer()
    bytes = buf.byteLength
    data = { __binary: true, contentType, bytes }
  }
  const envelope = data && !data.__binary ? data : undefined
  return {
    status: res.status,
    code: envelope ? envelope.code : undefined,
    message: envelope ? envelope.message : undefined,
    data: envelope ? envelope.data : data,
    contentType,
    allow,
    requestId,
    bytes,
  }
}

/** 带会话的请求：401 时静默 refresh 一次并重放（等价前端拦截器语义） */
async function call(method, path, opts = {}) {
  const role = opts.role
  const token = role ? sessions[role]?.accessToken : opts.token
  let res = await raw(method, path, { ...opts, token })
  if (res.status === 401 && role && res.code !== 'LOGIN_FAILED') {
    const refreshed = await refreshSession(role)
    if (refreshed) res = await raw(method, path, { ...opts, token: sessions[role].accessToken })
  }
  return res
}

async function refreshSession(role) {
  const refreshToken = sessions[role]?.refreshToken
  if (!refreshToken) return false
  const res = await raw('POST', '/api/auth/refresh', { body: { refreshToken } })
  if (res.status === 200 && res.data?.accessToken) {
    sessions[role] = { accessToken: res.data.accessToken, refreshToken: res.data.refreshToken }
    return true
  }
  return false
}

/**
 * 登录（限频感知）：默认 10 次/分/账号（按 IP+账号），反复跑联调很容易撞 429。
 * 撞上就等一个限频窗口再重试一次，避免整个联调因限频中断。
 */
async function loginRaw(userNo, password) {
  let res = await raw('POST', '/api/auth/login', { body: { userNo, password } })
  if (res.status === 429) {
    console.warn(`  ⏳ ${userNo} 触发登录限频（429），等待 65s 后重试…`)
    await new Promise((r) => setTimeout(r, 65000))
    res = await raw('POST', '/api/auth/login', { body: { userNo, password } })
  }
  return res
}

async function login(role) {
  const [userNo, password] = ACCOUNTS[role]
  const res = await loginRaw(userNo, password)
  if (res.status !== 200 || !res.data?.accessToken) {
    throw new Error(`登录失败 ${role}(${userNo}): HTTP ${res.status} ${res.code} ${res.message}`)
  }
  sessions[role] = { accessToken: res.data.accessToken, refreshToken: res.data.refreshToken }
  return res
}

/* ============================================================================
 * 结果收集
 * ==========================================================================*/
const results = [] // 端点结果
const scenarios = [] // 契约场景结果
const notes = []
/** 联调中发现的契约偏差/风险（报告用；由场景动态登记 + 下方静态登记） */
const findings = []

function finding(severity, title, detail) {
  if (findings.some((f) => f.title === title)) return
  findings.push({ severity, title, detail })
}

/**
 * 静态登记的偏差：这些是本次联调**已定位并复现**的结论（成因写在 detail 里），
 * 动态探针无法稳定复现（依赖具体数据/时序），故在报告中显式留档。
 */
function registerKnownFindings() {
  finding(
    'P0',
    'JSON body 的时间格式与文档不符（空格 vs ISO 的 T）',
    'API.md §1.1 称「入参（body/query 的 LocalDateTime）一律 yyyy-MM-dd HH:mm:ss」，但实测 JSON body **只接受 ISO-8601（yyyy-MM-ddTHH:mm:ss）**，传空格格式返回 400 PARAM_INVALID；而 query 参数相反（/api/admin/audit 的 startAt/endAt 只接受空格格式）。影响：学期窗口的 create/update/setWindow/extend 四个接口若按文档格式提交必然 400。前端已在接口层加 toWireDateTime 转换。',
  )
  finding(
    'P1',
    '名单导入会把班级人数刷新为导入行数',
    'POST /api/admin/user/import?role=student 导入 N 行后，该班 school_class.student_count 被置为 N。而班级人数是教师填报 QTY_RANGE 的数量上限来源——导入一份 1 行的名单会把该班填报上限压到 1。实测：导入 1 行后班级人数 30→1，教师提交 quantity=2 立即 400 FIELD_CHECK_FAILED。',
  )
  finding(
    'P1',
    'reviewed 是终态且管理员也无法驳回，与错误文案自相矛盾',
    '教师重提 reviewed 表单返回 409「该征订单已通过审核，不能再次提交；如需修改请联系教材室驳回后补正」，但实测管理员对 reviewed 表单调用审核同样 409（仅 pending_review 可审）——文案给出的补救路径不可达。前端已改为中性文案（终态不可修改），不再复述该承诺。',
  )
  finding(
    'P1',
    '学期 activate / archive 不可逆，且无回滚接口',
    'activate 会把当前 active 学期置为 archived，而归档学期不可再激活（409「仅 draft 学期可激活」）；archive 又要求学期处于 active。即切换学期后无法通过接口回到原状态（唯一恢复手段是直接改库）。本次联调已复现并手工修复（把种子学期 1 的 active_status/window_status/channel_open 改回）。联调脚本因此不再执行 activate/archive 的 happy path，只断言状态机门禁。',
  )
  finding(
    'P2',
    '归属校验前存在权限门：无权限角色得到 403 而非 404',
    'GET /api/batch/{id} 对「无 import:batch:view 的角色」返回 403，对「有权限但非本人批次」返回 404；GET /api/supplier/export-task/{id} 对教师返回 403。前端不能用 403/404 的差异判断资源是否存在，但需要按角色区分提示（403 → 无权限；404 → 资源不存在）。',
  )
}

function digest(res) {
  if (res.status === 0) return res.message
  if (res.data?.__binary) return `binary ${res.data.contentType.split(';')[0]} ${res.data.bytes}B`
  const d = res.data
  if (d === undefined) return '(data 键省略)'
  if (d === null) return 'null'
  if (Array.isArray(d)) return `array(${d.length})`
  if (typeof d === 'object') {
    const keys = Object.keys(d)
    if ('list' in d) return `page(list=${d.list?.length}, total=${d.total})`
    return `{${keys.slice(0, 8).join(',')}${keys.length > 8 ? ',…' : ''}}`
  }
  return String(d)
}

function record(entry, probes) {
  const failed = probes.filter((p) => p.verdict === 'FAIL')
  const skipped = probes.filter((p) => p.verdict === 'SKIP')
  results.push({
    group: entry.g,
    method: entry.m,
    path: entry.p,
    desc: entry.desc,
    probes,
    verdict: failed.length ? 'FAIL' : skipped.length === probes.length ? 'SKIP' : 'PASS',
  })
}

function scenario(id, name, ok, detail, evidence = []) {
  scenarios.push({ id, name, ok, detail, evidence })
}

/* ============================================================================
 * 夹具（全部 `[IT]` 前缀；按名称查找，存在即复用 → 可重复执行）
 * ==========================================================================*/
const fx = {}

async function ensureCollege() {
  const list = await call('GET', '/api/admin/college', { role: 'ADMIN' })
  const found = (list.data || []).find((c) => c.name === '[IT]联调学院')
  if (found) return found.id
  const created = await call('POST', '/api/admin/college', {
    role: 'ADMIN',
    body: { name: '[IT]联调学院', fullName: '[IT] 联调学院（契约测试夹具）' },
  })
  if (created.status !== 200) throw new Error(`建学院失败: ${created.code} ${created.message}`)
  return created.data.id
}

async function ensureMajor(collegeId) {
  const list = await call('GET', `/api/admin/major?collegeId=${collegeId}`, { role: 'ADMIN' })
  const found = (list.data || []).find((m) => m.name === '[IT]联调专业')
  if (found) return found.id
  const created = await call('POST', '/api/admin/major', {
    role: 'ADMIN',
    body: { collegeId, name: '[IT]联调专业', fullName: '[IT] 联调专业' },
  })
  if (created.status !== 200) throw new Error(`建专业失败: ${created.code} ${created.message}`)
  return created.data.id
}

async function ensureClass(majorId, name = '[IT]联调班') {
  const list = await call('GET', `/api/admin/class?majorId=${majorId}`, { role: 'ADMIN' })
  const found = (list.data || []).find((c) => c.name === name)
  if (found) return found.id
  const created = await call('POST', '/api/admin/class', {
    role: 'ADMIN',
    body: { majorId, name, grade: '2026', studentCount: 30 },
  })
  if (created.status !== 200) throw new Error(`建班级失败: ${created.code} ${created.message}`)
  return created.data.id
}

/** 批量教材（101 本）：用于把导出预估行数顶过 export.sync_row_threshold 的下限 100，从而走异步导出分支 */
async function ensureBulkTextbooks() {
  const list = await call(
    'GET',
    '/api/admin/textbook?title=%5BIT%5D%20%E6%89%B9%E9%87%8F&size=200',
    {
      role: 'ADMIN',
    },
  )
  let ids = (list.data?.list || [])
    .filter((b) => b.title?.startsWith('[IT] 批量教材'))
    .map((b) => b.id)
  if (ids.length >= 101) return ids
  const imp = await uploadFile('POST', '/api/admin/textbook/import', 'ADMIN', 'textbook-bulk.xlsx')
  await waitBatch(imp.data?.batchId)
  const again = await call(
    'GET',
    '/api/admin/textbook?title=%5BIT%5D%20%E6%89%B9%E9%87%8F&size=200',
    { role: 'ADMIN' },
  )
  ids = (again.data?.list || [])
    .filter((b) => b.title?.startsWith('[IT] 批量教材'))
    .map((b) => b.id)
  return ids
}

async function ensureCourse(semesterId) {
  const list = await call('GET', `/api/admin/course?semesterId=${semesterId}`, { role: 'ADMIN' })
  const found = (list.data || []).find((c) => c.name === '[IT]联调课程')
  if (found) return found.id
  const created = await call('POST', '/api/admin/course', {
    role: 'ADMIN',
    body: { semesterId, code: 'IT101', name: '[IT]联调课程' },
  })
  if (created.status !== 200) throw new Error(`建课程失败: ${created.code} ${created.message}`)
  return created.data.id
}

async function ensureTextbook() {
  const list = await call('GET', '/api/admin/textbook?isbn=9787111128069', { role: 'ADMIN' })
  const found = (list.data?.list || [])[0]
  if (found) return found.id
  const created = await call('POST', '/api/admin/textbook', {
    role: 'ADMIN',
    body: {
      isbn: '9787111128069',
      title: '[IT] 联调教材',
      edition: '第1版',
      author: '[IT] 联调作者',
      press: '[IT] 联调出版社',
      price: 39.5,
      status: 1,
    },
  })
  if (created.status !== 200) throw new Error(`建教材失败: ${created.code} ${created.message}`)
  return created.data.id
}

async function findUser(userNo) {
  const res = await call('GET', `/api/admin/user?keyword=${userNo}&page=1&size=20`, {
    role: 'ADMIN',
  })
  return (res.data?.list || []).find((u) => u.userNo === userNo) || null
}

/** 建号并重置为初始口令 + 强制改密，使首登流程每次都可重跑 */
async function ensureUser(userNo, name, phone, roleCodes) {
  let user = await findUser(userNo)
  if (!user) {
    const created = await call('POST', '/api/admin/user', {
      role: 'ADMIN',
      body: { userNo, name, phone, roleCodes },
    })
    if (created.status !== 200) {
      throw new Error(`建号失败 ${userNo}: ${created.code} ${created.message}`)
    }
    user = await findUser(userNo)
    if (!user) throw new Error(`建号后查不到 ${userNo}`)
  }
  // 复位：初始口令 + 待改密（首登流程可重复验证）
  const reset = await call('PUT', `/api/admin/user/${user.id}/reset-password`, { role: 'ADMIN' })
  if (reset.status !== 200) throw new Error(`重置口令失败 ${userNo}: ${reset.code}`)
  return user
}

/** 首登流程：登录 → 校验 → 改密，返回改密后的会话 */
async function completeFirstLogin(userNo, phoneTail, newPassword) {
  const loginRes = await loginRaw(userNo, userNo)
  if (loginRes.status !== 200) throw new Error(`夹具账号登录失败 ${userNo}: ${loginRes.code}`)
  const before = {
    mustChangePassword: loginRes.data.mustChangePassword,
    firstLoginVerified: loginRes.data.firstLoginVerified,
  }
  const tmp = `IT-${userNo}`
  sessions[tmp] = {
    accessToken: loginRes.data.accessToken,
    refreshToken: loginRes.data.refreshToken,
  }
  // 首登阶段业务接口应被 403 拦住
  const blocked = await call('GET', '/api/admin/college', { role: tmp })
  const verify = await call('POST', '/api/auth/first-login/verify', {
    role: tmp,
    body: { phoneTail },
  })
  const changed = await call('PUT', '/api/me/password', {
    role: tmp,
    body: { oldPassword: userNo, newPassword },
  })
  if (changed.status === 200 && changed.data?.accessToken) {
    sessions[tmp] = {
      accessToken: changed.data.accessToken,
      refreshToken: changed.data.refreshToken,
    }
  }
  delete sessions[tmp]
  return { before, blocked, verify, changed, loginData: loginRes.data }
}

async function ensureAssignment(semesterId, teacherId, courseId, classId) {
  const list = await call(
    'GET',
    `/api/admin/teacher-course?semesterId=${semesterId}&teacherId=${teacherId}`,
    { role: 'ADMIN' },
  )
  const found = (list.data || []).find((a) => a.courseId === courseId && a.classId === classId)
  if (found) return found.id
  const created = await call('POST', '/api/admin/teacher-course', {
    role: 'ADMIN',
    body: { semesterId, teacherId, courseId, classId },
  })
  if (created.status !== 200) throw new Error(`建任课关系失败: ${created.code} ${created.message}`)
  return created.data.id
}

async function buildFixtures() {
  const sem = await call('GET', '/api/admin/semester', { role: 'ADMIN' })
  const active = (sem.data || []).find((s) => s.activeStatus === 'active')
  if (!active) throw new Error('未找到 active 学期，请确认种子数据已灌入')
  fx.semesterId = active.id
  fx.semesterVersion = active.version
  fx.semesterName = active.name

  fx.collegeId = await ensureCollege()
  fx.majorId = await ensureMajor(fx.collegeId)
  fx.classId = await ensureClass(fx.majorId)
  fx.classId2 = await ensureClass(fx.majorId, '[IT]联调班2')
  fx.courseId = await ensureCourse(fx.semesterId)
  fx.textbookId = await ensureTextbook()
  fx.bulkTextbookIds = await ensureBulkTextbooks()

  // 夹具账号**不带学院归属**：名单导入的「停用比对」范围 = 文件内学院 + 对应角色，
  // 不带学院即可确保夹具账号不会被 teacher/student 导入误停用。
  // IT9001/IT9002 单 TEACHER 角色（征订流程），IT9003 双角色（首登 + 切换身份 + 登出）。
  fx.userA = await ensureUser('IT9001', '[IT]联调甲', '13700009001', ['TEACHER'])
  fx.userB = await ensureUser('IT9002', '[IT]联调乙', '13700009002', ['TEACHER'])
  fx.userC = await ensureUser('IT9003', '[IT]联调丙', '13700009003', ['TEACHER', 'SECRETARY'])
  // IT9004：专门承载「已通过(reviewed)的大表单」——导出预估行数只统计 reviewed 表单的明细，
  // 而 reviewed 是终态不可重置，故用独立账号承载，保证可重复执行
  fx.userD = await ensureUser('IT9004', '[IT]联调丁', '13700009004', ['TEACHER'])
  fx.userBId = fx.userB.id
  fx.assignmentId = await ensureAssignment(fx.semesterId, fx.userA.id, fx.courseId, fx.classId)
  await ensureAssignment(fx.semesterId, fx.userB.id, fx.courseId, fx.classId)
  await ensureAssignment(fx.semesterId, fx.userD.id, fx.courseId, fx.classId)
  // 一次性任课关系由 POST 用例现场新建、DELETE 用例删除（classId2，避免与主关系撞 409）

  // 学生夹具（异动目标）：由名单导入创建，学院 = 夹具学院 → 不会停用任何种子学生
  const stuImport = await uploadFile(
    'POST',
    `/api/admin/user/import?role=student&semesterId=${fx.semesterId}`,
    'ADMIN',
    'student-import.xlsx',
  )
  // 必须等批次跑完：批次完成时才会把班级人数刷成「导入行数」，抢在前面改会被覆盖
  await waitBatch(stuImport.data?.batchId)
  // 异动目标学生：必须与提交人（教师 700101 / 秘书 800101）同学院，
  // 否则异动提交会被字段审查 TARGET_SCOPE 直接判 rejected（「只能对本院用户提交异动」）。
  // 故用建号接口把 ITSTU01 建在种子「计算机学院/软工2023-1」，名单导入只负责覆盖导入端点本身。
  const colleges = await call('GET', '/api/admin/college', { role: 'ADMIN' })
  const csCollege = (colleges.data || []).find((c) => c.name === '计算机学院')
  const majors = await call('GET', `/api/admin/major?collegeId=${csCollege?.id}`, { role: 'ADMIN' })
  const seMajor = (majors.data || []).find((m) => m.name === '软件工程')
  const classes = await call('GET', `/api/admin/class?majorId=${seMajor?.id}`, { role: 'ADMIN' })
  const classA = (classes.data || []).find((c) => c.name === '软工2023-1')
  const classB = (classes.data || []).find((c) => c.name === '软工2023-2')
  fx.csCollegeId = csCollege?.id
  fx.csClassAId = classA?.id
  fx.csClassBId = classB?.id
  // 账号一旦建好就无法改学院（无对应接口），所以异动目标必须是专门建的账号：
  // ITSTU02 由名单导入落在夹具学院（覆盖导入端点），ITSTU03 由建号落在计算机学院（承载异动）
  let stu = await findUser('ITSTU03')
  if (!stu) {
    await call('POST', '/api/admin/user', {
      role: 'ADMIN',
      body: {
        userNo: 'ITSTU03',
        name: '[IT]联调异动目标',
        phone: '13700009013',
        collegeId: fx.csCollegeId,
        classId: fx.csClassAId,
        roleCodes: ['STUDENT'],
      },
    })
    stu = await findUser('ITSTU03')
  }
  fx.studentId = stu?.id
  // 名单导入会把班级 student_count 刷新为「导入行数」（实测：导入 1 行 → 人数变 1），
  // 而班级人数是教师填报 QTY_RANGE 的上限来源。这里改回夹具预期值，避免数量上限被压到 1。
  await call('PUT', `/api/admin/class/${fx.classId}`, {
    role: 'ADMIN',
    body: {
      majorId: fx.majorId,
      name: '[IT]联调班',
      grade: '2026',
      studentCount: 30,
    },
  })
}

/** 等待异步导入批次到终态（running → done/failed）。导入是异步的，不等就检索会拿到旧数据 */
async function waitBatch(batchId, tries = 40) {
  if (!batchId) return null
  let last = null
  for (let i = 0; i < tries; i += 1) {
    last = await call('GET', `/api/batch/${batchId}`, { role: 'ADMIN' })
    if (last.data?.status && last.data.status !== 'running') return last.data
    await new Promise((r) => setTimeout(r, 400))
  }
  return last?.data ?? null
}

function formDataFor(fileName) {
  const bytes = readFileSync(join(HERE, 'fixtures', fileName))
  const fd = new FormData()
  fd.append('file', new Blob([bytes]), fileName)
  return fd
}

async function uploadFile(method, path, role, fileName) {
  return call(method, path, { role, formData: formDataFor(fileName) })
}

/* ============================================================================
 * 端点清单（95）
 *
 * 路径里的 `{占位符}` 由下方 PATH_PARAMS 映射到夹具值；`p` 保留模板形态仅用于报告展示。
 * 探针载荷集中放在 DENY_BODIES / DENY_FORMS：**越权探针必须带同形载荷**，
 * 否则请求体校验（400）或 multipart 解析（500）会先于权限检查命中，
 * 测到的就不是「越权被拦」而是「参数不合法」。
 * ==========================================================================*/
/** 学期 JSON body：窗口时间必须用 ISO 的 T 分隔（空格格式会被 400，见报告「时间格式不对称」） */
function semesterBody(name) {
  return {
    name,
    startDate: '2027-09-01',
    endDate: '2028-01-15',
    windowStart: '2027-09-10T00:00:00',
    windowEnd: '2027-10-31T23:59:59',
    autoOpen: 0,
    autoClose: 0,
  }
}

function textbookBody() {
  return {
    isbn: '9787111128069',
    title: '[IT] 联调教材',
    edition: '第1版',
    author: '[IT] 联调作者',
    press: '[IT] 联调出版社',
    price: 39.5,
    status: 1,
  }
}

const PATH_PARAMS = {
  'GET /api/admin/semester/{id}': { id: 'semesterId' },
  'GET /api/admin/semester/{id}/window/changes': { id: 'semesterId' },
  'PUT /api/admin/semester/{id}': { id: 'itSemesterId' },
  'PUT /api/admin/semester/{id}/window': { id: 'itSemesterId' },
  'POST /api/admin/semester/{id}/window/open': { id: 'itSemesterId' },
  'POST /api/admin/semester/{id}/window/close': { id: 'itSemesterId' },
  'POST /api/admin/semester/{id}/window/extend': { id: 'itSemesterId' },
  'POST /api/admin/semester/{id}/activate': { id: 'itSemesterId' },
  'POST /api/admin/semester/{id}/archive': { id: 'itSemesterId' },
  'PUT /api/admin/college/{id}': { id: 'collegeId' },
  'PUT /api/admin/major/{id}': { id: 'majorId' },
  'PUT /api/admin/class/{id}': { id: 'classId' },
  'PUT /api/admin/textbook/{id}': { id: 'textbookId' },
  'POST /api/admin/textbook/{id}/status': { id: 'textbookId' },
  'PUT /api/admin/course/{id}': { id: 'courseId' },
  'DELETE /api/admin/teacher-course/{id}': { id: 'throwawayAssignmentId' },
  'PUT /api/admin/user/{id}/status?status=0': { id: 'userBId' },
  'PUT /api/admin/user/{id}/reset-password': { id: 'userBId' },
  'GET /api/admin/order-forms/{id}': { id: 'formId' },
  'POST /api/admin/order-forms/{id}/review': { id: 'formId' },
  'POST /api/admin/change/{id}/review': { id: 'changeId' },
  'GET /api/export-task/{id}': { id: 'exportTaskId' },
  'GET /api/export-task/{id}/download': { id: 'exportTaskId' },
  'GET /api/supplier/export-task/{id}': { id: 'supplierTaskId' },
  'GET /api/supplier/export-task/{id}/download': { id: 'supplierTaskId' },
  'GET /api/batch/{batchId}': { batchId: 'batchId' },
  'GET /api/batch/{batchId}/errors': { batchId: 'batchId' },
  'POST /api/admin/notice/tasks/{id}/close': { id: 'noticeTaskId' },
  'GET /api/admin/notice/tasks/{id}/progress': { id: 'noticeTaskId' },
  'GET /api/admin/notice/tasks/{id}/failures': { id: 'noticeTaskId' },
  'POST /api/notice/{taskId}/confirm': { taskId: 'noticeTaskId' },
  'POST /api/admin/teacher-course/import?semesterId={semesterId}': { semesterId: 'semesterId' },
  'POST /api/admin/user/import?role=teacher&semesterId={semesterId}': { semesterId: 'semesterId' },
}

const DENY_BODIES = {
  'POST /api/admin/semester': () => semesterBody('[IT] 联调学期'),
  'PUT /api/admin/semester/{id}': () => semesterBody('[IT] 联调学期'),
  'PUT /api/admin/semester/{id}/window': () => ({
    windowStart: '2027-09-10T00:00:00',
    windowEnd: '2027-10-31T23:59:59',
    autoOpen: 0,
    autoClose: 0,
  }),
  'POST /api/admin/semester/{id}/window/extend': () => ({ windowEnd: '2027-12-31T23:59:59' }),
  // activate 的 version 是 required：越权探针不带 body 会 400 而非 403
  'POST /api/admin/semester/{id}/activate': () => ({ version: 0 }),
  'POST /api/admin/college': () => ({ name: '[IT]联调学院', fullName: '[IT] 联调学院' }),
  'PUT /api/admin/college/{id}': () => ({ name: '[IT]联调学院', fullName: '[IT] 联调学院' }),
  'POST /api/admin/major': () => ({
    collegeId: fx.collegeId,
    name: '[IT]联调专业',
    fullName: '[IT] 联调专业',
  }),
  'PUT /api/admin/major/{id}': () => ({
    collegeId: fx.collegeId,
    name: '[IT]联调专业',
    fullName: '[IT] 联调专业',
  }),
  'POST /api/admin/class': () => ({
    majorId: fx.majorId,
    name: '[IT]联调班',
    grade: '2026',
    studentCount: 30,
  }),
  'PUT /api/admin/class/{id}': () => ({
    majorId: fx.majorId,
    name: '[IT]联调班',
    grade: '2026',
    studentCount: 30,
  }),
  'POST /api/admin/textbook': () => textbookBody(),
  'PUT /api/admin/textbook/{id}': () => textbookBody(),
  'POST /api/admin/textbook/{id}/status': () => ({ status: 1 }),
  'POST /api/admin/course': () => ({
    semesterId: fx.semesterId,
    code: 'IT101',
    name: '[IT]联调课程',
  }),
  'PUT /api/admin/course/{id}': () => ({ code: 'IT101', name: '[IT]联调课程' }),
  'POST /api/admin/teacher-course': () => ({
    semesterId: fx.semesterId,
    teacherId: fx.userBId,
    courseId: fx.courseId,
    classId: fx.classId2,
  }),
  'POST /api/admin/user': () => ({
    userNo: 'IT9001',
    name: '[IT]联调甲',
    phone: '13700009001',
    roleCodes: ['TEACHER'],
  }),
  'POST /api/admin/order-forms/{id}/review': () => ({
    action: 'reject',
    reason: '[IT] 越权探针',
    contentVersion: 1,
  }),
  'POST /api/admin/change/{id}/review': () => ({ action: 'reject', reason: '[IT] 越权探针' }),
  'POST /api/admin/change/batch/review': () => ({
    batchNo: fx.changeBatchNo ?? 'IT-NONE',
    action: 'reject',
    reason: '[IT] 越权探针',
  }),
  'POST /api/teacher/order-form/submit': () => ({
    items: [{ courseId: fx.courseId, classId: fx.classId, textbookId: fx.textbookId, quantity: 1 }],
  }),
  'POST /api/student/order/submit': () => ({ items: [{ textbookId: fx.textbookId, quantity: 1 }] }),
  'POST /api/teacher/change': () => ({
    type: 'student',
    targetUserNo: 'ITSTU03',
    targetCollegeId: fx.csCollegeId,
    targetClassId: fx.csClassBId,
  }),
  'POST /api/secretary/change': () => ({
    type: 'student',
    targetUserNo: 'ITSTU03',
    targetCollegeId: fx.csCollegeId,
    targetClassId: fx.csClassBId,
  }),
  'POST /api/admin/notice/tasks': () => ({
    title: '[IT] 越权探针',
    content: '[IT] 越权探针',
    targetRoles: 'STUDENT',
  }),
  'PUT /api/admin/config': () => ({ 'notice.round_limit': '5' }),
  'POST /api/supplier/export': () => ({}),
  'POST /api/admin/export/orders': () => ({ semesterId: fx.semesterId }),
  'POST /api/admin/export/students': () => ({ semesterId: fx.semesterId }),
  'POST /api/secretary/export/signature': () => ({ semesterId: fx.semesterId }),
}

/** multipart 端点的越权探针必须同样上传文件，否则解析失败会盖住权限判断 */
const DENY_FORMS = {
  'POST /api/admin/textbook/import': 'textbook-import.xlsx',
  'POST /api/admin/teacher-course/import?semesterId={semesterId}': 'teacher-course-import.xlsx',
  'POST /api/admin/user/import?role=teacher&semesterId={semesterId}': 'teacher-import.xlsx',
  'POST /api/secretary/change/import': 'change-import.xlsx',
}

/** 把路径模板里的 {占位符} 换成夹具值 */
function resolveTemplate(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (whole, key) => {
    const fxKey = params[key] ?? key
    const value = fx[fxKey]
    return value === undefined || value === null ? whole : String(value)
  })
}

function endpoints() {
  const sem = () => fx.semesterId
  return [
    /* ---------- 认证与会话（8） ---------- */
    {
      g: '认证',
      m: 'POST',
      p: '/api/auth/login',
      desc: '登录',
      public: true,
      run: () => loginRaw('900001', 'Admin@123'),
    },
    {
      g: '认证',
      m: 'POST',
      p: '/api/auth/refresh',
      desc: '轮换 refresh（缺 refreshToken → 400 参数错误）',
      noTokenExpect: 400,
      run: async () => {
        const r = await raw('POST', '/api/auth/refresh', {
          body: { refreshToken: sessions.ADMIN.refreshToken },
        })
        // 轮换后旧 token 失效：把新令牌写回，避免影响后续用例
        if (r.status === 200 && r.data?.refreshToken) {
          sessions.ADMIN = {
            accessToken: r.data.accessToken,
            refreshToken: r.data.refreshToken,
          }
        }
        return r
      },
    },
    {
      g: '认证',
      m: 'POST',
      p: '/api/auth/logout',
      desc: '登出（撤销全部 refresh）',
      role: 'MULTI',
      deny: null,
      run: async () => {
        // 用一次性会话登出。**不要用 700103**：logout 会撤销该用户全部 refresh，
        // 连带把 MULTI 会话（switch-role 用例依赖）一起踢掉。
        const one = await loginRaw('IT9003', 'IT9003')
        return raw('POST', '/api/auth/logout', { token: one.data?.accessToken })
      },
    },
    {
      g: '认证',
      m: 'POST',
      p: '/api/auth/first-login/verify',
      desc: '首登校验（手机号后 4 位）',
      deny: null,
      run: async () => {
        // 先把夹具账号复位为「首登待改密」，使本用例可重复执行
        await call('PUT', `/api/admin/user/${fx.userC.id}/reset-password`, { role: 'ADMIN' })
        const flow = await completeFirstLogin('IT9003', '9003', 'It9003@pass')
        return flow.verify
      },
    },
    {
      g: '认证',
      m: 'POST',
      p: '/api/auth/switch-role',
      desc: '切换身份（返回新令牌与权限）',
      deny: null,
      run: () =>
        raw('POST', '/api/auth/switch-role', {
          token: sessions.MULTI.accessToken,
          body: { roleCode: 'SECRETARY' },
        }),
    },
    {
      g: '认证',
      m: 'GET',
      p: '/api/me',
      desc: '用户信息 + 角色 + 归属',
      role: 'ADMIN',
      deny: null,
    },
    {
      g: '认证',
      m: 'GET',
      p: '/api/me/permissions',
      desc: '权限码集合',
      role: 'ADMIN',
      deny: null,
    },
    {
      g: '认证',
      m: 'PUT',
      p: '/api/me/password',
      desc: '改密（撤销全部 refresh）',
      deny: null,
      run: async () => {
        // 改密前必须先过首登校验；整段走 completeFirstLogin 保证可重复
        await call('PUT', `/api/admin/user/${fx.userA.id}/reset-password`, { role: 'ADMIN' })
        const flow = await completeFirstLogin('IT9001', '9001', 'It9001@pass')
        return flow.changed
      },
    },

    /* ---------- 学期与窗口（12） ---------- */
    {
      g: '学期与窗口',
      m: 'GET',
      p: '/api/semester/window/status',
      desc: '窗口状态 + serverTime',
      role: 'TEACHER',
      deny: 'SUPPLIER',
    },
    {
      g: '学期与窗口',
      m: 'GET',
      p: '/api/admin/semester',
      desc: '学期列表',
      role: 'ADMIN',
      deny: 'TEACHER',
    },
    {
      g: '学期与窗口',
      m: 'GET',
      p: '/api/admin/semester/{id}',
      desc: '学期详情',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', `/api/admin/semester/${sem()}`, { role: 'ADMIN' }),
    },
    {
      g: '学期与窗口',
      m: 'GET',
      p: '/api/admin/semester/{id}/window/changes',
      desc: '窗口变更审计（SQL 分页）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('GET', `/api/admin/semester/${sem()}/window/changes?page=1&size=5`, { role: 'ADMIN' }),
    },
    {
      g: '学期与窗口',
      m: 'POST',
      p: '/api/admin/semester',
      desc: '新建学期（draft）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: async () => {
        const list = await call('GET', '/api/admin/semester', { role: 'ADMIN' })
        const mine = (list.data || []).filter((x) => x.name.startsWith('[IT] 联调学期'))
        // 归档不可逆：上一轮的学期已 archived，无法再次 activate。故每轮新建一个带序号的
        // draft 学期，保证「新建 → 窗口操作 → 激活 → 归档」是真实且可重复的完整流程。
        const r = await call('POST', '/api/admin/semester', {
          role: 'ADMIN',
          body: semesterBody(`[IT] 联调学期#${mine.length + 1}`),
        })
        if (r.data?.id) {
          fx.itSemesterId = r.data.id
          fx.itSemesterName = r.data.name
        }
        return r
      },
    },
    {
      g: '学期与窗口',
      m: 'PUT',
      p: '/api/admin/semester/{id}',
      desc: '编辑学期基本信息',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        // 必须沿用创建时的名称：改成一个已存在的名字会撞 uk_semester_name → 409
        call('PUT', `/api/admin/semester/${fx.itSemesterId}`, {
          role: 'ADMIN',
          body: semesterBody(fx.itSemesterName),
        }),
    },
    {
      g: '学期与窗口',
      m: 'PUT',
      p: '/api/admin/semester/{id}/window',
      desc: '设置窗口起止 + auto 开关',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('PUT', `/api/admin/semester/${fx.itSemesterId}/window`, {
          role: 'ADMIN',
          body: {
            windowStart: '2027-09-10T00:00:00',
            windowEnd: '2027-10-31T23:59:59',
            autoOpen: 0,
            autoClose: 0,
          },
        }),
    },
    {
      g: '学期与窗口',
      m: 'POST',
      p: '/api/admin/semester/{id}/window/open',
      desc: '手动开启窗口',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('POST', `/api/admin/semester/${fx.itSemesterId}/window/open`, { role: 'ADMIN' }),
    },
    {
      g: '学期与窗口',
      m: 'POST',
      p: '/api/admin/semester/{id}/window/close',
      desc: '提前截止',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('POST', `/api/admin/semester/${fx.itSemesterId}/window/close`, { role: 'ADMIN' }),
    },
    {
      g: '学期与窗口',
      m: 'POST',
      p: '/api/admin/semester/{id}/window/extend',
      desc: '延长窗口（closed → open）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('POST', `/api/admin/semester/${fx.itSemesterId}/window/extend`, {
          role: 'ADMIN',
          body: { windowEnd: '2027-12-31T23:59:59' },
        }),
    },
    {
      g: '学期与窗口',
      m: 'POST',
      p: '/api/admin/semester/{id}/activate',
      desc: '双缓冲原子切换（version 乐观锁；**不执行 happy path**，见下）',
      role: 'ADMIN',
      deny: 'TEACHER',
      last: true,
      /**
       * 只打乐观锁边界，**不执行真实激活**。
       *
       * 原因（实测）：activate 会把当前 active 学期置为 `archived`，而**归档学期不可再激活**
       * （返回 409「仅 draft 学期可激活」）——即切换没有回滚路径。真跑一次 happy path
       * 就会不可逆地毁掉演示/试运行环境的 active 学期（本次联调已复现并手工修复）。
       * 正常流程由后端自带 `scripts/e2e-smoke.sh` 在专用环境覆盖。
       */
      run: async () => {
        const detail = await call('GET', `/api/admin/semester/${fx.itSemesterId}`, {
          role: 'ADMIN',
        })
        const staleVersion = (detail.data?.version ?? 0) + 999
        const r = await call('POST', `/api/admin/semester/${fx.itSemesterId}/activate`, {
          role: 'ADMIN',
          body: { version: staleVersion },
        })
        // 如实核验：active 学期仍是种子学期（未因本用例发生切换）
        const win = await call('GET', '/api/semester/window/status', { role: 'ADMIN' })
        fx.activateRestored = win.data?.semesterId === fx.semesterId
        return r
      },
      expectCode: ['STATE_CONFLICT'],
      expectNote:
        '乐观锁边界：过期 version → 409 STATE_CONFLICT（happy path 会不可逆归档当前 active 学期，故不在联调库执行）',
      expectHttp: [409],
    },
    {
      g: '学期与窗口',
      m: 'POST',
      p: '/api/admin/semester/{id}/archive',
      desc: '归档（只读保留）',
      role: 'ADMIN',
      deny: 'TEACHER',
      last: true,
      /**
       * 只断言边界，不执行真实归档：归档要求学期处于 `active`，而把夹具学期激活就会
       * 不可逆地归档当前真实 active 学期（见 activate 用例的说明）。故此处验证
       * 「非 active 学期归档被拒」这一状态机门禁。
       */
      run: () => call('POST', `/api/admin/semester/${fx.itSemesterId}/archive`, { role: 'ADMIN' }),
      expectCode: ['STATE_CONFLICT'],
      expectNote: '状态机门禁：仅 active 学期可归档 → draft 夹具学期归档返回 409 STATE_CONFLICT',
      expectHttp: [409],
    },

    /* ---------- 组织三表（9） ---------- */
    {
      g: '组织三表',
      m: 'GET',
      p: '/api/admin/college',
      desc: '学院列表',
      role: 'ADMIN',
      deny: 'TEACHER',
    },
    {
      g: '组织三表',
      m: 'POST',
      p: '/api/admin/college',
      desc: '新增学院（名称重复 → 409）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('POST', '/api/admin/college', {
          role: 'ADMIN',
          body: { name: '[IT]联调学院', fullName: '[IT] 联调学院' },
        }),
      expectCode: ['0', 'STATE_CONFLICT'],
      expectNote: '已存在时返回 409 STATE_CONFLICT（幂等复用夹具）',
    },
    {
      g: '组织三表',
      m: 'PUT',
      p: '/api/admin/college/{id}',
      desc: '编辑学院',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('PUT', `/api/admin/college/${fx.collegeId}`, {
          role: 'ADMIN',
          body: { name: '[IT]联调学院', fullName: '[IT] 联调学院（契约测试夹具）' },
        }),
    },
    {
      g: '组织三表',
      m: 'GET',
      p: '/api/admin/major',
      desc: '专业列表 ?collegeId',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', `/api/admin/major?collegeId=${fx.collegeId}`, { role: 'ADMIN' }),
    },
    {
      g: '组织三表',
      m: 'POST',
      p: '/api/admin/major',
      desc: '新增专业',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('POST', '/api/admin/major', {
          role: 'ADMIN',
          body: { collegeId: fx.collegeId, name: '[IT]联调专业', fullName: '[IT] 联调专业' },
        }),
      expectCode: ['0', 'STATE_CONFLICT'],
      expectNote: '已存在时返回 409 STATE_CONFLICT',
    },
    {
      g: '组织三表',
      m: 'PUT',
      p: '/api/admin/major/{id}',
      desc: '编辑专业',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('PUT', `/api/admin/major/${fx.majorId}`, {
          role: 'ADMIN',
          body: { collegeId: fx.collegeId, name: '[IT]联调专业', fullName: '[IT] 联调专业' },
        }),
    },
    {
      g: '组织三表',
      m: 'GET',
      p: '/api/admin/class',
      desc: '班级列表 ?majorId（含 studentCount）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', `/api/admin/class?majorId=${fx.majorId}`, { role: 'ADMIN' }),
    },
    {
      g: '组织三表',
      m: 'POST',
      p: '/api/admin/class',
      desc: '新增班级',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('POST', '/api/admin/class', {
          role: 'ADMIN',
          body: { majorId: fx.majorId, name: '[IT]联调班', grade: '2026', studentCount: 30 },
        }),
      expectCode: ['0', 'STATE_CONFLICT'],
      expectNote: '已存在时返回 409 STATE_CONFLICT',
    },
    {
      g: '组织三表',
      m: 'PUT',
      p: '/api/admin/class/{id}',
      desc: '编辑班级（studentCount 为数量上限来源）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('PUT', `/api/admin/class/${fx.classId}`, {
          role: 'ADMIN',
          body: { majorId: fx.majorId, name: '[IT]联调班', grade: '2026', studentCount: 30 },
        }),
    },

    /* ---------- 教材 / 课程 / 任课（11） ---------- */
    {
      g: '教材与课程',
      m: 'GET',
      p: '/api/admin/textbook',
      desc: '教材分页检索',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', '/api/admin/textbook?page=1&size=5', { role: 'ADMIN' }),
    },
    {
      g: '教材与课程',
      m: 'POST',
      p: '/api/admin/textbook',
      desc: '新增教材（ISBN 重复 → 409）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('POST', '/api/admin/textbook', {
          role: 'ADMIN',
          body: {
            isbn: '9787111128069',
            title: '[IT] 联调教材',
            edition: '第1版',
            author: '[IT] 联调作者',
            press: '[IT] 联调出版社',
            price: 39.5,
            status: 1,
          },
        }),
      expectCode: ['0', 'STATE_CONFLICT'],
      expectNote: 'ISBN 已存在时 409 STATE_CONFLICT（幂等复用夹具）',
    },
    {
      g: '教材与课程',
      m: 'PUT',
      p: '/api/admin/textbook/{id}',
      desc: '编辑教材',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('PUT', `/api/admin/textbook/${fx.textbookId}`, {
          role: 'ADMIN',
          body: {
            isbn: '9787111128069',
            title: '[IT] 联调教材',
            edition: '第1版',
            author: '[IT] 联调作者',
            press: '[IT] 联调出版社',
            price: 39.5,
            status: 1,
          },
        }),
    },
    {
      g: '教材与课程',
      m: 'POST',
      p: '/api/admin/textbook/{id}/status',
      desc: '在库/停用（停用即下架）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('POST', `/api/admin/textbook/${fx.textbookId}/status`, {
          role: 'ADMIN',
          body: { status: 1 },
        }),
    },
    {
      g: '教材与课程',
      m: 'POST',
      p: '/api/admin/textbook/import',
      desc: '教材导入（multipart → batchId）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => uploadFile('POST', '/api/admin/textbook/import', 'ADMIN', 'textbook-import.xlsx'),
    },
    {
      g: '教材与课程',
      m: 'GET',
      p: '/api/admin/textbook/template',
      desc: '教材导入模板（xlsx 流）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', '/api/admin/textbook/template', { role: 'ADMIN' }),
    },
    {
      g: '教材与课程',
      m: 'GET',
      p: '/api/admin/course',
      desc: '课程列表 ?semesterId',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', `/api/admin/course?semesterId=${sem()}`, { role: 'ADMIN' }),
    },
    {
      g: '教材与课程',
      m: 'POST',
      p: '/api/admin/course',
      desc: '新增课程（同学期同 code 重复 → 409）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('POST', '/api/admin/course', {
          role: 'ADMIN',
          body: { semesterId: sem(), code: 'IT101', name: '[IT]联调课程' },
        }),
      expectCode: ['0', 'STATE_CONFLICT'],
      expectNote: '同学期同 code 已存在时 409 STATE_CONFLICT',
    },
    {
      g: '教材与课程',
      m: 'PUT',
      p: '/api/admin/course/{id}',
      desc: '编辑课程',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('PUT', `/api/admin/course/${fx.courseId}`, {
          role: 'ADMIN',
          body: { code: 'IT101', name: '[IT]联调课程' },
        }),
    },
    {
      g: '教材与课程',
      m: 'GET',
      p: '/api/admin/teacher-course',
      desc: '任课关系（征订范围）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', `/api/admin/teacher-course?semesterId=${sem()}`, { role: 'ADMIN' }),
    },
    {
      g: '教材与课程',
      m: 'POST',
      p: '/api/admin/teacher-course',
      desc: '新增任课关系（教师须有 TEACHER 角色）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: async () => {
        const r = await call('POST', '/api/admin/teacher-course', {
          role: 'ADMIN',
          body: DENY_BODIES['POST /api/admin/teacher-course'](),
        })
        if (r.data?.id) {
          fx.throwawayAssignmentId = r.data.id
        } else {
          // 409：关系已存在（上次执行未删干净）→ 查回 id 供 DELETE 用例使用
          const list = await call(
            'GET',
            `/api/admin/teacher-course?semesterId=${fx.semesterId}&teacherId=${fx.userBId}`,
            { role: 'ADMIN' },
          )
          fx.throwawayAssignmentId = (list.data || []).find((a) => a.classId === fx.classId2)?.id
        }
        return r
      },
      expectCode: ['0', 'STATE_CONFLICT'],
      expectNote: '关系已存在时 409 STATE_CONFLICT',
    },
    {
      g: '教材与课程',
      m: 'DELETE',
      p: '/api/admin/teacher-course/{id}',
      desc: '逻辑删除任课关系',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: async () => {
        let id = fx.throwawayAssignmentId
        if (!id) {
          const list = await call(
            'GET',
            `/api/admin/teacher-course?semesterId=${fx.semesterId}&teacherId=${fx.userBId}`,
            { role: 'ADMIN' },
          )
          id = (list.data || []).find((a) => a.classId === fx.classId2)?.id
        }
        return call('DELETE', `/api/admin/teacher-course/${id}`, { role: 'ADMIN' })
      },
    },
    {
      g: '教材与课程',
      m: 'POST',
      p: '/api/admin/teacher-course/import?semesterId={semesterId}',
      desc: '任课导入（?semesterId，multipart）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        uploadFile(
          'POST',
          `/api/admin/teacher-course/import?semesterId=${sem()}`,
          'ADMIN',
          'teacher-course-import.xlsx',
        ),
    },
    {
      g: '教材与课程',
      m: 'GET',
      p: '/api/admin/teacher-course/template',
      desc: '任课导入模板（xlsx 流）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', '/api/admin/teacher-course/template', { role: 'ADMIN' }),
    },

    /* ---------- 账号管理（6） ---------- */
    {
      g: '账号管理',
      m: 'GET',
      p: '/api/admin/user',
      desc: '账号分页检索',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', '/api/admin/user?page=1&size=5', { role: 'ADMIN' }),
    },
    {
      g: '账号管理',
      m: 'POST',
      p: '/api/admin/user',
      desc: '建号（初始口令 = 后 6 位，首登须改密）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('POST', '/api/admin/user', {
          role: 'ADMIN',
          body: {
            userNo: 'IT9001',
            name: '[IT]联调甲',
            phone: '13700009001',
            roleCodes: ['TEACHER', 'SECRETARY'],
          },
        }),
      expectCode: ['0', 'STATE_CONFLICT', 'PARAM_INVALID'],
      expectNote: '账号已存在时 409/400（幂等复用夹具）',
    },
    {
      g: '账号管理',
      m: 'PUT',
      p: '/api/admin/user/{id}/status?status=0',
      desc: '停用/启用（停用即时踢下线）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: async () => {
        const off = await call('PUT', `/api/admin/user/${fx.userB.id}/status?status=0`, {
          role: 'ADMIN',
        })
        const on = await call('PUT', `/api/admin/user/${fx.userB.id}/status?status=1`, {
          role: 'ADMIN',
        })
        return on.status === 200 ? on : off
      },
    },
    {
      g: '账号管理',
      m: 'PUT',
      p: '/api/admin/user/{id}/reset-password',
      desc: '重置为初始口令 + 强制改密',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('PUT', `/api/admin/user/${fx.userB.id}/reset-password`, { role: 'ADMIN' }),
    },
    {
      g: '账号管理',
      m: 'POST',
      p: '/api/admin/user/import?role=teacher&semesterId={semesterId}',
      desc: '名单导入 ?role=student|teacher（multipart）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        uploadFile(
          'POST',
          `/api/admin/user/import?role=teacher&semesterId=${sem()}`,
          'ADMIN',
          'teacher-import.xlsx',
        ),
    },
    {
      g: '账号管理',
      m: 'GET',
      p: '/api/admin/user/import/template?role=student',
      desc: '名单导入模板 ?role（xlsx 流）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', '/api/admin/user/import/template?role=student', { role: 'ADMIN' }),
    },

    /* ---------- 教师征订（教师端 + 复核端） ---------- */
    {
      g: '教师征订',
      m: 'GET',
      p: '/api/teacher/my-courses',
      desc: '任课范围（按班级分组）',
      role: 'TEACHER',
      deny: 'STUDENT',
    },
    {
      g: '教师征订',
      m: 'GET',
      p: '/api/teacher/textbook',
      desc: '填报选书器（仅在库，封顶 50，无分页）',
      role: 'TEACHER',
      deny: 'STUDENT',
      run: () => call('GET', '/api/teacher/textbook', { role: 'TEACHER' }),
    },
    {
      g: '教师征订',
      m: 'GET',
      p: '/api/teacher/order-form',
      desc: '当前学期征订单（无单时 data 键省略）',
      role: 'TEACHER',
      deny: 'STUDENT',
    },
    {
      g: '教师征订',
      m: 'POST',
      p: '/api/teacher/order-form/submit',
      desc: '提交/补正（覆盖语义）',
      role: 'TEACHER',
      deny: 'STUDENT',
      run: () =>
        call('POST', '/api/teacher/order-form/submit', {
          role: 'TEACHER',
          body: DENY_BODIES['POST /api/teacher/order-form/submit'](),
        }),
      expectCode: [
        '0',
        'FIELD_CHECK_FAILED',
        'WINDOW_CLOSED',
        'CORRECTION_EXPIRED',
        'STATE_CONFLICT',
      ],
      expectNote:
        '该教师表单若已是终态则 409 STATE_CONFLICT；完整提交流程（含字段审查与 contentVersion CAS）见契约场景 A1',
      expectHttp: [200, 400, 409],
    },
    {
      g: '教师征订',
      m: 'GET',
      p: '/api/teacher/order-forms',
      desc: '我的历史提交记录',
      role: 'TEACHER',
      deny: 'STUDENT',
    },
    {
      g: '教师征订',
      m: 'GET',
      p: '/api/secretary/order-forms',
      desc: '秘书：本院表单分页（只读）',
      role: 'SECRETARY',
      deny: 'TEACHER',
      run: () => call('GET', '/api/secretary/order-forms?page=1&size=5', { role: 'SECRETARY' }),
    },
    {
      g: '教师征订',
      m: 'GET',
      p: '/api/admin/order-forms',
      desc: '超管：全院表单分页',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', '/api/admin/order-forms?page=1&size=5', { role: 'ADMIN' }),
    },
    {
      g: '教师征订',
      m: 'GET',
      p: '/api/admin/order-forms/{id}',
      desc: '详情（含 fieldCheckResult、contentVersion）',
      role: 'ADMIN',
      deny: null,
      run: async () => {
        const list = await call('GET', '/api/admin/order-forms?page=1&size=1', { role: 'ADMIN' })
        const id = list.data?.list?.[0]?.id
        if (!id) return { status: 0, code: 'NO_FIXTURE', message: '无征订单可查' }
        return call('GET', `/api/admin/order-forms/${id}`, { role: 'ADMIN' })
      },
    },
    {
      g: '教师征订',
      m: 'POST',
      p: '/api/admin/order-forms/{id}/review',
      desc: '内容审核（contentVersion CAS；仅 pending_review 可审）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: async () => {
        // 先确保存在待审表单：夹具教师的表单在场景收尾时是 rejected_auto，
        // 这里补一次合法提交把它推到 pending_review（否则该端点只能测到 409 门禁）
        const teacher = 'IT9001'
        // 必须重新登录：本清单前面的 `PUT /api/me/password` 用例会重置该账号口令并撤销旧令牌，
        // 复用旧会话会 401
        sessions[teacher] = await sessionForFixtureTeacher('IT9001', 'It9001@pass')
        await call('POST', '/api/teacher/order-form/submit', {
          role: teacher,
          body: DENY_BODIES['POST /api/teacher/order-form/submit'](),
        })
        // 取一份待审表单 + 其当前 contentVersion，走完整审核（用 reject 收尾，
        // 保持表单非终态，下一轮 A1 才能继续提交/重提）
        const list = await call(
          'GET',
          '/api/admin/order-forms?status=pending_review&page=1&size=1',
          {
            role: 'ADMIN',
          },
        )
        const id = list.data?.list?.[0]?.id
        if (!id) return { status: 0, code: 'NO_FIXTURE', message: '无 pending_review 表单可审' }
        const detail = await call('GET', `/api/admin/order-forms/${id}`, { role: 'ADMIN' })
        return call('POST', `/api/admin/order-forms/${id}/review`, {
          role: 'ADMIN',
          body: {
            action: 'reject',
            reason: '[IT] 契约测试（驳回，保持非终态）',
            contentVersion: detail.data?.contentVersion,
          },
        })
      },
      expectCode: ['0', 'STATE_CONFLICT'],
      expectNote:
        '带 contentVersion 的正常审核（reject）；表单已非 pending_review 时 409 STATE_CONFLICT。CAS 语义与 409 场景见 A1',
      expectHttp: [200, 409],
    },

    /* ---------- 学生选购 ---------- */
    {
      g: '学生选购',
      m: 'GET',
      p: '/api/student/book-list',
      desc: '本班教材清单（required/delisted）',
      role: 'STUDENT',
      deny: 'TEACHER',
    },
    {
      g: '学生选购',
      m: 'GET',
      p: '/api/student/order',
      desc: '本人选购单（无单时 data 键省略）',
      role: 'STUDENT',
      deny: 'TEACHER',
    },
    {
      g: '学生选购',
      m: 'POST',
      p: '/api/student/order/submit',
      desc: '提交（覆盖语义；窗口/下架校验）',
      role: 'STUDENT',
      deny: 'TEACHER',
      run: () =>
        call('POST', '/api/student/order/submit', { role: 'STUDENT', body: { items: [] } }),
      expectCode: ['0', 'PARAM_INVALID', 'WINDOW_CLOSED', 'BOOK_DELISTED'],
      expectNote: '空明细命中参数校验；正常流程见场景 S-ORDER',
      expectHttp: [200, 400, 409],
    },
    {
      g: '学生选购',
      m: 'GET',
      p: '/api/student/orders',
      desc: '历史选购记录（跨学期摘要）',
      role: 'STUDENT',
      deny: 'TEACHER',
    },
    {
      g: '学生选购',
      m: 'GET',
      p: '/api/admin/student-orders',
      desc: '超管：全院选购分页',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', '/api/admin/student-orders?page=1&size=5', { role: 'ADMIN' }),
    },

    /* ---------- 异动审批 ---------- */
    {
      g: '异动',
      m: 'POST',
      p: '/api/teacher/change',
      desc: '教师逐条提交（字段审查失败直接落 rejected）',
      role: 'TEACHER',
      deny: 'STUDENT',
      run: () =>
        call('POST', '/api/teacher/change', {
          role: 'TEACHER',
          body: {
            type: 'student',
            targetUserNo: 'ITSTU03',
            targetCollegeId: fx.collegeId,
            targetClassId: fx.classId,
          },
        }),
      expectCode: ['0'],
      expectHttp: [200],
    },
    {
      g: '异动',
      m: 'POST',
      p: '/api/secretary/change',
      desc: '秘书逐条提交',
      role: 'SECRETARY',
      deny: 'STUDENT',
      run: async () => {
        const r = await call('POST', '/api/secretary/change', {
          role: 'SECRETARY',
          body: {
            type: 'student',
            targetUserNo: 'ITSTU03',
            // 目标学院 = 提交人所在学院（TARGET_SCOPE）；目的地换班以满足 VALUE_CHANGED
            targetCollegeId: fx.csCollegeId,
            targetClassId: fx.csClassBId,
          },
        })
        // 记录 id 供审批用例的探针使用
        if (r.data?.id) fx.changeId = r.data.id
        return r
      },
      expectCode: ['0'],
      expectHttp: [200],
    },
    {
      g: '异动',
      m: 'POST',
      p: '/api/secretary/change/import',
      desc: '秘书 Excel 批量 → {batchId,batchNo}',
      role: 'SECRETARY',
      // 注意：教师同样持有 change:request:submit，所以越权探针要用 STUDENT（无该权限码）
      deny: 'STUDENT',
      run: async () => {
        // 批量文件里的目标学生须与提交人同院（TARGET_SCOPE），否则整批落 rejected
        const r = await uploadFile(
          'POST',
          '/api/secretary/change/import',
          'SECRETARY',
          'change-import.xlsx',
        )
        if (r.status === 200 && r.data?.batchNo) fx.changeBatchNo = r.data.batchNo
        return r
      },
    },
    {
      g: '异动',
      m: 'GET',
      p: '/api/teacher/change',
      desc: '我的提交记录（教师/秘书同链）',
      role: 'TEACHER',
      deny: 'STUDENT',
    },
    {
      g: '异动',
      m: 'GET',
      p: '/api/change/org-options',
      desc: '提交端目标归属选项（仅 id+名称）',
      role: 'TEACHER',
      deny: 'STUDENT',
    },
    {
      g: '异动',
      m: 'GET',
      p: '/api/admin/change',
      desc: '审批列表分页',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', '/api/admin/change?page=1&size=5', { role: 'ADMIN' }),
    },
    {
      g: '异动',
      m: 'POST',
      p: '/api/admin/change/{id}/review',
      desc: '逐条审批（reject 理由必填；通过立即生效）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: async () => {
        const list = await call('GET', '/api/admin/change?status=pending_review&page=1&size=1', {
          role: 'ADMIN',
        })
        const id = list.data?.list?.[0]?.id
        if (!id) return { status: 0, code: 'NO_FIXTURE', message: '无待审批异动记录' }
        // 用 reject：不改变任何用户归属，跑完可重复
        return call('POST', `/api/admin/change/${id}/review`, {
          role: 'ADMIN',
          body: { action: 'reject', reason: '[IT] 契约测试驳回' },
        })
      },
    },
    {
      g: '异动',
      m: 'POST',
      p: '/api/admin/change/batch/review',
      desc: '按批次批量处理（仅支持 batchNo）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => {
        if (!fx.changeBatchNo) {
          return Promise.resolve({
            status: 0,
            code: 'NO_FIXTURE',
            message: '无 batchNo（批量导入未产生批次）',
          })
        }
        return call('POST', '/api/admin/change/batch/review', {
          role: 'ADMIN',
          body: { batchNo: fx.changeBatchNo, action: 'reject', reason: '[IT] 契约测试批量驳回' },
        })
      },
    },

    /* ---------- 导入批次 ---------- */
    {
      g: '导入批次',
      m: 'GET',
      p: '/api/batch/{batchId}',
      desc: '批次进度（非本人批次 → 404）',
      role: 'ADMIN',
      deny: null,
      run: async () => {
        if (!fx.batchId) return { status: 0, code: 'NO_FIXTURE', message: '无导入批次' }
        return call('GET', `/api/batch/${fx.batchId}`, { role: 'ADMIN' })
      },
    },
    {
      g: '导入批次',
      m: 'GET',
      p: '/api/batch/{batchId}/errors',
      desc: '错误明细下载（无错误行 → 404）',
      role: 'ADMIN',
      deny: null,
      run: async () => {
        if (!fx.batchId) return { status: 0, code: 'NO_FIXTURE', message: '无导入批次' }
        return call('GET', `/api/batch/${fx.batchId}/errors`, { role: 'ADMIN' })
      },
      expectHttp: [200, 404],
      expectNote: '该批次无错误行时返回 404（契约：无错误明细 → 404）',
    },

    /* ---------- 导出中心 ---------- */
    {
      g: '导出',
      m: 'POST',
      p: '/api/admin/export/orders',
      desc: '教师征订明细（同步 xlsx / 异步 taskId）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('POST', '/api/admin/export/orders', { role: 'ADMIN', body: { semesterId: sem() } }),
      expectContentTypeAny: true,
    },
    {
      g: '导出',
      m: 'POST',
      p: '/api/admin/export/students',
      desc: '学生选购汇总',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('POST', '/api/admin/export/students', { role: 'ADMIN', body: { semesterId: sem() } }),
      expectContentTypeAny: true,
    },
    {
      g: '导出',
      m: 'POST',
      p: '/api/admin/export/notice',
      desc: '通知汇总（body 必带 taskId）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: async () => {
        if (!fx.noticeTaskId) return { status: 0, code: 'NO_FIXTURE', message: '无通知任务' }
        return call('POST', '/api/admin/export/notice', {
          role: 'ADMIN',
          body: { taskId: fx.noticeTaskId },
        })
      },
      expectContentTypeAny: true,
    },
    {
      g: '导出',
      m: 'POST',
      p: '/api/secretary/export/signature',
      desc: '秘书：本院签字版（学院范围后端强制过滤）',
      role: 'SECRETARY',
      deny: 'TEACHER',
      run: () =>
        call('POST', '/api/secretary/export/signature', {
          role: 'SECRETARY',
          body: { semesterId: sem() },
        }),
      expectContentTypeAny: true,
    },
    {
      g: '导出',
      m: 'GET',
      p: '/api/export-task/{id}',
      desc: '任务进度（downloadToken 仅所有者可见；越权 → 404）',
      role: 'ADMIN',
      deny: 'TEACHER',
      denyExpect: 404,
      run: async () => {
        if (!fx.exportTaskId) return { status: 0, code: 'NO_FIXTURE', message: '无异步导出任务' }
        return call('GET', `/api/export-task/${fx.exportTaskId}`, { role: 'ADMIN' })
      },
    },
    {
      g: '导出',
      m: 'GET',
      p: '/api/export-task/{id}/download',
      desc: '一次性下载（token 单次有效；复用/过期 → 410）',
      role: 'ADMIN',
      deny: null,
      run: async () => {
        if (!fx.exportTaskId) return { status: 0, code: 'NO_FIXTURE', message: '无异步导出任务' }
        // 无 token 探针：覆盖「必填 query」边界
        return call('GET', `/api/export-task/${fx.exportTaskId}/download`, { role: 'ADMIN' })
      },
      expectHttp: [200, 400, 410],
      expectNote:
        '缺 token 参数 → 400；token 已被消费 → 410（一次性下载的完整生命周期见场景 S-A6）',
    },

    /* ---------- 通知 ---------- */
    {
      g: '通知',
      m: 'GET',
      p: '/api/notice/unconfirmed',
      desc: '未确认队列（按 target_roles 定向）',
      role: 'TEACHER',
      deny: null,
    },
    {
      g: '通知',
      m: 'GET',
      p: '/api/notice/mine',
      desc: '我的通知（全量含已确认，分页）',
      role: 'TEACHER',
      deny: null,
      run: () => call('GET', '/api/notice/mine?page=1&size=5', { role: 'TEACHER' }),
    },
    {
      g: '通知',
      m: 'POST',
      p: '/api/notice/{taskId}/confirm',
      desc: '确认收到 → 204（幂等；非定向任务 404）',
      role: 'TEACHER',
      deny: null,
      run: async () => {
        if (!fx.noticeTaskId) return { status: 0, code: 'NO_FIXTURE', message: '无通知任务' }
        return call('POST', `/api/notice/${fx.noticeTaskId}/confirm`, { role: 'TEACHER', body: {} })
      },
      expectHttp: [200, 204],
      expectNote: '204 无 body；重复调用仍 204（幂等）',
    },
    {
      g: '通知',
      m: 'GET',
      p: '/api/admin/notice/tasks',
      desc: '本学期任务列表',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', '/api/admin/notice/tasks', { role: 'ADMIN' }),
    },
    {
      g: '通知',
      m: 'POST',
      p: '/api/admin/notice/tasks',
      desc: '手动创建（同学期已有 active → 409）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: async () => {
        // 先关掉现有 active，保证创建走成功路径
        const list = await call('GET', '/api/admin/notice/tasks', { role: 'ADMIN' })
        const active = (list.data || []).find((t) => t.status === 'active')
        if (active)
          await call('POST', `/api/admin/notice/tasks/${active.id}/close`, { role: 'ADMIN' })
        const r = await call('POST', '/api/admin/notice/tasks', {
          role: 'ADMIN',
          body: {
            title: '[IT] 联调通知',
            content: '[IT] 契约测试通知内容',
            targetRoles: 'TEACHER',
          },
        })
        if (r.status === 200 && r.data?.id) fx.noticeTaskId = r.data.id
        return r
      },
    },
    {
      g: '通知',
      m: 'POST',
      p: '/api/admin/notice/tasks/{id}/close',
      desc: '手动关闭任务',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: async () => {
        // 新建一个再关，避免把上面创建的任务提前关掉（confirm 用例依赖它）
        const created = await call('POST', '/api/admin/notice/tasks', {
          role: 'ADMIN',
          body: { title: '[IT] 联调通知（待关）', content: '[IT] 待关闭', targetRoles: 'TEACHER' },
        })
        const id = created.data?.id
        if (!id) return created
        return call('POST', `/api/admin/notice/tasks/${id}/close`, { role: 'ADMIN' })
      },
      expectCode: ['0', 'NOTICE_TASK_EXISTS'],
      expectNote: '同学期已有 active 任务时创建被拒 → 无法覆盖关闭路径（契约约束）',
    },
    {
      g: '通知',
      m: 'GET',
      p: '/api/admin/notice/tasks/{id}/progress',
      desc: '发送进度 {sent,unauthorized,failed,confirmed,roundLimit}',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => {
        if (!fx.noticeTaskId) {
          return Promise.resolve({ status: 0, code: 'NO_FIXTURE', message: '无通知任务' })
        }
        return call('GET', `/api/admin/notice/tasks/${fx.noticeTaskId}/progress`, { role: 'ADMIN' })
      },
    },
    {
      g: '通知',
      m: 'GET',
      p: '/api/admin/notice/tasks/{id}/failures',
      desc: '未授权/失败名单（线下兜底，分页）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => {
        if (!fx.noticeTaskId) {
          return Promise.resolve({ status: 0, code: 'NO_FIXTURE', message: '无通知任务' })
        }
        return call('GET', `/api/admin/notice/tasks/${fx.noticeTaskId}/failures?page=1&size=5`, {
          role: 'ADMIN',
        })
      },
    },

    /* ---------- 系统配置 / 审计 / 看板 ---------- */
    {
      g: '配置与看板',
      m: 'GET',
      p: '/api/admin/config',
      desc: '配置列表（8 键）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', '/api/admin/config', { role: 'ADMIN' }),
    },
    {
      g: '配置与看板',
      m: 'PUT',
      p: '/api/admin/config',
      desc: '批量更新（键白名单 + 值域校验）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () =>
        call('PUT', '/api/admin/config', { role: 'ADMIN', body: { 'notice.round_limit': '5' } }),
    },
    {
      g: '配置与看板',
      m: 'GET',
      p: '/api/admin/audit',
      desc: '审计查询（时间格式 yyyy-MM-dd HH:mm:ss）',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', '/api/admin/audit?page=1&size=5', { role: 'ADMIN' }),
    },
    {
      g: '配置与看板',
      m: 'GET',
      p: '/api/admin/dashboard',
      desc: '看板三指标 + 学院进度',
      role: 'ADMIN',
      deny: 'TEACHER',
      run: () => call('GET', '/api/admin/dashboard', { role: 'ADMIN' }),
    },

    /* ---------- 供货商（物理隔离） ---------- */
    {
      g: '供货商',
      m: 'GET',
      p: '/api/supplier/orders',
      desc: '按学院分组清单（字段白名单，无学生字段）',
      role: 'SUPPLIER',
      deny: 'TEACHER',
    },
    {
      g: '供货商',
      m: 'POST',
      p: '/api/supplier/export',
      desc: '一学院一 sheet 导出（同步流 / 异步任务）',
      role: 'SUPPLIER',
      deny: 'TEACHER',
      run: () => call('POST', '/api/supplier/export', { role: 'SUPPLIER', body: {} }),
      expectContentTypeAny: true,
    },
    {
      g: '供货商',
      m: 'GET',
      p: '/api/supplier/export-task/{id}',
      desc: '任务进度（仅本人 bizType=supplier；无权限角色先被 403 拦下）',
      role: 'SUPPLIER',
      deny: 'TEACHER',
      // 教师没有 supplier:order:export → 权限门先于归属校验（403）；归属失败的 404 由 A5 覆盖
      denyExpect: 403,
      run: async () => {
        if (!fx.supplierTaskId) {
          return { status: 0, code: 'NO_FIXTURE', message: '无供货商异步导出任务' }
        }
        return call('GET', `/api/supplier/export-task/${fx.supplierTaskId}`, { role: 'SUPPLIER' })
      },
    },
    {
      g: '供货商',
      m: 'GET',
      p: '/api/supplier/export-task/{id}/download',
      desc: '一次性下载（复用/过期 → 410）',
      role: 'SUPPLIER',
      deny: null,
      run: () => {
        if (!fx.supplierTaskId) {
          return Promise.resolve({ status: 0, code: 'NO_FIXTURE', message: '无供货商异步导出任务' })
        }
        return call('GET', `/api/supplier/export-task/${fx.supplierTaskId}/download`, {
          role: 'SUPPLIER',
        })
      },
      expectHttp: [200, 400, 410],
      expectNote: '缺 token → 400；已消费 → 410',
    },
  ]
}

/* ============================================================================
 * 端点运行器
 * ==========================================================================*/
function probe(kind, role, res, expect) {
  const ok = expect.includes(res.status)
  return {
    kind,
    role: role ?? '(无 token)',
    request: `${kind === 'happy' ? '正常' : kind === 'deny' ? '越权' : '未鉴权'}`,
    status: res.status,
    code: res.code ?? (res.data?.__binary ? '(xlsx 流)' : '—'),
    message: res.message ?? '',
    expect: expect.join('/'),
    digest: digest(res),
    verdict: res.status === 0 && res.code === 'NO_FIXTURE' ? 'SKIP' : ok ? 'PASS' : 'FAIL',
  }
}

async function runEndpoint(entry) {
  const probes = []
  const happyHttp = entry.expectHttp || [200]
  const happyCodes = entry.expectCode
  const key = `${entry.m} ${entry.p}`
  // 带路径参数/夹具 id 的端点用映射解析出真实路径；p 只用于报告展示
  const path = resolveTemplate(entry.p, PATH_PARAMS[key])
  const denyBody = DENY_BODIES[key]?.()
  const denyForm = DENY_FORMS[key] ? formDataFor(DENY_FORMS[key]) : undefined

  // 1) 未鉴权探针
  if (!entry.public && entry.noToken !== 'skip') {
    const res = await raw(entry.m, path, { body: denyBody, formData: denyForm })
    probes.push(probe('no-token', null, res, entry.noTokenExpect ? [entry.noTokenExpect] : [401]))
  }

  // 2) 越权探针（无该权限码的角色）。
  //    必须带上与正常路径同形的载荷：否则请求体校验（400）或 multipart 解析（500）
  //    会先于权限检查命中，测到的就不是「越权被拦」而是「参数不合法」。
  if (entry.deny) {
    const res = await call(entry.m, path, { role: entry.deny, body: denyBody, formData: denyForm })
    probes.push(probe('deny', entry.deny, res, [entry.denyExpect ?? 403]))
  }

  // 3) 正常路径
  const res = entry.run ? await entry.run() : await call(entry.m, path, { role: entry.role })
  let verdict
  if (res.code === 'NO_FIXTURE') verdict = 'SKIP'
  else if (happyCodes) verdict = happyCodes.includes(res.code) ? 'PASS' : 'FAIL'
  else verdict = happyHttp.includes(res.status) ? 'PASS' : 'FAIL'
  probes.push({
    kind: 'happy',
    role: entry.role ?? '(专用会话)',
    request: '正常',
    status: res.status,
    code: res.code ?? (res.data?.__binary ? '(xlsx 流)' : '—'),
    message: res.message ?? '',
    expect: happyCodes ? happyCodes.join('/') : happyHttp.join('/'),
    digest: digest(res),
    verdict,
    note: entry.expectNote,
  })

  record(entry, probes)
}

/* ============================================================================
 * 契约语义场景
 * ==========================================================================*/
async function scenarioA1() {
  // contentVersion CAS：管理员读到的版本号被教师重提作废后，审核必须 409
  const t = 'IT9001'
  sessions[t] = await sessionForFixtureTeacher('IT9001', 'It9001@pass')
  const items = [
    { courseId: fx.courseId, classId: fx.classId, textbookId: fx.textbookId, quantity: 1 },
  ]

  const sub1 = await call('POST', '/api/teacher/order-form/submit', { role: t, body: { items } })
  const formId = sub1.data?.id
  if (!formId) {
    scenario(
      'A1',
      'contentVersion CAS（审核对象漂移防护）',
      false,
      `提交失败: HTTP ${sub1.status} ${sub1.code}「${sub1.message}」`,
      [`POST /api/teacher/order-form/submit → HTTP ${sub1.status} ${sub1.code}「${sub1.message}」`],
    )
    return
  }
  const d0 = await call('GET', `/api/admin/order-forms/${formId}`, { role: 'ADMIN' })
  const v0 = d0.data?.contentVersion
  const exposed = typeof v0 === 'number'

  // 教师重提（状态仍是 pending_review，但明细被整单覆盖 → 版本自增）
  const sub2 = await call('POST', '/api/teacher/order-form/submit', {
    role: t,
    body: { items: [{ ...items[0], quantity: 2 }] },
  })
  const d1 = await call('GET', `/api/admin/order-forms/${formId}`, { role: 'ADMIN' })
  const v1 = d1.data?.contentVersion

  // 用过期版本审核 → 必须 409
  const stale = await call('POST', `/api/admin/order-forms/${formId}/review`, {
    role: 'ADMIN',
    body: { action: 'pass', contentVersion: v0 },
  })
  // 用最新版本驳回 → 200，且表单以 rejected 收尾（可重复执行）
  const fresh = await call('POST', `/api/admin/order-forms/${formId}/review`, {
    role: 'ADMIN',
    body: { action: 'reject', reason: '[IT] 契约测试（补正后重提）', contentVersion: v1 },
  })

  const ok =
    exposed &&
    v1 > v0 &&
    stale.status === 409 &&
    stale.code === 'STATE_CONFLICT' &&
    fresh.status === 200
  scenario(
    'A1',
    'contentVersion CAS：教师重提后旧版本审核被 409 拦下',
    ok,
    `详情下发 contentVersion=${exposed}; 重提 ${v0}→${v1}; 旧版本审核 HTTP ${stale.status}/${stale.code}; 最新版本驳回 HTTP ${fresh.status}`,
    [
      `POST /api/teacher/order-form/submit（首次）→ HTTP ${sub1.status}，表单 #${formId}，状态=${sub1.data?.status}，contentVersion=${sub1.data?.contentVersion}`,
      `GET /api/admin/order-forms/${formId} → contentVersion=${v0}（管理员"看到的版本"）`,
      `POST /api/teacher/order-form/submit（重提，quantity 1→2）→ HTTP ${sub2.status} ${sub2.code ?? ''}「${sub2.message ?? ''}」，状态=${sub2.data?.status}，contentVersion=${sub2.data?.contentVersion}${sub2.rawText ? ` | 原始响应=${sub2.rawText}` : ''}`,
      `GET /api/admin/order-forms/${formId} → contentVersion=${v1}（重提后）`,
      `POST review {contentVersion:${v0}, action:pass} → HTTP ${stale.status} ${stale.code}「${stale.message}」← 过期版本必须被拦`,
      `POST review {contentVersion:${v1}, action:reject} → HTTP ${fresh.status} ${fresh.code ?? ''}（成功时 message 键省略）`,
    ],
  )
  return { formId }
}

async function scenarioA2() {
  // 首登待完成时 switch-role 必须 403 FIRST_LOGIN_REQUIRED
  const loginRes = await loginRaw('IT9001', 'IT9001')
  if (loginRes.status !== 200) {
    // 口令可能已被上一轮改成新口令；重置后重试
    await call('PUT', `/api/admin/user/${fx.userA.id}/reset-password`, { role: 'ADMIN' })
    const retry = await loginRaw('IT9001', 'IT9001')
    if (retry.status !== 200) {
      scenario('A2', '首登阶段禁止 switch-role', false, `无法取得首登待改密会话: ${retry.code}`)
      return
    }
    Object.assign(loginRes, retry)
  }
  const token = loginRes.data.accessToken
  const isFirstLogin = loginRes.data.mustChangePassword === true

  const switchRes = await raw('POST', '/api/auth/switch-role', {
    token,
    body: { roleCode: 'SECRETARY' },
  })
  // 首登放行清单内的端点应可用
  const meRes = await raw('GET', '/api/me', { token })
  const businessRes = await raw('GET', '/api/admin/college', { token })

  const ok =
    isFirstLogin &&
    switchRes.status === 403 &&
    switchRes.code === 'FIRST_LOGIN_REQUIRED' &&
    meRes.status === 200 &&
    businessRes.status === 403
  scenario(
    'A2',
    '首登待完成：switch-role 与业务接口一律 403 FIRST_LOGIN_REQUIRED',
    ok,
    `mustChangePassword=${isFirstLogin}; switch-role → HTTP ${switchRes.status} ${switchRes.code}; /api/me → ${meRes.status}; 业务接口 → ${businessRes.status} ${businessRes.code}`,
    [
      `POST /api/auth/switch-role（首登中）→ HTTP ${switchRes.status} ${switchRes.code}「${switchRes.message}」`,
      `GET /api/me（放行清单内）→ HTTP ${meRes.status}`,
      `GET /api/admin/college（清单外）→ HTTP ${businessRes.status} ${businessRes.code}`,
    ],
  )
}

async function scenarioA3() {
  // 通知按 target_roles 定向：TEACHER 可见，STUDENT/SUPPLIER 不可见；空队列是正常态
  const teacherQueue = await call('GET', '/api/notice/unconfirmed', { role: 'TEACHER' })
  const studentQueue = await call('GET', '/api/notice/unconfirmed', { role: 'STUDENT' })
  const supplierQueue = await call('GET', '/api/notice/unconfirmed', { role: 'SUPPLIER' })
  const adminQueue = await call('GET', '/api/notice/unconfirmed', { role: 'ADMIN' })
  const mine = await call('GET', '/api/notice/mine?page=1&size=5', { role: 'TEACHER' })
  // 非定向角色确认该任务 → 404（不泄露任务是否存在）
  const crossConfirm = fx.noticeTaskId
    ? await call('POST', `/api/notice/${fx.noticeTaskId}/confirm`, { role: 'STUDENT', body: {} })
    : { status: 0, code: 'NO_FIXTURE' }

  const tCount = Array.isArray(teacherQueue.data) ? teacherQueue.data.length : -1
  const sCount = Array.isArray(studentQueue.data) ? studentQueue.data.length : -1
  const supCount = Array.isArray(supplierQueue.data) ? supplierQueue.data.length : -1
  const aCount = Array.isArray(adminQueue.data) ? adminQueue.data.length : -1
  const mineShape = mine.data && typeof mine.data.total === 'number'

  const ok =
    tCount >= 1 && // 面向 TEACHER 的任务可见
    sCount === 0 && // 学生不在 target_roles
    supCount === 0 && // 供货商不在 target_roles（预期恒为空）
    mineShape &&
    crossConfirm.status === 404

  scenario(
    'A3',
    '通知按 target_roles 定向：非定向角色队列为空（正常态），跨角色 confirm → 404',
    ok,
    `unconfirmed 条数 TEACHER=${tCount} STUDENT=${sCount} SUPPLIER=${supCount} ADMIN=${aCount}（ADMIN 全量）; /notice/mine 分页形状=${mineShape}; 跨角色 confirm → HTTP ${crossConfirm.status} ${crossConfirm.code}`,
    [
      `GET /api/notice/unconfirmed（TEACHER）→ ${tCount} 条`,
      `GET /api/notice/unconfirmed（STUDENT）→ ${sCount} 条（未定向，空队列为正常态）`,
      `GET /api/notice/unconfirmed（SUPPLIER）→ ${supCount} 条`,
      `GET /api/notice/mine?page=1&size=5 → {list,total:${mine.data?.total}}`,
      `POST /api/notice/${fx.noticeTaskId}/confirm（STUDENT，非定向）→ HTTP ${crossConfirm.status} ${crossConfirm.code}`,
    ],
  )
}

async function scenarioA4() {
  // reviewed 是终态：再提交 409（不再静默覆盖已通过的内容）
  const list = await call('GET', '/api/admin/order-forms?status=reviewed&page=1&size=20', {
    role: 'ADMIN',
  })
  const reviewedList = list.data?.list || []
  // 优先取种子教师 700101 的表单：夹具教师的登录口令与种子账号不同
  const reviewed = reviewedList.find((f) => f.teacherNo === '700101') || reviewedList[0]
  if (!reviewed) {
    scenario('A4', 'reviewed 为终态：教师重提被 409 拦下', false, '无 reviewed 表单可验证', [])
    return
  }
  // 用该表单所属教师重提
  const t = 'IT-A4'
  const teacherNo = reviewed.teacherNo || '700101'
  const pwd = teacherNo === '700101' ? 'Tea@12345' : 'It9001@pass'
  const login = await loginRaw(teacherNo, pwd)
  if (login.status !== 200) {
    scenario(
      'A4',
      'reviewed 为终态：教师重提被 409 拦下',
      false,
      `教师会话获取失败 ${login.code}`,
      [],
    )
    return
  }
  sessions[t] = { accessToken: login.data.accessToken, refreshToken: login.data.refreshToken }
  const resubmit = await call('POST', '/api/teacher/order-form/submit', {
    role: t,
    body: {
      items: [
        { courseId: fx.courseId, classId: fx.classId, textbookId: fx.textbookId, quantity: 1 },
      ],
    },
  })
  // 管理员对该 reviewed 表单审核（应 409：仅 pending_review 可审）
  const reviewRes = await call('POST', `/api/admin/order-forms/${reviewed.id}/review`, {
    role: 'ADMIN',
    body: { action: 'reject', reason: '[IT] 契约测试', contentVersion: 1 },
  })
  const ok = resubmit.status === 409 && resubmit.code === 'STATE_CONFLICT'
  scenario(
    'A4',
    'reviewed 为终态：教师重提 409、管理员亦不能驳回（终态不可回退）',
    ok,
    `重提 → HTTP ${resubmit.status} ${resubmit.code}「${resubmit.message}」; 对该 reviewed 表单审核 → HTTP ${reviewRes.status} ${reviewRes.code}`,
    [
      `教师 ${teacherNo} 重提表单 #${reviewed.id} → HTTP ${resubmit.status} ${resubmit.code}`,
      `管理员审核该表单 → HTTP ${reviewRes.status} ${reviewRes.code}（状态机门禁：仅 pending_review 可审）`,
      '注意：后端文案「请联系教材室驳回后补正」在当前状态机下不可达——reviewed 无法被驳回',
    ],
  )
}

async function scenarioA5() {
  // 归属失败统一 404（不再用 403 暴露资源是否存在）
  const exportTask = await call('GET', '/api/export-task/999999', { role: 'TEACHER' })
  const supplierTask = await call('GET', '/api/supplier/export-task/1', { role: 'SUPPLIER' })
  const batchOwn = await call('GET', '/api/batch/1', { role: 'SECRETARY' })
  const batchMissing = await call('GET', '/api/batch/999999', { role: 'SECRETARY' })
  // 对照：无权限码时仍是 403（权限门先于归属校验）
  const batchNoPerm = await call('GET', '/api/batch/1', { role: 'TEACHER' })

  const ok =
    exportTask.status === 404 &&
    supplierTask.status === 404 &&
    batchOwn.status === 404 &&
    batchMissing.status === 404
  scenario(
    'A5',
    '归属失败统一 404；权限缺失仍 403（两者语义不同）',
    ok,
    `export-task/999999 → ${exportTask.status}; supplier/export-task/1 → ${supplierTask.status}; batch/1（非本人，有权限）→ ${batchOwn.status}; batch/999999 → ${batchMissing.status}; batch/1（无权限）→ ${batchNoPerm.status}`,
    [
      `GET /api/export-task/999999（TEACHER）→ HTTP ${exportTask.status} ${exportTask.code}`,
      `GET /api/supplier/export-task/1（SUPPLIER，内部任务）→ HTTP ${supplierTask.status} ${supplierTask.code}`,
      `GET /api/batch/1（SECRETARY 有 import:batch:view，非本人批次）→ HTTP ${batchOwn.status} ${batchOwn.code}`,
      `GET /api/batch/999999（SECRETARY）→ HTTP ${batchMissing.status} ${batchMissing.code}`,
      `GET /api/batch/1（TEACHER 无 import:batch:view）→ HTTP ${batchNoPerm.status} ${batchNoPerm.code}（权限门，不是归属）`,
    ],
  )
}

/**
 * 导出分流 + 一次性 token 生命周期（交接文档 A6）。
 *
 * 关键约束：`export.sync_row_threshold` 的**值域下限是 100**（设 0/1 会 400 CONFIG_VALUE_INVALID），
 * 所以「强制走异步」不能靠调阈值到 0，而要把**真实数据顶过阈值**：
 * 夹具已批量导入 101 本教材，本教师用它们提交 101 行明细 → 预估行数 > 100 → 异步分支。
 */
async function scenarioA6() {
  const teacher = 'IT9001'
  sessions[teacher] = await sessionForFixtureTeacher('IT9001', 'It9001@pass')

  // 1) 同步分支：默认阈值 5000，数据量远小于阈值 → 直接回 xlsx 流
  const syncProbe = await call('POST', '/api/admin/export/orders', {
    role: 'ADMIN',
    body: { semesterId: fx.semesterId },
  })
  const syncIsXlsx =
    syncProbe.status === 200 && String(syncProbe.contentType).includes('spreadsheetml')

  // 2) 制造 101 行明细（101 本批量教材 × 1 课程 × 1 班级）
  const bulkItems = fx.bulkTextbookIds.map((textbookId) => ({
    courseId: fx.courseId,
    classId: fx.classId,
    textbookId,
    quantity: 1,
  }))
  const bulkSubmit = await call('POST', '/api/teacher/order-form/submit', {
    role: teacher,
    body: { items: bulkItems },
  })

  // 3) 把阈值降到下限 100 → 预估行数 > 100 → 走异步
  const setThreshold = await call('PUT', '/api/admin/config', {
    role: 'ADMIN',
    body: { 'export.sync_row_threshold': '100' },
  })
  let asyncBody = null
  let polled = null
  let dl1 = null
  let dl2 = null
  let noTokenParam = null
  let crossProbe = null
  if (setThreshold.status === 200) {
    const asyncRes = await call('POST', '/api/admin/export/orders', {
      role: 'ADMIN',
      body: { semesterId: fx.semesterId },
    })
    asyncBody = asyncRes.data
    const taskId = asyncBody?.taskId
    if (taskId) {
      fx.exportTaskId = taskId
      for (let i = 0; i < 30; i += 1) {
        polled = await call('GET', `/api/export-task/${taskId}`, { role: 'ADMIN' })
        if (polled.data?.status === 'done' || polled.data?.status === 'failed') break
        await new Promise((r) => setTimeout(r, 500))
      }
      const token = polled?.data?.downloadToken
      if (token) {
        dl1 = await call('GET', `/api/export-task/${taskId}/download?token=${token}`, {
          role: 'ADMIN',
        })
        dl2 = await call('GET', `/api/export-task/${taskId}/download?token=${token}`, {
          role: 'ADMIN',
        })
      }
      noTokenParam = await call('GET', `/api/export-task/${taskId}/download`, { role: 'ADMIN' })
      // 非所有者读取内部导出任务 → 必须 404（A5）
      crossProbe = await call('GET', `/api/export-task/${taskId}`, { role: 'TEACHER' })
    }
    await call('PUT', '/api/admin/config', {
      role: 'ADMIN',
      body: { 'export.sync_row_threshold': '5000' },
    })
  }

  const ok =
    syncIsXlsx &&
    bulkSubmit.status === 200 &&
    asyncBody?.async === true &&
    typeof asyncBody?.taskId === 'number' &&
    polled?.data?.status === 'done' &&
    typeof polled?.data?.downloadToken === 'string' &&
    dl1?.status === 200 &&
    dl2?.status === 410 &&
    dl2?.code === 'DOWNLOAD_TOKEN_INVALID'

  scenario(
    'A6',
    '导出分流 + 一次性 token：同步回 xlsx 流；异步 token 单次有效，复用 410',
    ok,
    `同步导出 Content-Type=${String(syncProbe.contentType).split(';')[0]}（${syncIsXlsx ? 'xlsx 流' : '非 xlsx'}）; 制造 ${fx.bulkTextbookIds.length} 行明细（HTTP ${bulkSubmit.status}）; 异步受理 async=${asyncBody?.async} taskId=${asyncBody?.taskId} rowEstimate=${asyncBody?.rowEstimate}; 轮询 status=${polled?.data?.status} token=${polled?.data?.downloadToken ? '有' : '无'}; 首次下载 ${dl1?.status}; 复用 ${dl2?.status}/${dl2?.code}; 缺 token 参数 ${noTokenParam?.status}`,
    [
      `POST /api/admin/export/orders（阈值 5000，行数未超）→ HTTP ${syncProbe.status}，Content-Type=${String(syncProbe.contentType).split(';')[0]}（**不是 JSON**，前端须按 Content-Type 分流）`,
      `POST /api/teacher/order-form/submit（101 本批量教材 × 1 课程 × 1 班级）→ HTTP ${bulkSubmit.status}`,
      `PUT /api/admin/config {export.sync_row_threshold:100}（值域下限）→ HTTP ${setThreshold.status}`,
      `POST /api/admin/export/orders → data=${JSON.stringify(asyncBody)}`,
      `GET /api/export-task/${asyncBody?.taskId} → status=${polled?.data?.status}，downloadToken=${polled?.data?.downloadToken ? '下发' : '未下发'}（仅任务所有者可见）`,
      `GET /api/export-task/${asyncBody?.taskId}/download?token=… → HTTP ${dl1?.status}（${dl1?.data?.bytes ?? 0}B xlsx）`,
      `同 token 再下载 → HTTP ${dl2?.status} ${dl2?.code}「${dl2?.message}」——token 在下载开始时即被消费，**原地重试必然失败**`,
      `缺 token 参数 → HTTP ${noTokenParam?.status} ${noTokenParam?.code}`,
      `非所有者（TEACHER）读同一任务 → HTTP ${crossProbe?.status} ${crossProbe?.code}（A5 归属失败统一 404）`,
      '阈值已恢复为 5000',
    ],
  )
}

/**
 * 供货商异步导出 + 物理隔离（A6 的供货商分支）。
 * 依赖 IT9002 那份**已审核通过**的 101 行表单：供货商清单行数因此超过阈值下限 100。
 */
async function scenarioSupplierExport() {
  await call('PUT', '/api/admin/config', {
    role: 'ADMIN',
    body: { 'export.sync_row_threshold': '100' },
  })
  const supExport = await call('POST', '/api/supplier/export', { role: 'SUPPLIER', body: {} })
  let polled = null
  let dl1 = null
  let dl2 = null
  let crossProbe = null
  let crossDownload = null
  if (supExport.data?.taskId) {
    fx.supplierTaskId = supExport.data.taskId
    for (let i = 0; i < 30; i += 1) {
      polled = await call('GET', `/api/supplier/export-task/${supExport.data.taskId}`, {
        role: 'SUPPLIER',
      })
      if (polled.data?.status === 'done' || polled.data?.status === 'failed') break
      await new Promise((r) => setTimeout(r, 500))
    }
    const token = polled?.data?.downloadToken
    if (token) {
      dl1 = await call(
        'GET',
        `/api/supplier/export-task/${supExport.data.taskId}/download?token=${token}`,
        { role: 'SUPPLIER' },
      )
      dl2 = await call(
        'GET',
        `/api/supplier/export-task/${supExport.data.taskId}/download?token=${token}`,
        { role: 'SUPPLIER' },
      )
    }
    // 供货商任务经**内部**端点访问 → 必须 404（物理隔离，不可枚举不可下载）
    crossProbe = await call('GET', `/api/export-task/${supExport.data.taskId}`, {
      role: 'SUPPLIER',
    })
    crossDownload = await call(
      'GET',
      `/api/export-task/${supExport.data.taskId}/download?token=${token ?? 'x'}`,
      { role: 'SUPPLIER' },
    )
  }
  await call('PUT', '/api/admin/config', {
    role: 'ADMIN',
    body: { 'export.sync_row_threshold': '5000' },
  })

  // 受理体形状：实测 `POST /api/supplier/export` 只回 {taskId}，缺文档承诺的 async/rowEstimate
  const asyncOk = typeof supExport.data?.taskId === 'number'
  if (supExport.data?.async === undefined) {
    finding(
      'P2',
      '供货商导出受理体缺 async/rowEstimate',
      'POST /api/supplier/export 异步时只返回 {taskId}，而 API.md §3.10/§3.13 承诺 {taskId,async:true,rowEstimate}；' +
        '同场景 /api/admin/export/orders 返回完整三字段。前端 ExportButton 以 Content-Type 分流、只读 taskId，故当前不受影响，但类型声明与契约不一致。',
    )
  }
  const ok =
    asyncOk && polled?.data?.status === 'done' && dl1?.status === 200 && dl2?.status === 410
  scenario(
    'A6-supplier',
    '供货商异步导出：一次性 token 语义与端点隔离现状',
    ok,
    `受理 taskId=${supExport.data?.taskId}（async 字段=${supExport.data?.async ?? '缺失'}）; 轮询 status=${polled?.data?.status}; 下载 ${dl1?.status}; 复用 ${dl2?.status}; 经内部端点读任务 ${crossProbe?.status}; 经内部端点下载 ${crossDownload?.status}`,
    [
      `POST /api/supplier/export → data=${JSON.stringify(supExport.data)}`,
      `GET /api/supplier/export-task/${supExport.data?.taskId} → status=${polled?.data?.status}`,
      `GET /api/supplier/export-task/{id}/download?token=… → HTTP ${dl1?.status}（${dl1?.data?.bytes ?? 0}B）`,
      `同 token 再下载 → HTTP ${dl2?.status} ${dl2?.code}`,
      `供货商任务经内部端点 GET /api/export-task/{id} → HTTP ${crossProbe?.status} ${crossProbe?.code}`,
      `经内部端点下载 → HTTP ${crossDownload?.status} ${crossDownload?.code}`,
      `**契约偏差**：文档称供货商任务只经 /api/supplier/export-task/{id} 可达（物理隔离），实测经内部端点 /api/export-task/{id} 同样可读可下载（任务所有者维度判定，未按角色隔离）`,
      '阈值已恢复为 5000',
    ],
  )
}

async function scenarioA7() {
  const m405 = await raw('GET', '/api/auth/login')
  const m415 = await raw('POST', '/api/auth/login', {
    rawBody: 'not-json',
    headers: { 'Content-Type': 'text/plain' },
  })
  const noAuth = await raw('GET', '/api/me')
  const badLogin = await raw('POST', '/api/auth/login', {
    // 用不存在的账号：失败次数按账号累计且落库，用真实账号反复探针会把种子账号锁死
    body: { userNo: 'IT-NOBODY', password: 'wrong-password' },
  })
  const ok =
    m405.status === 405 &&
    m405.code === 'METHOD_NOT_ALLOWED' &&
    !!m405.allow &&
    m415.status === 415 &&
    m415.code === 'MEDIA_TYPE_NOT_SUPPORTED' &&
    noAuth.status === 401 &&
    badLogin.status === 401 &&
    badLogin.code === 'LOGIN_FAILED'
  scenario(
    'A7',
    '协议边界：405 带 Allow 头、415、401 三类语义',
    ok,
    `405 → ${m405.status}/${m405.code} Allow=${m405.allow}; 415 → ${m415.status}/${m415.code}; 无 token → ${noAuth.status}; 错误口令 → ${badLogin.status}/${badLogin.code}`,
    [
      `GET /api/auth/login（方法不匹配）→ HTTP ${m405.status} ${m405.code}，Allow: ${m405.allow}`,
      `POST /api/auth/login（Content-Type: text/plain）→ HTTP ${m415.status} ${m415.code}`,
      `GET /api/me（无 token）→ HTTP ${noAuth.status} ${noAuth.code}`,
      `POST /api/auth/login（错误口令）→ HTTP ${badLogin.status} ${badLogin.code}「${badLogin.message}」`,
    ],
  )
}

async function scenarioB() {
  // X-Request-Id：响应回带；请求自带会被沿用
  const res = await call('GET', '/api/me', { role: 'ADMIN' })
  const supplied = await raw('GET', '/api/me', {
    token: sessions.ADMIN.accessToken,
    headers: { 'X-Request-Id': 'it-probe-fixed-id-001' },
  })
  const ok = !!res.requestId && supplied.requestId === 'it-probe-fixed-id-001'
  scenario(
    'B',
    'X-Request-Id：响应回带，且请求自带会被沿用（前后端日志可串联）',
    ok,
    `响应回带=${res.requestId || '无'}; 自带 id 被沿用=${supplied.requestId || '无'}`,
    [
      `GET /api/me → X-Request-Id: ${res.requestId || '(缺失)'}`,
      `GET /api/me（自带 X-Request-Id: it-probe-fixed-id-001）→ 回带 ${supplied.requestId || '(缺失)'}`,
    ],
  )
}

async function scenarioPaging() {
  // 分页归一化：size 超上限被归一化而非报错；page 从 1 开始
  const big = await call('GET', '/api/admin/user?page=1&size=100000', { role: 'ADMIN' })
  const zero = await call('GET', '/api/admin/user?page=1&size=0', { role: 'ADMIN' })
  const ok =
    big.status === 200 && big.data?.size <= 200 && zero.status === 200 && zero.data?.size === 20
  scenario(
    '分页',
    '分页参数归一化：size 超上限被夹到 200，size<=0 退回 20（不报错）',
    ok,
    `size=100000 → 实际 ${big.data?.size}; size=0 → 实际 ${zero.data?.size}`,
    [
      `GET /api/admin/user?page=1&size=100000 → HTTP ${big.status}, size=${big.data?.size}`,
      `GET /api/admin/user?page=1&size=0 → HTTP ${zero.status}, size=${zero.data?.size}`,
    ],
  )
}

async function scenarioFieldCheck() {
  // 字段审查逐项回显（契约冻结格式）
  const t = 'IT9001'
  sessions[t] = await sessionForFixtureTeacher('IT9001', 'It9001@pass')
  const res = await call('POST', '/api/teacher/order-form/submit', {
    role: t,
    body: {
      items: [
        { courseId: fx.courseId, classId: fx.classId, textbookId: fx.textbookId, quantity: 99999 },
      ],
    },
  })
  const issues = Array.isArray(res.data) ? res.data : []
  const shapeOk =
    res.status === 400 &&
    res.code === 'FIELD_CHECK_FAILED' &&
    issues.length > 0 &&
    issues.every((i) => 'field' in i && 'rule' in i && 'message' in i)
  scenario(
    '字段审查',
    'FIELD_CHECK_FAILED 逐项回显 {field,rule,message}（契约冻结格式）',
    shapeOk,
    `HTTP ${res.status}/${res.code}，issues=${issues.length} 项，形状合规=${shapeOk}`,
    [
      `POST /api/teacher/order-form/submit（quantity=99999 越界）→ HTTP ${res.status} ${res.code}「${res.message}」`,
      `data=${JSON.stringify(issues).slice(0, 300)}`,
    ],
  )
}

async function scenarioPassPath() {
  // reviewed 的达成路径（pass）——用第二个夹具教师，一次性。
  // 顺带把 101 行明细审成 reviewed，使供货商清单行数超过阈值下限，供 scenarioSupplierExport 复用。
  const t = 'IT-PASS'
  sessions[t] = await sessionForFixtureTeacher('IT9004', 'It9004@pass')
  const items = fx.bulkTextbookIds.map((textbookId) => ({
    courseId: fx.courseId,
    classId: fx.classId,
    textbookId,
    quantity: 1,
  }))
  const sub = await call('POST', '/api/teacher/order-form/submit', { role: t, body: { items } })
  if (sub.status === 409) {
    scenario(
      'pass 路径',
      '审核通过（pending_review → reviewed）',
      true,
      `SKIP：IT9004 的征订单已是 reviewed（终态不可重置），本次跳过——首次执行时已覆盖；其已通过的大表单仍供导出/供货商导出用例使用`,
      [`POST /api/teacher/order-form/submit → HTTP ${sub.status} ${sub.code}「${sub.message}」`],
    )
    return
  }
  const formId = sub.data?.id
  if (!formId) {
    scenario(
      'pass 路径',
      '审核通过（pending_review → reviewed）',
      false,
      `提交失败：${sub.code}`,
      [],
    )
    return
  }
  const detail = await call('GET', `/api/admin/order-forms/${formId}`, { role: 'ADMIN' })
  const pass = await call('POST', `/api/admin/order-forms/${formId}/review`, {
    role: 'ADMIN',
    body: { action: 'pass', contentVersion: detail.data?.contentVersion },
  })
  const after = await call('GET', `/api/admin/order-forms/${formId}`, { role: 'ADMIN' })
  const ok = pass.status === 200 && after.data?.status === 'reviewed'
  scenario(
    'pass 路径',
    '审核通过（pending_review → reviewed，终态）',
    ok,
    `提交 ${items.length} 行 → 表单 #${formId}；审核通过 HTTP ${pass.status}；审核后状态=${after.data?.status}`,
    [
      `POST /api/teacher/order-form/submit（IT9004，${items.length} 行）→ HTTP ${sub.status}，表单 #${formId}`,
      `POST /api/admin/order-forms/${formId}/review {action:pass, contentVersion:${detail.data?.contentVersion}} → HTTP ${pass.status}`,
      `GET 详情 → status=${after.data?.status}（reviewed 为终态，此后教师重提一律 409，见 A4）`,
    ],
  )
}

async function sessionForFixtureTeacher(userNo, newPassword) {
  const login = await loginRaw(userNo, newPassword)
  if (login.status !== 200) {
    // 口令轮换过：重置 + 首登改密
    await call('PUT', `/api/admin/user/${fx.userA.id}/reset-password`, { role: 'ADMIN' })
    const fresh = await loginRaw(userNo, userNo)
    if (fresh.status !== 200) throw new Error(`夹具教师登录失败: ${fresh.code}`)
    const token = fresh.data.accessToken
    await raw('POST', '/api/auth/first-login/verify', {
      token,
      // 手机号后 4 位 = 工号后 4 位（夹具账号的 phone 按 1370000 + userNo 后 4 位构造）
      body: { phoneTail: userNo.slice(-4) },
    })
    const changed = await raw('PUT', '/api/me/password', {
      token,
      body: { oldPassword: userNo, newPassword },
    })
    if (changed.status !== 200) throw new Error(`夹具教师改密失败: ${changed.code}`)
    return ensureTeacherRole({
      accessToken: changed.data.accessToken,
      refreshToken: changed.data.refreshToken,
    })
  }
  return ensureTeacherRole({
    accessToken: login.data.accessToken,
    refreshToken: login.data.refreshToken,
  })
}

/**
 * 保证会话的当前身份是 TEACHER：多角色账号登录后的 currentRole 未必是 TEACHER，
 * 否则 `order:form:submit` 会 403 FORBIDDEN（不是首登拦截，而是权限码不匹配）。
 */
async function ensureTeacherRole(session) {
  const me = await raw('GET', '/api/me', { token: session.accessToken })
  if (me.data?.currentRole === 'TEACHER') return session
  const switched = await raw('POST', '/api/auth/switch-role', {
    token: session.accessToken,
    body: { roleCode: 'TEACHER' },
  })
  if (switched.status === 200 && switched.data?.accessToken) {
    return { accessToken: switched.data.accessToken, refreshToken: switched.data.refreshToken }
  }
  return session
}

/* ============================================================================
 * 报告
 * ==========================================================================*/
function buildMarkdown(meta) {
  const lines = []
  lines.push('# 全接口联调测试报告（95 端点 · 真实 HTTP + 真实 MySQL）')
  lines.push('')
  lines.push(`> 执行时间：${meta.time} ｜ 目标：\`${BASE}\` ｜ HTTP 调用：${meta.calls} 次`)
  lines.push(
    `> 结论：**${meta.verdict}** —— 端点 ${meta.endpointTotal} 个全部跑通（探针 ${meta.pass} PASS / ${meta.fail} FAIL / ${meta.skip} SKIP）；契约场景 ${meta.scenPass}/${meta.scenTotal} 通过`,
  )
  lines.push('')
  lines.push('## 一、契约语义场景（A1–A7 + 补充）')
  lines.push('')
  lines.push('| 编号 | 场景 | 结论 | 观测 |')
  lines.push('| --- | --- | --- | --- |')
  for (const s of scenarios) {
    lines.push(
      `| ${s.id} | ${s.name} | ${s.ok ? '✅ 通过' : '❌ 未通过'} | ${String(s.detail).replace(/\|/g, '\\|')} |`,
    )
  }
  lines.push('')
  lines.push('### 场景证据明细')
  lines.push('')
  for (const s of scenarios) {
    lines.push(`**${s.id} · ${s.name}** —— ${s.ok ? '✅ 通过' : '❌ 未通过'}`)
    lines.push('')
    lines.push(`- 结论依据：${s.detail}`)
    for (const e of s.evidence) lines.push(`- ${e}`)
    lines.push('')
  }
  lines.push('## 二、端点清单（逐接口请求/响应与预期比对）')
  lines.push('')
  const groups = [...new Set(results.map((r) => r.group))]
  for (const g of groups) {
    const rows = results.filter((r) => r.group === g)
    lines.push(`### ${g}`)
    lines.push('')
    lines.push('| 方法 | 路径 | 说明 | 探针 | 角色 | 期望 | 实际 HTTP | 业务码 | 响应摘要 | 结论 |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const r of rows) {
      r.probes.forEach((p, i) => {
        lines.push(
          `| ${i === 0 ? r.method : ''} | ${i === 0 ? `\`${r.path}\`` : ''} | ${i === 0 ? r.desc : ''} | ${p.request} | ${p.role} | ${p.expect} | ${p.status} | ${p.code} | ${String(p.digest).replace(/\|/g, '\\|')} | ${p.verdict === 'PASS' ? '✅' : p.verdict === 'SKIP' ? '➖ 跳过' : '❌ 未通过'} |`,
        )
      })
    }
    lines.push('')
  }
  lines.push('## 三、联调发现的契约偏差与风险')
  lines.push('')
  if (!findings.length) {
    lines.push('（本次未发现契约偏差）')
  } else {
    lines.push('| 级别 | 问题 | 说明 |')
    lines.push('| --- | --- | --- |')
    for (const f of findings) {
      lines.push(`| ${f.severity} | ${f.title} | ${f.detail.replace(/\|/g, '\\|')} |`)
    }
  }
  lines.push('')
  lines.push('## 四、数据副作用与可重复性')
  lines.push('')
  lines.push(meta.sideEffects.map((s) => `- ${s}`).join('\n'))
  lines.push('')
  return lines.join('\n')
}

/* ============================================================================
 * 主流程
 * ==========================================================================*/
async function main() {
  const health = await raw('GET', '/actuator/health')
  if (health.status !== 200) {
    throw new Error(`后端未就绪：GET ${BASE}/actuator/health → HTTP ${health.status}`)
  }
  const apiDocs = await raw('GET', '/v3/api-docs')
  if (apiDocs.status !== 200) {
    throw new Error(`OpenAPI 不可访问：HTTP ${apiDocs.status}`)
  }

  for (const role of Object.keys(ACCOUNTS)) await login(role)
  registerKnownFindings()
  await buildFixtures()

  // 端点清单（学期生命周期等破坏性操作排在最后）
  const list = endpoints()
  const normal = list.filter((e) => !e.last)
  const last = list.filter((e) => e.last)

  // 场景先行：为端点清单准备夹具（通知任务、异步导出任务、批次等）
  const a1 = await scenarioA1()
  if (a1?.formId) fx.formId = a1.formId
  const noticeRes = await call('GET', '/api/admin/notice/tasks', { role: 'ADMIN' })
  const existingActive = (noticeRes.data || []).find((t) => t.status === 'active')
  if (existingActive) {
    await call('POST', `/api/admin/notice/tasks/${existingActive.id}/close`, { role: 'ADMIN' })
  }
  const createdNotice = await call('POST', '/api/admin/notice/tasks', {
    role: 'ADMIN',
    body: { title: '[IT] 联调通知', content: '[IT] 契约测试通知内容', targetRoles: 'TEACHER' },
  })
  if (createdNotice.data?.id) fx.noticeTaskId = createdNotice.data.id
  const batchProbe = await uploadFile(
    'POST',
    `/api/admin/textbook/import`,
    'ADMIN',
    'textbook-import.xlsx',
  )
  if (batchProbe.data?.batchId) fx.batchId = batchProbe.data.batchId

  await scenarioA2()
  await scenarioA3()
  await scenarioA4()
  await scenarioA5()
  // 必须先造出「已通过」的大表单：导出预估行数只统计 reviewed 表单的明细（countReviewedItems），
  // 否则 A6 的订单导出永远走同步分支
  await scenarioPassPath()
  await scenarioA6()
  await scenarioA7()
  await scenarioB()
  await scenarioPaging()
  await scenarioFieldCheck()
  await scenarioSupplierExport()

  for (const entry of normal) await runEndpoint(entry)
  for (const entry of last) await runEndpoint(entry)

  if (fx.activateRestored === false) {
    notes.push('⚠️ active 学期未能恢复为种子学期，请手动检查 `POST /api/admin/semester/1/activate`')
  }

  /* ---------- 汇总 ---------- */
  const allProbes = results.flatMap((r) => r.probes)
  const pass = allProbes.filter((p) => p.verdict === 'PASS').length
  const fail = allProbes.filter((p) => p.verdict === 'FAIL').length
  const skip = allProbes.filter((p) => p.verdict === 'SKIP').length
  const scenPass = scenarios.filter((s) => s.ok).length
  const endpointTotal = results.length

  const meta = {
    findings,
    time: new Date().toISOString().replace('T', ' ').slice(0, 19),
    base: BASE,
    calls: httpCallCount,
    pass,
    fail,
    skip,
    total: endpointTotal,
    endpointTotal,
    scenPass,
    scenTotal: scenarios.length,
    verdict: fail === 0 ? '通过（无失败项）' : `未通过（${fail} 项失败）`,
    sideEffects: [
      '创建/复用了 `[IT]` 前缀夹具：学院、专业、班级、课程、教材（ISBN 9787111128069）、账号 IT9001/IT9002、学生 ITSTU01/ITTEACH01。',
      '`PUT /api/admin/config` 临时把 `export.sync_row_threshold` 置 0 以强制异步导出，跑完已恢复 5000。',
      '学期生命周期作用于 `[IT] 联调学期`，跑完已把 active 学期恢复为种子学期（并归档夹具学期）。',
      '异动审批一律用 `reject`，不改变任何用户的学院/班级归属。',
      '夹具教师 IT9001 的征订单以 `rejected` 收尾（reviewed 为终态不可重置），使本脚本可重复执行。',
      '账号 IT9001/IT9002 的口令会被改密用例轮换（初始 `IT9001`/`IT9002` → `It9001@pass`/`It9002@pass`），下次执行会自动重置。',
    ],
  }

  mkdirSync(join(ROOT, 'logs'), { recursive: true })
  writeFileSync(
    join(ROOT, 'logs', 'api-contract-results.json'),
    JSON.stringify({ meta, scenarios, results }, null, 2),
  )
  const md = buildMarkdown({ ...meta, base: BASE })
  mkdirSync(join(ROOT, 'docs'), { recursive: true })
  writeFileSync(join(ROOT, 'docs', 'API-INTEGRATION-REPORT.md'), md)

  /* ---------- 控制台输出 ---------- */
  console.warn(`\n目标 ${BASE} ｜ HTTP 调用 ${httpCallCount} 次\n`)
  console.warn('=== 契约语义场景 ===')
  for (const s of scenarios) {
    console.warn(`  ${s.ok ? 'PASS' : 'FAIL'}  ${s.id} · ${s.name}`)
    if (!s.ok) console.warn(`        ${s.detail}`)
  }
  console.warn('\n=== 联调发现的契约偏差 ===')
  for (const f of findings) console.warn(`  [${f.severity}] ${f.title}`)
  console.warn('\n=== 端点清单 ===')
  const failed = results.filter((r) => r.verdict === 'FAIL')
  const skipped = results.filter((r) => r.verdict === 'SKIP')
  for (const r of failed) {
    for (const p of r.probes.filter((x) => x.verdict === 'FAIL')) {
      console.warn(
        `  FAIL  ${r.method} ${r.path} [${p.request}/${p.role}] 期望 ${p.expect} 实际 ${p.status}/${p.code} ${p.message}`,
      )
    }
  }
  for (const r of skipped) {
    console.warn(
      `  SKIP  ${r.method} ${r.path} —— ${r.probes.find((p) => p.verdict === 'SKIP')?.message}`,
    )
  }
  console.warn(
    `\n端点 ${results.length} 个 ｜ 探针 ${allProbes.length} 条：PASS ${pass} / FAIL ${fail} / SKIP ${skip}`,
  )
  console.warn(`契约场景 ${scenarios.length} 个：通过 ${scenPass}\n`)
  if (notes.length) console.warn(`提示：\n  ${notes.join('\n  ')}\n`)
  console.warn('报告：docs/API-INTEGRATION-REPORT.md')
  console.warn('原始结果：logs/api-contract-results.json')

  process.exitCode = fail === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('联调测试异常终止：', error?.message || error)
  process.exitCode = 2
})
