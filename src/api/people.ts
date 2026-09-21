import { http } from './http'
import type { PageQuery, PageResult, Person } from '@/types'

export const peopleApi = {
  page: (query: PageQuery & { type: 'student' | 'teacher' }) =>
    http.post<PageResult<Person>>('/people/page', query),
  /** 全量 Excel 异步导入（学生/教师） */
  importExcel: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return http.post<{ batchId: string }>('/people/import', formData)
  },
}

export const batchApi = {
  detail: (batchId: string) =>
    http.get<import('@/types').ImportBatch>(`/import-batches/${batchId}`),
  /** 错误明细下载 */
  downloadErrors: (batchId: string) =>
    http.get<Blob>(`/import-batches/${batchId}/errors`, { responseType: 'blob' }),
}

export const accountsApi = {
  page: (query: PageQuery) =>
    http.post<PageResult<import('@/types').Account>>('/accounts/page', query),
  create: (data: Record<string, unknown>) =>
    http.post<import('@/types').Account>('/accounts', data),
  setStatus: (id: number, status: 'active' | 'disabled') =>
    http.post<void>(`/accounts/${id}/status`, { status }),
  resetPassword: (id: number) =>
    http.post<{ initialPassword: string }>(`/accounts/${id}/reset-password`),
}
