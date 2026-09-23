import { http } from './http'
import type {
  MyNotice,
  NoticeFailure,
  NoticeProgress,
  NoticeSendResult,
  NoticeTask,
  PageResult,
  SubscribeConfig,
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
  /**
   * 确认「收到」→ 204（幂等）；可带小程序订阅授权上报
   */
  confirm: (taskId: number, subscribeResult?: 'accepted' | 'rejected') =>
    http.post<void>(`/notice/${taskId}/confirm`, subscribeResult ? { subscribeResult } : {}),
  /**
   * 进入选书页即确认收到（BE-5g）：把本人所有未确认且面向本人角色的 active 任务
   * 按 `confirmed_by_entry` 补记确认，返回本次新确认的任务数。**幂等**。
   * 语义是「弹窗未出现/失败降级时学生已进入选书页」的兜底，弹窗仍是主触达。
   */
  confirmByEntry: () => http.post<{ confirmed: number }>('/notice/confirm-by-entry'),
  /**
   * 通知配置下发（BE-5e，登录即可读）：小程序订阅模板 id 与弹窗队列上限。
   * 模板未配置时 `subscribeTemplateId` 为 `null`（此时不应发起订阅授权）。
   */
  subscribeConfig: () => http.get<SubscribeConfig>('/notice/subscribe-config'),
  /**
   * 任务列表：`semesterId` 可选，缺省 = 当前 active 学期（BE-5d）。
   * 传历史/已归档学期的 id 可查看该学期任务（归档后记录迁至 `notice_record_history`，
   * 进度/失败名单/导出对归档学期仍可读）。
   */
  tasks: (params?: { semesterId?: number }) =>
    http.get<NoticeTask[]>('/admin/notice/tasks', { params }),
  /** 手动创建（同学期已有 active → 409 NOTICE_TASK_EXISTS） */
  createTask: (data: { title: string; content: string; targetRoles?: string }) =>
    http.post<NoticeTask>('/admin/notice/tasks', data),
  /**
   * 立即发送一轮（BE-5b），不等调度周期，同步执行。
   * 任务已关闭 → 409 `STATE_CONFLICT`；窗口非开放 → 409 `WINDOW_CLOSED`。
   */
  sendNow: (taskId: number) =>
    http.post<NoticeSendResult>(`/admin/notice/tasks/${taskId}/send-now`),
  closeTask: (taskId: number) => http.post<NoticeTask>(`/admin/notice/tasks/${taskId}/close`),
  progress: (taskId: number) => http.get<NoticeProgress>(`/admin/notice/tasks/${taskId}/progress`),
  /** 未授权/失败名单（线下兜底） */
  failures: (taskId: number, params?: { page?: number; size?: number }) =>
    http.get<PageResult<NoticeFailure>>(`/admin/notice/tasks/${taskId}/failures`, { params }),
}
