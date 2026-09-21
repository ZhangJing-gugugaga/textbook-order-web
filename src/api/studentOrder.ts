import { http } from './http'
import type { PageResult, StudentBook, StudentOrder, StudentOrderListItem } from '@/types'

/** 学生选购（API.md §3.7 · 学生端 4 + 超管 1） */
export const studentOrderApi = {
  /** 本班教材清单（required 必修 / delisted 已下架不可选） */
  bookList: () => http.get<StudentBook[]>('/student/book-list'),
  /** 本人选购单（无单时 data=null） */
  myOrder: () => http.get<StudentOrder | null>('/student/order'),
  /** 提交（覆盖语义：重提 = 整单替换） */
  submit: (items: { textbookId: number; quantity: number }[]) =>
    http.post<StudentOrder>('/student/order/submit', { items }),
  /** 历史选购记录 */
  myHistory: () => http.get<StudentOrderListItem[]>('/student/orders'),
  /** 超管：全院选购分页 */
  page: (query: {
    semesterId?: number
    collegeId?: number
    classId?: number
    studentName?: string
    page?: number
    size?: number
  }) => http.get<PageResult<StudentOrderListItem>>('/admin/student-orders', { params: query }),
}
