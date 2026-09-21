import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import ImportWizard from '@/components/ImportWizard.vue'
import { useConfigStore } from '@/stores/config'
import type { ImportBatch } from '@/types'

/**
 * ImportWizard：轮询与错误回显（SPEC §10 / PRD 功能 5）：
 * 上传 → 批次轮询进度 → 结果摘要 + 错误明细下载 + 前 N 行预览。
 */
describe('ImportWizard Excel 异步导入', () => {
  let batches: Record<string, ImportBatch>

  const batch = (overrides: Partial<ImportBatch> = {}): ImportBatch => ({
    batchId: 'IMB-001',
    bizType: 'student',
    fileName: '学生全量表.xlsx',
    status: 'parsing',
    progressPct: 0,
    totalRows: 0,
    successRows: 0,
    errorRows: 0,
    message: '',
    createdAt: '2026-09-18 08:00',
    errorPreview: [],
    ...overrides,
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    batches = {}
    const config = useConfigStore()
    config.importMaxSizeMb = 10
  })

  function mountWizard() {
    return mount(ImportWizard, {
      props: {
        title: '学生全量 Excel 导入',
        uploader: async () => ({ batchId: 'IMB-001' }),
        poller: async (id: string) => {
          const current = batches[id] ?? batch()
          batches[id] = current
          return current
        },
        errorDownloader: async () => new Blob(['row,reason']),
      },
      global: { plugins: [ElementPlus, createPinia()], components: { UploadFilled } },
      attachTo: document.body,
    })
  }

  it('上传后展示批次号与进度，完成后给出结果摘要', async () => {
    batches['IMB-001'] = batch()
    const wrapper = mountWizard()

    // 触发上传（before-upload 返回 false 阻止 el-upload 自动请求，由我们调用）
    await wrapper.vm.$options
    const input = wrapper.find('input[type="file"]')
    const file = new File(['x'], '学生全量表.xlsx', { type: 'application/vnd.ms-excel' })
    Object.defineProperty(input.element, 'files', { value: [file] })

    // 直接调用内部 handleFile 逻辑：通过 emit change 触发 el-upload 的 before-upload
    await input.trigger('change')
    await vi.waitFor(() => expect(wrapper.text()).toContain('IMB-001'), { timeout: 8000 })
    expect(wrapper.text()).toContain('正在解析')

    // 推进到「部分错误」终态
    batches['IMB-001'] = batch({
      status: 'partial',
      progressPct: 100,
      totalRows: 12,
      successRows: 11,
      errorRows: 1,
      message: '1 行数据校验失败',
      errorPreview: [{ row: 7, reason: '学号格式不正确（应为 8 位数字）' }],
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
    // 未产生批次号
    expect(wrapper.text()).not.toContain('IMB-')
    wrapper.unmount()
  })

  it('解析失败展示失败原因，可重新上传', async () => {
    batches['IMB-001'] = batch()
    const wrapper = mountWizard()
    const input = wrapper.find('input[type="file"]')
    const file = new File(['x'], '教材库.xlsx')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await vi.waitFor(() => expect(wrapper.text()).toContain('IMB-001'), { timeout: 8000 })

    batches['IMB-001'] = batch({ status: 'failed', progressPct: 100, message: '文件格式无法解析' })
    await vi.waitFor(() => expect(wrapper.text()).toContain('解析失败：文件格式无法解析'), {
      timeout: 8000,
    })
    await wrapper.find('button').trigger('click') // 重新上传
    expect(wrapper.text()).not.toContain('IMB-001')
    wrapper.unmount()
  })
})
