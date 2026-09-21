import { http } from './http'
import type { PageQuery, PageResult, Textbook } from '@/types'

export const textbookApi = {
  page: (query: PageQuery) => http.post<PageResult<Textbook>>('/textbooks/page', query),
  create: (data: Partial<Textbook>) => http.post<Textbook>('/textbooks', data),
  update: (id: number, data: Partial<Textbook>) => http.put<Textbook>(`/textbooks/${id}`, data),
  remove: (id: number) => http.delete<void>(`/textbooks/${id}`),
  disable: (id: number) => http.post<Textbook>(`/textbooks/${id}/disable`),
  enable: (id: number) => http.post<Textbook>(`/textbooks/${id}/enable`),
  /** 教材库搜索（教师填报教材选择器用） */
  search: (keyword: string) => http.get<Textbook[]>('/textbooks/search', { params: { keyword } }),
  /** Excel 导入（异步批次） */
  importExcel: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return http.post<{ batchId: string }>('/textbooks/import', formData)
  },
}
