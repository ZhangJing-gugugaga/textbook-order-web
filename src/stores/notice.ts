import { defineStore } from 'pinia'
import { noticeApi } from '@/api/notice'
import { ApiError } from '@/api/http'
import { useConfigStore } from '@/stores/config'
import { CODE } from '@/utils/constants'
import type { UnconfirmedNotice } from '@/types'

/**
 * 通知 store（SPEC §7）：
 * - fetchUnconfirmed 失败 = fail-open 放行，下次进入重查（02 §3.3 交互竞态规则 2）
 * - **空队列是正常状态**：后端按 `notice_task.target_roles` 定向，只返回面向本人角色的
 *   通知（ADMIN 全量）。某角色没有面向自己的通知时队列为空，不得当错误处理或触发重试；
 *   供货商恒为空属预期（不在窗口变更通知的 target_roles 内）。
 * - confirm 失败弹窗保留可重试，不放行；后端 204 幂等，重复调用安全。
 *   例外：404（该任务已不在本人定向范围内，见 A3）→ 摘除该条，否则弹窗会永久卡死。
 * - 队列逐条弹出直至清空（含已停止重发但未确认的任务）
 * - 展示条数按 system_config.notice.popup_queue_max 截断（保留最新 N 条）
 */
export const useNoticeStore = defineStore('notice', {
  state: () => ({
    queue: [] as UnconfirmedNotice[],
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
        // 后端按创建时间倒序返回；前端按 popup_queue_max 截断展示
        const config = useConfigStore()
        this.queue = list.slice(0, Math.max(1, config.popupQueueMax))
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
        this.queue = this.queue.filter((item) => item.taskId !== taskId)
      } catch (error) {
        // 该任务已不在本人定向范围内（角色变更/任务关闭后清理）：摘除并放行，
        // 否则用户会对着一个永远 404 的弹窗反复点「收到」
        if (error instanceof ApiError && error.code === CODE.NOT_FOUND) {
          this.queue = this.queue.filter((item) => item.taskId !== taskId)
          return
        }
        throw error
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
