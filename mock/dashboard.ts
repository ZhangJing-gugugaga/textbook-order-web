import type { MockMethod } from 'vite-plugin-mock'
import { db, iso, DAY } from './db'
import { currentUser, ok, withAuth } from './auth'

/** 数据看板统计（后端 M4 交付，此处为本地 mock） */
const dashboardMocks: MockMethod[] = [
  {
    url: '/api/dashboard/stats',
    method: 'get',
    response: withAuth(() => {
      const semester = db.semesters.find((item) => item.status === 'active')
      const forms = db.orderForms.filter((form) => form.semesterId === (semester?.id ?? 1))
      const students = db.people.filter((item) => item.type === 'student')
      const orderedStudentIds = new Set(
        db.studentOrders
          .filter((order) => order.semesterId === (semester?.id ?? 1))
          .map((order) => order.studentId),
      )
      const colleges = db.colleges.map((college) => {
        const collegeForms = forms.filter((form) => form.collegeId === college.id)
        const collegeStudents = students.filter((item) => item.collegeId === college.id)
        return {
          collegeId: college.id,
          collegeName: college.name,
          teacherTotal: collegeForms.length,
          submitted: collegeForms.length,
          reviewed: collegeForms.filter((form) => form.status === 'reviewed').length,
          studentTotal: collegeStudents.length,
          studentOrdered: collegeStudents.filter((item) => orderedStudentIds.has(item.id)).length,
        }
      })
      const unconfirmed = Object.values(db.unconfirmedByUser).reduce(
        (sum, ids) => sum + ids.length,
        0,
      )
      return ok({
        windowStatus: 'open',
        windowEnd: semester?.windowEnd ?? '',
        semesterName: semester?.name ?? '',
        colleges,
        pendingReviewCount: forms.filter((form) => form.status === 'pending_review').length,
        unconfirmedNoticeCount: unconfirmed,
      })
    }),
  },
  {
    url: '/api/college/order-forms/page',
    method: 'post',
    response: withAuth(({ body, headers }) => {
      const user = currentUser(headers)!
      const page = Math.max(1, Number(body?.page) || 1)
      const size = Math.min(100, Math.max(1, Number(body?.size) || 10))
      // 数据范围由后端强制过滤：秘书仅本院
      const list = db.orderForms.filter((form) => user.collegeIds.includes(form.collegeId))
      return ok({
        list: list
          .slice((page - 1) * size, page * size)
          .map((form) => ({ ...form, items: form.items.map((i) => ({ ...i })) })),
        total: list.length,
      })
    }),
  },
  {
    url: '/api/supplier/orders/page',
    method: 'post',
    response: withAuth(({ body }) => {
      const page = Math.max(1, Number(body?.page) || 1)
      const size = Math.min(100, Math.max(1, Number(body?.size) || 10))
      const collegeId = Number(body?.collegeId) || 0
      const keyword = String(body?.keyword ?? '').trim()
      // 接口层物理隔离：仅返回 书名/ISBN/教师姓名/学院 四类字段
      const rows = db.orderForms
        .filter((form) => form.status !== 'draft')
        .filter((form) => (collegeId ? form.collegeId === collegeId : true))
        .flatMap((form) =>
          form.items.map((item) => ({
            id: item.id,
            title: item.textbookTitle,
            isbn: item.isbn,
            teacherName: form.teacherName,
            collegeName: form.collegeName,
          })),
        )
        .filter((row) =>
          keyword
            ? row.title.includes(keyword) ||
              row.isbn.includes(keyword) ||
              row.teacherName.includes(keyword)
            : true,
        )
      return ok({ list: rows.slice((page - 1) * size, page * size), total: rows.length })
    }),
  },
  {
    url: '/api/supplier/export',
    method: 'post',
    response: withAuth(() => ok({ sync: true })),
  },
  {
    url: '/api/dashboard/pending-review',
    method: 'get',
    response: withAuth(() => {
      const list = db.orderForms.filter((form) => form.status === 'pending_review')
      return ok({ count: list.length, updatedAt: iso(-1 * DAY) })
    }),
  },
]

export default dashboardMocks
