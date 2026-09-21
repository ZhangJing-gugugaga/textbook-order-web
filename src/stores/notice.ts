import { defineStore } from 'pinia'
import { noticeApi } from '@/api/notice'
import type { NoticeTask } from '@/types'

/**
 * 通知 store（SPEC §7）：
 * - fetchUnconfirmed 失败 = fail-open 放行，下次进入重查（02 §3.3 交互竞态规则 2）
 * - confirm 失败弹窗保留可重试，不放行
 * - 队列逐条弹出直至清空（含已停止重发但未确认的任务）
 */
export const useNoticeStore = defineStore('notice', {
  state: () => ({
    queue: [] as NoticeTask[],
    confirming: false,
    /** 是否已拉取过一次（fail-open 后不再阻塞） */
    loaded: false,
  }),
  getters: {
    hasUnconfirmed: (state) => state.queue.length > 0,
    current: (state) => state.queue[0] ?? null,
  },
  actions: {
    async fetchUnconfirmed() {
      try {
        const list = await noticeApi.unconfirmed()
        this.queue = list
        this.loaded = true
      } catch {
        // fail-open：按暂无通知降级，下次进入重查
        this.queue = []
        this.loaded = true
      }
    },
    async confirm(taskId: number) {
      if (this.confirming) return
      this.confirming = true
      try {
        await noticeApi.confirm(taskId)
        this.queue = this.queue.filter((item) => item.id !== taskId)
      } finally {
        this.confirming = false
      }
    },
    reset() {
      this.queue = []
      this.confirming = false
      this.loaded = false
    },
  },
})
