import { http } from './http'
import type { ExportTask } from '@/types'

/**
 * 导出任务（SPEC §6：预估 ≤5000 行同步下载；>5000 行建 export_task + 轮询 +
 * 一次性授权下载链接，Q16）
 */
export const exportTaskApi = {
  create: (data: { name: string; params: Record<string, unknown>; estimatedRows: number }) =>
    http.post<ExportTask>('/export-tasks', data),
  progress: (taskId: string) => http.get<ExportTask>(`/export-tasks/${taskId}`),
  download: (taskId: string) =>
    http.get<Blob>(`/export-tasks/${taskId}/download`, { responseType: 'blob' }),
  /** 同步导出（≤5000 行） */
  syncDownload: (data: { name: string; params: Record<string, unknown> }) =>
    http.post<Blob>('/exports/sync', data, { responseType: 'blob' }),
}
