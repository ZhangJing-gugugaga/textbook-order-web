import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { CODE, COPY } from '@/utils/constants'

/**
 * 接口消费层（SPEC §6）：
 * - axios 单例，baseURL 相对路径 '/api'（硬约束，零域名硬编码）
 * - 响应拦截器解包 `{code, message, data}` 包络；code 为字符串令牌（后端 ErrorCode 同源）
 * - 401 三类语义（契约冻结项）：TOKEN_EXPIRED 静默 refresh 重放；
 *   REFRESH_INVALID / ACCOUNT_DISABLED 强制登出
 * - 403 FIRST_LOGIN_REQUIRED 跳首登引导（不跳 403 页）；FORBIDDEN 跳 403
 * - 并发 401 single-flight：首个 401 触发 refresh，其余请求挂起等待
 * - 文件流接口（模板/同步导出/错误明细/一次性下载）不走包络解包，见 postForFile / downloadBlob
 */

export interface ApiEnvelope<T = unknown> {
  code: string
  message?: string
  data: T
}

export class ApiError extends Error {
  code: string
  data: unknown
  config: AxiosRequestConfig | undefined

  constructor(message: string, code: string, data?: unknown, config?: AxiosRequestConfig) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.data = data
    this.config = config
  }
}

export interface TokenBundle {
  accessToken: string
  refreshToken: string
  expiresIn?: number
}

export interface HttpHooks {
  getAccessToken: () => string | null
  getRefreshToken: () => string | null
  /** 登录 / refresh / 切换身份 / 改密后的令牌覆盖 */
  onTokens: (tokens: TokenBundle) => void
  /** 强制登出（refresh 失效 / 账号停用） */
  onForceLogout: (message: string) => void
  /** 403 无权限 */
  onForbidden: () => void
  /** 403 首登拦截：跳首登引导页 */
  onFirstLoginRequired: () => void
}

const noop = () => {}
const hooks: HttpHooks = {
  getAccessToken: () => null,
  getRefreshToken: () => null,
  onTokens: noop,
  onForceLogout: noop,
  onForbidden: noop,
  onFirstLoginRequired: noop,
}

export function configureHttp(next: Partial<HttpHooks>) {
  Object.assign(hooks, next)
}

/** 标记内部请求，避免拦截器递归 */
interface InternalConfig extends AxiosRequestConfig {
  _isRefresh?: boolean
  _retried?: boolean
}

/* ---------------- 设备标识（refresh 轮换的会话标识，SPEC §5） ---------------- */
const DEVICE_ID_KEY = 'textbook.deviceId'

function deviceId(): string {
  try {
    let id = sessionStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      sessionStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return 'web-anonymous'
  }
}

export const httpInstance = axios.create({
  baseURL: '/api',
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
})

/* ---------------- 请求拦截：注入 Bearer + X-Device-Id ---------------- */
httpInstance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = hooks.getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  config.headers['X-Device-Id'] = deviceId()
  return config
})

/* ---------------- refresh single-flight ---------------- */
let refreshPromise: Promise<string> | null = null

/**
 * 触发 refresh：并发 401 共享同一次 refresh（single-flight），其余请求挂起等待。
 * 后端要求 refreshToken 置于请求体（不使用 Set-Cookie），轮换后旧 token 立即失效。
 * adapter 透传以复用同一传输通道（测试环境注入内存适配器）。
 */
