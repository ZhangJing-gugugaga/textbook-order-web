import { defineStore } from 'pinia'
import { semesterApi } from '@/api/semester'
import { WINDOW_POLL_INTERVAL } from '@/utils/constants'
import type { WindowState, WindowStatus } from '@/types'

/**
 * 时间窗口 store（SPEC §7）：
 * 倒计时 = window_end - (clientNow + serverTimeOffset)，不信任本地时钟（PRD 功能 2）。
 * 轮询失败按上次已知状态渲染并静默重试。
 */
export const useWindowStore = defineStore('window', {
  state: () => ({
    status: 'not_open' as WindowStatus,
    windowStart: '',
    windowEnd: '',
    serverTime: '',
    serverTimeOffset: 0,
    semesterId: 0,
    semesterName: '',
    loading: false,
    pollTimer: 0 as unknown as ReturnType<typeof setInterval> | 0,
  }),
  getters: {
    canFill: (state) => state.status === 'open',
    canOrder: (state) => state.status === 'open',
    /** 截止倒计时（毫秒），<=0 表示已截止 */
    remainMs(): number {
      if (!this.windowEnd) return 0
      return new Date(this.windowEnd).getTime() - (Date.now() + this.serverTimeOffset)
    },
    /** 距离开始的倒计时（毫秒） */
    startRemainMs(): number {
      if (!this.windowStart) return 0
      return new Date(this.windowStart).getTime() - (Date.now() + this.serverTimeOffset)
    },
  },
  actions: {
    async fetch() {
      this.loading = true
      try {
        const state = await semesterApi.currentWindow()
        this.apply(state)
      } catch {
        // 轮询失败：保持上次已知状态，静默重试
      } finally {
        this.loading = false
      }
    },
    apply(state: WindowState) {
      this.status = state.status
      this.windowStart = state.windowStart
      this.windowEnd = state.windowEnd
      this.serverTime = state.serverTime
      this.serverTimeOffset = new Date(state.serverTime).getTime() - Date.now()
      this.semesterId = state.semesterId
      this.semesterName = state.semesterName
    },
    startPolling() {
      this.stopPolling()
      this.pollTimer = setInterval(() => {
        void this.fetch()
      }, WINDOW_POLL_INTERVAL)
    },
    stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer as unknown as number)
        this.pollTimer = 0
      }
    },
  },
})
