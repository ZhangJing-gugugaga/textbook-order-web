import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configureHttp, http, parseFileName } from '@/api/http'
import { CODE, COPY } from '@/utils/constants'

/**
 * 401 三类语义与 single-flight（SPEC §5 / API.md §1.4）：
 * - TOKEN_EXPIRED：首个 401 触发 refresh 并挂起后续请求；refresh 期间不重复发起；
 *   成功后统一重放；
 * - REFRESH_INVALID / ACCOUNT_DISABLED：强制登出（不重放）。
 * 业务码为字符串令牌（后端 ErrorCode 同源）。
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

function unauthorized(config: Record<string, unknown>, code: string, message: string) {
  return new axios.AxiosError(
    message,
    code,
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
  firstLogin: vi.fn(),
}

beforeEach(() => {
  token = 'access-1'
  state.refreshCalls = 0
  state.businessCalls = 0
  state.forceLogout = vi.fn()
  state.forbidden = vi.fn()
  state.firstLogin = vi.fn()
  configureHttp({
    getAccessToken: () => token,
    getRefreshToken: () => 'refresh-1',
    onTokens: (tokens) => {
      token = tokens.accessToken
    },
    onForceLogout: state.forceLogout,
    onForbidden: state.forbidden,
    onFirstLoginRequired: state.firstLogin,
  })
})

describe('401 三类语义', () => {
  it('并发 TOKEN_EXPIRED 只触发一次 refresh，成功后统一重放原请求', async () => {
    const attempted = new Set<string>()
    const adapter = (config: Record<string, unknown>) => {
      if (String(config.url).includes('/auth/refresh')) {
        state.refreshCalls += 1
        return Promise.resolve(
          jsonResponse(config, {
            code: '0',
            data: { accessToken: 'access-2', refreshToken: 'refresh-2' },
          }),
        )
      }
      state.businessCalls += 1
      if (!attempted.has(String(config.url))) {
        attempted.add(String(config.url))
        return Promise.reject(unauthorized(config, CODE.TOKEN_EXPIRED, '登录已过期，请重新登录'))
      }
      return Promise.resolve(jsonResponse(config, { code: '0', data: { url: config.url } }))
    }

    const [first, second] = await Promise.all([
      http.get<{ url: string }>('/admin/order-forms', { adapter } as never),
      http.get<{ url: string }>('/notice/unconfirmed', { adapter } as never),
    ])

    expect(state.refreshCalls).toBe(1)
    expect(state.businessCalls).toBe(4)
    expect(token).toBe('access-2')
    expect(first.url).toBe('/admin/order-forms')
    expect(second.url).toBe('/notice/unconfirmed')
    expect(state.forceLogout).not.toHaveBeenCalled()
  })

  it('REFRESH_INVALID：强制登出并提示登录已过期', async () => {
    const adapter = (config: Record<string, unknown>) => {
      if (String(config.url).includes('/auth/refresh')) {
        return Promise.reject(unauthorized(config, CODE.REFRESH_INVALID, '登录已过期，请重新登录'))
      }
      return Promise.reject(unauthorized(config, CODE.TOKEN_EXPIRED, '登录已过期，请重新登录'))
    }

    await expect(http.get('/x', { adapter } as never)).rejects.toThrow(COPY.LOGIN_EXPIRED)
    expect(state.forceLogout).toHaveBeenCalledWith(COPY.LOGIN_EXPIRED)
  })

  it('ACCOUNT_DISABLED：强制登出并提示联系教材室', async () => {
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(unauthorized(config, CODE.ACCOUNT_DISABLED, COPY.ACCOUNT_DISABLED))

    await expect(http.get('/x', { adapter } as never)).rejects.toThrow(COPY.ACCOUNT_DISABLED)
    expect(state.forceLogout).toHaveBeenCalledWith(COPY.ACCOUNT_DISABLED)
  })

  it('重放后仍 401：不再刷新，直接登出', async () => {
    const adapter = (config: Record<string, unknown>) => {
      if (String(config.url).includes('/auth/refresh')) {
        return Promise.resolve(
          jsonResponse(config, {
            code: '0',
            data: { accessToken: 'access-2', refreshToken: 'refresh-2' },
          }),
        )
      }
      return Promise.reject(unauthorized(config, CODE.TOKEN_EXPIRED, '登录已过期，请重新登录'))
    }

    await expect(http.get('/x', { adapter } as never)).rejects.toThrow(COPY.LOGIN_EXPIRED)
    expect(state.forceLogout).toHaveBeenCalledWith(COPY.LOGIN_EXPIRED)
  })

  it('LOGIN_FAILED：不触发 refresh，直接回业务文案', async () => {
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(unauthorized(config, CODE.LOGIN_FAILED, COPY.BAD_CREDENTIAL))

    await expect(http.get('/x', { adapter } as never)).rejects.toThrow(COPY.BAD_CREDENTIAL)
    expect(state.refreshCalls).toBe(0)
    expect(state.forceLogout).not.toHaveBeenCalled()
  })
})

describe('403 分流', () => {
  it('FIRST_LOGIN_REQUIRED：跳首登引导（不跳 403，不登出）', async () => {
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(
        new axios.AxiosError(
          'forbidden',
          '403',
          config as never,
          {},
          jsonResponse(
            config,
            { code: CODE.FIRST_LOGIN_REQUIRED, message: COPY.FIRST_LOGIN_REQUIRED },
            403,
          ) as never,
        ),
      )

    await expect(http.get('/x', { adapter } as never)).rejects.toThrow(COPY.FIRST_LOGIN_REQUIRED)
    expect(state.firstLogin).toHaveBeenCalled()
    expect(state.forbidden).not.toHaveBeenCalled()
    expect(state.forceLogout).not.toHaveBeenCalled()
  })

  it('FORBIDDEN：跳 403 页', async () => {
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(
        new axios.AxiosError(
          'forbidden',
          '403',
          config as never,
          {},
          jsonResponse(config, { code: CODE.FORBIDDEN, message: COPY.FORBIDDEN }, 403) as never,
        ),
      )

    await expect(http.get('/x', { adapter } as never)).rejects.toThrow(COPY.FORBIDDEN)
    expect(state.forbidden).toHaveBeenCalled()
    expect(state.firstLogin).not.toHaveBeenCalled()
  })
})

describe('业务码与文案（包络）', () => {
  it('400 FIELD_CHECK_FAILED：data 为逐项数组，原样透传', async () => {
    const issues = [
      { field: 'items[0].quantity', rule: 'QTY_RANGE', message: '第 1 行：数量需在 1-50 之间' },
    ]
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(
        new axios.AxiosError(
          'bad request',
          '400',
          config as never,
          {},
          jsonResponse(
            config,
            { code: CODE.FIELD_CHECK_FAILED, message: '存在 1 项问题', data: issues },
            400,
          ) as never,
        ),
      )

    await expect(http.post('/x', {}, { adapter } as never)).rejects.toMatchObject({
      code: CODE.FIELD_CHECK_FAILED,
      data: issues,
    })
  })

  it('409 WINDOW_CLOSED：保留后端业务码', async () => {
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(
        new axios.AxiosError(
          'conflict',
          '409',
          config as never,
          {},
          jsonResponse(
            config,
            { code: CODE.WINDOW_CLOSED, message: COPY.WINDOW_CLOSED },
            409,
          ) as never,
        ),
      )

    await expect(http.post('/x', {}, { adapter } as never)).rejects.toMatchObject({
      code: CODE.WINDOW_CLOSED,
    })
  })
})

describe('文件名解析（Content-Disposition）', () => {
  it('解析 RFC 5987 filename*', () => {
    expect(parseFileName("attachment; filename*=UTF-8''%E6%95%99%E6%9D%90.xlsx", 'f.xlsx')).toBe(
      '教材.xlsx',
    )
  })

  it('解析普通 filename', () => {
    expect(parseFileName('attachment; filename="teacher-orders.xlsx"', 'f.xlsx')).toBe(
      'teacher-orders.xlsx',
    )
  })

  it('缺头时回退默认名', () => {
    expect(parseFileName(undefined, 'fallback.xlsx')).toBe('fallback.xlsx')
  })
})
