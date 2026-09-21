import { http, postForExport, type ExportDispatch } from './http'
import type { AsyncExportAccepted, ExportTask } from '@/types'

/**
 * 导出中心（API.md §3.10 · 四类导出 + 任务查询/一次性下载）。
 * 同步/异步由后端 export.sync_row_threshold 裁决：前端一律以 Content-Type 分流，
 * 不预估行数（避免与后端阈值配置漂移）。
 */
export const exportApi = {
  /** 教师征订明细（可选 semesterId / collegeId） */
  orders: (body: { semesterId?: number; collegeId?: number } = {}) =>
    postForExport<AsyncExportAccepted>('/admin/export/orders', body, '教师征订明细.xlsx'),
  /** 学生选购汇总 */
  students: (body: { semesterId?: number } = {}) =>
    postForExport<AsyncExportAccepted>('/admin/export/students', body, '学生选购汇总.xlsx'),
  /** 通知汇总（body 必带 taskId） */
  notice: (body: { taskId: number }) =>
    postForExport<AsyncExportAccepted>('/admin/export/notice', body, '通知汇总.xlsx'),
  /** 秘书：本院签字版（学院范围取当前用户 active 学期归属） */
  signature: (body: { semesterId?: number } = {}) =>
    postForExport<AsyncExportAccepted>('/secretary/export/signature', body, '教材征订签字版.xlsx'),
}

/** 导出任务查询与一次性下载 */
export const exportTaskApi = {
  progress: (taskId: number) => http.get<ExportTask>(`/export-task/${taskId}`),
}

export type { ExportDispatch }
