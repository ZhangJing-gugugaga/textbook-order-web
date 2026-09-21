import type { MockMethod } from 'vite-plugin-mock'
import { db, iso } from './db'
import { fail, num, ok, withAuth } from './auth'

let changeSeq = 100

/** 组织树 */
function orgTree() {
  return db.colleges.map((college) => ({
    ...college,
    majors: db.majors
      .filter((major) => major.collegeId === college.id)
      .map((major) => ({
        ...major,
        classes: db.classes.filter((klass) => klass.majorId === major.id),
      })),
  }))
}

/** 窗口三态（PRD 功能 2） */
function windowState() {
  const semester = db.semesters.find((item) => item.status === 'active')
  if (!semester || !semester.windowStart || !semester.windowEnd) {
    return {
      status: 'not_open' as const,
      windowStart: '',
      windowEnd: '',
      serverTime: new Date().toISOString(),
      semesterId: semester?.id ?? 0,
      semesterName: semester?.name ?? '',
    }
  }
  const now = Date.now()
  const start = new Date(semester.windowStart).getTime()
  const end = new Date(semester.windowEnd).getTime()
  const status = now < start ? 'not_open' : now > end ? 'closed' : 'open'
  return {
    status: status as 'not_open' | 'open' | 'closed',
    windowStart: semester.windowStart,
    windowEnd: semester.windowEnd,
    serverTime: new Date().toISOString(),
    semesterId: semester.id,
    semesterName: semester.name,
  }
}

function recordChange(
  semesterId: number,
  action: 'open' | 'close' | 'extend' | 'activate' | 'archive',
  fromValue: string,
  toValue: string,
) {
  db.windowChanges.unshift({
    id: ++changeSeq,
    semesterId,
    action,
    operatorName: '张教材',
    createdAt: iso(0),
    fromValue,
    toValue,
  })
}

