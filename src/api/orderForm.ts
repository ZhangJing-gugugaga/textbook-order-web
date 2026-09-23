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
  /**
   * 教师：单表单详情（**本人**；非本人 403 + 审计、不存在 404）。
   *
   * 走 `/teacher/order-forms/{id}`（权限 `order:form:view:self`）。
   * 此前复用 `/admin/order-forms/{id}`，该端点要求 `order:form:view:all`（教师不持有）
   * → 教师点「明细与轨迹」必然 403 并被全局 onForbidden 弹到 /403 页（线上实测 2026-09-23）。
   */
  detail: (id: number) => http.get<OrderForm>(`/teacher/order-forms/${id}`),
  /**
   * 教师：主动撤回（待审核 → 草稿）。
   *
   * 仅 `pending_review` 且窗口开放期可撤回（后端 `@WithinWindow`，关窗 409 WINDOW_CLOSED）；
   * 与审核并发时由行锁串行化——撤回后管理员的审核 CAS 落空 409，结论不会被静默撤销。
   * 返回撤回后的表单（状态已变 draft、`withdrawnAt` 有值）。
   */
  withdraw: () => http.post<OrderForm>('/teacher/order-form/withdraw'),
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
  /**
   * 秘书：本院单表单详情（**本院**；非本院 403、不存在 404）。
   *
   * 走 `/secretary/order-forms/{id}`（权限 `order:form:view:college`）。与教师侧同因：
   * 复用 `/admin/order-forms/{id}` 会让秘书点「查看明细」被 403 弹走。
   */
  collegeDetail: (id: number) => http.get<OrderForm>(`/secretary/order-forms/${id}`),
  /** 超管：详情（含 fieldCheckResult、contentVersion 与明细）——仅复核工作台使用 */
  detail: (id: number) => http.get<OrderForm>(`/admin/order-forms/${id}`),
  /**
   * 内容审核：pass / reject（reject 理由必填 1-200 字；仅 pending_review 可审，否则 409）。
   *
   * `contentVersion` **必传**：取详情接口读到的值原样回传，服务端以它做 CAS。
   * 审核页打开后教师若又重提过（状态仍是 pending_review，但明细已被整单覆盖），
   * 版本不一致即 409 STATE_CONFLICT——调用方应重新拉详情让管理员确认，**不要自动重试**
   * （自动重试等于替他确认了没看过的内容）。不传时服务端只能拦住请求处理窗口内的并发提交。
   */
  review: (
    id: number,
    data: { action: 'pass' | 'reject'; reason?: string; contentVersion: number },
  ) => http.post<OrderForm>(`/admin/order-forms/${id}/review`, data),
}
