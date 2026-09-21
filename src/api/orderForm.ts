import { http } from './http'
import type { FieldCheckItem, OrderForm, PageQuery, PageResult } from '@/types'

export interface OrderFormSubmitPayload {
  teacherId: number
  items: {
    courseId: number
    classId: number
    textbookId: number
    quantity: number
  }[]
  remark?: string
}

/** 教师填报与两级审查（SPEC §6：submit/resubmit/review） */
export const orderFormApi = {
  /** 超管/秘书：全院表单分页 */
  page: (query: PageQuery & { status?: string; collegeId?: number; keyword?: string }) =>
    http.post<PageResult<OrderForm>>('/order-forms/page', query),
  detail: (id: number) => http.get<OrderForm>(`/order-forms/${id}`),
  /** 教师：我的表单分页 */
  myPage: (query: PageQuery) => http.post<PageResult<OrderForm>>('/order-forms/my/page', query),
  submit: (data: OrderFormSubmitPayload) =>
    http.post<{ id: number; fieldCheck: FieldCheckItem[] }>('/order-forms/submit', data),
  /** 被驳回表单补正重提 */
  resubmit: (id: number, data: OrderFormSubmitPayload) =>
    http.post<{ id: number; fieldCheck: FieldCheckItem[] }>(`/order-forms/${id}/resubmit`, data),
  /** 超管内容审核：通过 / 驳回（理由必填） */
  review: (id: number, data: { action: 'approve' | 'reject'; comment?: string }) =>
    http.post<OrderForm>(`/order-forms/${id}/review`, data),
  /** 教师：我的课程 × 班级（任课关系带出） */
  myCourses: () => http.get<import('@/types').TeachingAssignment[]>('/order-forms/my/courses'),
}
