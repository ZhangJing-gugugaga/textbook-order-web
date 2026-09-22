import { APP_NAME } from '@/utils/constants'

/**
 * 错误监控接入点（评审 E5：此前无任何可观测性，生产白屏只能靠用户口述）。
 *
 * 设计原则：**零依赖 + 可插拔**。默认实现把未捕获错误与未处理 Promise 拒绝
 * 汇总为一条结构化记录，按环境走 console（生产）或 console（开发），
 * 并对外暴露 `setErrorReporter()` 以便接入 Sentry / 自建上报端点时**只改一行装配代码**，
 * 业务代码无需改动。
 *
 * 生产接入示例（部署时按需启用，不必引入额外依赖）：
 * ```ts
 * import { setErrorReporter } from '@/utils/monitor'
 * setErrorReporter((report) => {
 *   navigator.sendBeacon('/api/client-log', JSON.stringify(report))
 * })
 * ```
 * 说明：上报端点若启用，需在后端与 Nginx 侧同步放行，且**不得携带令牌与个人信息**
 * （本模块只上报错误消息、堆栈、路由路径与 UA，见 `ErrorReport`）。
 */

export interface ErrorReport {
  /** 错误来源：window.onerror / unhandledrejection / 手动上报 */
  source: 'error' | 'unhandledrejection' | 'manual'
  message: string
  stack?: string
  /** 发生时的路由路径（不含 query，避免把 token 之类的参数带出去） */
  path: string
  /**
   * 服务端 `X-Request-Id`（仅接口错误有）。
   * 带上它就能把这条前端报错直接对到后端那次请求的日志上。
   */
  requestId?: string
  app: string
  /** 应用版本（构建时注入，见 vite.config.ts define） */
  version: string
  userAgent: string
  time: string
}

export type ErrorReporter = (report: ErrorReport) => void

/**
 * 构建时由 vite.config.ts 的 `define` 注入；单测等未注入场景回退为 'dev'。
 * 用 `typeof` 取值可避免未定义时抛 ReferenceError（上报器本身不得成为故障源）。
 */
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

/** 默认上报器：仅输出到控制台，便于本地与试运行期排查 */
const consoleReporter: ErrorReporter = (report) => {
  const tag = report.requestId ? ` [request-id=${report.requestId}]` : ''
  console.error(`[${APP_NAME}][${report.source}]${tag}`, report.message, report.stack ?? '')
}

/**
 * 结构化取 `requestId`：不 import ApiError，保持本模块零依赖
 * （接入上报端点时也不必把接口层拖进来）。
 */
function requestIdOf(error: unknown): string | undefined {
  const value = (error as { requestId?: unknown } | null | undefined)?.requestId
  return typeof value === 'string' && value ? value : undefined
}

let reporter: ErrorReporter = consoleReporter

/** 替换上报实现（接入监控平台时调用） */
export function setErrorReporter(next: ErrorReporter) {
  reporter = next
}

function currentPath(): string {
  try {
    // 只用 pathname：query/hash 可能含一次性下载 token，不上报
    return window.location.pathname
  } catch {
    return ''
  }
}

export function reportError(
  source: ErrorReport['source'],
  error: unknown,
  extra?: Partial<Pick<ErrorReport, 'message' | 'stack'>>,
) {
  const err = error instanceof Error ? error : undefined
  const report: ErrorReport = {
    source,
    message: extra?.message ?? err?.message ?? String(error ?? '未知错误'),
    stack: extra?.stack ?? err?.stack,
    path: currentPath(),
    requestId: requestIdOf(error),
    app: APP_NAME,
    version: APP_VERSION,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    time: new Date().toISOString(),
  }
  try {
    reporter(report)
  } catch {
    // 上报失败不得影响业务
  }
  return report
}

/**
 * 安装全局错误钩子（main.ts 调用一次）。
 * @returns 卸载函数（测试用）
 */
export function installGlobalErrorHandlers(): () => void {
  const onError = (event: ErrorEvent) => {
    reportError('error', event.error, { message: event.message })
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    reportError('unhandledrejection', event.reason)
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
