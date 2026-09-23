#!/usr/bin/env node
/**
 * 第一批演示数据：真实教材库 + 课程/任课关系 + 已审核征订单
 * ============================================================================
 * 目的（2026-09-23 甲方决策）：试运行库的「班级—课程—教材」映射不完整，导致
 * 学生选书页无可选教材、教师征订只有 1 行。本脚本按**调研到的真实书目与当前市场价**
 * 灌入第一批演示数据，并把链路跑通到「学生可选」的状态。
 *
 * 教材数据来源：出版社官网（清华社/高教社/电子工业社）+ 云台购（新华书店系图书采购平台）
 * 交叉核对，ISBN 全部通过校验位算法验证。定价为**当前印次定价**（经典教材多次重印会调价，
 * 豆瓣等站点常记录首印价，故以出版社/采购平台现价为准）。
 *
 * 幂等性：
 *   · 教材按 ISBN 判重；课程按 (semesterId, code) 判重；任课关系按 (teacher, course, class) 判重；
 *   · 已 `reviewed` 的征订单**不重复提交**（reviewed 是终态，重提会 409）。
 *
 * 用法：
 *   node scripts/seed-demo-data.mjs https://textbooksorder.moonzj.com
 *   node scripts/seed-demo-data.mjs                      # 默认本地 127.0.0.1:8080
 *
 * 注意：本批数据与 `[IT]` 夹具一样，属**演示数据**，正式启用前由超管清理
 * （教材用「停用即下架」、课程/任课关系无删除接口时需 DBA 处理，详见交付报告）。
 * ============================================================================
 */

const BASE = (process.argv[2] || process.env.API_BASE || 'http://127.0.0.1:8080').replace(/\/$/, '')

const ADMIN = ['900001', 'Admin@123']
/** 承担「已审核征订单」的教师：软工2023-1 的任课教师，口令为种子演示口令 */
const TEACHER = ['700101', 'Tea@12345']

/* ---------------------------------------------------------------------------
 * 教材书目（真实 ISBN / 当前定价）
 * ------------------------------------------------------------------------- */
const TEXTBOOKS = [
  // —— 计算机类 ——
  {
    isbn: '9787302147510',
    title: '数据结构（C语言版·第2版）',
    edition: '第2版',
    author: '严蔚敏、吴伟民、李冬梅',
    press: '清华大学出版社',
    price: 49.0,
  },
  {
    isbn: '9787121411748',
    title: '计算机网络（第8版）',
    edition: '第8版',
    author: '谢希仁',
    press: '电子工业出版社',
    price: 59.8,
  },
  {
    isbn: '9787302481447',
    title: 'C程序设计（第五版）',
    edition: '第5版',
    author: '谭浩强',
    press: '清华大学出版社',
    price: 59.9,
  },
  {
    isbn: '9787040591255',
    title: '数据库系统概论（第6版）',
    edition: '第6版',
    author: '王珊、杜小勇、陈红',
    press: '高等教育出版社',
    price: 59.0,
  },
  {
    isbn: '9787560633503',
    title: '计算机操作系统（第4版）',
    edition: '第4版',
    author: '汤小丹、梁红兵、哲凤屏、汤子瀛',
    press: '西安电子科技大学出版社',
    price: 53.0,
  },
  {
    isbn: '9787302330981',
    title: '软件工程导论（第6版）',
    edition: '第6版',
    author: '张海藩、牟永敏',
    press: '清华大学出版社',
    price: 68.0,
  },
  {
    isbn: '9787111604365',
    title: '操作系统概念（原书第9版）',
    edition: '原书第9版',
    author: 'Abraham Silberschatz 等',
    press: '机械工业出版社',
    price: 99.0,
  },
  {
    isbn: '9787302464259',
    title: 'Java 2实用教程（第5版）',
    edition: '第5版',
    author: '耿祥义、张跃平',
    press: '清华大学出版社',
    price: 59.5,
  },
  {
    isbn: '9787111636878',
    title: '离散数学及其应用（原书第8版）',
    edition: '原书第8版',
    author: 'Kenneth H. Rosen（徐六通等 译）',
    press: '机械工业出版社',
    price: 139.0,
  },
  // —— 数学 / 物理类 ——
  {
    isbn: '9787040589818',
    title: '高等数学（第八版）上册',
    edition: '第8版',
    author: '同济大学数学科学学院',
    press: '高等教育出版社',
    price: 56.8,
  },
  {
    isbn: '9787040396614',
    title: '工程数学 线性代数（第六版）',
    edition: '第6版',
    author: '同济大学数学系',
    press: '高等教育出版社',
    price: 24.8,
  },
  {
    isbn: '9787040516609',
    title: '概率论与数理统计（第五版）',
    edition: '第5版',
    author: '盛骤、谢式千、潘承毅',
    press: '高等教育出版社',
    price: 51.4,
  },
  {
    isbn: '9787040616200',
    title: '离散数学（第3版）',
    edition: '第3版',
    author: '屈婉玲、曹永知、耿素云、张立昂',
    press: '高等教育出版社',
    price: 66.0,
  },
  {
    isbn: '9787302509806',
    title: '大学物理学（第4版）力学、热学',
    edition: '第4版',
    author: '张三慧',
    press: '清华大学出版社',
    price: 67.0,
  },
  {
    isbn: '9787302509844',
    title: '大学物理学（第4版）电磁学、光学、量子物理',
    edition: '第4版',
    author: '张三慧',
    press: '清华大学出版社',
    price: 81.0,
  },
  {
    isbn: '9787040429190',
    title: '普通物理学（第七版）上册',
    edition: '第7版',
    author: '程守洙、江之永',
    press: '高等教育出版社',
    price: 52.8,
  },
  // —— 外语类 ——
  {
    isbn: '9787560025063',
    title: '新视野大学英语 读写教程1',
    edition: '第1版',
    author: '郑树棠（总主编）',
    press: '外语教学与研究出版社',
    price: 30.9,
  },
]

