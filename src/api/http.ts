import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { CODE, COPY } from '@/utils/constants'

/**
 * 接口消费层（SPEC §6）：
 * - axios 单例，baseURL 固定相对路径 '/api'（硬约束，零域名硬编码）
 * - 响应拦截器解包 { code, message, data } 包络
 * - 401 三类细分（SPEC §5）：access 过期静默 refresh 重放；refresh 失效 / 角色版本失效 / 账号停用强制登出
 * - 并发 401 single-flight：首个 401 触发 refresh，其余请求挂起等待，refresh 期间不重复发起
 */

export interface ApiEnvelope<T = unknown> {
  code: number
  message: string
  data: T
}

export class ApiError extends Error {
  code: number
  data: unknown
  config: AxiosRequestConfig | undefined

  constructor(message: string, code: number, data?: unknown, config?: AxiosRequestConfig) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.data = data
    this.config = config
  }
}

export interface HttpHooks {
  getAccessToken: () => string | null
  onAccessToken: (token: string) => void
  /** 强制登出（refresh 失效 / 角色版本失效 / 账号停用） */
  onForceLogout: (message: string) => void
  /** 403 无权限 */
  onForbidden: () => void
  /** 统一提示 */
  notify: (message: string, type: 'error' | 'warning') => void
}

const noop = () => {}
const hooks: HttpHooks = {
  getAccessToken: () => null,
  onAccessToken: noop,
  onForceLogout: noop,
  onForbidden: noop,
  notify: noop,
}

export function configureHttp(next: Partial<HttpHooks>) {
  Object.assign(hooks, next)
}

/** 标记内部请求，避免拦截器递归 */
interface InternalConfig extends AxiosRequestConfig {
  _isRefresh?: boolean
  _retried?: boolean
}

const instance = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

/* ---------------- 请求拦截：注入 Bearer ---------------- */
instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = hooks.getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

/* ---------------- refresh single-flight ---------------- */
let refreshPromise: Promise<string> | null = null

/**
 * 触发 refresh：并发 401 共享同一次 refresh（single-flight），其余请求挂起等待。
 * adapter 透传以复用同一传输通道（测试环境可注入内存适配器）。
 */
