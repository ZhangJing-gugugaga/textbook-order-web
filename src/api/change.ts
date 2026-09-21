import { http } from './http'
import type { ChangeImportResult, ChangeRequest, ChangeRequestListItem, PageResult } from '@/types'

export interface ChangeSubmitPayload {
  /** student 学生异动（可改学院+班级）/ teacher 教师异动（仅改学院） */
  type: 'student' | 'teacher'
  targetUserNo: string
  targetCollegeId: number
  targetClassId?: number
}

/**
 * 异动审批（API.md §3.8 · 提交端 3 + 审批端 3）：
 * 教师/秘书同链两级审查；字段审查失败直接落 rejected 并回显 fieldCheckResult（不抛 400）。
 */
export const changeApi = {
  /** 教师逐条提交 */
  submitByTeacher: (data: ChangeSubmitPayload) => http.post<ChangeRequest>('/teacher/change', data),
  /** 秘书逐条提交 */
  submitBySecretary: (data: ChangeSubmitPayload) =>
    http.post<ChangeRequest>('/secretary/change', data),
  /** 秘书 Excel 批量（列：学号/工号、变更类型、目标学院、目标班级、原因） */
  importBatch: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return http.post<ChangeImportResult>('/secretary/change/import', formData)
  },
  /** 教师：我的提交记录 */
  mySubmissions: () => http.get<ChangeRequest[]>('/teacher/change'),
  /**
   * 目标归属选项（学院 / 班级只读清单）。
   * 组织三表接口为超管专属（org:*:manage），教师/秘书调用会 403，
   * 故异动提交表单使用此最小权限选项接口。
   */
  orgOptions: () =>
    http.get<{
      colleges: { id: number; name: string }[]
      classes: { id: number; name: string; majorId?: number }[]
    }>('/change/org-options'),
  /** 超管：审批列表分页 */
  page: (query: {
    semesterId?: number
    status?: string
    batchNo?: string
    type?: string
    page?: number
    size?: number
  }) => http.get<PageResult<ChangeRequestListItem>>('/admin/change', { params: query }),
  /** 超管：逐条审批（reject 理由必填；通过后对 active 学期立即生效） */
  review: (id: number, data: { action: 'pass' | 'reject'; reason?: string }) =>
    http.post<ChangeRequest>(`/admin/change/${id}/review`, data),
  /** 超管：按批次批量处理 */
  reviewBatch: (data: { batchNo: string; action: 'pass' | 'reject'; reason?: string }) =>
    http.post<{ batchNo: string; action: string; count: number; records: ChangeRequest[] }>(
      '/admin/change/batch/review',
      data,
    ),
}
