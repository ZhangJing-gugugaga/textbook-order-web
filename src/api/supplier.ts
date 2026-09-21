import { http, downloadSupplierExportTask, postForExport } from './http'
import type { ExportTask, SupplierCollegeGroup } from '@/types'

/**
 * 供货商只读（API.md §3.13 · 4 端点，物理隔离）：
 * 字段白名单仅 书名/ISBN/数量/教师姓名/学院，无任何学生字段路径。
 */
export const supplierApi = {
  /** 按学院分组清单（默认 active 学期） */
  orders: (semesterId?: number) =>
    http.get<SupplierCollegeGroup[]>('/supplier/orders', { params: { semesterId } }),
  /** 一学院一 sheet 导出（同步流 / {taskId,async,rowEstimate}） */
  export: (body: { semesterId?: number } = {}) =>
    postForExport<{ taskId: number; async: boolean }>(
      '/supplier/export',
      body,
      'supplier-orders.xlsx',
    ),
  taskProgress: (taskId: number) => http.get<ExportTask>(`/supplier/export-task/${taskId}`),
  taskDownload: downloadSupplierExportTask,
}
