import { defineStore } from 'pinia'
import type { PermissionBundle, RoleCode, UserInfo } from '@/types'
import { authApi, meApi } from '@/api/auth'

/**
 * 会话 store（SPEC §7）：
 * access token 存内存（Pinia，不落 storage）；refresh token 由后端 Set-Cookie 保管。
 * 401 强制登出由 api/http.ts 回调 onForceLogout 触发。
 */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: '' as string,
    user: null as UserInfo | null,
    roles: [] as RoleCode[],
    permissions: [] as string[],
    currentRole: '' as RoleCode | '',
    roleVersion: 0,
    mustChangePassword: false,
  }),
  getters: {
    isLoggedIn: (state) => !!state.accessToken,
    has: (state) => (perm: string) => state.permissions.includes(perm),
    hasAny:
      (state) =>
      (...perms: string[]) =>
        perms.some((p) => state.permissions.includes(p)),
    displayRole: (state) => state.currentRole,
  },
  actions: {
    async login(userNo: string, password: string) {
      const result = await authApi.login({ userNo, password })
      this.accessToken = result.accessToken
      this.user = result.user
      this.roles = result.user.roles
      this.currentRole = result.user.currentRole
      this.permissions = result.permissions
      this.roleVersion = result.roleVersion
      this.mustChangePassword = result.user.mustChangePassword
      return result
    },
    async fetchPermissions() {
      const bundle = await meApi.permissions()
      this.applyBundle(bundle)
      return bundle
    },
    applyBundle(bundle: PermissionBundle) {
      this.roles = bundle.roles
      this.permissions = bundle.permissions
      this.currentRole = bundle.currentRole
      this.roleVersion = bundle.roleVersion
    },
    /** 切换身份：重拉权限（菜单与数据全量重载由调用方触发） */
    async switchRole(role: RoleCode) {
      const bundle = await meApi.switchRole(role)
      this.applyBundle(bundle)
      if (this.user) this.user.currentRole = role
      return bundle
    },
    async changePassword(oldPassword: string, newPassword: string) {
      await meApi.changePassword({ oldPassword, newPassword })
      this.mustChangePassword = false
      if (this.user) this.user.mustChangePassword = false
    },
    async logout() {
      try {
        if (this.accessToken) await authApi.logout()
      } catch {
        // 登出接口失败不阻塞本地清理
      }
      this.resetSession()
    },
    /** 清理序列：清 Pinia 全部 store → 清路由动态注册（由调用方处理）→ 跳转 */
    resetSession() {
      this.accessToken = ''
      this.user = null
      this.roles = []
      this.permissions = []
      this.currentRole = ''
      this.roleVersion = 0
      this.mustChangePassword = false
    },
  },
})