/**
 * 软工2023-1 的课程 → 教材映射（一条课程一条教材，构成该班的征订范围）。
 * 只用**已存在**的课程「数据结构」+ 新增 3 门，形成 4 行真实征订单。
 */
const CURRICULUM = [
  { code: 'CS101', name: '数据结构', textbookIsbn: '9787302147510', quantity: 50 },
  { code: 'MATH201', name: '高等数学（上）', textbookIsbn: '9787040589818', quantity: 50 },
  { code: 'MATH203', name: '线性代数', textbookIsbn: '9787040396614', quantity: 50 },
  { code: 'ENG101', name: '大学英语（读写）', textbookIsbn: '9787560025063', quantity: 50 },
]

/* ------------------------------------------------------------------------- */
let calls = 0
const sessions = {}

async function raw(method, path, { token, body } = {}) {
  calls += 1
  const headers = {}
  let payload
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  const text = await res.text()
  let env = null
  try {
    env = text ? JSON.parse(text) : null
  } catch {
    env = null
  }
  return { status: res.status, code: env?.code, message: env?.message, data: env?.data }
}

const call = (m, p, o = {}) =>
  raw(m, p, { ...o, token: o.role ? sessions[o.role]?.accessToken : o.token })

async function login(key, [userNo, password]) {
  const res = await raw('POST', '/api/auth/login', { body: { userNo, password } })
  if (res.status !== 200) throw new Error(`登录失败 ${userNo}: ${res.code} ${res.message}`)
  sessions[key] = { accessToken: res.data.accessToken, refreshToken: res.data.refreshToken }
  return res.data
}

const out = []
function log(ok, msg) {
  out.push({ ok, msg })
  console.log(`  [${ok ? 'OK' : '!!'}] ${msg}`)
}

