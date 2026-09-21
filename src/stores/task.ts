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
 * 导入/导出批次轮询——2s 起步、退避至上限 10s、页面离开即停。
 */
export const useTaskStore = defineStore('task', {
  state: () => ({
    imports: {} as Record<string, TaskState<ImportBatch>>,
    exports: {} as Record<string, TaskState<ExportTask>>,
  }),
  actions: {
    ensureImport(batchId: string) {
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
    ensureExport(taskId: string) {
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
    /** 轮询导入批次；终态自动停止 */
    pollImport(batchId: string, fetcher: (id: string) => Promise<ImportBatch>) {
      const state = this.ensureImport(batchId)
      if (state.polling) return
      state.polling = true
      state.interval = POLL_INTERVAL_START
      const tick = async () => {
        try {
          const batch = await fetcher(batchId)
          state.data = batch
          state.error = ''
          if (batch.status === 'parsing') {
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
    /** 轮询导出任务；终态自动停止 */
    pollExport(taskId: string, fetcher: (id: string) => Promise<ExportTask>) {
      const state = this.ensureExport(taskId)
      if (state.polling) return
      state.polling = true
      state.interval = POLL_INTERVAL_START
      const tick = async () => {
        try {
          const task = await fetcher(taskId)
          state.data = task
          state.error = ''
          if (task.status === 'pending' || task.status === 'running') {
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
    stopImport(batchId: string) {
      const state = this.imports[batchId]
      if (state?.timer) clearTimeout(state.timer)
      delete this.imports[batchId]
    },
    stopExport(taskId: string) {
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
