import { defineStore } from 'pinia'
import type { AuthResult, RoleCode, UserInfo } from '@/types'
import { authApi, meApi } from '@/api/auth'
import { readRefreshToken, writeRefreshToken } from '@/utils/session'

/**
 * 会话 store（SPEC §5 / §7）：
 * - access token 仅存内存（Pinia）；refresh token 按 SPEC §5 降级方案落 localStorage
 *   （后端契约不使用 Set-Cookie，refreshToken 走请求体，故采用文档记载的降级方案）
 * - 刷新页面用 refresh token 静默换新（bootstrap），失败即清会话
 * - 401 强制登出由 api/http.ts 回调 onForceLogout 触发
 * - refresh token 的键名与读写统一收敛在 `utils/session.ts`（多标签页同步见该模块）
 */

export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: '' as string,
    refreshToken: readRefreshToken(),
    user: null as UserInfo | null,
    roles: [] as RoleCode[],
    permissions: [] as string[],
    currentRole: '' as RoleCode | '',
    mustChangePassword: false,
    firstLoginVerified: true,
    /** bootstrap 完成前不渲染业务（避免权限码未到位误跳 403） */
    ready: false,
  }),
  getters: {
    isLoggedIn: (state) => !!state.accessToken,
    has: (state) => (perm: string) => state.permissions.includes(perm),
    hasAny:
      (state) =>
      (...perms: string[]) =>
        perms.some((p) => state.permissions.includes(p)),
    displayRole: (state) => state.currentRole,
    /** 首登未改密：业务接口一律 403，前端据此前置拦截 */
    mustVerifyFirstLogin: (state) => state.mustChangePassword,
  },
  actions: {
    applyTokens(result: AuthResult) {
      this.accessToken = result.accessToken
      this.refreshToken = result.refreshToken
      writeRefreshToken(result.refreshToken)
      this.roles = result.roles
      this.currentRole = result.currentRole
      this.mustChangePassword = result.mustChangePassword
      this.firstLoginVerified = result.firstLoginVerified
    },
    applyProfile(profile: UserInfo) {
      this.user = profile
      this.roles = profile.roles
      this.currentRole = profile.currentRole
      this.permissions = profile.permissions
      this.mustChangePassword = profile.mustChangePassword === 1
      this.firstLoginVerified = profile.firstLoginVerified === 1
    },
    async login(userNo: string, password: string) {
      const result = await authApi.login({ userNo, password })
      this.applyTokens(result)
      // 登录响应不含权限码，须再拉一次 /me 取权限与学期归属
      await this.loadProfile()
      return result
    },
    /** GET /me：用户信息 + 角色 + 当前身份 + 权限码 + active 学期归属 */
    async loadProfile() {
      const profile = await meApi.profile()
      this.applyProfile(profile)
      return profile
    },
    /** 仅重拉权限码（切换身份/角色变更后） */
    async fetchPermissions() {
      this.permissions = await meApi.permissions()
      return this.permissions
    },
    /** 切换身份：返回新令牌与角色，随后重拉权限（数据范围不变） */
    async switchRole(roleCode: RoleCode) {
      const result = await authApi.switchRole(roleCode)
      this.applyTokens(result)
      await this.loadProfile()
      return result
    },
    /** 首登校验（手机号后 4 位） */
    async verifyFirstLogin(phoneTail: string) {
      await authApi.firstLoginVerify({ phoneTail })
      this.firstLoginVerified = true
    },
    /** 改密：返回新令牌（旧 refresh 全部撤销） */
    async changePassword(oldPassword: string, newPassword: string) {
      const result = await meApi.changePassword({ oldPassword, newPassword })
      this.applyTokens(result)
      this.mustChangePassword = false
      if (this.user) {
        this.user.mustChangePassword = 0
        this.user.firstLoginVerified = 1
      }
    },
    /**
     * 应用启动/刷新：用持久化的 refresh token 换新 access 并拉取 profile。
     * 无 refresh token 或已失效 → 视为未登录。
     */
    async bootstrap() {
      if (this.ready) return this.isLoggedIn
      try {
        // 以持久层为准：同一浏览器多标签页下，其他标签页可能已轮换过 refresh token
        const persisted = readRefreshToken()
        if (persisted) this.refreshToken = persisted
        if (persisted && !this.accessToken) {
          const result = await authApi.refresh(persisted)
          this.applyTokens(result)
        }
        if (this.accessToken) await this.loadProfile()
      } catch {
        this.resetSession()
      } finally {
        this.ready = true
      }
      return this.isLoggedIn
    },
    async logout() {
      try {
        if (this.accessToken) await authApi.logout()
      } catch {
        // 登出接口失败不阻塞本地清理
      }
      this.resetSession()
    },
    /** 清理序列：清会话态 → 清 refresh 持久化 → 跳转由调用方处理 */
    resetSession() {
      this.accessToken = ''
      this.refreshToken = ''
      writeRefreshToken('')
      this.user = null
      this.roles = []
      this.permissions = []
      this.currentRole = ''
      this.mustChangePassword = false
      this.firstLoginVerified = true
    },
  },
})
