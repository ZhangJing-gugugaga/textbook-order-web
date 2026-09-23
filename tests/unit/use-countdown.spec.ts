import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCountdown } from '@/composables/useCountdown'

/**
 * useCountdown（SPEC §8）：每秒重算的响应式取值器，**卸载时自动清理计时器**。
 *
 * 这条清理逻辑是评审 Q8 的修复项：此前 WindowBanner 直接 setInterval 且未清理，
 * 每次「登出 → 登录」循环都会新增一个永不销毁的计时器（计时器泄漏）。
 * 因此本文件的重点是**卸载后不得再 tick**，而不是「能取到值」。
 */
function mountWithCountdown<T>(getValue: () => T, tickMs?: number) {
  let exposed: ReturnType<typeof useCountdown<T>> | null = null
  const Comp = defineComponent({
    setup() {
      exposed = useCountdown(getValue, tickMs)
      return () => h('span', String(exposed!.value))
    },
  })
  const wrapper = mount(Comp)
  return { wrapper, value: () => (exposed as unknown as { value: T }).value }
}

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始值取 getValue 的首次求值结果', () => {
    const source = ref(1000)
    const { value } = mountWithCountdown(() => source.value)
    expect(value()).toBe(1000)
  })

  it('每秒重新求值并更新（依赖源变化后随之刷新）', async () => {
    const source = ref(1000)
    const { value } = mountWithCountdown(() => source.value)

    source.value = 2000
    // 未到 tick 前不刷新（这正是「派生值依赖本地时钟」需要每秒重算的原因）
    expect(value()).toBe(1000)

    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(value()).toBe(2000)
  })

  it('按 tickMs 参数控制刷新间隔（不传则默认 1000ms）', async () => {
    const source = ref(0)
    const { value } = mountWithCountdown(() => source.value, 250)

    source.value = 1
    vi.advanceTimersByTime(249)
    await nextTick()
    expect(value()).toBe(0)

    vi.advanceTimersByTime(1)
    await nextTick()
    expect(value()).toBe(1)
  })

  it('组件卸载后计时器被清理：不再 tick（评审 Q8 的计时器泄漏修复）', async () => {
    const source = ref(0)
    const getValue = vi.fn(() => source.value)
    const { wrapper, value } = mountWithCountdown(getValue)

    vi.advanceTimersByTime(1000)
    await nextTick()
    const callsWhileMounted = getValue.mock.calls.length
    expect(callsWhileMounted).toBeGreaterThan(1)

    wrapper.unmount()
    source.value = 999
    vi.advanceTimersByTime(5000)
    await nextTick()

    // 卸载后不得再有任何求值调用
    expect(getValue.mock.calls.length).toBe(callsWhileMounted)
    expect(value()).not.toBe(999)
  })

  it('返回的是 shallowRef（值本身即响应式，不深解构对象）', async () => {
    const source = ref({ n: 1 })
    const { value } = mountWithCountdown(() => source.value)
    expect(value()).toBe(source.value)

    source.value = { n: 2 }
    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(value()).toBe(source.value)
  })
})
