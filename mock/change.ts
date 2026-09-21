import type { MockMethod } from 'vite-plugin-mock'
import { db, iso } from './db'
import type { FieldCheckItem } from '../src/types'
import { currentUser, fail, num, ok, pageParams, withAuth } from './auth'

let changeSeq = 4000

/** 系统字段审查（异动）：客观项白名单 */
function checkChange(payload: {
  studentNo: string
  type: string
  reason: string
}): FieldCheckItem[] {
  const person = db.people.find((item) => item.userNo === payload.studentNo)
  return [
    {
      field: '学号',
      rule: 'student_exists',
      passed: Boolean(person),
      message: person ? `学生存在：${person.name}` : `学号 ${payload.studentNo} 不在名册，请核对`,
    },
    {
      field: '异动类型',
      rule: 'type_valid',
      passed: ['transfer_in', 'transfer_out', 'suspend', 'resume', 'info_fix'].includes(
        payload.type,
      ),
      message: '类型合法',
    },
    {
      field: '原因',
      rule: 'reason_required',
      passed: payload.reason.trim().length > 0 && payload.reason.length <= 200,
      message: payload.reason.trim() ? '原因已填写' : '异动原因必填',
    },
  ]
}

const changeMocks: MockMethod[] = [
  {
    url: '/api/change-requests/page',
    method: 'post',
    response: withAuth(({ body, headers, params }) => {
      const user = currentUser(headers)!
      const { page, size, source } = pageParams(body, params)
      const status = String(source.status ?? '')
      const keyword = String(source.keyword ?? '').trim()
      // 提交人只看本人；超管看全部
      let list = db.changeRequests.filter((item) =>
        user.roles.includes('admin') ? true : item.submitterName === user.name,
      )
      if (status) list = list.filter((item) => item.status === status)
      if (keyword) {
        list = list.filter(
          (item) => item.studentNo.includes(keyword) || item.studentName.includes(keyword),
        )
      }
      return ok({
        list: list.slice((page - 1) * size, page * size).map((item) => ({
          ...item,
          fieldCheck: item.fieldCheck?.map((f) => ({ ...f })) ?? null,
        })),
        total: list.length,
      })
    }),
  },
  {
    url: '/api/change-requests',
    method: 'post',
    response: withAuth(({ body, headers }) => {
      const user = currentUser(headers)!
      const payload = {
        studentNo: String(body?.studentNo ?? '').trim(),
        studentName: String(body?.studentName ?? '').trim(),
        type: String(body?.type ?? 'info_fix'),
        reason: String(body?.reason ?? ''),
      }
      const fieldCheck = checkChange(payload)
      const request = {
        id: ++changeSeq,
        batchId: null,
        semesterId: 1,
        studentNo: payload.studentNo,
        studentName: payload.studentName,
        type: payload.type as 'transfer_in',
        reason: payload.reason,
        submitterName: user.name,
        status: 'pending' as const,
        fieldCheck,
        reviewComment: null,
        reviewedBy: null,
        createdAt: iso(0),
      }
      db.changeRequests.unshift(request)
      return ok(
        { ...request, fieldCheck: fieldCheck.map((f) => ({ ...f })) },
        '已提交，进入两级审批流程',
      )
    }),
  },
  {
    url: '/api/change-requests/batch',
    method: 'post',
    response: withAuth(({ headers }) => {
      const user = currentUser(headers)!
      // 一个上传批次 = 一个 change_request 批次（逐行生成、共享批次号）
      const batchId = `CRB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(
        db.changeRequests.filter((item) => item.batchId).length + 1,
      ).padStart(3, '0')}`
      const seed = [
        {
          studentNo: '20230201',
          studentName: '钱七',
          type: 'info_fix',
          reason: '姓名变更：钱七 → 钱小七',
        },
        { studentNo: '20230301', studentName: '孙八', type: 'resume', reason: '休学期满复学' },
        {
          studentNo: '20230401',
          studentName: '周九',
          type: 'transfer_in',
          reason: '由机械学院转入',
        },
      ]
      for (const row of seed) {
        db.changeRequests.unshift({
          id: ++changeSeq,
          batchId,
          semesterId: 1,
          studentNo: row.studentNo,
          studentName: row.studentName,
          type: row.type as 'info_fix',
          reason: row.reason,
          submitterName: user.name,
          status: 'pending',
          fieldCheck: checkChange(row),
          reviewComment: null,
          reviewedBy: null,
          createdAt: iso(0),
        })
      }
      return ok({ batchId })
    }),
  },
  {
    url: '/api/change-requests/batch/:batchId',
    method: 'get',
    response: withAuth(({ params }) => {
      const batchId = String(params.batchId ?? '')
      const list = db.changeRequests
        .filter((item) => item.batchId === batchId)
        .map((item) => ({ ...item, fieldCheck: item.fieldCheck?.map((f) => ({ ...f })) ?? null }))
      return ok(list)
    }),
  },
  {
    url: '/api/change-requests/:id/approve',
    method: 'post',
    response: withAuth(({ params }) => {
      const request = db.changeRequests.find((item) => item.id === num(params, 'id'))
      if (!request) return fail('异动申请不存在', 40400)
      if (request.status !== 'pending') return fail('该申请已被处理，请刷新后重试', 40900)
      request.status = 'approved'
      request.reviewedBy = '张教材'
      request.reviewComment = '情况属实，同意'
      return ok({ ...request, fieldCheck: request.fieldCheck?.map((f) => ({ ...f })) ?? null })
    }),
  },
  {
    url: '/api/change-requests/:id/reject',
    method: 'post',
    response: withAuth(({ body, params }) => {
      const request = db.changeRequests.find((item) => item.id === num(params, 'id'))
      if (!request) return fail('异动申请不存在', 40400)
      if (request.status !== 'pending') return fail('该申请已被处理，请刷新后重试', 40900)
      const comment = String(body?.comment ?? '').trim()
      if (!comment) return fail('驳回理由必填', 40080)
      if (comment.length > 200) return fail('驳回理由不超过 200 字', 40081)
      request.status = 'rejected'
      request.reviewComment = comment
      request.reviewedBy = '张教材'
      return ok({ ...request, fieldCheck: request.fieldCheck?.map((f) => ({ ...f })) ?? null })
    }),
  },
  {
    url: '/api/change-requests/batch-approve',
    method: 'post',
    response: withAuth(({ body }) => {
      const ids = Array.isArray(body?.ids) ? (body.ids as number[]) : []
      let affected = 0
      for (const id of ids) {
        const request = db.changeRequests.find((item) => item.id === id)
        if (request && request.status === 'pending') {
          request.status = 'approved'
          request.reviewedBy = '张教材'
          request.reviewComment = '批量通过'
          affected += 1
        }
      }
      return ok({ affected })
    }),
  },
  {
    url: '/api/change-requests/batch-reject',
    method: 'post',
    response: withAuth(({ body }) => {
      const ids = Array.isArray(body?.ids) ? (body.ids as number[]) : []
      const comment = String(body?.comment ?? '').trim()
      if (!comment) return fail('驳回理由必填', 40080)
      let affected = 0
      for (const id of ids) {
        const request = db.changeRequests.find((item) => item.id === id)
        if (request && request.status === 'pending') {
          request.status = 'rejected'
          request.reviewComment = comment
          request.reviewedBy = '张教材'
          affected += 1
        }
      }
      return ok({ affected })
    }),
  },
  {
    url: '/api/change-requests/:id',
    method: 'get',
    response: withAuth(({ params }) => {
      const request = db.changeRequests.find((item) => item.id === num(params, 'id'))
      if (!request) return fail('异动申请不存在', 40400)
      return ok({ ...request, fieldCheck: request.fieldCheck?.map((f) => ({ ...f })) ?? null })
    }),
  },
]

export default changeMocks
