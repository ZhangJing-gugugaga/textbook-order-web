import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import SemesterLifecyclePanel from '@/components/SemesterLifecyclePanel.vue'
import { useAuthStore } from '@/stores/auth'
import { PERMISSIONS } from '@/utils/constants'
import type { AuditLog, PageResult, Semester } from '@/types'

/**
 * SemesterLifecyclePanel：激活 / 回退（SPEC §10 / API.md §3.2）：
 * draft→active 激活二次确认（body 带 version 乐观锁）；原子切换失败回退提示；
 * 窗口变更记录来自审计（分页返回）。
 * 窗口期字段校验规则见 tests/unit/validate.spec.ts。
 */
vi.mock('@/api/semester', () => ({
  semesterApi: {
    list: vi.fn(),
    update: vi.fn(),
    setWindow: vi.fn(),
    activate: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
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
  name: '2026-2027学年春季学期',
  startDate: '2027-02-20',
  endDate: '2027-07-10',
  windowStart: '2027-03-01 08:00:00',
  windowEnd: '2027-03-20 18:00:00',
  channelOpen: 0,
  autoOpen: 1,
  autoClose: 1,
  windowStatus: 'not_open',
  activeStatus: 'draft',
  version: 0,
}

function pageOf<T>(list: T[]): PageResult<T> {
  return { list, page: 1, size: 50, total: list.length, totalPages: 1 }
}

const changeLogs: AuditLog[] = [
  {
    id: 1,
    action: 'WINDOW_EXTEND',
    resource: 'semester',
    resourceId: '2',
    detailJson: { before: '2026-09-30 18:00:00', after: '2026-10-10 18:00:00' },
    at: '2026-09-20 09:00:00',
  },
]

function mountPanel(semester: Semester) {
  // 面板写操作按钮统一走 PermButton（无权限码移除 DOM）：先给会话注入学期 / 窗口
  // 管理权限码，用例聚焦生命周期行为本身；无权限时按钮不渲染见 PermButton 契约。
  const pinia = createPinia()
  useAuthStore(pinia).permissions = [PERMISSIONS.SEMESTER_MANAGE, PERMISSIONS.WINDOW_MANAGE]
  return mount(SemesterLifecyclePanel, {
    props: { semester },
    global: { plugins: [ElementPlus, pinia] },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.mocked(semesterApi.changes).mockResolvedValue(pageOf(changeLogs))
  vi.mocked(semesterApi.setWindow).mockResolvedValue(draft)
  vi.mocked(semesterApi.activate).mockResolvedValue({ ...draft, activeStatus: 'active' })
  vi.mocked(semesterApi.archive).mockResolvedValue(undefined)
  document.body.innerHTML = ''
})

describe('SemesterLifecyclePanel 学期生命周期', () => {
  it('draft 学期展示激活入口，激活需二次确认', async () => {
    const wrapper = mountPanel(draft)
    expect(wrapper.text()).toContain('可导入')

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

  it('激活成功：带 version 乐观锁调用并通知 changed 事件', async () => {
    const wrapper = mountPanel(draft)
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as never)

    const activateButton = wrapper.findAll('button').find((b) => b.text() === '激活学期')
    await activateButton!.trigger('click')
    await vi.waitFor(() => expect(semesterApi.activate).toHaveBeenCalledWith(2, 0))
    await vi.waitFor(() => expect(wrapper.emitted('changed')).toBeTruthy())

    confirmSpy.mockRestore()
    wrapper.unmount()
  })

  it('激活失败（原子切换回退）：提示重试并回退展示', async () => {
    vi.mocked(semesterApi.activate).mockRejectedValue(new Error('存在更新的学期状态，请刷新'))
    const messageSpy = vi.spyOn(ElMessage, 'error')
    const wrapper = mountPanel(draft)
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as never)

    const activateButton = wrapper.findAll('button').find((b) => b.text() === '激活学期')
    await activateButton!.trigger('click')
    await vi.waitFor(() => expect(semesterApi.activate).toHaveBeenCalled())
    // 失败后回退提示 + 通知父级刷新
    await vi.waitFor(() => expect(messageSpy).toHaveBeenCalledWith('存在更新的学期状态，请刷新'))
    expect(wrapper.emitted('changed')).toBeTruthy()

    confirmSpy.mockRestore()
    messageSpy.mockRestore()
    wrapper.unmount()
  })

  it('active 学期提供立即开启 / 提前截止 / 延长 / 归档入口', async () => {
    const wrapper = mountPanel({ ...draft, activeStatus: 'active', windowStatus: 'open' })
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).toContain('立即开启')
    expect(labels).toContain('提前截止')
    expect(labels).toContain('延长')
    expect(labels).toContain('归档')
    wrapper.unmount()
  })

  it('归档带二次门禁参数（B11）：窗口进行中传 version + confirmWindowOpen=true', async () => {
    const wrapper = mountPanel({
      ...draft,
      activeStatus: 'active',
      windowStatus: 'open',
      channelOpen: 1,
      version: 3,
    })
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as never)

    const archiveButton = wrapper.findAll('button').find((b) => b.text() === '归档')
    await archiveButton!.trigger('click')
    // 空 body 归档曾导致线上一次调用即停摆业务：前端必须回传 version 与显式确认标记
    await vi.waitFor(() => expect(semesterApi.archive).toHaveBeenCalledWith(2, 3, true))
    await vi.waitFor(() => expect(wrapper.emitted('changed')).toBeTruthy())

    confirmSpy.mockRestore()
    wrapper.unmount()
  })

  it('archived 学期提供撤销归档入口（B15）：带 version 调用 unarchive', async () => {
    const wrapper = mountPanel({ ...draft, activeStatus: 'archived', version: 4 })
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).toContain('撤销归档')
    expect(labels).not.toContain('归档')

    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as never)
    const unarchiveButton = wrapper.findAll('button').find((b) => b.text() === '撤销归档')
    await unarchiveButton!.trigger('click')
    await vi.waitFor(() => expect(semesterApi.unarchive).toHaveBeenCalledWith(2, 4))

    confirmSpy.mockRestore()
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

  it('展示窗口变更记录（来自审计）', async () => {
    const wrapper = mountPanel(draft)
    await vi.waitFor(() => expect(wrapper.text()).toContain('延长窗口'))
    expect(wrapper.text()).toContain('2026-10-10 18:00:00')
    wrapper.unmount()
  })
})
