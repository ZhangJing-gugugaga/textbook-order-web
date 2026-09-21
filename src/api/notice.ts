import { http } from './http'
import type {
  NoticeFailure,
  NoticeProgress,
  NoticeTask,
  PageResult,
  UnconfirmedNotice,
} from '@/types'

/** 通知确认闭环（API.md §3.11 · 弹窗 2 + 管理端 5） */
export const noticeApi = {
  /** 未确认任务队列（阻塞弹窗数据源，按创建时间倒序） */
  unconfirmed: () => http.get<UnconfirmedNotice[]>('/notice/unconfirmed'),
  /** 确认「收到」→ 204（幂等）；可带小程序订阅授权上报 */
  confirm: (taskId: number, subscribeResult?: 'accepted' | 'rejected') =>
    http.post<void>(`/notice/${taskId}/confirm`, subscribeResult ? { subscribeResult } : {}),
  /** 本学期任务列表 */
  tasks: () => http.get<NoticeTask[]>('/admin/notice/tasks'),
  /** 手动创建（同学期已有 active → 409 NOTICE_TASK_EXISTS） */
  createTask: (data: { title: string; content: string; targetRoles?: string }) =>
    http.post<NoticeTask>('/admin/notice/tasks', data),
  closeTask: (taskId: number) => http.post<NoticeTask>(`/admin/notice/tasks/${taskId}/close`),
  progress: (taskId: number) => http.get<NoticeProgress>(`/admin/notice/tasks/${taskId}/progress`),
  /** 未授权/失败名单（线下兜底） */
  failures: (taskId: number, params?: { page?: number; size?: number }) =>
    http.get<PageResult<NoticeFailure>>(`/admin/notice/tasks/${taskId}/failures`, { params }),
}