const orgMocks: MockMethod[] = [
  /* ---------------- 窗口 ---------------- */
  {
    url: '/api/window/current',
    method: 'get',
    response: () => ok(windowState()),
  },

  /* ---------------- 学期与窗口引擎 ---------------- */
  {
    url: '/api/semesters',
    method: 'get',
    response: withAuth(() => ok(db.semesters)),
  },
  {
    url: '/api/semesters',
    method: 'post',
    response: withAuth(({ body }) => {
      const name = String(body?.name ?? '').trim()
      if (!name) return fail('请输入学期名称', 40010)
      const start = String(body?.windowStart ?? '')
      const end = String(body?.windowEnd ?? '')
      if (start && end && new Date(start) >= new Date(end)) {
        return fail('窗口开始时间必须早于结束时间', 40011)
      }
      const id = Math.max(...db.semesters.map((s) => s.id)) + 1
      const semester = {
        id,
        name,
        startDate: String(body?.startDate ?? ''),
        endDate: String(body?.endDate ?? ''),
        status: 'draft' as const,
        windowStart: start,
        windowEnd: end,
        autoOpen: Boolean(body?.autoOpen ?? true),
        autoClose: Boolean(body?.autoClose ?? true),
        createdAt: iso(0),
      }
      db.semesters.push(semester)
      return ok(semester, '学期已创建（草稿）')
    }),
  },
  {
    url: '/api/semesters/:id',
    method: 'put',
    response: withAuth(({ body, params }) => {
      const semester = db.semesters.find((item) => item.id === num(params, 'id'))
      if (!semester) return fail('学期不存在', 40400)
      const start = String(body?.windowStart ?? semester.windowStart)
      const end = String(body?.windowEnd ?? semester.windowEnd)
      if (start && end && new Date(start) >= new Date(end)) {
        return fail('窗口开始时间必须早于结束时间', 40011)
      }
      const from = semester.windowEnd
      Object.assign(semester, {
        windowStart: start,
        windowEnd: end,
        autoOpen: Boolean(body?.autoOpen ?? semester.autoOpen),
        autoClose: Boolean(body?.autoClose ?? semester.autoClose),
      })
      if (from !== semester.windowEnd) recordChange(semester.id, 'extend', from, semester.windowEnd)
      return ok(semester, '已生效，通知将自动发送给全员')
    }),
  },
  {
    url: '/api/semesters/:id/activate',
    method: 'post',
    response: withAuth(({ params }) => {
      const semester = db.semesters.find((item) => item.id === num(params, 'id'))
      if (!semester) return fail('学期不存在', 40400)
      if (db.semesters.some((item) => item.status === 'active' && item.id !== semester.id)) {
        return fail('同一时刻仅允许一个 active 学期，请先归档当前学期', 40012)
      }
      if (semester.status === 'archived') return fail('已归档学期不可激活', 40013)
      semester.status = 'active'
      recordChange(semester.id, 'activate', 'draft', 'active')
      return ok(semester, '已生效，通知将自动发送给全员')
    }),
  },
  {
    url: '/api/semesters/:id/archive',
    method: 'post',
    response: withAuth(({ params }) => {
      const semester = db.semesters.find((item) => item.id === num(params, 'id'))
      if (!semester) return fail('学期不存在', 40400)
      semester.status = 'archived'
      recordChange(semester.id, 'archive', semester.status, 'archived')
      return ok(semester, '已归档')
    }),
  },
  {
    url: '/api/semesters/:id/window/open',
    method: 'post',
    response: withAuth(({ params }) => {
      const semester = db.semesters.find((item) => item.id === num(params, 'id'))
      if (!semester) return fail('学期不存在', 40400)
      if (!semester.windowEnd) return fail('请先设置窗口起止时间', 40014)
      semester.windowStart = iso(0)
      recordChange(semester.id, 'open', 'not_open', 'open')
      return ok(semester, '已生效，通知将自动发送给全员')
    }),
  },
  {
    url: '/api/semesters/:id/window/close',
    method: 'post',
    response: withAuth(({ params }) => {
      const semester = db.semesters.find((item) => item.id === num(params, 'id'))
      if (!semester) return fail('学期不存在', 40400)
      const from = semester.windowEnd
      semester.windowEnd = iso(0)
      recordChange(semester.id, 'close', from, semester.windowEnd)
      return ok(semester, '已生效，通知将自动发送给全员')
    }),
  },
  {
    url: '/api/semesters/:id/window/extend',
    method: 'post',
    response: withAuth(({ body, params }) => {
      const semester = db.semesters.find((item) => item.id === num(params, 'id'))
      if (!semester) return fail('学期不存在', 40400)
      const next = String(body?.windowEnd ?? '')
      if (!next) return fail('请选择新的截止时间', 40015)
      if (new Date(next) <= new Date()) {
        return fail('延长后的截止时间必须晚于当前时间', 40016)
      }
      const from = semester.windowEnd
      semester.windowEnd = next
      recordChange(semester.id, 'extend', from, next)
      return ok(semester, '已生效，通知将自动发送给全员')
    }),
  },
  {
    url: '/api/semesters/:id/changes',
    method: 'get',
    response: withAuth(({ params }) =>
      ok(db.windowChanges.filter((item) => item.semesterId === num(params, 'id'))),
    ),
  },

  /* ---------------- 组织管理 ---------------- */
  {
    url: '/api/org/tree',
    method: 'get',
    response: withAuth(() => ok(orgTree())),
  },
  {
    url: '/api/org/colleges',
    method: 'get',
    response: withAuth(() => ok(db.colleges.map(({ id, name }) => ({ id, name })))),
  },
  {
    url: '/api/org/colleges',
    method: 'post',
    response: withAuth(({ body }) => {
      const name = String(body?.name ?? '').trim()
      if (!name) return fail('请输入学院名称', 40020)
      const id = Math.max(...db.colleges.map((c) => c.id)) + 1
      const college = { id, name, code: String(body?.code ?? '') }
      db.colleges.push(college)
      return ok(college)
    }),
  },
  {
    url: '/api/org/colleges/:id',
    method: 'put',
    response: withAuth(({ body, params }) => {
      const college = db.colleges.find((item) => item.id === num(params, 'id'))
      if (!college) return fail('学院不存在', 40400)
      Object.assign(college, {
        name: String(body?.name ?? college.name),
        code: String(body?.code ?? college.code),
      })
      return ok(college)
    }),
  },
  {
    url: '/api/org/colleges/:id',
    method: 'delete',
    response: withAuth(({ params }) => {
      const id = num(params, 'id')
      const index = db.colleges.findIndex((item) => item.id === id)
      if (index < 0) return fail('学院不存在', 40400)
      db.colleges.splice(index, 1)
      for (let i = db.majors.length - 1; i >= 0; i -= 1) {
        if (db.majors[i].collegeId === id) {
          const majorId = db.majors[i].id
          db.majors.splice(i, 1)
          for (let j = db.classes.length - 1; j >= 0; j -= 1) {
            if (db.classes[j].majorId === majorId) db.classes.splice(j, 1)
          }
        }
      }
      return ok(null, '已删除')
    }),
  },
  {
    url: '/api/org/majors',
    method: 'post',
    response: withAuth(({ body }) => {
      const name = String(body?.name ?? '').trim()
      if (!name) return fail('请输入专业名称', 40021)
      const id = Math.max(...db.majors.map((m) => m.id)) + 1
      const major = { id, collegeId: Number(body?.collegeId), name }
      db.majors.push(major)
      return ok(major)
    }),
  },
  {
    url: '/api/org/majors/:id',
    method: 'put',
    response: withAuth(({ body, params }) => {
      const major = db.majors.find((item) => item.id === num(params, 'id'))
      if (!major) return fail('专业不存在', 40400)
      Object.assign(major, {
        name: String(body?.name ?? major.name),
        collegeId: Number(body?.collegeId ?? major.collegeId),
      })
      return ok(major)
    }),
  },
  {
    url: '/api/org/majors/:id',
    method: 'delete',
    response: withAuth(({ params }) => {
      const id = num(params, 'id')
      const index = db.majors.findIndex((item) => item.id === id)
      if (index < 0) return fail('专业不存在', 40400)
      db.majors.splice(index, 1)
      for (let i = db.classes.length - 1; i >= 0; i -= 1) {
        if (db.classes[i].majorId === id) db.classes.splice(i, 1)
      }
      return ok(null, '已删除')
    }),
  },
  {
    url: '/api/org/classes',
    method: 'post',
    response: withAuth(({ body }) => {
      const name = String(body?.name ?? '').trim()
      if (!name) return fail('请输入班级名称', 40022)
      const major = db.majors.find((item) => item.id === Number(body?.majorId))
      if (!major) return fail('专业不存在', 40400)
      const id = Math.max(...db.classes.map((c) => c.id)) + 1
      const klass = {
        id,
        majorId: major.id,
        collegeId: major.collegeId,
        name,
        studentCount: Number(body?.studentCount ?? 40),
      }
      db.classes.push(klass)
      return ok(klass)
    }),
  },
  {
    url: '/api/org/classes/:id',
    method: 'put',
    response: withAuth(({ body, params }) => {
      const klass = db.classes.find((item) => item.id === num(params, 'id'))
      if (!klass) return fail('班级不存在', 40400)
      Object.assign(klass, {
        name: String(body?.name ?? klass.name),
        studentCount: Number(body?.studentCount ?? klass.studentCount),
      })
      return ok(klass)
    }),
  },
  {
    url: '/api/org/classes/:id',
    method: 'delete',
    response: withAuth(({ params }) => {
      const id = num(params, 'id')
      const index = db.classes.findIndex((item) => item.id === id)
      if (index < 0) return fail('班级不存在', 40400)
      db.classes.splice(index, 1)
      return ok(null, '已删除')
    }),
  },
]

export default orgMocks