/* ------------------------------------------------------------------------- */
async function main() {
  console.log('='.repeat(76))
  console.log(`第一批演示数据灌入 ｜ 目标 ${BASE}`)
  console.log('='.repeat(76))

  await login('ADMIN', ADMIN)
  await login('TEACHER', TEACHER)

  /* ---------- 1) 教材库 ---------- */
  console.log('\n[1] 教材库（真实 ISBN + 当前定价）')
  const existing = await call('GET', '/api/admin/textbook?page=1&size=200', { role: 'ADMIN' })
  const byIsbn = new Map((existing.data?.list || []).map((b) => [b.isbn, b]))
  const idOfIsbn = new Map(byIsbn)

  let created = 0
  for (const book of TEXTBOOKS) {
    if (byIsbn.has(book.isbn)) {
      log(true, `已存在，跳过：${book.title}（${book.isbn}）`)
      continue
    }
    const res = await call('POST', '/api/admin/textbook', { role: 'ADMIN', body: book })
    if (res.status === 200 && res.data?.id) {
      idOfIsbn.set(book.isbn, res.data)
      created += 1
      log(true, `新增：${book.title} ｜ ${book.press} ｜ ¥${book.price.toFixed(2)}`)
    } else {
      log(false, `新增失败：${book.title} → ${res.status} ${res.code} ${res.message}`)
    }
  }
  console.log(`  → 教材：新增 ${created} 本，库内合计 ${idOfIsbn.size} 本`)

  /* ---------- 2) 学期与班级 ---------- */
  const sem = await call('GET', '/api/admin/semester', { role: 'ADMIN' })
  const active = (sem.data || []).find((s) => s.activeStatus === 'active')
  if (!active) throw new Error('未找到 active 学期')

  const classes = await call('GET', '/api/admin/class', { role: 'ADMIN' })
  const klass = (classes.data || []).find((c) => c.name === '软工2023-1')
  if (!klass) throw new Error('未找到班级 软工2023-1')

  const me = await call('GET', '/api/me', { role: 'TEACHER' })
  const teacherId = me.data?.userId ?? me.data?.id
  console.log(
    `\n[2] 目标：学期=${active.name}(#${active.id}) 班级=${klass.name}(#${klass.id}) 教师=${me.data?.userNo}`,
  )

  /* ---------- 3) 课程 + 任课关系 ---------- */
  console.log('\n[3] 课程与任课关系（= 该班征订范围）')
  const courses = await call('GET', `/api/admin/course?semesterId=${active.id}`, { role: 'ADMIN' })
  const courseByName = new Map((courses.data || []).map((c) => [c.name, c]))
  const courseIdByCode = new Map()

  for (const item of CURRICULUM) {
    let course = courseByName.get(item.name)
    if (!course) {
      const res = await call('POST', '/api/admin/course', {
        role: 'ADMIN',
        body: { semesterId: active.id, code: item.code, name: item.name },
      })
      if (res.status === 200 && res.data?.id) {
        course = res.data
        log(true, `新增课程：${item.name}（${item.code}）`)
      } else {
        log(false, `新增课程失败：${item.name} → ${res.status} ${res.code} ${res.message}`)
        continue
      }
    } else {
      log(true, `课程已存在：${item.name}`)
    }
    courseIdByCode.set(item.code, course.id)
  }

  const assignments = await call(
    'GET',
    `/api/admin/teacher-course?semesterId=${active.id}&teacherId=${teacherId}`,
    { role: 'ADMIN' },
  )
  const assigned = new Set((assignments.data || []).map((a) => `${a.courseId}-${a.classId}`))
  for (const item of CURRICULUM) {
    const courseId = courseIdByCode.get(item.code)
    if (!courseId) continue
    if (assigned.has(`${courseId}-${klass.id}`)) {
      log(true, `任课关系已存在：${item.name} × ${klass.name}`)
      continue
    }
    const res = await call('POST', '/api/admin/teacher-course', {
      role: 'ADMIN',
      body: { semesterId: active.id, teacherId, courseId, classId: klass.id },
    })
    if (res.status === 200) log(true, `新增任课关系：${item.name} × ${klass.name}`)
    else log(false, `任课关系失败：${item.name} → ${res.status} ${res.code} ${res.message}`)
  }

  /* ---------- 4) 教师填报（正确课程↔教材配对） ---------- */
  console.log('\n[4] 教师填报（课程 ↔ 教材 一一对应）')
  const before = await call('GET', '/api/teacher/order-form', { role: 'TEACHER' })
  if (before.data?.status === 'reviewed') {
    log(true, `#${before.data.id} 已是 reviewed（终态），跳过填报（学生已可选书）`)
    summarize()
    return
  }

  const items = CURRICULUM.map((item) => ({
    courseId: courseIdByCode.get(item.code),
    classId: klass.id,
    textbookId: idOfIsbn.get(item.textbookIsbn)?.id,
    quantity: item.quantity,
  })).filter((i) => i.courseId && i.textbookId)

  if (!items.length) throw new Error('没有可用的 课程×教材 组合')
  const submit = await call('POST', '/api/teacher/order-form/submit', {
    role: 'TEACHER',
    body: { items },
  })
  if (submit.status !== 200) {
    log(false, `提交失败 → ${submit.status} ${submit.code} ${submit.message}`)
  } else {
    log(
      true,
      `提交成功：#${submit.data.id} status=${submit.data.status} 明细 ${items.length} 行，版本 ${submit.data.contentVersion}`,
    )
  }

  /* ---------- 5) 管理员审核通过 → reviewed（学生才可选） ---------- */
  console.log('\n[5] 管理员审核通过（reviewed 后学生才可选该书）')
  const formId = submit.data?.id ?? before.data?.id
  const detail = await call('GET', `/api/admin/order-forms/${formId}`, { role: 'ADMIN' })
  const version = detail.data?.contentVersion
  const review = await call('POST', `/api/admin/order-forms/${formId}/review`, {
    role: 'ADMIN',
    body: { action: 'pass', reason: '', contentVersion: version },
  })
  if (review.status === 200) {
    log(
      true,
      `审核通过：#${formId}（contentVersion=${version}）→ 该班学生现在可选这 ${items.length} 本教材`,
    )
  } else {
    log(false, `审核失败 → ${review.status} ${review.code} ${review.message}`)
  }

  summarize()
}

function summarize() {
  const ok = out.filter((o) => o.ok).length
  const bad = out.length - ok
  console.log('\n' + '='.repeat(76))
  console.log(
    `演示数据灌入：步骤 ${out.length} ｜ OK ${ok} ｜ 失败 ${bad} ｜ HTTP 调用 ${calls} 次`,
  )
  if (bad) {
    console.log('失败项：')
    for (const o of out.filter((x) => !x.ok)) console.log('  - ' + o.msg)
  }
  console.log('='.repeat(76))
  process.exit(bad ? 1 : 0)
}

main().catch((e) => {
  console.error('\n异常终止：', e.message)
  process.exit(1)
})
