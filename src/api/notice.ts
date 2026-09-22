import { http } from './http'
import type {
  MyNotice,
  NoticeFailure,
  NoticeProgress,
  NoticeTask,
  PageResult,
  UnconfirmedNotice,
} from '@/types'

/**
 * 通知确认闭环（API.md §3.11 · 弹窗 2 + 管理端 5）。
 *
 * 定向语义（`notice_task.target_roles`）：`/unconfirmed`、`/mine`、`/{taskId}/confirm`
 * 三处都只对**面向本人角色**的任务生效（ADMIN 全量可见）。
 * 因此**空队列是正常状态**（该角色没有面向自己的通知），不是故障——
 * 消费方不得把空列表当错误处理或触发重试。供货商不在窗口变更通知的 target_roles 内，
 * 其队列恒为空属预期。不在定向范围内的任务，confirm 返回 404（不泄露任务是否存在）。
 */
export const noticeApi = {
  /** 未确认任务队列（阻塞弹窗数据源，按创建时间倒序） */
  unconfirmed: () => http.get<UnconfirmedNotice[]>('/notice/unconfirmed'),
  /** 我的通知（全量含已确认与已关闭，分页；`confirmedAt` 非空即已确认） */
  mine: (params?: { page?: number; size?: number }) =>
    http.get<PageResult<MyNotice>>('/notice/mine', { params }),
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
