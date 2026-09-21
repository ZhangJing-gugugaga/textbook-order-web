import type { MockMethod } from 'vite-plugin-mock'
import { db, iso } from './db'
import type { ImportBatch, MockUser } from './db'
import { fail, num, ok, pageParams, paginate, param, withAuth } from './auth'

let batchSeq = 100

function makeBatch(
  bizType: 'student' | 'teacher' | 'textbook' | 'course' | 'change',
  fileName: string,
) {
  const id = `IMB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(++batchSeq).padStart(3, '0')}`
  const batch: ImportBatch = {
    batchId: id,
    bizType,
    fileName,
    status: 'parsing' as const,
    progressPct: 0,
    totalRows: 0,
    successRows: 0,
    errorRows: 0,
    message: '',
    createdAt: iso(0),
    errorPreview: [] as { row: number; reason: string }[],
  }
  db.importBatches.unshift(batch)
  // 模拟异步解析：1.2s 后完成（含 1 行错误，演示错误回显与明细下载）
  setTimeout(() => {
    batch.status = 'partial'
    batch.progressPct = 100
    batch.totalRows = 12
    batch.successRows = 11
    batch.errorRows = 1
    batch.message = '1 行数据校验失败'
    batch.errorPreview = [{ row: 7, reason: '学号格式不正确（应为 8 位数字）' }]
  }, 1200)
  return batch
}

