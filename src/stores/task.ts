import { defineStore } from 'pinia'
import { POLL_INTERVAL_MAX, POLL_INTERVAL_START } from '@/utils/constants'
import type { ExportTask, ImportBatch } from '@/types'

type TaskState<T> = {
  data: T | null
  polling: boolean
  timer: number
  interval: number
  error: string
}

/**
 * 异步任务 store（SPEC §7）：
 * 导入批次（/api/batch/{id}）与导出任务（/api/export-task/{id}）轮询——
 * 2s 起步、退避至上限 10s、终态自动停止、页面离开即停。
 */
export const useTaskStore = defineStore('task', {
  state: () => ({
    imports: {} as Record<number, TaskState<ImportBatch>>,
    exports: {} as Record<number, TaskState<ExportTask>>,
  }),
  actions: {
    ensureImport(batchId: number) {
      if (!this.imports[batchId]) {
        this.imports[batchId] = {
          data: null,
          polling: false,
          timer: 0,
          interval: POLL_INTERVAL_START,
          error: '',
        }
      }
      return this.imports[batchId]
    },
    ensureExport(taskId: number) {
      if (!this.exports[taskId]) {
        this.exports[taskId] = {
          data: null,
          polling: false,
          timer: 0,
          interval: POLL_INTERVAL_START,
          error: '',
        }
      }
      return this.exports[taskId]
    },
    /**
     * 轮询导入批次；终态（done/failed）自动停止。
     * 轮询失败会写入 `state.error` 并停止——消费方必须展示该字段并提供重试入口
     * （评审 Q6：此前失败后界面表现为进度条永久卡住且无重试入口）；
     * 再次调用本方法即为重试（会清空 error 并从初始间隔重新开始）。
     */
    pollImport(batchId: number, fetcher: (id: number) => Promise<ImportBatch>) {
      const state = this.ensureImport(batchId)
      if (state.polling) return
      state.polling = true
      state.error = ''
      state.interval = POLL_INTERVAL_START
      const tick = async () => {
        try {
          const batch = await fetcher(batchId)
          state.data = batch
          state.error = ''
          if (batch.status === 'running') {
            state.interval = Math.min(state.interval * 1.5, POLL_INTERVAL_MAX)
            state.timer = setTimeout(tick, state.interval) as unknown as number
          } else {
            state.polling = false
          }
        } catch (error) {
          state.error = (error as Error)?.message || '轮询失败'
          state.polling = false
        }
      }
      void tick()
    },
    /**
     * 轮询导出任务；终态（done/failed/expired）自动停止。
     * 同 `pollImport`：失败写入 `state.error`，再次调用即为重试（评审 Q6）。
     */
    pollExport(taskId: number, fetcher: (id: number) => Promise<ExportTask>) {
      const state = this.ensureExport(taskId)
      if (state.polling) return
      state.polling = true
      state.error = ''
      state.interval = POLL_INTERVAL_START
      const tick = async () => {
        try {
          const task = await fetcher(taskId)
          state.data = task
          state.error = ''
          if (task.status === 'queued' || task.status === 'running') {
            state.interval = Math.min(state.interval * 1.5, POLL_INTERVAL_MAX)
            state.timer = setTimeout(tick, state.interval) as unknown as number
          } else {
            state.polling = false
          }
        } catch (error) {
          state.error = (error as Error)?.message || '轮询失败'
          state.polling = false
        }
      }
      void tick()
    },
    stopImport(batchId: number) {
      const state = this.imports[batchId]
      if (state?.timer) clearTimeout(state.timer)
      delete this.imports[batchId]
    },
    stopExport(taskId: number) {
      const state = this.exports[taskId]
      if (state?.timer) clearTimeout(state.timer)
      delete this.exports[taskId]
    },
    stopAll() {
      Object.values(this.imports).forEach((s) => s.timer && clearTimeout(s.timer))
      Object.values(this.exports).forEach((s) => s.timer && clearTimeout(s.timer))
      this.imports = {}
      this.exports = {}
    },
  },
})
