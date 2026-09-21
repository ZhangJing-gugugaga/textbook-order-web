import { http } from './http'
import type {
  OrderForm,
  OrderFormListItem,
  PageResult,
  TeacherCourseGroup,
  TeacherTextbookOption,
} from '@/types'

export interface OrderFormSubmitItem {
  courseId: number
  classId: number
  textbookId: number
  quantity: number
}

/** 教师填报与两级审查（API.md §3.6） */
export const orderFormApi = {
  /** 教师：任课范围（按班级分组） */
  myCourses: () => http.get<TeacherCourseGroup[]>('/teacher/my-courses'),
  /** 教师：填报选书器（在库教材检索；keyword 匹配 书名/ISBN/作者/出版社） */
  searchTextbooks: (keyword?: string) =>
    http.get<TeacherTextbookOption[]>('/teacher/textbook', { params: { keyword } }),
  /** 教师：当前学期征订单（无单时 data=null） */
  myForm: () => http.get<OrderForm | null>('/teacher/order-form'),
  /** 教师：提交/补正（字段审查不过 → 400 FIELD_CHECK_FAILED + data=[{field,rule,message}]） */
  submit: (items: OrderFormSubmitItem[]) =>
    http.post<OrderForm>('/teacher/order-form/submit', { items }),
  /** 教师：历史提交记录 */
  myHistory: () => http.get<OrderFormListItem[]>('/teacher/order-forms'),
  /** 教师：单表单详情（越权 403；教师只能看本人） */
  detail: (id: number) => http.get<OrderForm>(`/admin/order-forms/${id}`),
}

/** 复核工作台（超管 /api/admin/order-forms、秘书 /api/secretary/order-forms） */
export const reviewApi = {
  /** 超管：全院表单分页 */
  page: (query: {
    semesterId?: number
    collegeId?: number
    status?: string
    teacherName?: string
    page?: number
    size?: number
  }) => http.get<PageResult<OrderFormListItem>>('/admin/order-forms', { params: query }),
  /** 秘书：本院表单分页（只读） */
  collegePage: (query: { status?: string; teacherName?: string; page?: number; size?: number }) =>
    http.get<PageResult<OrderFormListItem>>('/secretary/order-forms', { params: query }),
  /** 详情（含 fieldCheckResult 与明细） */
  detail: (id: number) => http.get<OrderForm>(`/admin/order-forms/${id}`),
  /** 内容审核：pass / reject（reject 理由必填 1-200 字；仅 pending_review 可审，否则 409） */
  review: (id: number, data: { action: 'pass' | 'reject'; reason?: string }) =>
    http.post<OrderForm>(`/admin/order-forms/${id}/review`, data),
}
