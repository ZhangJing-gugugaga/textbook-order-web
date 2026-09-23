import { http, downloadBlob } from './http'
import type { Account, ImportBatch, ImportPreview, PageResult } from '@/types'

export interface AccountQuery {
  roleCode?: string
  collegeId?: number
  /** 1 正常 / 0 停用 */
  status?: number
  keyword?: string
  page?: number
  size?: number
}

/** 账号管理（API.md §3.5 · 6 端点） */
export const accountsApi = {
  page: (query: AccountQuery) => http.get<PageResult<Account>>('/admin/user', { params: query }),
  /** 建号（含供货商）；初始密码 = 学号/工号后 6 位 */
  create: (data: {
    userNo: string
    name: string
    phone?: string
    collegeId?: number
    classId?: number
    roleCodes: string[]
  }) => http.post<void>('/admin/user', data),
  /** 停用/启用（?status=0|1；停用即时踢下线） */
  setStatus: (id: number, status: number) =>
    http.put<void>(`/admin/user/${id}/status`, undefined, { params: { status } }),
  /** 重置为初始密码 + 强制改密 */
  resetPassword: (id: number) => http.put<void>(`/admin/user/${id}/reset-password`),
  /**
   * 调整账号角色（BE-2 / 决策 FE-W2）：`PUT /api/admin/user/{id}/roles`。
   *
   * 全量覆盖式；调整后该账号被**强制下线**，需重新登录才生效（后端以角色变更事件踢线）。
   * 前端在提交前二次确认，并禁止把自己改成不含 ADMIN（后端也有 400 兜底）。
   */
  updateRoles: (id: number, roleCodes: string[]) =>
    http.put<void>(`/admin/user/${id}/roles`, { roleCodes }),
  /**
   * 名单导入（?role=student|teacher&semesterId=）。
   *
   * `confirmClassSizeShrink`（局部名单门禁，B13）：学生名单会按文件内人数重算班级人数
   * （= 教师填报数量上限），下调比例超阈值时后端 409，必须带 true 重提（前端先预览再确认）。
   */
  importExcel: (
    file: File,
    role: 'student' | 'teacher',
    semesterId?: number,
    confirmClassSizeShrink = false,
  ) => {
    const formData = new FormData()
    formData.append('file', file)
    return http.post<{ batchId: number }>('/admin/user/import', formData, {
      params: { role, semesterId, confirmClassSizeShrink },
    })
  },
  /**
   * 导入预览（只读，不落库不建批次）：班级人数 diff / 将新建账号数 / 将停用账号数 / 错误行样例。
   * 供导入前的「强确认」弹窗使用（B13）。
   */
  previewImport: (file: File, role: 'student' | 'teacher', semesterId?: number) => {
    const formData = new FormData()
    formData.append('file', file)
    return http.post<ImportPreview>('/admin/user/import/preview', formData, {
      params: { role, semesterId },
    })
  },
  /** 名单模板下载（学生：学号/姓名/学院/专业/班级/手机号；教师：工号/姓名/学院/手机号） */
  template: (role: 'student' | 'teacher') =>
    downloadBlob(
      '/admin/user/import/template',
      { params: { role } },
      role === 'student' ? '学生名单导入模板.xlsx' : '教师名单导入模板.xlsx',
    ),
}

/** 导入批次（API.md §3.9 · 通用 /api/batch） */
export const batchApi = {
  detail: (batchId: number) => http.get<ImportBatch>(`/batch/${batchId}`),
}
