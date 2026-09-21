import { http } from './http'
import type { AuditLog, DashboardStats, PageResult } from '@/types'

/** 数据看板（API.md §3.12） */
export const dashboardApi = {
  stats: () => http.get<DashboardStats>('/admin/dashboard'),
}

/** 审计日志查询（时间格式 yyyy-MM-dd HH:mm:ss；开始晚于结束 → 400） */
export const auditApi = {
  page: (query: {
    userId?: number
    userNo?: string
    action?: string
    resource?: string
    startAt?: string
    endAt?: string
    page?: number
    size?: number
  }) => http.get<PageResult<AuditLog>>('/admin/audit', { params: query }),
}
