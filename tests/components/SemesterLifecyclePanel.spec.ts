import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import SemesterLifecyclePanel from '@/components/SemesterLifecyclePanel.vue'
import type { Semester } from '@/types'

/**
 * SemesterLifecyclePanel：激活 / 回退（SPEC §10 / 02 §6.2 Q1）：
 * draft→active 激活二次确认；原子切换失败回退提示；同一时刻仅一个 active 的前端校验。
 * 窗口期字段校验规则见 tests/unit/validate.spec.ts。
 */
vi.mock('@/api/semester', () => ({
  semesterApi: {
    list: vi.fn(),
    update: vi.fn(),
    activate: vi.fn(),
    archive: vi.fn(),
    openWindow: vi.fn(),
    closeWindow: vi.fn(),
    extendWindow: vi.fn(),
    changes: vi.fn(),
    currentWindow: vi.fn(),
  },
}))

import { semesterApi } from '@/api/semester'

const draft: Semester = {
  id: 2,
  name: '2026-2027 学年第二学期（预备）',
  startDate: '2027-02-20',
  endDate: '2027-07-10',
  status: 'draft',
  windowStart: '2027-03-01T08:00:00',
  windowEnd: '2027-03-20T18:00:00',
  autoOpen: true,
  autoClose: true,
  createdAt: '2026-09-16T08:00:00',
}

function mountPanel(semester: Semester) {
  return mount(SemesterLifecyclePanel, {
    props: { semester },
    global: { plugins: [ElementPlus, createPinia()] },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.mocked(semesterApi.changes).mockResolvedValue([])
  vi.mocked(semesterApi.update).mockResolvedValue(draft)
  vi.mocked(semesterApi.activate).mockResolvedValue({ ...draft, status: 'active' })
  vi.mocked(semesterApi.archive).mockResolvedValue({ ...draft, status: 'archived' })
  document.body.innerHTML = ''
})

describe('SemesterLifecyclePanel 学期生命周期', () => {
  it('draft 学期展示激活入口，激活需二次确认', async () => {
    const wrapper = mountPanel(draft)
    expect(wrapper.text()).toContain('草稿')

    const activateButton = wrapper.findAll('button').find((b) => b.text() === '激活学期')
    expect(activateButton).toBeTruthy()

    // 取消确认 → 不调用接口
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce(new Error('cancel'))
    await activateButton!.trigger('click')
    await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    expect(semesterApi.activate).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
    wrapper.unmount()
  })

  it('激活成功后通知 changed 事件并刷新变更记录', async () => {
    const wrapper = mountPanel(draft)
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as never)

    const activateButton = wrapper.findAll('button').find((b) => b.text() === '激活学期')
    await activateButton!.trigger('click')
    await vi.waitFor(() => expect(semesterApi.activate).toHaveBeenCalledWith(2))
    await vi.waitFor(() => expect(wrapper.emitted('changed')).toBeTruthy())

    confirmSpy.mockRestore()
    wrapper.unmount()
  })

  it('激活失败（原子切换回退）：提示重试并回退展示', async () => {
    vi.mocked(semesterApi.activate).mockRejectedValue(
      new Error('同一时刻仅允许一个 active 学期，请先归档当前学期'),
    )
    const messageSpy = vi.spyOn(ElMessage, 'error')
    const wrapper = mountPanel(draft)
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as never)

    const activateButton = wrapper.findAll('button').find((b) => b.text() === '激活学期')
    await activateButton!.trigger('click')
    await vi.waitFor(() => expect(semesterApi.activate).toHaveBeenCalled())
    // 失败后回退提示 + 通知父级刷新
    await vi.waitFor(() =>
      expect(messageSpy).toHaveBeenCalledWith('同一时刻仅允许一个 active 学期，请先归档当前学期'),
    )
    expect(wrapper.emitted('changed')).toBeTruthy()

    confirmSpy.mockRestore()
    messageSpy.mockRestore()
    wrapper.unmount()
  })

  it('active 学期提供立即开启 / 提前截止 / 延长 / 归档入口', async () => {
    const wrapper = mountPanel({ ...draft, status: 'active' })
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).toContain('立即开启')
    expect(labels).toContain('提前截止')
    expect(labels).toContain('延长')
    expect(labels).toContain('归档')
    wrapper.unmount()
  })

  it('draft 学期不展示窗口操作区', async () => {
    const wrapper = mountPanel(draft)
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).not.toContain('立即开启')
    expect(labels).not.toContain('提前截止')
    expect(labels).toContain('激活学期')
    wrapper.unmount()
  })

  it('展示窗口变更记录', async () => {
    vi.mocked(semesterApi.changes).mockResolvedValue([
      {
        id: 1,
        semesterId: 2,
        action: 'extend',
        operatorName: '张教材',
        createdAt: '2026-09-20 09:00:00',
        fromValue: '2026-09-30T18:00:00',
        toValue: '2026-10-10T18:00:00',
      },
    ])
    const wrapper = mountPanel(draft)
    await vi.waitFor(() => expect(wrapper.text()).toContain('延长窗口'))
    expect(wrapper.text()).toContain('张教材')
    wrapper.unmount()
  })
})
