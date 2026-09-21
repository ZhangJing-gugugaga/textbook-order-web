import type { MockMethod } from 'vite-plugin-mock'
import { CODE } from '../src/utils/constants'
import { classBooks, db, iso } from './db'
import type { FieldCheckItem } from '../src/types'
import { currentUser, fail, num, ok, pageParams, withAuth } from './auth'

let formSeq = 2000
let itemSeq = 100

/** 系统字段审查白名单（PRD 功能 3：客观项，教师可控可修复） */
function runFieldCheck(
  items: { courseId: number; classId: number; textbookId: number; quantity: number }[],
): FieldCheckItem[] {
  const result: FieldCheckItem[] = []
  const textbooks = new Map(db.textbooks.map((item) => [item.id, item]))
  const classes = new Map(db.classes.map((item) => [item.id, item]))
  const assignments = db.assignments
  const courses = new Map(db.courses.map((item) => [item.id, item]))

  if (items.length === 0) {
    result.push({
      field: '明细',
      rule: 'items_not_empty',
      passed: false,
      message: '请至少选择一门教材',
    })
    return result
  }
  for (const item of items) {
    const book = textbooks.get(item.textbookId)
    const klass = classes.get(item.classId)
    const course = courses.get(item.courseId)
    const teaching = assignments.some(
      (a) => a.courseId === item.courseId && a.classId === item.classId,
    )

    result.push({
      field: '教材',
      rule: 'textbook_in_stock',
      passed: Boolean(book && book.status === 'active'),
      message:
        book && book.status === 'active'
          ? `教材在库：${book.title}`
          : '教材不存在或已停用，请从教材库重新选择',
    })
    result.push({
      field: '数量',
      rule: 'quantity_gt_zero',
      passed: Number(item.quantity) > 0,
      message: Number(item.quantity) > 0 ? '数量大于 0' : '数量需大于 0',
    })
    result.push({
      field: '数量',
      rule: 'quantity_lte_class_size',
      passed: Boolean(klass) && Number(item.quantity) <= (klass?.studentCount ?? 0),
      message: klass
        ? Number(item.quantity) <= klass.studentCount
          ? `数量未超过班级人数 ${klass.studentCount}`
          : `数量 ${item.quantity} 超过班级人数上限 ${klass.studentCount}，请核对`
        : '班级不存在，请确认课程 × 班级任课关系',
    })
    result.push({
      field: '课程归属',
      rule: 'course_ownership',
      passed: Boolean(course),
      message: course ? `课程存在：${course.name}` : '课程不存在，请从教材室维护的课程中选择',
    })
    result.push({
      field: '任课关联',
      rule: 'teaching_exists',
      passed: teaching,
      message: teaching ? '课程 × 班级任课关系存在' : '课程 × 班级任课关系不存在，请联系教材室',
    })
    result.push({
      field: 'ISBN',
      rule: 'isbn_format',
      passed: Boolean(book && /^978\d{10}$/.test(book.isbn)),
      message: book && /^978\d{10}$/.test(book.isbn) ? 'ISBN 格式正确' : 'ISBN 格式不正确',
    })
  }
  return result
}

function formOf(form: (typeof db.orderForms)[number]) {
  return {
    ...form,
    items: form.items.map((item) => ({ ...item })),
    fieldCheck: form.fieldCheck ? form.fieldCheck.map((item) => ({ ...item })) : null,
  }
}

/** 教师视角：仅本人表单 */
function myForms(userNo: string) {
  const user = db.users.find((item) => item.userNo === userNo)
  if (!user) return []
  return db.orderForms.filter((form) => form.teacherId === user.id)
}

/** 秘书/超管视角：按数据范围过滤（秘书仅本院） */
function scopedForms(user: ReturnType<typeof currentUser>) {
  if (!user) return []
  if (user.roles.includes('admin')) return db.orderForms
  const collegeIds = user.collegeIds
  return db.orderForms.filter((form) => collegeIds.includes(form.collegeId))
}

