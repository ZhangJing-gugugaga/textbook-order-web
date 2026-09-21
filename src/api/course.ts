import { http, downloadBlob } from './http'
import type { Course, TeacherCourse } from '@/types'

/** 课程与任课关系（API.md §3.4 · 11 端点） */
export const courseApi = {
  /** 课程列表（默认 active 学期） */
  list: (semesterId?: number) => http.get<Course[]>('/admin/course', { params: { semesterId } }),
  create: (data: { semesterId?: number; code?: string; name: string }) =>
    http.post<Course>('/admin/course', data),
  update: (id: number, data: { code?: string; name: string }) =>
    http.put<Course>(`/admin/course/${id}`, data),
  /** 任课关系（征订范围 = 此表） */
  assignments: (params: { semesterId?: number; teacherId?: number; classId?: number }) =>
    http.get<TeacherCourse[]>('/admin/teacher-course', { params }),
  createAssignment: (data: {
    semesterId?: number
    teacherId: number
    courseId: number
    classId: number
  }) => http.post<TeacherCourse>('/admin/teacher-course', data),
  removeAssignment: (id: number) => http.delete<void>(`/admin/teacher-course/${id}`),
  /** 任课导入（?semesterId + multipart file） */
  importAssignments: (file: File, semesterId?: number) => {
    const formData = new FormData()
    formData.append('file', file)
    return http.post<{ batchId: number }>('/admin/teacher-course/import', formData, {
      params: { semesterId },
    })
  },
  /** 任课模板下载（课程代码/课程名/教师工号/班级名称/学期） */
  assignmentTemplate: () =>
    downloadBlob('/admin/teacher-course/template', {}, '课程任课导入模板.xlsx'),
}
