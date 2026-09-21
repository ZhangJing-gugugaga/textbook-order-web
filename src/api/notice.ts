import { http } from './http'
import type { NoticeFailure, NoticeTask } from '@/types'

/** 通知（SPEC §6：unconfirmed/confirm/task/progress/failures） */
export const noticeApi = {
  unconfirmed: () => http.get<NoticeTask[]>('/notice/unconfirmed'),
  confirm: (taskId: number) => http.post<void>(`/notice/${taskId}/confirm`),
  tasks: (params?: { source?: 'manual' | 'system' }) =>
    http.get<NoticeTask[]>('/notice/tasks', { params }),
  createTask: (data: { title: string; content: string; scope: string }) =>
    http.post<NoticeTask>('/notice/tasks', data),
  progress: (taskId: number) => http.get<NoticeTask>(`/notice/tasks/${taskId}/progress`),
  failures: (taskId: number) => http.get<NoticeFailure[]>(`/notice/tasks/${taskId}/failures`),
}
