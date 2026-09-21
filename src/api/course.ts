import { http } from './http'
import type { Course, PageQuery, PageResult, TeachingAssignment } from '@/types'

export const courseApi = {
  page: (query: PageQuery) => http.post<PageResult<Course>>('/courses/page', query),
  create: (data: Partial<Course>) => http.post<Course>('/courses', data),
  update: (id: number, data: Partial<Course>) => http.put<Course>(`/courses/${id}`, data),
  remove: (id: number) => http.delete<void>(`/courses/${id}`),
  assignments: (params: { courseId?: number; keyword?: string }) =>
    http.get<TeachingAssignment[]>('/courses/assignments', { params }),
  createAssignment: (data: Partial<TeachingAssignment>) =>
    http.post<TeachingAssignment>('/courses/assignments', data),
  removeAssignment: (id: number) => http.delete<void>(`/courses/assignments/${id}`),
  /** 任课关系 Excel 导入（异步批次） */
  importAssignments: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return http.post<{ batchId: string }>('/courses/assignments/import', formData)
  },
}
