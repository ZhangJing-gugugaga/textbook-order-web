import { defineStore } from 'pinia'
import { semesterApi } from '@/api/semester'
import { useAuthStore } from '@/stores/auth'
import { PERMISSIONS, WINDOW_POLL_INTERVAL } from '@/utils/constants'
import type { WindowState, WindowStatus } from '@/types'

/**
 * 时间窗口 store（SPEC §7）：
 * 倒计时 = windowEnd - (clientNow + serverTimeOffset)，以服务端 serverTime 为准，不信任本地时钟（PRD 功能 2）。
 * 轮询失败按上次已知状态渲染并静默重试。
 *
 * 学生通道额外受 channelOpen 约束（windowStatus=open 且 channelOpen=1 才可提交）。
 * 注意：GET /api/semester/window/status 需 semester:window:view，供货商无此权限，
 * 故 fetch 前先做权限判断，避免 403 被全局处理弹到 /403 页。
 */
export const useWindowStore = defineStore('window', {
  state: () => ({
    status: 'not_open' as WindowStatus,
    windowStart: '' as string | null,
    windowEnd: '' as string | null,
    serverTime: '',
    serverTimeOffset: 0,
    semesterId: 0 as number | null,
    semesterName: '' as string | null,
    channelOpen: 0 as number | null,
    loading: false,
    pollTimer: 0 as unknown as ReturnType<typeof setInterval> | 0,
  }),
  getters: {
    /** 是否具备窗口状态查看权限（供货商无此权限，不拉取也不展示横幅） */
    canView: () => {
      const auth = useAuthStore()
      return auth.has(PERMISSIONS.WINDOW_VIEW)
    },
    /** 窗口开放（教师填报基准） */
    canFill: (state) => state.status === 'open',
    /** 学生选购：窗口开放且学生通道开启 */
    canOrder: (state) => state.status === 'open' && state.channelOpen === 1,
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
      // 无 semester:window:view 的角色（供货商）不请求窗口状态
      if (!this.canView) return
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
      // 无 active 学期时后端返回 semesterId/windowStatus 为 null
      this.status = state.windowStatus ?? 'not_open'
      this.windowStart = state.windowStart
      this.windowEnd = state.windowEnd
      this.serverTime = state.serverTime
      this.serverTimeOffset = new Date(state.serverTime).getTime() - Date.now()
      this.semesterId = state.semesterId
      this.semesterName = state.semesterName
      this.channelOpen = state.channelOpen
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
