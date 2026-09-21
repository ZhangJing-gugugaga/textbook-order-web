import { http } from './http'
import type { PageQuery, PageResult, SupplierOrderRow } from '@/types'

/**
 * 供货商（SPEC §9：接口层物理隔离，仅返回 书名/ISBN/教师姓名/学院 四类字段，
 * 无学生字段渲染路径）
 */
export const supplierApi = {
  page: (query: PageQuery & { collegeId?: number }) =>
    http.post<PageResult<SupplierOrderRow>>('/supplier/orders/page', query),
  export: (data: { collegeId?: number }) =>
    http.post<{ taskId?: string; sync?: boolean }>('/supplier/export', data),
}
