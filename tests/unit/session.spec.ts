import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearRefreshToken,
  getRefreshToken,
  onRefreshTokenChange,
  readRefreshToken,
  setRefreshToken,
  writeRefreshToken,
} from '@/utils/session'

/**
 * refresh token 持久层（SPEC §5 降级方案 + 评审 S2）：
 * 键名唯一收敛在 utils/session.ts；刷新页面用持久层恢复会话，
 * 其他标签页轮换后通过 `storage` 事件同步内存态。
 */

const KEY = 'textbook.refreshToken'

beforeEach(() => {
  // 模块内还有内存兜底（跨用例保留），先写空清掉它，再清 localStorage
  writeRefreshToken('')
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('refresh token 持久层读写', () => {
  it('写—读—清往返：localStorage 与 getRefreshToken 一致', () => {
    writeRefreshToken('refresh-abc')
    expect(localStorage.getItem(KEY)).toBe('refresh-abc')
    expect(readRefreshToken()).toBe('refresh-abc')
    expect(getRefreshToken()).toBe('refresh-abc')

    clearRefreshToken()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(readRefreshToken()).toBe('')
    expect(getRefreshToken()).toBeNull()
  })

  it("writeRefreshToken('') 移除已存储的键", () => {
    setRefreshToken('token-1')
    expect(localStorage.getItem(KEY)).toBe('token-1')

    writeRefreshToken('')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('未存储任何令牌时 getRefreshToken() 返回 null', () => {
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(readRefreshToken()).toBe('')
    expect(getRefreshToken()).toBeNull()
  })
})

describe('onRefreshTokenChange 跨标签页同步', () => {
  it('本键的 storage 事件触发监听，其他键不触发，取消订阅后不再触发', () => {
    const listener = vi.fn()
    const unsubscribe = onRefreshTokenChange(listener)

    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'rotated-1' }))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith('rotated-1')

    // 其他键的写入（同一浏览器下别的 localStorage 使用方）不触发
    window.dispatchEvent(new StorageEvent('storage', { key: 'other.key', newValue: 'x' }))
    expect(listener).toHaveBeenCalledTimes(1)

    // 其他标签页清空令牌（newValue 为 null）→ 通知空串
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: null }))
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenLastCalledWith('')

    unsubscribe()
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'rotated-2' }))
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('localStorage 不可写时的内存兜底', () => {
  it('setItem 抛错：写入不抛异常，内存兜底仍可读', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => writeRefreshToken('memory-only')).not.toThrow()
    expect(setItem).toHaveBeenCalled()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(readRefreshToken()).toBe('memory-only')
    expect(getRefreshToken()).toBe('memory-only')
  })

  it('存储整体不可用（隐私模式）：读写清都不抛异常，内存态为唯一真源', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(() => writeRefreshToken('memory-fallback')).not.toThrow()
    expect(readRefreshToken()).toBe('memory-fallback')
    expect(getRefreshToken()).toBe('memory-fallback')

    expect(() => clearRefreshToken()).not.toThrow()
    expect(readRefreshToken()).toBe('')
    expect(getRefreshToken()).toBeNull()
  })
})
