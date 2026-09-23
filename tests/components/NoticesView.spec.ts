import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox, ElTable } from 'element-plus'
import NoticesView from '@/views/admin/NoticesView.vue'
import ExportButton from '@/components/ExportButton.vue'
import { useAuthStore } from '@/stores/auth'
import { PERMISSIONS } from '@/utils/constants'
import type { NoticeTask, Semester } from '@/types'

/**
 * 通知管理页 · FE-W4（决策文档 §A6）。
 *
 * 覆盖三处此前与后端能力脱节的交互，重点在**载荷正确性**：
 *   1. 学期筛选——`noticeApi.tasks` 必须带选中学期的 `semesterId`（缺省口径是 active 学期）；
 *   2. 按选中任务导出——导出载荷必须是**选中的那条任务**，而不是历史上写死的 `tasks[0]`；
 *      未选中时导出按钮禁用（避免导错对象）；
 *   3. 立即发送——仅 `active` 任务显示该按钮，点击走 `sendNow`；
 *      创建流程是「创建 → 立即发首轮」两步，且**首轮失败不回滚任务**。
 */
vi.mock('@/api/notice', () => ({
  noticeApi: {
    tasks: vi.fn(),
    createTask: vi.fn(),
    sendNow: vi.fn(),
    closeTask: vi.fn(),
    progress: vi.fn(),
    failures: vi.fn(),
  },
}))
vi.mock('@/api/semester', () => ({
  semesterApi: { list: vi.fn() },
}))
vi.mock('@/api/exportTask', () => ({
  exportApi: { notice: vi.fn() },
}))

import { noticeApi } from '@/api/notice'
import { semesterApi } from '@/api/semester'
import { exportApi } from '@/api/exportTask'

const tasks = vi.mocked(noticeApi.tasks)
const createTask = vi.mocked(noticeApi.createTask)
const sendNow = vi.mocked(noticeApi.sendNow)
const semesterList = vi.mocked(semesterApi.list)
const exportNotice = vi.mocked(exportApi.notice)

const SEMESTERS: Semester[] = [
  { id: 1, name: '2026-2027学年秋季学期', activeStatus: 'active' } as Semester,
  { id: 2, name: '2026-2027学年春季学期', activeStatus: 'draft' } as Semester,
]

function task(partial: Partial<NoticeTask> & Pick<NoticeTask, 'id'>): NoticeTask {
  return {
    semesterId: 1,
    title: `通知 ${partial.id}`,
    content: '内容',
    source: 'manual',
    status: 'active',
    ...partial,
  } as NoticeTask
}

const TASKS: NoticeTask[] = [
  task({ id: 31, title: '进行中的通知', status: 'active' }),
  task({ id: 22, title: '已关闭的通知', status: 'closed' }),
]

async function mountPage() {
  semesterList.mockResolvedValue(SEMESTERS)
  tasks.mockResolvedValue(TASKS)
  // 导出走 ExportButton（无权限码即移除 DOM），故需先给到权限
  useAuthStore().permissions = [PERMISSIONS.EXPORT_NOTICE, PERMISSIONS.NOTICE_TASK_MANAGE]
  const wrapper = mount(NoticesView, {
    global: { plugins: [ElementPlus] },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
  vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
  vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as never)
})

