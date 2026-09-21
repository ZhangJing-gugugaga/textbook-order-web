import { http } from './http'
import type { PermissionBundle, RoleCode, UserInfo } from '@/types'

export interface LoginResult {
  accessToken: string
  user: UserInfo
  permissions: string[]
  roleVersion: number
}

export const authApi = {
  login: (data: { userNo: string; password: string }) =>
    http.post<LoginResult>('/auth/login', data),
  logout: () => http.post<void>('/auth/logout'),
}

export const meApi = {
  profile: () => http.get<UserInfo>('/me'),
  permissions: () => http.get<PermissionBundle>('/me/permissions'),
  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    http.put<void>('/me/password', data),
  switchRole: (role: RoleCode) => http.post<PermissionBundle>('/me/switch-role', { role }),
}

export const configApi = {
  systemConfig: () => http.get<Record<string, unknown>>('/system-config'),
}
