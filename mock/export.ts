import type { MockMethod } from 'vite-plugin-mock'
import { db } from './db'
import { ok, withAuth } from './auth'

/** 导出内容生成（mock 环境输出 CSV，真实后端输出 xlsx 文件流） */
function csvOf(kind: string): string {
  const BOM = '\uFEFF'
  const rows: string[][] = [['教材征订系统 · 导出']]
  if (kind === 'order-detail' || kind === 'college') {
    rows.push([
      '表单号',
      '任课教师',
      '学院',
      '课程',
      '班级',
      '教材',
      'ISBN',
      '单价',
      '数量',
      '状态',
    ])
    for (const form of db.orderForms) {
      for (const item of form.items) {
        rows.push([
          String(form.id),
          form.teacherName,
          form.collegeName,
          item.courseName,
          item.className,
          item.textbookTitle,
          item.isbn,
          item.price.toFixed(2),
          String(item.quantity),
          form.status,
        ])
      }
    }
  } else if (kind === 'supplier') {
    rows.push(['书名', 'ISBN', '教师姓名', '所属学院'])
    for (const form of db.orderForms.filter((item) => item.status !== 'draft')) {
      for (const item of form.items) {
        rows.push([item.textbookTitle, item.isbn, form.teacherName, form.collegeName])
      }
    }
  } else if (kind === 'notice') {
    rows.push(['任务号', '标题', '来源', '应发送', '已发送', '已确认', '失败'])
    for (const task of db.noticeTasks) {
      rows.push([
        String(task.id),
        task.title,
        task.source === 'system' ? '系统（窗口变更）' : '手动创建',
        String(task.totalCount),
        String(task.sentCount),
        String(task.confirmedCount),
        String(task.failedCount),
      ])
    }
  } else {
    rows.push(['学院', '教师表单数', '已复核', '学生数', '已选购'])
  }
  return (
    BOM +
    rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
  )
}

function sendCsv(res: import('http').ServerResponse, name: string, kind: string) {
  const content = csvOf(kind)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
  res.end(content)
}

const tasks = new Map<
  string,
  {
    taskId: string
    name: string
    status: 'pending' | 'running' | 'success' | 'failed'
    progressPct: number
    estimatedRows: number
    message: string
    createdAt: string
  }
>()

let exportSeq = 0

/** 读取 POST 请求体（rawResponse 场景） */
function readBody(req: import('http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

const exportMocks: MockMethod[] = [
  /* ---------------- 同步导出（≤5000 行） ---------------- */
  {
    url: '/api/exports/sync',
    method: 'post',
    async rawResponse(req, res) {
      const body = await readBody(req)
      const params = (body.params ?? {}) as Record<string, unknown>
      const kind = String(params.type ?? 'order-detail')
      const name = String(body.name ?? '导出')
      sendCsv(res, `${name}.csv`, kind)
    },
  },
  /* ---------------- 异步导出任务（>5000 行，Q16） ---------------- */
  {
    url: '/api/export-tasks',
    method: 'post',
    response: withAuth(({ body }) => {
      const taskId = `EXT-${Date.now()}-${++exportSeq}`
      tasks.set(taskId, {
        taskId,
        name: String(body?.name ?? '导出'),
        status: 'running',
        progressPct: 10,
        estimatedRows: Number(body?.estimatedRows ?? 0),
        message: '',
        createdAt: new Date().toISOString(),
      })
      setTimeout(() => {
        const task = tasks.get(taskId)
        if (task) {
          task.status = 'success'
          task.progressPct = 100
        }
      }, 1500)
      return ok({ taskId })
    }),
  },
  {
    url: '/api/export-tasks/:id',
    method: 'get',
    response: withAuth(({ params }) => {
      const task = tasks.get(String(params.id))
      if (!task) return { code: 40400, message: '导出任务不存在', data: null }
      return ok({ ...task })
    }),
  },
  {
    url: '/api/export-tasks/:id/download',
    method: 'get',
    rawResponse(req, res) {
      const url = new URL(req.url ?? '', 'http://localhost')
      const taskId = url.pathname.split('/').pop() ?? ''
      const task = tasks.get(taskId)
      const kind = task?.name.includes('供货商') ? 'supplier' : 'order-detail'
      sendCsv(res, `${task?.name ?? '导出'}.csv`, kind)
    },
  },
  /* ---------------- 导入错误明细下载 ---------------- */
  {
    url: '/api/import-batches/:id/errors',
    method: 'get',
    rawResponse(req, res) {
      const url = new URL(req.url ?? '', 'http://localhost')
      const batchId = url.pathname.split('/').pop() ?? ''
      const batch = db.importBatches.find((item) => item.batchId === batchId)
      const rows: string[][] = [['行号', '错误原因']]
      for (const item of batch?.errorPreview ?? []) rows.push([String(item.row), item.reason])
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(`导入错误明细-${batchId}.csv`)}`,
      )
      res.end('\uFEFF' + rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\r\n'))
    },
  },
]

export default exportMocks
