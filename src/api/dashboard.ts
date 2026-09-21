import { http } from './http'
import type { DashboardStats } from '@/types'

export const dashboardApi = {
  stats: () => http.get<DashboardStats>('/dashboard/stats'),
}
