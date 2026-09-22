import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, configureHttp, http } from '@/api/http'
import { CODE, COPY } from '@/utils/constants'

/**
 * 协议边界错误码与请求链路追踪（交接文档 A7 + B 节）：
 * - 405 `METHOD_NOT_ALLOWED` / 415 `MEDIA_TYPE_NOT_SUPPORTED`：此前被后端兜底成
 *   500 SERVER_ERROR，前端不得再把它们显示成「服务开小差了」；
 * - 410 `DOWNLOAD_TOKEN_INVALID`：一次性下载 token 已被消费，文案必须引导重新导出
 *   （原地重试同一个 token 必然再失败）；
 * - `X-Request-Id`：请求自带、响应回带，挂到 ApiError 上供报障串联后端日志。
 */

function jsonResponse(
  config: Record<string, unknown>,
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return {
    data,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    headers,
    config: config as never,
    request: {},
  }
}

function failure(
  config: Record<string, unknown>,
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
) {
  return new axios.AxiosError(
    'failed',
    String(status),
    config as never,
    {},
    jsonResponse(config, body, status, headers) as never,
  )
}

beforeEach(() => {
  configureHttp({
    getAccessToken: () => 'access-1',
    getRefreshToken: () => 'refresh-1',
    onTokens: vi.fn(),
    onForceLogout: vi.fn(),
    onForbidden: vi.fn(),
    onFirstLoginRequired: vi.fn(),
  })
})

describe('405 / 415 协议边界', () => {
  it('405 METHOD_NOT_ALLOWED：保留后端码与文案，不显示成服务故障', async () => {
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(
        failure(config, { code: CODE.METHOD_NOT_ALLOWED, message: '请求方法不被支持' }, 405, {
          allow: 'POST',
        }),
      )

    await expect(http.get('/auth/login', { adapter } as never)).rejects.toMatchObject({
      code: CODE.METHOD_NOT_ALLOWED,
      message: '请求方法不被支持',
    })
  })

  it('405 缺文案时回退到内置文案（不是 SERVER_ERROR）', async () => {
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(failure(config, { code: CODE.METHOD_NOT_ALLOWED }, 405))

    await expect(http.get('/x', { adapter } as never)).rejects.toMatchObject({
      code: CODE.METHOD_NOT_ALLOWED,
      message: COPY.METHOD_NOT_ALLOWED,
    })
  })

  it('415 MEDIA_TYPE_NOT_SUPPORTED：保留后端码，缺文案时回退内置文案', async () => {
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(failure(config, { code: CODE.MEDIA_TYPE_NOT_SUPPORTED }, 415))

    await expect(http.post('/x', {}, { adapter } as never)).rejects.toMatchObject({
      code: CODE.MEDIA_TYPE_NOT_SUPPORTED,
      message: COPY.MEDIA_TYPE_NOT_SUPPORTED,
    })
  })

  it('500 仍归 SERVER_ERROR（未被 405/415 分支误伤）', async () => {
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(failure(config, { code: CODE.SERVER_ERROR }, 500))

    await expect(http.get('/x', { adapter } as never)).rejects.toMatchObject({
      code: CODE.SERVER_ERROR,
      message: COPY.SERVER_ERROR,
    })
  })
})

describe('410 一次性下载 token 失效', () => {
  it('DOWNLOAD_TOKEN_INVALID：保留业务码，文案引导重新导出', async () => {
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(failure(config, { code: CODE.DOWNLOAD_TOKEN_INVALID }, 410))

    await expect(
      http.get('/export-task/7/download', { params: { token: 't' }, adapter } as never),
    ).rejects.toMatchObject({
      code: CODE.DOWNLOAD_TOKEN_INVALID,
      message: COPY.DOWNLOAD_TOKEN_INVALID,
    })
  })
})

describe('X-Request-Id 链路追踪', () => {
  it('请求自带 X-Request-Id（后端会沿用并回带）', async () => {
    let sent: Record<string, unknown> | undefined
    const adapter = (config: Record<string, unknown>) => {
      sent = config.headers as Record<string, unknown>
      return Promise.resolve(jsonResponse(config, { code: '0', data: null }))
    }

    await http.get('/me', { adapter } as never)

    expect(sent?.['X-Request-Id']).toMatch(/^web-/)
    expect(sent?.['X-Device-Id']).toBeTruthy()
    expect(sent?.Authorization).toBe('Bearer access-1')
  })

  it('响应回带的 request-id 挂到 ApiError 上', async () => {
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(
        failure(config, { code: CODE.NOT_FOUND, message: '资源不存在' }, 404, {
          'x-request-id': 'srv-abc-123',
        }),
      )

    const error = await http.get('/batch/9', { adapter } as never).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe(CODE.NOT_FOUND)
    expect((error as ApiError).requestId).toBe('srv-abc-123')
  })

  it('响应未回带时回退到请求自带的 id（网络中断也有 id 可报障）', async () => {
    const adapter = (config: Record<string, unknown>) =>
      Promise.reject(new axios.AxiosError('Network Error', 'ERR_NETWORK', config as never))

    const error = await http.get('/me', { adapter } as never).catch((e: unknown) => e)

    expect((error as ApiError).code).toBe('NETWORK_ERROR')
    expect((error as ApiError).requestId).toMatch(/^web-/)
  })
})
