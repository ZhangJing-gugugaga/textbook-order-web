import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { APP_NAME } from '@/utils/constants'
import { installGlobalErrorHandlers, reportError, setErrorReporter } from '@/utils/monitor'
import type { ErrorReport } from '@/utils/monitor'

/**
 * 错误监控接入点（评审 E5）：结构化上报 + 可插拔上报器 + 全局错误钩子。
 *
 * `version` 取自构建期注入的 `__APP_VERSION__`（vite.config.ts / vitest.config.ts 的 define，
 * 同源取 package.json 的 version）。
 */
import pkg from '../../package.json'

let reports: ErrorReport[]
const cleanups: (() => void)[] = []

beforeEach(() => {
  reports = []
  setErrorReporter((report) => {
    reports.push(report)
  })
})

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
})

describe('reportError 结构化上报', () => {
  it('setErrorReporter 接管上报：message/source/path/version 等字段完整', () => {
    const report = reportError('manual', new Error('boom'))

    expect(reports).toHaveLength(1)
    expect(reports[0]).toBe(report)
    expect(report.source).toBe('manual')
    expect(report.message).toBe('boom')
    expect(report.path).toBe(window.location.pathname)
    expect(report.app).toBe(APP_NAME)
    expect(report.version).toBe(pkg.version)
    expect(report.userAgent).toBe(navigator.userAgent)
    expect(report.time).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(report.stack).toContain('boom')
  })

  it('非 Error 值被强制转为字符串消息', () => {
    reportError('manual', 'oops')
    expect(reports[0].message).toBe('oops')
    expect(reports[0].stack).toBeUndefined()

    reportError('manual', undefined)
    expect(reports[1].message).toBe('未知错误')
  })

  it('上报器自身抛错不影响业务：reportError 不抛且仍返回上报体', () => {
    setErrorReporter(() => {
      throw new Error('reporter down')
    })

    const call = () => reportError('manual', new Error('boom'))
    expect(call).not.toThrow()
    expect(call().message).toBe('boom')
  })
})

describe('installGlobalErrorHandlers 全局钩子', () => {
  it('捕获 window error 事件（event.message 优先），cleanup 后不再上报', () => {
    cleanups.push(installGlobalErrorHandlers())

    window.dispatchEvent(new ErrorEvent('error', { message: 'kaboom', error: new Error('kaboom') }))
    expect(reports).toHaveLength(1)
    expect(reports[0].source).toBe('error')
    expect(reports[0].message).toBe('kaboom')
    expect(reports[0].stack).toContain('kaboom')
    expect(reports[0].path).toBe(window.location.pathname)

    cleanups.splice(0).forEach((cleanup) => cleanup())
    // 卸载后再次派发（普通 Event：无监听时 jsdom 不会把 ErrorEvent 记为未捕获异常）
    window.dispatchEvent(new Event('error'))
    expect(reports).toHaveLength(1)
  })

  it('捕获 unhandledrejection 事件，cleanup 后不再上报', () => {
    cleanups.push(installGlobalErrorHandlers())

    // jsdom 未实现 PromiseRejectionEvent 构造器：手工构造事件并挂上 reason
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(rejection, 'reason', { value: new Error('nope') })
    window.dispatchEvent(rejection)

    expect(reports).toHaveLength(1)
    expect(reports[0].source).toBe('unhandledrejection')
    expect(reports[0].message).toBe('nope')

    cleanups.splice(0).forEach((cleanup) => cleanup())
    window.dispatchEvent(rejection)
    expect(reports).toHaveLength(1)
  })
})
