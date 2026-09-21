import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useWindowStore } from '@/stores/window'
import type { WindowState, WindowStatus } from '@/types'

setActivePinia(createPinia())

/** 后端 GET /api/semester/window/status 的真实字段形状（含 serverTime） */
function makeState(overrides: Partial<WindowState> = {}): WindowState {
  const now = Date.now()
  const fmt = (ms: number) => {
    const d = new Date(ms)
    const p = (v: number) => String(v).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
      d.getMinutes(),
    )}:${p(d.getSeconds())}`
  }
  return {
    serverTime: fmt(now),
    semesterId: 1,
    semesterName: '2026-2027学年秋季学期',
    windowStatus: 'open' as WindowStatus,
    windowStart: fmt(now - 3600000),
    windowEnd: fmt(now + 7200000),
    channelOpen: 1,
    activeStatus: 'active',
    ...overrides,
  }
}

/**
 * 窗口 store：三态流转 + 时钟偏移（SPEC §10 / PRD 功能 2）：
 * 倒计时 = windowEnd - (clientNow + serverTimeOffset)，以服务端 serverTime 为准，不信任本地时钟。
 * 学生选购额外受 channelOpen 约束。
 */
describe('window store 三态与时钟偏移', () => {
  beforeEach(() => {
    const store = useWindowStore()
    store.$reset()
  })

  it('open + 通道开放：可填报/可选购', () => {
    const store = useWindowStore()
    store.apply(makeState({ windowStatus: 'open', channelOpen: 1 }))
    expect(store.status).toBe('open')
    expect(store.canFill).toBe(true)
    expect(store.canOrder).toBe(true)
  })

  it('open 但学生通道关闭：可填报、不可选购', () => {
    const store = useWindowStore()
    store.apply(makeState({ windowStatus: 'open', channelOpen: 0 }))
    expect(store.canFill).toBe(true)
    expect(store.canOrder).toBe(false)
  })

  it('closed 状态：锁定填报与选购', () => {
    const store = useWindowStore()
    store.apply(makeState({ windowStatus: 'closed' }))
    expect(store.canFill).toBe(false)
    expect(store.canOrder).toBe(false)
  })

  it('not_open 状态：入口置灰，显示距开始倒计时', () => {
    const store = useWindowStore()
    const now = Date.now()
    store.apply(makeState({ windowStatus: 'not_open' }))
    store.windowStart = new Date(now + 60000).toISOString()
    expect(store.canFill).toBe(false)
    expect(store.startRemainMs).toBeGreaterThan(0)
  })

  it('无 active 学期（windowStatus 为 null）：按未开始降级', () => {
    const store = useWindowStore()
    store.apply(
      makeState({ windowStatus: null, semesterId: null, windowStart: null, windowEnd: null }),
    )
    expect(store.status).toBe('not_open')
    expect(store.canFill).toBe(false)
    expect(store.canOrder).toBe(false)
  })

  it('服务端时钟偏移被计入倒计时（客户端改表不生效）', () => {
    const store = useWindowStore()
    const now = Date.now()
    // 服务端时间比客户端快 10 分钟
    const pad = (v: number) => String(v).padStart(2, '0')
    const fmt = (ms: number) => {
      const d = new Date(ms)
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
        d.getHours(),
      )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    }
    store.apply({
      serverTime: fmt(now + 600000),
      semesterId: 1,
      semesterName: 'demo',
      windowStatus: 'open',
      windowStart: fmt(now - 3600000),
      windowEnd: fmt(now + 7200000),
      channelOpen: 1,
      activeStatus: 'active',
    })
    // 偏移 = serverTime - clientNow ≈ +600s
    expect(store.serverTimeOffset).toBeGreaterThan(590000)
    expect(store.serverTimeOffset).toBeLessThan(610000)
    // 剩余时间按「客户端当前时间 + 偏移」计算，约 6600s（而非 7200s）
    expect(store.remainMs).toBeGreaterThan(6500000)
    expect(store.remainMs).toBeLessThan(6700000)
  })
})

/** 窗口状态判定（组件读取 store 视角） */
describe('窗口状态判定', () => {
  const Harness = defineComponent({
    setup() {
      const store = useWindowStore()
      return () =>
        h(
          'div',
          { 'data-testid': 'status' },
          `${store.status}:${store.canFill ? 'fill' : 'locked'}`,
        )
    },
  })

  it('组件读取 store 的 canFill', () => {
    const store = useWindowStore()
    store.apply(makeState({ windowStatus: 'closed' }))
    const wrapper = mount(Harness)
    expect(wrapper.find('[data-testid="status"]').text()).toBe('closed:locked')
  })
})