function startRefresh(adapter?: unknown): Promise<string> {
  if (!refreshPromise) {
    const refreshToken = hooks.getRefreshToken()
    if (!refreshToken) {
      return Promise.reject(new ApiError(COPY.LOGIN_EXPIRED, CODE.REFRESH_INVALID))
    }
    refreshPromise = httpInstance
      .post<ApiEnvelope<TokenBundle>>('/auth/refresh', { refreshToken }, {
        _isRefresh: true,
        adapter,
      } as InternalConfig)
      .then((data) => {
        const bundle = data as unknown as TokenBundle
        if (!bundle?.accessToken) throw new ApiError(COPY.LOGIN_EXPIRED, CODE.REFRESH_INVALID)
        hooks.onTokens(bundle)
        return bundle.accessToken
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

/* ---------------- 错误分流 ---------------- */
function rejectWith(
  message: string,
  code: string,
  data: unknown,
  config: AxiosRequestConfig | undefined,
): Promise<never> {
  return Promise.reject(new ApiError(message, code, data, config))
}

/** 401 三类语义分流；返回是否已处理为强制登出 */
function handle401(code: string | undefined, fallbackMessage: string): string {
  if (code === CODE.REFRESH_INVALID || code === CODE.TOKEN_INVALID) {
    hooks.onForceLogout(COPY.LOGIN_EXPIRED)
    return COPY.LOGIN_EXPIRED
  }
  if (code === CODE.ACCOUNT_DISABLED) {
    hooks.onForceLogout(COPY.ACCOUNT_DISABLED)
    return COPY.ACCOUNT_DISABLED
  }
  return fallbackMessage || COPY.LOGIN_EXPIRED
}

/** blob 错误体（responseType:'blob' 但后端回 JSON 包络）反解 */
async function envelopeFromBlob(blob: unknown): Promise<ApiEnvelope | undefined> {
  if (!(blob instanceof Blob)) return undefined
  try {
    const text = await blob.text()
    return JSON.parse(text) as ApiEnvelope
  } catch {
    return undefined
  }
}

/* ---------------- 响应拦截 ---------------- */
httpInstance.interceptors.response.use(
  (response: AxiosResponse): any => {
    const body = response.data as ApiEnvelope | unknown
    if (body && typeof body === 'object' && 'code' in (body as Record<string, unknown>)) {
      const envelope = body as ApiEnvelope
      const config = response.config as InternalConfig
      if (envelope.code === CODE.OK) return envelope.data
      const code = envelope.code
      const message = envelope.message || ''
      if (code === CODE.FORBIDDEN || code === CODE.RESOURCE_FORBIDDEN) {
        hooks.onForbidden()
        return rejectWith(message || COPY.FORBIDDEN, code, envelope.data, config)
      }
      if (code === CODE.FIRST_LOGIN_REQUIRED) {
        hooks.onFirstLoginRequired()
        return rejectWith(message || COPY.FIRST_LOGIN_REQUIRED, code, envelope.data, config)
      }
      if (code === CODE.REFRESH_INVALID || code === CODE.ACCOUNT_DISABLED) {
        return rejectWith(handle401(code, message), code, envelope.data, config)
      }
      return rejectWith(message || COPY.FAILED, code, envelope.data, config)
    }
    // 文件流等非包络响应（同步导出 xlsx、模板下载）
    return body
  },
  async (error: AxiosError<ApiEnvelope>): Promise<never> => {
    const response = error.response
    const config = (error.config || {}) as InternalConfig

    // 网络失败（无响应）
    if (!response) {
      return rejectWith(COPY.NETWORK, 'NETWORK_ERROR', undefined, config)
    }

    const status = response.status
    // responseType:'blob' 的错误体需先反解成 JSON 才能拿到业务码
    const envelope =
      response.data && typeof response.data === 'object' && !('code' in response.data)
        ? ((await envelopeFromBlob(response.data)) ?? undefined)
        : (response.data as ApiEnvelope | undefined)
    const code = envelope?.code
    const message = envelope?.message || ''
    /** 逐字段错误明细等业务数据位于包络 data（如 FIELD_CHECK_FAILED 的 issues 数组） */
    const detail = envelope?.data

    if (status === 401) {
      if (config._isRefresh) {
        hooks.onForceLogout(COPY.LOGIN_EXPIRED)
        return rejectWith(COPY.LOGIN_EXPIRED, CODE.REFRESH_INVALID, detail, config)
      }
      // 未持有 access token 的 401 = 「未登录」而非「会话过期」：
      // 公共页（登录页）的并发请求不应触发刷新与强制登出提示
      if (!hooks.getAccessToken()) {
        return rejectWith(message || COPY.LOGIN_EXPIRED, code ?? CODE.UNAUTHORIZED, detail, config)
      }
      // 已重放仍 401 → 不再刷新
      if (config._retried) {
        hooks.onForceLogout(COPY.LOGIN_EXPIRED)
        return rejectWith(COPY.LOGIN_EXPIRED, CODE.TOKEN_EXPIRED, detail, config)
      }
      // 明确非「access 过期」的语义：直接返回业务文案，不触发 refresh
      if (
        code === CODE.LOGIN_FAILED ||
        code === CODE.ACCOUNT_LOCKED ||
        code === CODE.FIRST_LOGIN_VERIFY_FAILED
      ) {
        return rejectWith(message || COPY.BAD_CREDENTIAL, code, detail, config)
      }
      if (code === CODE.REFRESH_INVALID || code === CODE.ACCOUNT_DISABLED) {
        return rejectWith(handle401(code, message), code, detail, config)
      }
      // access 过期（TOKEN_EXPIRED / UNAUTHORIZED / 未细分）→ single-flight refresh 后重放
      try {
        await startRefresh(config.adapter)
      } catch {
        hooks.onForceLogout(COPY.LOGIN_EXPIRED)
        return rejectWith(COPY.LOGIN_EXPIRED, CODE.REFRESH_INVALID, detail, config)
      }
      return httpInstance.request({
        ...(config as AxiosRequestConfig),
        _retried: true,
      } as InternalConfig)
    }

    if (status === 403) {
      if (code === CODE.FIRST_LOGIN_REQUIRED) {
        hooks.onFirstLoginRequired()
      } else {
        hooks.onForbidden()
      }
      return rejectWith(message || COPY.FORBIDDEN, code ?? CODE.FORBIDDEN, detail, config)
    }

    if (status >= 500) {
      return rejectWith(COPY.SERVER_ERROR, code ?? CODE.SERVER_ERROR, detail, config)
    }

    // 400 / 404 / 409 / 410 / 429：保留后端业务码、文案与逐字段明细（前端按码分流）
    return rejectWith(message || COPY.FAILED, code ?? String(status), detail, config)
  },
)

/**
 * 对外暴露的 http 客户端：拦截器已解包 envelope，方法直接返回业务 data。
 */
export interface HttpClient {
  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>
  post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
  put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
  delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>
  request<T = unknown>(config: AxiosRequestConfig): Promise<T>
}

export const http: HttpClient = {
  get: <T>(url: string, config?: AxiosRequestConfig) =>
    httpInstance.get(url, config) as unknown as Promise<T>,
  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    httpInstance.post(url, data, config) as unknown as Promise<T>,
  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    httpInstance.put(url, data, config) as unknown as Promise<T>,
  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    httpInstance.delete(url, config) as unknown as Promise<T>,
  request: <T>(config: AxiosRequestConfig) => httpInstance.request(config) as unknown as Promise<T>,
}

/* ---------------- 文件流 ---------------- */

/** 从 Content-Disposition 解析文件名（兼容 filename*=UTF-8''x 与 filename="x"） */
export function parseFileName(disposition: string | undefined, fallback: string): string {
  if (!disposition) return fallback
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim())
    } catch {
      return utf8[1].trim()
    }
  }
  const plain = disposition.match(/filename="?([^";]+)"?/i)
  return plain?.[1]?.trim() || fallback
}

