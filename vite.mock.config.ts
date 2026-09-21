/**
 * mock 配置入口（SPEC §3 / Q5）：
 * 契约冻结前，登录/改密/切换身份/权限/通知等接口走 vite-plugin-mock（挂 /api 前缀）；
 * 契约冻结后 Vite proxy 切真实后端，页面代码零改动。
 * 单文件聚合保证内存数据库（mock/db.ts）全 mock 路由共享同一份状态。
 */
import type { MockMethod } from 'vite-plugin-mock'
import authMocks from './mock/auth'
import orgMocks from './mock/org'
import dataMocks from './mock/admin-data'
import orderMocks from './mock/order'
import changeMocks from './mock/change'
import noticeMocks from './mock/notice'
import dashboardMocks from './mock/dashboard'
import exportMocks from './mock/export'

export default [
  ...authMocks,
  ...orgMocks,
  ...dataMocks,
  ...orderMocks,
  ...changeMocks,
  ...noticeMocks,
  ...dashboardMocks,
  ...exportMocks,
] as MockMethod[]