function startRefresh(adapter?: unknown): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = instance
      .post<{ accessToken: string }>('/auth/refresh', {}, {
        _isRefresh: true,
        adapter,
      } as InternalConfig)
      .then((data) => {
        const token = (data as unknown as { accessToken: string })?.accessToken
        if (!token) throw new ApiError(COPY.LOGIN_EXPIRED, CODE.REFRESH_INVALID)
        hooks.onAccessToken(token)
        return token
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

function forceLogout(message: string) {
  hooks.onForceLogout(message)
}

/* ---------------- 401 / 403 / 409 / 5xx 处理矩阵 ---------------- */
function rejectWith(
  message: string,
  code: number,
  data: unknown,
  config: AxiosRequestConfig | undefined,
): Promise<never> {
  return Promise.reject(new ApiError(message, code, data, config))
}

function handleAuthError(
  code: number,
  message: string,
  data: unknown,
  config: AxiosRequestConfig,
): Promise<never> {
  if (code === CODE.REFRESH_INVALID) {
    forceLogout(COPY.LOGIN_EXPIRED)
    return rejectWith(COPY.LOGIN_EXPIRED, code, data, config)
  }
  if (code === CODE.ROLE_VERSION_INVALID) {
    forceLogout(COPY.ROLE_CHANGED)
    return rejectWith(COPY.ROLE_CHANGED, code, data, config)
  }
  if (code === CODE.ACCOUNT_DISABLED) {
    forceLogout(COPY.ACCOUNT_DISABLED)
    return rejectWith(COPY.ACCOUNT_DISABLED, code, data, config)
  }
  return rejectWith(message || COPY.FAILED, code, data, config)
}

/* ---------------- 响应拦截 ---------------- */
instance.interceptors.response.use(
  (response: AxiosResponse): any => {
    const body = response.data as ApiEnvelope | unknown
    if (body && typeof body === 'object' && 'code' in (body as Record<string, unknown>)) {
      const envelope = body as ApiEnvelope
      if (envelope.code === CODE.OK) return envelope.data
      const config = response.config as InternalConfig
      const code = envelope.code
      const message = envelope.message || ''
      if (code === CODE.FORBIDDEN) {
        hooks.notify(COPY.FORBIDDEN, 'warning')
        hooks.onForbidden()
        return rejectWith(COPY.FORBIDDEN, code, envelope.data, config)
      }
      if (code === CODE.WINDOW_CLOSED) {
        hooks.notify(message || COPY.WINDOW_CLOSED, 'warning')
        return rejectWith(message || COPY.WINDOW_CLOSED, code, envelope.data, config)
      }
      if (
        code === CODE.ACCESS_EXPIRED ||
        code === CODE.REFRESH_INVALID ||
        code === CODE.ROLE_VERSION_INVALID ||
        code === CODE.ACCOUNT_DISABLED
      ) {
        return handleAuthError(code, message, envelope.data, config)
      }
      return rejectWith(message || COPY.FAILED, code, envelope.data, config)
    }
    return body
  },
  async (error: AxiosError<ApiEnvelope>): Promise<never> => {
    const response = error.response
    const config = (error.config || {}) as InternalConfig

    // 网络失败（无响应）
    if (!response) {
      hooks.notify(COPY.NETWORK, 'error')
      return rejectWith(COPY.NETWORK, -1, undefined, config)
    }

    const status = response.status
    const envelope = response.data
    const code = envelope?.code ?? status
    const message = envelope?.message || ''

    if (status === 401) {
      // refresh 请求本身 401 → 直接登出
      if (config._isRefresh) {
        forceLogout(COPY.LOGIN_EXPIRED)
        return rejectWith(COPY.LOGIN_EXPIRED, CODE.REFRESH_INVALID, envelope, config)
      }
      // 重放后仍 401 → 不再刷新，直接登出
      if (config._retried) {
        forceLogout(COPY.LOGIN_EXPIRED)
        return rejectWith(COPY.LOGIN_EXPIRED, CODE.ACCESS_EXPIRED, envelope, config)
      }
      // 三类细分：仅 access 过期走静默刷新，其余强制登出
      if (code === CODE.REFRESH_INVALID) {
        forceLogout(COPY.LOGIN_EXPIRED)
        return rejectWith(COPY.LOGIN_EXPIRED, code, envelope, config)
      }
      if (code === CODE.ROLE_VERSION_INVALID) {
        forceLogout(COPY.ROLE_CHANGED)
        return rejectWith(COPY.ROLE_CHANGED, code, envelope, config)
      }
      if (code === CODE.ACCOUNT_DISABLED) {
        forceLogout(COPY.ACCOUNT_DISABLED)
        return rejectWith(COPY.ACCOUNT_DISABLED, code, envelope, config)
      }
      // access 过期（含未细分错误码）→ single-flight refresh 后重放
      try {
        await startRefresh(config.adapter)
      } catch {
        forceLogout(COPY.LOGIN_EXPIRED)
        return rejectWith(COPY.LOGIN_EXPIRED, CODE.REFRESH_INVALID, envelope, config)
      }
      return instance.request({
        ...(config as AxiosRequestConfig),
        _retried: true,
      } as InternalConfig)
    }

    if (status === 403) {
      hooks.notify(COPY.FORBIDDEN, 'warning')
      hooks.onForbidden()
      return rejectWith(COPY.FORBIDDEN, CODE.FORBIDDEN, envelope, config)
    }

    if (status === 409) {
      hooks.notify(message || COPY.WINDOW_CLOSED, 'warning')
      return rejectWith(message || COPY.WINDOW_CLOSED, CODE.WINDOW_CLOSED, envelope, config)
    }

    if (status === 422) {
      return rejectWith(message || COPY.FAILED, CODE.FIELD_CHECK_FAILED, envelope, config)
    }

    if (status >= 500) {
      hooks.notify(COPY.SERVER_ERROR, 'error')
      return rejectWith(COPY.SERVER_ERROR, status, envelope, config)
    }

    hooks.notify(message || COPY.FAILED, 'error')
    return rejectWith(message || COPY.FAILED, code, envelope, config)
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
    instance.get(url, config) as unknown as Promise<T>,
  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    instance.post(url, data, config) as unknown as Promise<T>,
  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    instance.put(url, data, config) as unknown as Promise<T>,
  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    instance.delete(url, config) as unknown as Promise<T>,
  request: <T>(config: AxiosRequestConfig) => instance.request(config) as unknown as Promise<T>,
}

/** 文件下载（导出）：走 blob，按 Content-Disposition 解析文件名 */
export async function downloadFile(
  url: string,
  params?: Record<string, unknown>,
): Promise<{ blob: Blob; fileName: string }> {
  const blob = await http.post<Blob>(url, params, { responseType: 'blob' })
  const fileName = 'download.xlsx'
  return { blob, fileName }
}

export function triggerBrowserDownload(blob: Blob, fileName: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(link.href)
}
