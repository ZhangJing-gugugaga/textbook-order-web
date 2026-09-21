import { http, downloadBlob } from './http'
import type { Account, ImportBatch, PageResult } from '@/types'

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
  /** 名单导入（?role=student|teacher&semesterId=） */
  importExcel: (file: File, role: 'student' | 'teacher', semesterId?: number) => {
    const formData = new FormData()
    formData.append('file', file)
    return http.post<{ batchId: number }>('/admin/user/import', formData, {
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
