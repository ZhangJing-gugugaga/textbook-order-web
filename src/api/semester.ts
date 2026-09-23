import { http } from './http'
import { toWireDateTime } from '@/utils/format'
import type { AuditLog, College, Klass, Major, PageResult, Semester, WindowState } from '@/types'

/**
 * 学期与窗口引擎（API.md §3.2 · 13 端点）。
 *
 * **时间入参格式（2026-09-23 更正）**：后端 `TimeFormatConfig` 统一了解析口径，**body 与 query
 * 都接受** ISO-8601（`yyyy-MM-ddTHH:mm:ss`）与空格格式（`yyyy-MM-dd HH:mm:ss`），日期字段
 * （`startDate/endDate`）带时间也按日期取值。此处保留 `toWireDateTime` 只是为了形态稳定，
 * 不是"必须转 ISO"（此前注释记的"body 只认 ISO、query 只认空格"是旧行为，已被实测推翻）。
 */
export const semesterApi = {
  /** 学期列表（draft/active/archived） */
  list: () => http.get<Semester[]>('/admin/semester'),
  detail: (id: number) => http.get<Semester>(`/admin/semester/${id}`),
  create: (data: Partial<Semester>) =>
    http.post<Semester>('/admin/semester', {
      ...data,
      windowStart: toWireDateTime(data.windowStart),
      windowEnd: toWireDateTime(data.windowEnd),
    }),
  update: (id: number, data: Partial<Semester>) =>
    http.put<Semester>(`/admin/semester/${id}`, {
      ...data,
      windowStart: toWireDateTime(data.windowStart),
      windowEnd: toWireDateTime(data.windowEnd),
    }),
  /** 双缓冲原子切换：body 带 version 乐观锁（不匹配 → 409 STATE_CONFLICT） */
  activate: (id: number, version: number) =>
    http.post<Semester>(`/admin/semester/${id}/activate`, { version }),
  /**
   * 归档（**二次门禁**，2026-09-23）：`version` 必填（乐观锁）；
   * 窗口进行中（windowStatus=open 或 channelOpen=1）时必须显式 `confirmWindowOpen=true`，
   * 否则后端 409 并说明「归档会立即停止全站征订业务」。
   */
  archive: (id: number, version: number, confirmWindowOpen = false) =>
    http.post<void>(`/admin/semester/${id}/archive`, { version, confirmWindowOpen }),
  /**
   * 撤销归档（受限回滚，2026-09-23）：仅当当前没有 active 学期时可用（误归档现场），
   * 恢复后窗口保持 closed，需手动重新开启。
   */
  unarchive: (id: number, version: number) =>
    http.post<Semester>(`/admin/semester/${id}/unarchive`, { version, confirm: true }),
  /** 设置窗口起止 + auto 开关 */
  setWindow: (
    id: number,
    data: { windowStart: string; windowEnd: string; autoOpen?: number; autoClose?: number },
  ) =>
    http.put<Semester>(`/admin/semester/${id}/window`, {
      ...data,
      windowStart: toWireDateTime(data.windowStart),
      windowEnd: toWireDateTime(data.windowEnd),
    }),
  openWindow: (id: number) => http.post<Semester>(`/admin/semester/${id}/window/open`),
  closeWindow: (id: number) => http.post<Semester>(`/admin/semester/${id}/window/close`),
  /** 延长（无限次；延长至早于当前时间 → 400） */
  extendWindow: (id: number, windowEnd: string) =>
    http.post<Semester>(`/admin/semester/${id}/window/extend`, {
      windowEnd: toWireDateTime(windowEnd),
    }),
  /** 变更记录（来自审计） */
  changes: (id: number, params?: { page?: number; size?: number }) =>
    http.get<PageResult<AuditLog>>(`/admin/semester/${id}/window/changes`, { params }),
  /** 窗口状态 + 服务器时间（倒计时基准，不信任本地时钟） */
  currentWindow: () => http.get<WindowState>('/semester/window/status'),
}

/** 组织三表（API.md §3.3 · 9 端点） */
export const orgApi = {
  colleges: () => http.get<College[]>('/admin/college'),
  createCollege: (data: { name: string; fullName?: string }) =>
    http.post<College>('/admin/college', data),
  updateCollege: (id: number, data: { name: string; fullName?: string }) =>
    http.put<College>(`/admin/college/${id}`, data),
  majors: (collegeId?: number) => http.get<Major[]>('/admin/major', { params: { collegeId } }),
  createMajor: (data: { collegeId: number; name: string; fullName?: string }) =>
    http.post<Major>('/admin/major', data),
  updateMajor: (id: number, data: { collegeId: number; name: string; fullName?: string }) =>
    http.put<Major>(`/admin/major/${id}`, data),
  classes: (majorId?: number) => http.get<Klass[]>('/admin/class', { params: { majorId } }),
  createClass: (data: { majorId: number; name: string; grade?: string; studentCount?: number }) =>
    http.post<Klass>('/admin/class', data),
  updateClass: (
    id: number,
    data: { majorId: number; name: string; grade?: string; studentCount?: number },
  ) => http.put<Klass>(`/admin/class/${id}`, data),
}

export type { PageResult }