describe('通知管理页（FE-W4）', () => {
  it('默认按 active 学期拉任务（semesterId 随下拉下发）', async () => {
    await mountPage()
    expect(semesterList).toHaveBeenCalled()
    // 默认选中 active 学期（id=1）→ 任务列表必须带该 semesterId
    expect(tasks).toHaveBeenCalledWith({ semesterId: 1 })
  })

  it('切换学期后按新学期重新拉任务', async () => {
    const wrapper = await mountPage()
    const select = wrapper.findComponent({ name: 'ElSelect' })
    select.vm.$emit('update:modelValue', 2)
    select.vm.$emit('change', 2)
    await flushPromises()
    expect(tasks).toHaveBeenLastCalledWith({ semesterId: 2 })
  })

  it('未选中任务时导出禁用；选中后导出载荷用**选中任务**而不是 tasks[0]', async () => {
    const wrapper = await mountPage()
    const exportBtn = wrapper.findComponent(ExportButton)

    // 初始无选中 → 禁用（防止导错对象）
    expect(exportBtn.props('disabled')).toBe(true)

    // 选中第二条（id=22）——若沿用历史实现 tasks[0]，载荷会是 31
    const table = wrapper.findComponent(ElTable)
    table.vm.$emit('current-change', TASKS[1])
    await flushPromises()
    expect(wrapper.findComponent(ExportButton).props('disabled')).toBe(false)

    exportNotice.mockResolvedValue({
      kind: 'file',
      blob: new Blob(['x']),
      fileName: '通知汇总.xlsx',
    } as never)
    const exporter = wrapper.findComponent(ExportButton).props('exporter') as () => Promise<unknown>
    await exporter()
    expect(exportNotice).toHaveBeenCalledWith({ taskId: 22 })
  })

  it('「立即发送」只出现在 active 任务上，点击走 sendNow 并展示本轮统计', async () => {
    const wrapper = await mountPage()
    const sendButtons = wrapper.findAll('[data-testid="notice-send-now"]')
    // 两条任务里只有 1 条 active
    expect(sendButtons).toHaveLength(1)

    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    sendNow.mockResolvedValue({
      roundNo: 2,
      total: 10,
      sent: 7,
      unauthorized: 2,
      failed: 1,
      skipped: 0,
    })
    await sendButtons[0].trigger('click')
    await flushPromises()
    expect(sendNow).toHaveBeenCalledWith(31)
    const successText = vi.mocked(ElMessage.success).mock.calls.at(-1)?.[0] as string
    expect(successText).toContain('成功 7')
    expect(successText).toContain('未授权 2')
    expect(successText).toContain('第 2 轮')
  })

  it('创建流程是「创建 → 立即发首轮」，且首轮失败不回滚任务', async () => {
    const wrapper = await mountPage()
    createTask.mockResolvedValue(task({ id: 77 }))
    sendNow.mockRejectedValue(new Error('本期征订已截止'))

    // 两个 tab 同时渲染，必须按 placeholder 精确定位标题/内容输入框
    await wrapper.find('input[placeholder="如 请尽快完成教材填报"]').setValue('测试标题')
    await wrapper.find('textarea').setValue('测试内容')

    await wrapper.find('[data-testid="notice-create-submit"]').trigger('click')
    await flushPromises()

    // 先创建，再立即发送（后端保持两个原子动作）
    expect(createTask).toHaveBeenCalledWith({
      title: '测试标题',
      content: '测试内容',
      targetRoles: 'STUDENT',
    })
    expect(sendNow).toHaveBeenCalledWith(77)
    // 首轮失败：任务**不回滚**（回滚会让用户重复创建并撞 409），只提示可重试
    const warnText = vi.mocked(ElMessage.warning).mock.calls.at(-1)?.[0] as string
    expect(warnText).toContain('任务已创建')
    expect(warnText).toContain('可在任务列表重试')
  })

  it('创建成功且首轮发送成功 → 提示含本轮统计', async () => {
    const wrapper = await mountPage()
    createTask.mockResolvedValue(task({ id: 88 }))
    sendNow.mockResolvedValue({
      roundNo: 1,
      total: 5,
      sent: 3,
      unauthorized: 2,
      failed: 0,
      skipped: 0,
    })

    await wrapper.find('input[placeholder="如 请尽快完成教材填报"]').setValue('标题')
    await wrapper.find('textarea').setValue('内容')
    await wrapper.find('[data-testid="notice-create-submit"]').trigger('click')
    await flushPromises()

    expect(sendNow).toHaveBeenCalledWith(88)
    const okText = vi.mocked(ElMessage.success).mock.calls.at(-1)?.[0] as string
    expect(okText).toContain('任务已创建并完成首轮发送')
    expect(okText).toContain('成功 3')
  })
})
