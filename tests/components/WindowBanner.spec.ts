import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'

import WindowBanner from '@/components/WindowBanner.vue'
import { useAuthStore } from '@/stores/auth'
import { useWindowStore } from '@/stores/window'
import { PERMISSIONS } from '@/utils/constants'
import { formatCountdown } from '@/utils/format'

/**
 * 全局窗口三态横幅（PRD 功能 2 / SPEC §8）。
 *
 * 关键约束：
 *   1. 三态文案与倒计时口径（not_open 显示距开始、open 显示距截止、closed 显示已截止）；
 *   2. **无 `semester:window:view` 的角色不渲染横幅**（供货商无此权限，渲染出来就是空壳）；
 *   3. 倒计时基于 store 的 remainMs/startRemainMs（已含服务端时钟偏移），组件不自算时钟。
 */
vi.mock('@/api/semester', () => ({
  semesterApi: { currentWindow: vi.fn() },
  orgApi: {},
}))

const DAY = 24 * 60 * 60 * 1000

function mountBanner() {
  return mount(WindowBanner, { global: { plugins: [ElementPlus] } })
}

/** 授予窗口查看权限（横幅的渲染前置条件） */
function grantWindowView() {
  const auth = useAuthStore()
  auth.permissions = [PERMISSIONS.WINDOW_VIEW]
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('WindowBanner 窗口三态', () => {
  it('not_open：显示「距离开始还有」与距开始倒计时', () => {
    grantWindowView()
    const win = useWindowStore()
    win.status = 'not_open'
    win.windowStart = new Date(Date.now() + 2 * DAY).toISOString()
    win.serverTimeOffset = 0

    const wrapper = mountBanner()
    const text = wrapper.text()
    expect(text).toContain('距离开始还有')
    expect(text).toContain(formatCountdown(win.startRemainMs))
  })

  it('open：显示「本期征订将于 …后截止」与截止倒计时，语义色为 success', () => {
    grantWindowView()
    const win = useWindowStore()
    win.status = 'open'
    win.windowEnd = new Date(Date.now() + 3 * DAY).toISOString()
    win.serverTimeOffset = 0

    const wrapper = mountBanner()
    expect(wrapper.text()).toContain('本期征订将于')
    expect(wrapper.text()).toContain(formatCountdown(win.remainMs))
    expect(wrapper.findComponent({ name: 'ElAlert' }).props('type')).toBe('success')
  })

  it('closed：显示「本期征订已截止，可查看历史记录」，语义色为 warning', () => {
    grantWindowView()
    const win = useWindowStore()
    win.status = 'closed'
    win.windowEnd = new Date(Date.now() - DAY).toISOString()
    win.serverTimeOffset = 0

    const wrapper = mountBanner()
    expect(wrapper.text()).toContain('本期征订已截止，可查看历史记录')
    expect(wrapper.findComponent({ name: 'ElAlert' }).props('type')).toBe('warning')
    // closed 无倒计时片段
    expect(wrapper.text()).not.toContain('距截止')
  })

  it('无 semester:window:view 权限（供货商）：不渲染横幅', () => {
    // 不授予权限
    const win = useWindowStore()
    win.status = 'open'
    win.windowEnd = new Date(Date.now() + DAY).toISOString()

    const wrapper = mountBanner()
    expect(wrapper.find('[data-testid="window-banner"]').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('倒计时用服务端时钟偏移修正：客户端时钟被改也不影响（PRD 功能 2）', () => {
    grantWindowView()
    const win = useWindowStore()
    win.status = 'open'
    win.windowEnd = new Date(Date.now() + 5 * DAY).toISOString()
    // 服务端比客户端快 1 天 → 剩余时间应少 1 天
    win.serverTimeOffset = DAY

    // 断言用 store 的实际值（含毫秒漂移，避免落在取整边界上误判）
    expect(win.remainMs).toBeLessThanOrEqual(4 * DAY)
    expect(win.remainMs).toBeGreaterThan(4 * DAY - 1000)

    const wrapper = mountBanner()
    expect(wrapper.text()).toContain(formatCountdown(win.remainMs))
  })
})
