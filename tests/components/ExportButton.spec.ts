import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'

/** 内部端点（默认）与浏览器下载被替换为可断言的桩；ApiError 等真实实现保留 */
const progressSpy = vi.fn()
const downloadSpy = vi.fn()
const triggerDownloadSpy = vi.fn()

vi.mock('@/api/exportTask', () => ({
  exportTaskApi: { progress: (taskId: number) => progressSpy(taskId) },
}))
vi.mock('@/api/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/http')>()
  return {
    ...actual,
    downloadExportTask: (taskId: number, token: string, name?: string) =>
      downloadSpy(taskId, token, name),
    triggerBrowserDownload: (blob: Blob, fileName: string) => triggerDownloadSpy(blob, fileName),
  }
})

const ExportButton = (await import('@/components/ExportButton.vue')).default
const { useAuthStore } = await import('@/stores/auth')
type ExportTaskLike = import('@/types').ExportTask

/**
 * ExportButton：同步/异步分流 + 端点按角色注入（SPEC §8 / API.md §3.10）。
 *
 * 回归背景：本组件曾把轮询与下载端点写死为内部 `/api/export-task/{id}`，
 * 供货商异步导出会打到不属于它的端点（联调发现）。修复后端点由 `progress`/`download`
 * prop 注入，供货商页面传 `supplierApi.taskProgress/taskDownload`。
 * 本文件为该修复提供可重复执行的回归保护（此前该组件单测覆盖率为 0）。
 */
describe('ExportButton 导出分流与端点注入', () => {
  beforeEach(() => {
    progressSpy.mockReset()
    downloadSpy.mockReset()
    triggerDownloadSpy.mockReset()
  })

  function mountButton(props: Record<string, unknown>, options: { permissions?: string[] } = {}) {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.permissions = options.permissions ?? ['export:order:create']
    const wrapper = mount(ExportButton, {
      props: {
        name: '导出',
        exporter: async () => ({ kind: 'async', data: { taskId: 77 } }),
        ...props,
      },
      global: { plugins: [ElementPlus, pinia] },
      attachTo: document.body,
    })
    return wrapper
  }

  it('同步导出（Content-Type 为 xlsx 流）：直接触发浏览器下载，不建任务', async () => {
    const blob = new Blob(['xlsx'])
    const wrapper = mountButton({
      exporter: async () => ({ kind: 'file', blob, fileName: '教师征订明细.xlsx' }),
    })
    await (wrapper.vm as unknown as { run: () => Promise<void> }).run()
    expect(triggerDownloadSpy).toHaveBeenCalledWith(blob, '教师征订明细.xlsx')
    expect(progressSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('异步导出：轮询走注入的 progress（供货商端点），不碰内部端点', async () => {
    const progress = vi.fn(async () => ({ id: 77, status: 'running', progressPct: 30 }))
    const wrapper = mountButton({ progress, download: vi.fn() })
    await (wrapper.vm as unknown as { run: () => Promise<void> }).run()

    expect(progress).toHaveBeenCalledWith(77)
    expect(progressSpy).not.toHaveBeenCalled() // 内部端点未被使用
    wrapper.unmount()
  })

  it('异步导出完成：用注入的 download 下载一次性 token，不碰内部下载端点', async () => {
    const progress = vi.fn(async (): Promise<ExportTaskLike> => ({
      id: 77,
      bizType: 'supplier',
      status: 'done',
      downloadToken: 'tok-once',
    }))
    const download = vi.fn(async () => ({
      blob: new Blob(['xlsx']),
      fileName: 'supplier-orders-77.xlsx',
    }))
    const wrapper = mountButton({ progress, download })
    await (wrapper.vm as unknown as { run: () => Promise<void> }).run()

    await vi.waitFor(() => expect(download).toHaveBeenCalled(), { timeout: 5000 })
    expect(download).toHaveBeenCalledWith(77, 'tok-once', '导出.xlsx')
    expect(downloadSpy).not.toHaveBeenCalled() // 内部下载端点未被使用
    expect(triggerDownloadSpy).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('任务完成但无 downloadToken：不发下载请求（不浪费一次性机会），提示重新导出', async () => {
    const progress = vi.fn(async (): Promise<ExportTaskLike> => ({
      id: 77,
      bizType: 'orders',
      status: 'done',
    }))
    const download = vi.fn()
    const wrapper = mountButton({ progress, download })
    await (wrapper.vm as unknown as { run: () => Promise<void> }).run()

    // 轮询进入终态、watch 触发后仍不应调用任何下载
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(download).not.toHaveBeenCalled()
    expect(downloadSpy).not.toHaveBeenCalled()
    expect(triggerDownloadSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('终态失败（404 归属失败）：不给「重试」入口，改为提示重新导出', async () => {
    const { ApiError } = await import('@/api/http')
    const progress = vi.fn(async () => {
      throw new ApiError('资源不存在', 'NOT_FOUND')
    })
    const wrapper = mountButton({ progress, download: vi.fn() })
    await (wrapper.vm as unknown as { run: () => Promise<void> }).run()

    await vi.waitFor(() => expect(wrapper.text()).toContain('进度查询失败'), { timeout: 5000 })
    expect(wrapper.text()).toContain('该任务已不可访问，请重新导出。')
    expect(wrapper.findAll('button').some((b) => b.text().includes('重试'))).toBe(false)
    wrapper.unmount()
  })

  it('非终态失败（网络/5xx）：保留「重试」入口', async () => {
    const { ApiError } = await import('@/api/http')
    const progress = vi.fn(async () => {
      throw new ApiError('网络异常', 'NETWORK_ERROR')
    })
    const wrapper = mountButton({ progress, download: vi.fn() })
    await (wrapper.vm as unknown as { run: () => Promise<void> }).run()

    await vi.waitFor(() => expect(wrapper.text()).toContain('进度查询失败'), { timeout: 5000 })
    expect(wrapper.findAll('button').some((b) => b.text().includes('重试'))).toBe(true)
    wrapper.unmount()
  })

  it('按钮级权限：无权限码时移除 DOM（供货商导出只对 supplier:order:export 可见）', async () => {
    const wrapper = mountButton({ code: 'supplier:order:export' }, { permissions: [] })
    expect(wrapper.find('button').exists()).toBe(false)
    wrapper.unmount()
  })
})
