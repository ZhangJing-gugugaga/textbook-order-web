import { http } from './http'
import type { AuthResult, RoleCode, SystemConfigItem, UserInfo } from '@/types'

/** 认证与会话（API.md §3.1 · 8 端点） */
export const authApi = {
  login: (data: { userNo: string; password: string }) => http.post<AuthResult>('/auth/login', data),
  /** 轮换 refresh（旧 token 立即失效）；正常路径由 http 层 single-flight 调用 */
  refresh: (refreshToken: string) => http.post<AuthResult>('/auth/refresh', { refreshToken }),
  logout: () => http.post<void>('/auth/logout'),
  /** 首登校验：手机号后 4 位 / 小程序 wxCode 二选一 */
  firstLoginVerify: (data: { phoneTail?: string; wxCode?: string }) =>
    http.post<void>('/auth/first-login/verify', data),
  /** 切换身份：返回新令牌与角色（数据范围不变） */
  switchRole: (roleCode: RoleCode) => http.post<AuthResult>('/auth/switch-role', { roleCode }),
}

export const meApi = {
  profile: () => http.get<UserInfo>('/me'),
  /** 当前身份的权限码集合（动态菜单/按钮） */
  permissions: () => http.get<string[]>('/me/permissions'),
  /** 改密：返回新令牌（旧 refresh 全部撤销） */
  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    http.put<AuthResult>('/me/password', data),
}

/** 系统配置（8 键；GET 列表 / PUT 批量映射） */
export const configApi = {
  list: () => http.get<SystemConfigItem[]>('/admin/config'),
  update: (items: Record<string, string>) => http.put<void>('/admin/config', items),
}
