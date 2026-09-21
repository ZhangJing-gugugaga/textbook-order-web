import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import GlobalBlockingNotice from '@/components/GlobalBlockingNotice.vue'
import { useNoticeStore } from '@/stores/notice'
import type { UnconfirmedNotice } from '@/types'

vi.mock('@/api/notice', () => ({
  noticeApi: {
    unconfirmed: vi.fn(),
    confirm: vi.fn(),
  },
}))

import { noticeApi } from '@/api/notice'

const tasks: UnconfirmedNotice[] = [
  {
    taskId: 4001,
    title: '教材征订窗口已开启',
    content: '请在截止时间前完成填报。',
    source: 'system_window_change',
    createdAt: '2026-09-18 08:00',
    roundStopped: false,
  },
  {
    taskId: 4002,
    title: '征订窗口已延长',
    content: '请尽快提交。',
    source: 'system_window_change',
    createdAt: '2026-09-20 08:00',
    roundStopped: false,
  },
]

function mountComponent() {
  return mount(GlobalBlockingNotice, {
    global: { plugins: [ElementPlus, createPinia()] },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

/** GlobalBlockingNotice：逐条确认队列与 fail-open（SPEC §10 / PRD 功能 4） */
describe('GlobalBlockingNotice 阻塞弹窗通知', () => {
  it('无未确认通知：不弹窗，直接放行', async () => {
    vi.mocked(noticeApi.unconfirmed).mockResolvedValue([])
    const wrapper = mountComponent()
    await vi.waitFor(() => expect(useNoticeStore().loaded).toBe(true))
    expect(useNoticeStore().queue).toHaveLength(0)
    expect(document.body.querySelector('[data-testid=blocking-notice]')).toBeNull()
    wrapper.unmount()
  })

  it('拉取失败 = fail-open：放行进入，下次进入重查', async () => {
    vi.mocked(noticeApi.unconfirmed).mockRejectedValue(new Error('network'))
    const wrapper = mountComponent()
    await vi.waitFor(() => expect(useNoticeStore().loaded).toBe(true))
    expect(useNoticeStore().queue).toHaveLength(0)
    expect(document.body.querySelector('[data-testid=blocking-notice]')).toBeNull()
    wrapper.unmount()
  })

  it('有未确认通知：逐条弹出，确认后出队下一条', async () => {
    vi.mocked(noticeApi.unconfirmed).mockResolvedValue([...tasks])
    vi.mocked(noticeApi.confirm).mockResolvedValue(undefined)

    const wrapper = mountComponent()
    await vi.waitFor(() =>
      expect(document.body.querySelector('[data-testid=blocking-notice]')).not.toBeNull(),
    )

    const dialog = document.body.querySelector('[data-testid=blocking-notice]') as HTMLElement
    expect(dialog.textContent).toContain('教材征订窗口已开启')
    expect(dialog.textContent).toContain('还有 2 条通知待确认')

    // 点「收到」→ 确认第一条
    const buttons = document.body.querySelectorAll('[data-testid=blocking-notice] .el-button')
    ;(buttons[buttons.length - 1] as HTMLElement).click()
    await vi.waitFor(() => expect(useNoticeStore().queue).toHaveLength(1))

    // 队列推进到下一条（仅剩 1 条时不再显示剩余提示）
    await vi.waitFor(() => {
      const next = document.body.querySelector('[data-testid=blocking-notice]') as HTMLElement
      expect(next.textContent).toContain('征订窗口已延长')
      expect(next.textContent).not.toContain('还有')
    })

    const nextButtons = document.body.querySelectorAll('[data-testid=blocking-notice] .el-button')
    ;(nextButtons[nextButtons.length - 1] as HTMLElement).click()
    await vi.waitFor(() => expect(useNoticeStore().queue).toHaveLength(0))

    // 全部确认后弹窗内容销毁，放行进入
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('征订窗口已延长'), {
      timeout: 4000,
    })
    expect(noticeApi.confirm).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('确认接口失败：弹窗保留可重试，不放行', async () => {
    vi.mocked(noticeApi.unconfirmed).mockResolvedValue([tasks[0]])
    vi.mocked(noticeApi.confirm).mockRejectedValue(new Error('网络异常，请稍后重试'))

    const wrapper = mountComponent()
    await vi.waitFor(() =>
      expect(document.body.querySelector('[data-testid=blocking-notice]')).not.toBeNull(),
    )

    const buttons = document.body.querySelectorAll('[data-testid=blocking-notice] .el-button')
    ;(buttons[buttons.length - 1] as HTMLElement).click()
    await vi.waitFor(() => expect(noticeApi.confirm).toHaveBeenCalledTimes(1))

    // 弹窗仍在，队列未清空
    expect(document.body.querySelector('[data-testid=blocking-notice]')).not.toBeNull()
    expect(useNoticeStore().queue).toHaveLength(1)
    wrapper.unmount()
  })
})
