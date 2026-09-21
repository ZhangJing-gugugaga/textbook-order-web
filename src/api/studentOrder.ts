import { http } from './http'
import type { PageQuery, PageResult, StudentOrder, StudentOrderItem } from '@/types'

/** 学生选购（提交 = 覆盖更新，整单替换） */
export const studentOrderApi = {
  /** 按班级带出教材清单 */
  classBooks: () => http.get<StudentOrderItem[]>('/student-order/class-books'),
  submit: (data: { items: { textbookId: number; quantity: number }[] }) =>
    http.post<StudentOrder>('/student-order/submit', data),
  myPage: (query: PageQuery) =>
    http.post<PageResult<StudentOrder>>('/student-order/my/page', query),
}
