import type { MockMethod } from 'vite-plugin-mock'
import { db, iso } from './db'
import { currentUser, ok, withAuth } from './auth'

let taskSeq = 5000

const noticeMocks: MockMethod[] = [
  {
    url: '/api/notice/unconfirmed',
    method: 'get',
    response: withAuth(({ headers }) => {
      const user = currentUser(headers)!
      const ids = db.unconfirmedByUser[user.userNo] ?? []
      const list = db.noticeTasks
        .filter((task) => ids.includes(task.id))
        .map((task) => ({ ...task }))
      return ok(list)
    }),
  },
  {
    url: '/api/notice/:id/confirm',
    method: 'post',
    response: withAuth(({ headers, params }) => {
      const user = currentUser(headers)!
      const taskId = Number(params.id)
      const ids = db.unconfirmedByUser[user.userNo] ?? []
      db.unconfirmedByUser[user.userNo] = ids.filter((id) => id !== taskId)
      const task = db.noticeTasks.find((item) => item.id === taskId)
      if (task && task.confirmedCount < task.totalCount) task.confirmedCount += 1
      return ok(null, '已确认')
    }),
  },
  {
    url: '/api/notice/tasks',
    method: 'get',
    response: withAuth(() => ok(db.noticeTasks.map((task) => ({ ...task })))),
  },
  {
    url: '/api/notice/tasks',
    method: 'post',
    response: withAuth(({ body }) => {
      const title = String(body?.title ?? '').trim()
      if (!title) return { code: 40090, message: '请输入通知标题', data: null }
      const scope = String(body?.scope ?? 'all')
      const totalCount = scope === 'all' ? 6 : scope === 'student' ? 2 : 3
      const task = {
        id: ++taskSeq,
        title,
        content: String(body?.content ?? ''),
        source: 'manual' as const,
        scope,
        status: 'sending' as const,
        totalCount,
        sentCount: totalCount,
        confirmedCount: 0,
        failedCount: 0,
        createdAt: iso(0),
      }
      db.noticeTasks.unshift(task)
      return ok({ ...task })
    }),
  },
  {
    url: '/api/notice/tasks/:id/progress',
    method: 'get',
    response: withAuth(({ params }) => {
      const task = db.noticeTasks.find((item) => item.id === Number(params.id))
      if (!task) return { code: 40400, message: '任务不存在', data: null }
      return ok({ ...task })
    }),
  },
  {
    url: '/api/notice/tasks/:id/failures',
    method: 'get',
    response: withAuth(({ params }) => {
      const taskId = Number(params.id)
      const task = db.noticeTasks.find((item) => item.id === taskId)
      if (!task || task.failedCount === 0) return ok([])
      return ok([
        {
          id: 1,
          taskId,
          userName: '李四',
          userNo: '20230101',
          role: 'student',
          reason: '订阅消息授权未通过（unauthorized）',
          round: 3,
          createdAt: iso(-1),
        },
      ])
    }),
  },
]

export default noticeMocks