const orderMocks: MockMethod[] = [
  /* ---------------- 教师：我的课程 ---------------- */
  {
    url: '/api/order-forms/my/courses',
    method: 'get',
    response: withAuth(({ headers }) => {
      const user = currentUser(headers)!
      const list = db.assignments.filter(
        (item) => item.teacherName === user.name || item.teacherId === user.id,
      )
      return ok(list)
    }),
  },

  /* ---------------- 教师：我的提交记录 ---------------- */
  {
    url: '/api/order-forms/my/page',
    method: 'post',
    response: withAuth(({ body, headers, params }) => {
      const user = currentUser(headers)!
      const { page, size, source } = pageParams(body, params)
      const status = String(source.status ?? '')
      const keyword = String(source.keyword ?? '').trim()
      let list = myForms(user.userNo)
      if (status) list = list.filter((item) => item.status === status)
      if (keyword) {
        list = list.filter((form) =>
          form.items.some(
            (item) => item.courseName.includes(keyword) || item.textbookTitle.includes(keyword),
          ),
        )
      }
      return ok({
        list: list.slice((page - 1) * size, page * size).map(formOf),
        total: list.length,
      })
    }),
  },

  /* ---------------- 全院表单分页（超管 / 秘书数据范围） ---------------- */
  {
    url: '/api/order-forms/page',
    method: 'post',
    response: withAuth(({ body, headers, params }) => {
      const user = currentUser(headers)!
      const { page, size, source } = pageParams(body, params)
      const status = String(source.status ?? '')
      const keyword = String(source.keyword ?? '').trim()
      const collegeId = Number(source.collegeId) || 0
      let list = scopedForms(user)
      if (status) list = list.filter((item) => item.status === status)
      if (collegeId) list = list.filter((item) => item.collegeId === collegeId)
      if (keyword) {
        list = list.filter(
          (form) =>
            form.teacherName.includes(keyword) ||
            form.items.some(
              (item) => item.courseName.includes(keyword) || item.textbookTitle.includes(keyword),
            ),
        )
      }
      return ok({
        list: list.slice((page - 1) * size, page * size).map(formOf),
        total: list.length,
      })
    }),
  },
  {
    url: '/api/order-forms/:id',
    method: 'get',
    response: withAuth(({ headers, params }) => {
      const user = currentUser(headers)!
      const form = db.orderForms.find((item) => item.id === num(params, 'id'))
      if (!form) return fail('表单不存在', 40400)
      if (
        !user.roles.includes('admin') &&
        !user.collegeIds.includes(form.collegeId) &&
        form.teacherId !== user.id
      ) {
        return fail('无权访问该表单', CODE.FORBIDDEN)
      }
      return ok(formOf(form))
    }),
  },

  /* ---------------- 提交 / 补正重提（两级审查第一级：系统字段审查） ---------------- */
  {
    url: '/api/order-forms/submit',
    method: 'post',
    response: withAuth(({ body, headers }) => {
      const user = currentUser(headers)!
      const items = Array.isArray(body?.items) ? (body.items as never[]) : []
      if (items.length === 0) return fail('请先从教材库选择教材', 40060)
      const fieldCheck = runFieldCheck(items as never)
      const failed = fieldCheck.filter((item) => !item.passed)
      const id = ++formSeq
      const first = items[0] as { courseId: number; classId: number }
      const klass = db.classes.find((item) => item.id === first.classId)
      const form = {
        id,
        semesterId: 1,
        teacherId: user.id,
        teacherName: user.name,
        collegeId: klass?.collegeId ?? user.collegeIds[0] ?? 1,
        collegeName: db.colleges.find((item) => item.id === (klass?.collegeId ?? 1))?.name ?? '',
        status: (failed.length ? 'rejected' : 'pending_review') as 'rejected' | 'pending_review',
        items: (
          items as { courseId: number; classId: number; textbookId: number; quantity: number }[]
        ).map((item) => {
          const book = db.textbooks.find((b) => b.id === item.textbookId)
          const course = db.courses.find((c) => c.id === item.courseId)
          return {
            id: ++itemSeq,
            courseId: item.courseId,
            courseName: course?.name ?? '',
            classId: item.classId,
            className: klass?.name ?? '',
            textbookId: item.textbookId,
            textbookTitle: book?.title ?? '',
            isbn: book?.isbn ?? '',
            price: book?.price ?? 0,
            quantity: item.quantity,
          }
        }),
        fieldCheck,
        reviewComment: null,
        reviewedBy: null,
        createdAt: iso(0),
        updatedAt: iso(0),
      }
      db.orderForms.unshift(form)
      return ok({ id, fieldCheck })
    }),
  },
  {
    url: '/api/order-forms/:id/resubmit',
    method: 'post',
    response: withAuth(({ body, headers, params }) => {
      const user = currentUser(headers)!
      const form = db.orderForms.find((item) => item.id === num(params, 'id'))
      if (!form) return fail('表单不存在', 40400)
      if (form.teacherId !== user.id) return fail('无权操作该表单', CODE.FORBIDDEN)
      const items = Array.isArray(body?.items) ? (body.items as never[]) : []
      const fieldCheck = runFieldCheck(items as never)
      const failed = fieldCheck.filter((item) => !item.passed)
      form.items = (
        items as { courseId: number; classId: number; textbookId: number; quantity: number }[]
      ).map((item) => {
        const book = db.textbooks.find((b) => b.id === item.textbookId)
        const course = db.courses.find((c) => c.id === item.courseId)
        const klass = db.classes.find((c) => c.id === item.classId)
        return {
          id: ++itemSeq,
          courseId: item.courseId,
          courseName: course?.name ?? '',
          classId: item.classId,
          className: klass?.name ?? '',
          textbookId: item.textbookId,
          textbookTitle: book?.title ?? '',
          isbn: book?.isbn ?? '',
          price: book?.price ?? 0,
          quantity: item.quantity,
        }
      })
      form.fieldCheck = fieldCheck
      form.status = failed.length ? 'rejected' : 'pending_review'
      form.reviewComment = failed.length ? null : form.reviewComment
      form.updatedAt = iso(0)
      return ok({ id: form.id, fieldCheck })
    }),
  },

  /* ---------------- 超管内容审核（两级审查第二级） ---------------- */
  {
    url: '/api/order-forms/:id/review',
    method: 'post',
    response: withAuth(({ body, params }) => {
      const form = db.orderForms.find((item) => item.id === num(params, 'id'))
      if (!form) return fail('表单不存在', 40400)
      if (form.status !== 'pending_review') {
        return fail('该表单已被处理，请刷新后重试', 40900)
      }
      const action = String(body?.action ?? '')
      if (action === 'approve') {
        form.status = 'reviewed'
        form.reviewedBy = '张教材'
        form.reviewComment = '同意'
      } else if (action === 'reject') {
        const comment = String(body?.comment ?? '').trim()
        if (!comment) return fail('驳回理由必填', 40061)
        if (comment.length > 200) return fail('驳回理由不超过 200 字', 40062)
        form.status = 'rejected'
        form.reviewComment = comment
        form.reviewedBy = '张教材'
      } else {
        return fail('不支持的审核动作', 40063)
      }
      form.updatedAt = iso(0)
      return ok(formOf(form))
    }),
  },

  /* ---------------- 学生选购 ---------------- */
  {
    url: '/api/student-order/class-books',
    method: 'get',
    response: withAuth(({ headers }) => {
      const user = currentUser(headers)!
      const person = db.people.find((item) => item.userNo === user.userNo)
      const classId = person?.classId ?? 101
      const existing = db.studentOrders.find(
        (order) => order.studentId === user.id && order.semesterId === 1,
      )
      const base = existing?.items ?? classBooks(classId)
      return ok(base.map((item) => ({ ...item })))
    }),
  },
  {
    url: '/api/student-order/submit',
    method: 'post',
    response: withAuth(({ body, headers }) => {
      const user = currentUser(headers)!
      const semester = db.semesters.find((item) => item.status === 'active')
      if (!semester) return fail('当前没有进行中的学期', 40070)
      const now = Date.now()
      if (
        now < new Date(semester.windowStart).getTime() ||
        now > new Date(semester.windowEnd).getTime()
      ) {
        // 关窗瞬间提交：后端 409 兜底（PRD 选书页异常分支）
        return fail('本期征订已截止，提交未生效', CODE.WINDOW_CLOSED)
      }
      const items = Array.isArray(body?.items)
        ? (body.items as { textbookId: number; quantity: number }[])
        : []
      const person = db.people.find((item) => item.userNo === user.userNo)
      const classId = person?.classId ?? 101
      const current = classBooks(classId)
      const selected = items
        .map((item) => {
          const book = current.find((b) => b.textbookId === item.textbookId)
          return book
            ? { ...book, quantity: Math.max(1, Number(item.quantity) || 1), checked: true }
            : null
        })
        .filter(Boolean) as typeof current
      const order = {
        id: Math.max(...db.studentOrders.map((item) => item.id)) + 1,
        semesterId: semester.id,
        semesterName: semester.name,
        studentId: user.id,
        classId,
        className: db.classes.find((item) => item.id === classId)?.name ?? '',
        // 覆盖更新语义：整单替换（未勾选的教材保留在 items 中但 checked=false）
        items: current.map(
          (book) => selected.find((item) => item.textbookId === book.textbookId) ?? book,
        ),
        totalAmount: selected.reduce((sum, item) => sum + item.price * item.quantity, 0),
        totalQuantity: selected.reduce((sum, item) => sum + item.quantity, 0),
        submittedAt: iso(0),
      }
      const index = db.studentOrders.findIndex(
        (item) => item.studentId === user.id && item.semesterId === semester.id,
      )
      if (index >= 0) db.studentOrders[index] = order
      else db.studentOrders.unshift(order)
      return ok(order, '提交成功')
    }),
  },
  {
    url: '/api/student-order/my/page',
    method: 'post',
    response: withAuth(({ body, headers, params }) => {
      const user = currentUser(headers)!
      const { page, size, source } = pageParams(body, params)
      const keyword = String(source.keyword ?? '').trim()
      // 超管看全院，学生看本人
      const list = db.studentOrders.filter((order) =>
        user.roles.includes('admin') ? true : order.studentId === user.id,
      )
      const filtered = keyword
        ? list.filter(
            (order) => order.className.includes(keyword) || order.semesterName.includes(keyword),
          )
        : list
      return ok({
        list: filtered
          .slice((page - 1) * size, page * size)
          .map((order) => ({ ...order, items: order.items.map((item) => ({ ...item })) })),
        total: filtered.length,
      })
    }),
  },
]

/** 班级教材清单（复用 db.ts 定义，保证列表与提交口径一致） */
export default orderMocks
