import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useWindowStore } from '@/stores/window'
import type { WindowState } from '@/types'

setActivePinia(createPinia())

function makeState(overrides: Partial<WindowState> = {}): WindowState {
  const now = Date.now()
  return {
    status: 'open',
    windowStart: new Date(now - 3600000).toISOString(),
    windowEnd: new Date(now + 7200000).toISOString(),
    serverTime: new Date(now).toISOString(),
    semesterId: 1,
    semesterName: '2026-2027 学年第一学期',
    ...overrides,
  }
}

/**
 * 窗口 store：三态流转 + 时钟偏移（SPEC §10）：
 * 倒计时 = window_end - (clientNow + serverTimeOffset)，不信任本地时钟（PRD 功能 2）。
 */
describe('window store 三态与时钟偏移', () => {
  beforeEach(() => {
    const store = useWindowStore()
    store.$reset()
  })

  it('open 状态：可填报/可选购', () => {
    const store = useWindowStore()
    store.apply(makeState({ status: 'open' }))
    expect(store.status).toBe('open')
    expect(store.canFill).toBe(true)
    expect(store.canOrder).toBe(true)
  })

  it('closed 状态：锁定填报与选购', () => {
    const store = useWindowStore()
    store.apply(
      makeState({ status: 'closed', windowEnd: new Date(Date.now() - 1000).toISOString() }),
    )
    expect(store.canFill).toBe(false)
    expect(store.canOrder).toBe(false)
    expect(store.remainMs).toBeLessThanOrEqual(0)
  })

  it('not_open 状态：入口置灰，显示距开始倒计时', () => {
    const store = useWindowStore()
    store.apply(
      makeState({ status: 'not_open', windowStart: new Date(Date.now() + 60000).toISOString() }),
    )
    expect(store.canFill).toBe(false)
    expect(store.startRemainMs).toBeGreaterThan(0)
  })

  it('服务端时钟偏移被计入倒计时（客户端改表不生效）', () => {
    const store = useWindowStore()
    // 服务端时间比客户端快 10 分钟
    const now = Date.now()
    store.apply({
      status: 'open',
      windowStart: new Date(now - 3600000).toISOString(),
      windowEnd: new Date(now + 7200000).toISOString(),
      serverTime: new Date(now + 600000).toISOString(),
      semesterId: 1,
      semesterName: 'demo',
    })
    // 偏移 = serverTime - clientNow ≈ +600s
    expect(store.serverTimeOffset).toBeGreaterThan(590000)
    expect(store.serverTimeOffset).toBeLessThan(610000)
    // 剩余时间按「客户端当前时间 + 偏移」计算，约 6600s（而非 7200s）
    expect(store.remainMs).toBeGreaterThan(6500000)
    expect(store.remainMs).toBeLessThan(6700000)
  })
})

/** 窗口状态判定（与 store 的解耦纯函数视角） */
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
    store.apply(makeState({ status: 'closed', windowEnd: new Date(Date.now() - 1).toISOString() }))
    const wrapper = mount(Harness)
    expect(wrapper.find('[data-testid="status"]').text()).toBe('closed:locked')
  })
})
