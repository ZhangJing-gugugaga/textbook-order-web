import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import ImportWizard from '@/components/ImportWizard.vue'
import { useConfigStore } from '@/stores/config'
import type { ImportBatch } from '@/types'

/**
 * ImportWizard：批次轮询与错误回显（SPEC §10 / API.md §3.9）：
 * 上传（.xlsx）→ GET /api/batch/{id} 轮询（status running→done/failed）
 * → 结果摘要（okCount/errorCount）+ 错误明细下载 + 错误行预览。
 */
describe('ImportWizard Excel 异步导入', () => {
  let batches: Record<number, ImportBatch>

  const batch = (overrides: Partial<ImportBatch> = {}): ImportBatch => ({
    id: 1,
    bizType: 'student',
    status: 'running',
    progressPct: 0,
    total: 0,
    okCount: 0,
    errorCount: 0,
    ...overrides,
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    batches = {}
    const config = useConfigStore()
    config.config['import.max_file_mb'] = 10
  })

  function mountWizard() {
    return mount(ImportWizard, {
      props: {
        title: '学生名单 Excel 导入',
        uploader: async () => ({ batchId: 1 }),
        poller: async (id: number) => {
          const current = batches[id] ?? batch()
          batches[id] = current
          return current
        },
        errorDownloader: async (id: number) => ({
          blob: new Blob(['row,reason']),
          fileName: `导入错误明细-${id}.xlsx`,
        }),
      },
      global: { plugins: [ElementPlus, createPinia()], components: { UploadFilled } },
      attachTo: document.body,
    })
  }

  it('上传后展示批次号与进度，完成后给出结果摘要', async () => {
    batches[1] = batch()
    const wrapper = mountWizard()

    const input = wrapper.find('input[type="file"]')
    const file = new File(['x'], '学生名单.xlsx', { type: 'application/vnd.ms-excel' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await vi.waitFor(() => expect(wrapper.text()).toContain('批次号：1'), { timeout: 8000 })
    expect(wrapper.text()).toContain('正在解析')

    // 推进到「有错误行」终态
    batches[1] = batch({
      status: 'done',
      progressPct: 100,
      total: 12,
      okCount: 11,
      errorCount: 1,
      errorDetail: [{ row: 7, reason: '学号格式不正确（应为 8 位数字）' }],
    })
    await vi.waitFor(() => expect(wrapper.text()).toContain('导入完成：成功 11 行，失败 1 行'), {
      timeout: 8000,
    })
    expect(wrapper.text()).toContain('学号格式不正确（应为 8 位数字）')
    wrapper.unmount()
  })

  it('非 .xlsx 文件被前置拦截', async () => {
    const wrapper = mountWizard()
    const input = wrapper.find('input[type="file"]')
    const file = new File(['x'], '名单.txt', { type: 'text/plain' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    expect(wrapper.text()).not.toContain('批次号：')
    wrapper.unmount()
  })

  it('批次失败展示失败提示，可重新上传', async () => {
    batches[1] = batch()
    const wrapper = mountWizard()
    const input = wrapper.find('input[type="file"]')
    const file = new File(['x'], '教材库.xlsx')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await vi.waitFor(() => expect(wrapper.text()).toContain('批次号：1'), { timeout: 8000 })

    batches[1] = batch({ status: 'failed', progressPct: 100 })
    await vi.waitFor(() => expect(wrapper.text()).toContain('解析失败，请下载错误明细核对后重试'), {
      timeout: 8000,
    })
    const resetButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('重新上传'))
    await resetButton?.trigger('click')
    expect(wrapper.text()).not.toContain('批次号：1')
    wrapper.unmount()
  })
})
