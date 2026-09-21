import { http, downloadBlob } from './http'
import type { PageResult, Textbook } from '@/types'

export interface TextbookQuery {
  isbn?: string
  title?: string
  author?: string
  press?: string
  /** 1 在库 / 0 停用 */
  status?: number
  page?: number
  size?: number
}

/** 教材库（API.md §3.4 · 教材 CRUD + 导入/模板） */
export const textbookApi = {
  page: (query: TextbookQuery) =>
    http.get<PageResult<Textbook>>('/admin/textbook', { params: query }),
  create: (data: Partial<Textbook>) => http.post<Textbook>('/admin/textbook', data),
  update: (id: number, data: Partial<Textbook>) =>
    http.put<Textbook>(`/admin/textbook/${id}`, data),
  /** 在库/停用（1 在库 / 0 停用）；无删除接口，停用即下架 */
  setStatus: (id: number, status: number) =>
    http.post<Textbook>(`/admin/textbook/${id}/status`, { status }),
  /** Excel 导入（multipart file → {batchId}） */
  importExcel: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return http.post<{ batchId: number }>('/admin/textbook/import', formData)
  },
  /** 模板下载（xlsx：ISBN/书名/版次/作者/出版社/单价/状态） */
  template: () => downloadBlob('/admin/textbook/template', {}, '教材库导入模板.xlsx'),
}
