import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configureHttp, http } from '@/api/http'
import { CODE, COPY, shouldUseAsyncExport } from '@/utils/constants'

/**
 * 401 single-flight 队列（SPEC §5 / §10）：
 * 首个 401 触发 refresh 并挂起后续请求；refresh 期间不重复发起；
 * refresh 成功后统一重放；refresh 失效 / 角色版本失效 / 账号停用强制登出。
 */

function jsonResponse(config: Record<string, unknown>, data: unknown, status = 200) {
  return {
    data,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    headers: {},
    config: config as never,
    request: {},
  }
}

function unauthorized(config: Record<string, unknown>, code: number, message: string) {
  return new axios.AxiosError(
    message,
    String(code),
    config as never,
    {},
    jsonResponse(config, { code, message }, 401) as never,
  )
}

let token = 'access-1'
const state = {
  refreshCalls: 0,
  businessCalls: 0,
  forceLogout: vi.fn(),
  forbidden: vi.fn(),
  notify: vi.fn(),
}

beforeEach(() => {
  token = 'access-1'
  state.refreshCalls = 0
  state.businessCalls = 0
  state.forceLogout = vi.fn()
  state.forbidden = vi.fn()
  state.notify = vi.fn()
  configureHttp({
    getAccessToken: () => token,
    onAccessToken: (next) => {
      token = next
    },
    onForceLogout: state.forceLogout,
    onForbidden: state.forbidden,
    notify: state.notify,
  })
})

describe('401 single-flight', () => {
  it('并发 401 只触发一次 refresh，成功后统一重放原请求', async () => {
    // 同一 URL 的首次尝试返回 401，重放后放行（模拟 access 过期）
    const attempted = new Set<string>()
    const adapter = (config: Record<string, unknown>) => {
      if (String(config.url).includes('/auth/refresh')) {
        state.refreshCalls += 1
        return Promise.resolve(
          jsonResponse(config, { code: 0, message: 'ok', data: { accessToken: 'access-2' } }),
        )
      }
      state.businessCalls += 1
      if (!attempted.has(String(config.url))) {
        attempted.add(String(config.url))
        return Promise.reject(unauthorized(config, CODE.ACCESS_EXPIRED, 'access expired'))
      }
      return Promise.resolve(
        jsonResponse(config, { code: 0, message: 'ok', data: { url: config.url } }),
      )
    }

    const [first, second] = await Promise.all([
      http.get<{ url: string }>('/order-forms/page', { adapter } as never),
      http.get<{ url: string }>('/notice/unconfirmed', { adapter } as never),
    ])

    expect(state.refreshCalls).toBe(1)
    expect(state.businessCalls).toBe(4)
    expect(token).toBe('access-2')
    expect(first.url).toBe('/order-forms/page')
    expect(second.url).toBe('/notice/unconfirmed')
    expect(state.forceLogout).not.toHaveBeenCalled()
  })

  it('refresh 失效：强制登出并提示登录已过期', async () => {
    const adapter = (config: Record<string, unknown>) => {
      if (String(config.url).includes('/auth/refresh')) {
        return Promise.reject(unauthorized(config, CODE.REFRESH_INVALID, 'refresh invalid'))
      }
      return Promise.reject(unauthorized(config, CODE.ACCESS_EXPIRED, 'access expired'))
    }

    await expect(http.get('/x', { adapter } as never)).rejects.toThrow(COPY.LOGIN_EXPIRED)
    expect(state.forceLogout).toHaveBeenCalledWith(COPY.LOGIN_EXPIRED)
  })

  it('角色版本失效：强制登出并提示账号信息已变更', async () => {
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(unauthorized(config, CODE.ROLE_VERSION_INVALID, 'role version invalid'))

    await expect(http.get('/x', { adapter } as never)).rejects.toThrow(COPY.ROLE_CHANGED)
    expect(state.forceLogout).toHaveBeenCalledWith(COPY.ROLE_CHANGED)
  })

  it('账号被停用：强制登出并提示联系教材室', async () => {
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(unauthorized(config, CODE.ACCOUNT_DISABLED, 'account disabled'))

    await expect(http.get('/x', { adapter } as never)).rejects.toThrow(COPY.ACCOUNT_DISABLED)
    expect(state.forceLogout).toHaveBeenCalledWith(COPY.ACCOUNT_DISABLED)
  })

  it('重放后仍 401：不再刷新，直接登出', async () => {
    const adapter = (config: Record<string, unknown>) => {
      if (String(config.url).includes('/auth/refresh')) {
        return Promise.resolve(
          jsonResponse(config, { code: 0, message: 'ok', data: { accessToken: 'access-2' } }),
        )
      }
      return Promise.reject(unauthorized(config, CODE.ACCESS_EXPIRED, 'access expired'))
    }

    await expect(http.get('/x', { adapter } as never)).rejects.toThrow(COPY.LOGIN_EXPIRED)
    expect(state.forceLogout).toHaveBeenCalledWith(COPY.LOGIN_EXPIRED)
  })
})

describe('导出阈值分流（Q16）', () => {
  it('≤5000 行走同步下载', () => {
    expect(shouldUseAsyncExport(1)).toBe(false)
    expect(shouldUseAsyncExport(5000)).toBe(false)
  })

  it('>5000 行走异步导出任务', () => {
    expect(shouldUseAsyncExport(5001)).toBe(true)
    expect(shouldUseAsyncExport(20000)).toBe(true)
  })

  it('阈值来自 system_config 缓存', () => {
    expect(shouldUseAsyncExport(6000, 10000)).toBe(false)
  })
})