export interface FileResult {
  blob: Blob
  fileName: string
}

/** 导出/模板下载（GET 文件流） */
export async function downloadBlob(
  url: string,
  config: AxiosRequestConfig = {},
  fallbackName = 'download.xlsx',
): Promise<FileResult> {
  const response = await httpInstance.request<Blob>({
    url,
    method: 'GET',
    responseType: 'blob',
    ...config,
  })
  return {
    blob: response.data,
    fileName: parseFileName(
      response.headers['content-disposition'] as string | undefined,
      fallbackName,
    ),
  }
}

/** 导出类接口的两种形态：同步回 xlsx 流，异步回 {taskId, async, rowEstimate} */
export type ExportDispatch<T> =
  { kind: 'file'; blob: Blob; fileName: string } | { kind: 'async'; data: T }

/**
 * 导出接口分流：以响应 Content-Type 判定（application/json → 异步任务；其余 → xlsx 文件流）。
 * 后端同步/异步由 export.sync_row_threshold 裁决，前端不预估。
 */
export async function postForExport<T = unknown>(
  url: string,
  body?: unknown,
  fallbackName = 'export.xlsx',
): Promise<ExportDispatch<T>> {
  const response = await httpInstance.post(url, body ?? {}, { responseType: 'blob' })
  const contentType = String(response.headers['content-type'] || '')
  if (contentType.includes('application/json')) {
    const text = await (response.data as Blob).text()
    const envelope = JSON.parse(text) as ApiEnvelope<T>
    if (envelope.code !== CODE.OK) {
      throw new ApiError(
        envelope.message || COPY.FAILED,
        envelope.code,
        envelope.data,
        response.config,
      )
    }
    return { kind: 'async', data: envelope.data }
  }
  return {
    kind: 'file',
    blob: response.data as Blob,
    fileName: parseFileName(
      response.headers['content-disposition'] as string | undefined,
      fallbackName,
    ),
  }
}

/** 错误明细下载（GET 文件流，无错误行时后端 404） */
export const downloadErrorDetail = (batchId: number) =>
  downloadBlob(`/batch/${batchId}/errors`, {}, `导入错误明细-${batchId}.xlsx`)

/** 一次性授权下载（token 单次有效，复用/过期 410） */
export const downloadExportTask = (taskId: number, token: string, fallbackName = '导出数据.xlsx') =>
  downloadBlob(`/export-task/${taskId}/download`, { params: { token } }, fallbackName)

export const downloadSupplierExportTask = (taskId: number, token: string) =>
  downloadBlob(
    `/supplier/export-task/${taskId}/download`,
    { params: { token } },
    `supplier-orders-${taskId}.xlsx`,
  )

export function triggerBrowserDownload(blob: Blob, fileName: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(link.href)
}
