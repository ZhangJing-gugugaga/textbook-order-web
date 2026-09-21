import { http } from './http'
import type { ChangeRequest, PageQuery, PageResult } from '@/types'

export interface ChangeSubmitPayload {
  studentNo: string
  studentName: string
  type: ChangeRequest['type']
  reason: string
}

/**
 * 异动申请（SPEC §9：教师/秘书同链两级审查，Excel 一律生成批量 change_request，
 * 页面不出现"直接生效"路径）
 */
export const changeApi = {
  /** 秘书/教师：提交列表 */
  page: (query: PageQuery & { status?: string; keyword?: string }) =>
    http.post<PageResult<ChangeRequest>>('/change-requests/page', query),
  /** 逐条提交 */
  submit: (data: ChangeSubmitPayload) => http.post<ChangeRequest>('/change-requests', data),
  /** Excel 批量提交 → 一个批次 = 一个 change_request 批次 */
  submitBatch: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return http.post<{ batchId: string }>('/change-requests/batch', formData)
  },
  /** 批次进度（复用 task 轮询） */
  batchProgress: (batchId: string) =>
    http.get<ChangeRequest[]>(`/change-requests/batch/${batchId}`),
  /** 超管：两级审批（系统字段审查结果只读展示 → 内容审核） */
  approve: (id: number) => http.post<ChangeRequest>(`/change-requests/${id}/approve`),
  reject: (id: number, comment: string) =>
    http.post<ChangeRequest>(`/change-requests/${id}/reject`, { comment }),
  batchApprove: (ids: number[]) =>
    http.post<{ affected: number }>('/change-requests/batch-approve', { ids }),
  batchReject: (ids: number[], comment: string) =>
    http.post<{ affected: number }>('/change-requests/batch-reject', { ids, comment }),
}
