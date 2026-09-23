import { http } from './http'
import type { PermissionGroup, RoleListItem } from '@/types'

/**
 * 角色与权限管理（BE-2 / 决策 FE-W2）。
 *
 * 7 个端点，权限门：角色增删改查与权限目录需 `role:manage`，
 * 角色-权限分配需 `role:permission:assign`（比 role:manage 更细，便于只给「配权限」的人）。
 *
 * **口径（决策 D2）**：角色配置只作用于**权限码集合**（接口可达性 + 按钮级权限），
 * 页面归属仍由路由 `meta.roles` 静态白名单决定——新建的自定义角色不会自动获得管理台页面。
 */
export const roleApi = {
  /** 角色列表（含内置标记、账号数、已分配权限码） */
  list: () => http.get<RoleListItem[]>('/admin/role'),
  /** 新建角色（roleCode 须匹配 ^[A-Z][A-Z0-9_]{1,31}$；重码 409） */
  create: (data: { roleCode: string; roleName: string; sort?: number }) =>
    http.post<RoleListItem>('/admin/role', data),
  /** 编辑角色（仅名称与排序；**编码不可改**） */
  update: (id: number, data: { roleName: string; sort?: number }) =>
    http.put<RoleListItem>(`/admin/role/${id}`, data),
  /** 删除角色（仍有账号 → 409「该角色仍有 N 个账号，请先调整账号角色」；内置角色不可删） */
  remove: (id: number) => http.delete<void>(`/admin/role/${id}`),
  /** 全量覆盖式分配权限（后端按传入集合覆盖，非增量） */
  assignPermissions: (id: number, permCodes: string[]) =>
    http.put<RoleListItem>(`/admin/role/${id}/permissions`, { permCodes }),
}

/** 权限目录（按模块分组，供权限树两级展示） */
export const permissionApi = {
  catalog: () => http.get<PermissionGroup[]>('/admin/permission'),
}