const dataMocks: MockMethod[] = [
  /* ---------------- 教材库 ---------------- */
  {
    url: '/api/textbooks/page',
    method: 'post',
    response: withAuth(({ body, params }) => {
      const { page, size, source } = pageParams(body, params)
      const keyword = String(source.keyword ?? '').trim()
      const status = String(source.status ?? '')
      let list = [...db.textbooks]
      if (keyword) {
        list = list.filter((item) => item.title.includes(keyword) || item.isbn.includes(keyword))
      }
      if (status) list = list.filter((item) => item.status === status)
      return ok(paginate(list, page, size))
    }),
  },
  {
    url: '/api/textbooks/search',
    method: 'get',
    response: withAuth(({ params }) => {
      const keyword = String(params.keyword ?? '').trim()
      if (!keyword) return ok([])
      return ok(
        db.textbooks.filter((item) => item.title.includes(keyword) || item.isbn.includes(keyword)),
      )
    }),
  },
  {
    url: '/api/textbooks',
    method: 'post',
    response: withAuth(({ body }) => {
      const isbn = String(body?.isbn ?? '').trim()
      if (!/^978\d{10}$/.test(isbn)) return fail('ISBN 需为 13 位且以 978 开头', 40030)
      if (db.textbooks.some((item) => item.isbn === isbn))
        return fail('ISBN 已存在（教材按 ISBN 唯一）', 40031)
      const id = Math.max(...db.textbooks.map((item) => item.id)) + 1
      const book = {
        id,
        isbn,
        title: String(body?.title ?? ''),
        author: String(body?.author ?? ''),
        publisher: String(body?.publisher ?? ''),
        edition: String(body?.edition ?? ''),
        price: Number(body?.price ?? 0),
        status: 'active' as const,
        createdAt: iso(0),
      }
      db.textbooks.push(book)
      return ok(book)
    }),
  },
  {
    url: '/api/textbooks/:id',
    method: 'put',
    response: withAuth(({ body, params }) => {
      const book = db.textbooks.find((item) => item.id === num(params, 'id'))
      if (!book) return fail('教材不存在', 40400)
      const isbn = String(body?.isbn ?? book.isbn)
      if (db.textbooks.some((item) => item.isbn === isbn && item.id !== book.id)) {
        return fail('ISBN 已存在（教材按 ISBN 唯一）', 40031)
      }
      Object.assign(book, {
        isbn,
        title: String(body?.title ?? book.title),
        author: String(body?.author ?? book.author),
        publisher: String(body?.publisher ?? book.publisher),
        edition: String(body?.edition ?? book.edition),
        price: Number(body?.price ?? book.price),
      })
      return ok(book)
    }),
  },
  {
    url: '/api/textbooks/:id',
    method: 'delete',
    response: withAuth(({ params }) => {
      const index = db.textbooks.findIndex((item) => item.id === num(params, 'id'))
      if (index < 0) return fail('教材不存在', 40400)
      db.textbooks.splice(index, 1)
      return ok(null, '已删除')
    }),
  },
  {
    url: '/api/textbooks/:id/disable',
    method: 'post',
    response: withAuth(({ params }) => {
      const book = db.textbooks.find((item) => item.id === num(params, 'id'))
      if (!book) return fail('教材不存在', 40400)
      book.status = 'disabled'
      return ok(book)
    }),
  },
  {
    url: '/api/textbooks/:id/enable',
    method: 'post',
    response: withAuth(({ params }) => {
      const book = db.textbooks.find((item) => item.id === num(params, 'id'))
      if (!book) return fail('教材不存在', 40400)
      book.status = 'active'
      return ok(book)
    }),
  },
  {
    url: '/api/textbooks/import',
    method: 'post',
    response: withAuth(() => ok({ batchId: makeBatch('textbook', '教材库.xlsx').batchId })),
  },

  /* ---------------- 课程与任课 ---------------- */
  {
    url: '/api/courses/page',
    method: 'post',
    response: withAuth(({ body, params }) => {
      const { page, size, source } = pageParams(body, params)
      const keyword = String(source.keyword ?? '').trim()
      const collegeId = Number(source.collegeId) || 0
      let list = [...db.courses]
      if (keyword)
        list = list.filter((item) => item.name.includes(keyword) || item.code.includes(keyword))
      if (collegeId) list = list.filter((item) => item.collegeId === collegeId)
      return ok(paginate(list, page, size))
    }),
  },
  {
    url: '/api/courses/assignments',
    method: 'get',
    response: withAuth(({ params }) => {
      const courseId = Number(params.courseId) || 0
      let list = [...db.assignments]
      if (courseId) list = list.filter((item) => item.courseId === courseId)
      return ok(list)
    }),
  },
  {
    url: '/api/courses/assignments',
    method: 'post',
    response: withAuth(({ body }) => {
      const course = db.courses.find((item) => item.id === Number(body?.courseId))
      if (!course) return fail('课程不存在', 40400)
      const id = Math.max(0, ...db.assignments.map((item) => item.id)) + 1
      const assignment = {
        id,
        courseId: course.id,
        courseName: course.name,
        teacherId: 0,
        teacherName: String(body?.teacherName ?? ''),
        classId: 0,
        className: String(body?.className ?? ''),
        collegeId: course.collegeId,
        semesterId: 1,
      }
      db.assignments.push(assignment)
      return ok(assignment)
    }),
  },
  {
    url: '/api/courses/assignments/:id',
    method: 'delete',
    response: withAuth(({ params }) => {
      const index = db.assignments.findIndex((item) => item.id === num(params, 'id'))
      if (index < 0) return fail('任课关系不存在', 40400)
      db.assignments.splice(index, 1)
      return ok(null, '已删除')
    }),
  },
  {
    url: '/api/courses/assignments/import',
    method: 'post',
    response: withAuth(() => ok({ batchId: makeBatch('course', '任课关系.xlsx').batchId })),
  },
  {
    url: '/api/courses',
    method: 'post',
    response: withAuth(({ body }) => {
      const name = String(body?.name ?? '').trim()
      if (!name) return fail('请输入课程名称', 40040)
      const id = Math.max(...db.courses.map((item) => item.id)) + 1
      const course = {
        id,
        code: String(body?.code ?? ''),
        name,
        collegeId: Number(body?.collegeId),
        credit: Number(body?.credit ?? 0),
      }
      db.courses.push(course)
      return ok(course)
    }),
  },
  {
    url: '/api/courses/:id',
    method: 'put',
    response: withAuth(({ body, params }) => {
      const course = db.courses.find((item) => item.id === num(params, 'id'))
      if (!course) return fail('课程不存在', 40400)
      Object.assign(course, {
        code: String(body?.code ?? course.code),
        name: String(body?.name ?? course.name),
        collegeId: Number(body?.collegeId ?? course.collegeId),
        credit: Number(body?.credit ?? course.credit),
      })
      return ok(course)
    }),
  },
  {
    url: '/api/courses/:id',
    method: 'delete',
    response: withAuth(({ params }) => {
      const index = db.courses.findIndex((item) => item.id === num(params, 'id'))
      if (index < 0) return fail('课程不存在', 40400)
      db.courses.splice(index, 1)
      return ok(null, '已删除')
    }),
  },

  /* ---------------- 学生 / 教师 ---------------- */
  {
    url: '/api/people/page',
    method: 'post',
    response: withAuth(({ body, params }) => {
      const { page, size, source } = pageParams(body, params)
      const type = String(source.type ?? 'student')
      const keyword = String(source.keyword ?? '').trim()
      let list = db.people.filter((item) => item.type === type)
      if (keyword)
        list = list.filter((item) => item.name.includes(keyword) || item.userNo.includes(keyword))
      return ok(paginate(list, page, size))
    }),
  },
  {
    url: '/api/people/import',
    method: 'post',
    response: withAuth(() => ok({ batchId: makeBatch('student', '学生全量表.xlsx').batchId })),
  },

  /* ---------------- 导入批次 ---------------- */
  {
    url: '/api/import-batches/:id',
    method: 'get',
    response: withAuth(({ params }) => {
      const batch = db.importBatches.find((item) => item.batchId === param(params, 'id'))
      if (!batch) return fail('批次不存在', 40400)
      return ok(batch)
    }),
  },

  /* ---------------- 账号管理 ---------------- */
  {
    url: '/api/accounts/page',
    method: 'post',
    response: withAuth(({ body, params }) => {
      const { page, size, source } = pageParams(body, params)
      const keyword = String(source.keyword ?? '').trim()
      const role = String(source.role ?? '')
      const status = String(source.status ?? '')
      let list = [...db.accounts]
      if (keyword)
        list = list.filter((item) => item.name.includes(keyword) || item.userNo.includes(keyword))
      if (role) list = list.filter((item) => item.roles.includes(role as never))
      if (status) list = list.filter((item) => item.status === status)
      return ok(paginate(list, page, size))
    }),
  },
  {
    url: '/api/accounts',
    method: 'post',
    response: withAuth(({ body }) => {
      const userNo = String(body?.userNo ?? '').trim()
      if (!/^[A-Za-z0-9]{4,32}$/.test(userNo)) return fail('学号/工号需为 4-32 位字母或数字', 40050)
      if (db.users.some((item) => item.userNo === userNo)) return fail('账号已存在', 40051)
      const id = Math.max(...db.users.map((item) => item.id)) + 1
      const initial = String(body?.initialPassword ?? userNo.slice(-6))
      const role = String(body?.role ?? 'teacher')
      const collegeId = Number(body?.collegeId) || null
      const account = {
        id,
        userNo,
        name: String(body?.name ?? ''),
        password: initial,
        roles: [role] as MockUser['roles'],
        collegeIds: collegeId ? [collegeId] : [],
        mustChangePassword: true,
        status: 'active' as const,
        collegeName: collegeId ? (db.colleges.find((c) => c.id === collegeId)?.name ?? '—') : '—',
        createdAt: iso(0),
      }
      db.users.push(account)
      db.accounts.push(account)
      return ok({ ...account, password: undefined }, '账号已创建')
    }),
  },
  {
    url: '/api/accounts/:id/status',
    method: 'post',
    response: withAuth(({ body, params }) => {
      const account = db.accounts.find((item) => item.id === num(params, 'id'))
      if (!account) return fail('账号不存在', 40400)
      account.status = String(body?.status) === 'disabled' ? 'disabled' : 'active'
      return ok(null, '已更新')
    }),
  },
  {
    url: '/api/accounts/:id/reset-password',
    method: 'post',
    response: withAuth(({ params }) => {
      const account = db.accounts.find((item) => item.id === num(params, 'id'))
      if (!account) return fail('账号不存在', 40400)
      account.password = account.userNo.slice(-6)
      account.mustChangePassword = true
      return ok({ initialPassword: account.password })
    }),
  },
]

export default dataMocks
