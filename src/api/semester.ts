import { http } from './http'
import { toWireDateTime } from '@/utils/format'
import type { AuditLog, College, Klass, Major, PageResult, Semester, WindowState } from '@/types'

/**
 * 学期与窗口引擎（API.md §3.2 · 12 端点）。
 *
 * **时间入参格式（实测 2026-09-22，与 API.md §1.1 的表述有出入）**：JSON body 里的
 * `LocalDateTime` 只认 ISO-8601（`yyyy-MM-ddTHH:mm:ss`），传空格格式会 400 PARAM_INVALID。
 * el-date-picker 的值是空格格式，因此在接口层统一用 `toWireDateTime` 转换
 * （query 参数则相反，要求空格格式——详见 `utils/format.ts` 的格式不对称说明）。
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
  archive: (id: number) => http.post<void>(`/admin/semester/${id}/archive`),
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
