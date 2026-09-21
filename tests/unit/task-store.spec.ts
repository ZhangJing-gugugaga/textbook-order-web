import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTaskStore } from '@/stores/task'
import { POLL_INTERVAL_MAX, POLL_INTERVAL_START } from '@/utils/constants'
import type { ExportTask, ImportBatch } from '@/types'

/**
 * 异步任务 store（SPEC §7 / 评审 Q6）：
 * 导入批次与导出任务轮询——2s 起步、×1.5 退避至 10s 上限、终态自动停止；
 * 轮询失败写入 `state.error` 并停止，消费方展示错误 + 重试（再次调用即重试）。
 */

/** 首次轮询后的退避间隔：2s × 1.5 = 3s */
const SECOND_INTERVAL = POLL_INTERVAL_START * 1.5

function batch(overrides: Partial<ImportBatch> = {}): ImportBatch {
  return { id: 1, bizType: 'student', status: 'running', ...overrides }
}

function exportTask(overrides: Partial<ExportTask> = {}): ExportTask {
  return { id: 1, bizType: 'order', status: 'queued', ...overrides }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('pollImport 导入批次轮询', () => {
  it('running 时按退避继续轮询，终态（done）后自动停止', async () => {
    const store = useTaskStore()
    const fetcher = vi
      .fn<(id: number) => Promise<ImportBatch>>()
      .mockResolvedValueOnce(batch({ status: 'running', progressPct: 30 }))
      .mockResolvedValueOnce(batch({ status: 'done', progressPct: 100, okCount: 12 }))

    store.pollImport(1, fetcher)
    expect(store.imports[1].polling).toBe(true)

    // 首次请求立即发出
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(1)
    expect(store.imports[1].data?.status).toBe('running')
    expect(store.imports[1].polling).toBe(true)
    expect(store.imports[1].interval).toBe(SECOND_INTERVAL)

    // 已在轮询中：重复调用不叠加轮询
    store.pollImport(1, fetcher)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(1)

    // 退避到点 → 第二次请求，拿到终态
    await vi.advanceTimersByTimeAsync(SECOND_INTERVAL)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(store.imports[1].data?.status).toBe('done')
    expect(store.imports[1].data?.okCount).toBe(12)
    expect(store.imports[1].polling).toBe(false)

    // 终态后不再轮询
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MAX * 6)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('轮询失败：写入 state.error 并停止轮询（不再自动重试）', async () => {
    const store = useTaskStore()
    const fetcher = vi
      .fn<(id: number) => Promise<ImportBatch>>()
      .mockRejectedValue(new Error('批次查询失败'))

    store.pollImport(7, fetcher)
    await vi.advanceTimersByTimeAsync(0)

    expect(store.imports[7].error).toBe('批次查询失败')
    expect(store.imports[7].polling).toBe(false)
    expect(store.imports[7].data).toBeNull()

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MAX * 6)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('失败后再次 pollImport 即重试：清空 error、间隔复位并重新轮询', async () => {
    const store = useTaskStore()
    const fetcher = vi
      .fn<(id: number) => Promise<ImportBatch>>()
      .mockRejectedValueOnce(new Error('网络异常，请稍后重试'))
      .mockResolvedValueOnce(batch({ status: 'done' }))

    store.pollImport(3, fetcher)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.imports[3].error).toBe('网络异常，请稍后重试')
    expect(store.imports[3].polling).toBe(false)

    store.pollImport(3, fetcher)
    expect(store.imports[3].error).toBe('')
    expect(store.imports[3].polling).toBe(true)
    expect(store.imports[3].interval).toBe(POLL_INTERVAL_START)

    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(store.imports[3].data?.status).toBe('done')
    expect(store.imports[3].polling).toBe(false)
    expect(store.imports[3].error).toBe('')
  })
})

describe('pollExport 导出任务轮询', () => {
  it('queued/running 继续轮询，终态（expired）后停止', async () => {
    const store = useTaskStore()
    const fetcher = vi
      .fn<(id: number) => Promise<ExportTask>>()
      .mockResolvedValueOnce(exportTask({ status: 'queued' }))
      .mockResolvedValueOnce(exportTask({ status: 'running', progressPct: 60 }))
      .mockResolvedValueOnce(exportTask({ status: 'expired' }))

    store.pollExport(5, fetcher)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledWith(5)
    expect(store.exports[5].data?.status).toBe('queued')
    expect(store.exports[5].polling).toBe(true)

    await vi.advanceTimersByTimeAsync(SECOND_INTERVAL)
    expect(store.exports[5].data?.status).toBe('running')
    expect(store.exports[5].polling).toBe(true)

    await vi.advanceTimersByTimeAsync(SECOND_INTERVAL * 1.5)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(store.exports[5].data?.status).toBe('expired')
    expect(store.exports[5].polling).toBe(false)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MAX * 6)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})

describe('停止与清理', () => {
  it('stopImport / stopExport 移除条目并清理在途定时器', async () => {
    const store = useTaskStore()
    const importFetcher = vi
      .fn<(id: number) => Promise<ImportBatch>>()
      .mockResolvedValue(batch({ status: 'running' }))
    const exportFetcher = vi
      .fn<(id: number) => Promise<ExportTask>>()
      .mockResolvedValue(exportTask({ status: 'running' }))

    store.pollImport(1, importFetcher)
    store.pollExport(2, exportFetcher)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.imports[1].polling).toBe(true)
    expect(store.exports[2].polling).toBe(true)

    store.stopImport(1)
    store.stopExport(2)
    expect(store.imports[1]).toBeUndefined()
    expect(store.exports[2]).toBeUndefined()

    // 已停止的轮询不再打接口
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MAX * 3)
    expect(importFetcher).toHaveBeenCalledTimes(1)
    expect(exportFetcher).toHaveBeenCalledTimes(1)
  })

  it('stopAll() 清空 imports 与 exports', () => {
    const store = useTaskStore()
    store.ensureImport(1)
    store.ensureImport(2)
    store.ensureExport(3)

    store.stopAll()

    expect(store.imports).toEqual({})
    expect(store.exports).toEqual({})
  })
})
