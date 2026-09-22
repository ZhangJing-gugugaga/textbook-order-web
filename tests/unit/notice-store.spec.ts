import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/http'
import { useNoticeStore } from '@/stores/notice'
import { CODE } from '@/utils/constants'
import type { UnconfirmedNotice } from '@/types'

/**
 * 通知 store（交接文档 A3）：
 * - 后端按 `notice_task.target_roles` 定向，只返回面向本人角色的通知（ADMIN 全量）。
 *   **空队列是正常状态**，不是故障——不得当错误处理或触发重试（供货商恒为空属预期）。
 * - confirm 返回 404（该任务已不在本人定向范围内）→ 摘除该条并放行，
 *   否则用户会对着一个永远 404 的弹窗反复点「收到」。
 */
const unconfirmed = vi.fn()
const confirm = vi.fn()
vi.mock('@/api/notice', () => ({
  noticeApi: {
    unconfirmed: () => unconfirmed(),
    confirm: (...args: unknown[]) => confirm(...args),
    mine: vi.fn(),
    tasks: vi.fn(),
    createTask: vi.fn(),
    closeTask: vi.fn(),
    progress: vi.fn(),
    failures: vi.fn(),
  },
}))

function notice(taskId: number): UnconfirmedNotice {
  return { taskId, title: `通知${taskId}`, content: '内容', source: 'manual', roundStopped: false }
}

describe('notice store · 定向语义与空队列', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    unconfirmed.mockReset()
    confirm.mockReset()
  })

  it('空队列是正常状态：loaded=true 且无错误、不阻塞', async () => {
    unconfirmed.mockResolvedValue([])
    const store = useNoticeStore()

    await store.fetchUnconfirmed()

    expect(store.queue).toEqual([])
    expect(store.loaded).toBe(true)
    expect(store.hasUnconfirmed).toBe(false)
    expect(store.current).toBeNull()
  })

  it('拉取失败 fail-open：按暂无通知降级，仍标记已拉取（不阻塞用户）', async () => {
    unconfirmed.mockRejectedValue(new ApiError('网络异常', 'NETWORK_ERROR'))
    const store = useNoticeStore()

    await store.fetchUnconfirmed()

    expect(store.queue).toEqual([])
    expect(store.loaded).toBe(true)
  })

  it('确认成功：该条出队', async () => {
    unconfirmed.mockResolvedValue([notice(1), notice(2)])
    confirm.mockResolvedValue(undefined)
    const store = useNoticeStore()
    await store.fetchUnconfirmed()

    await store.confirm(1)

    expect(store.queue.map((n) => n.taskId)).toEqual([2])
    expect(store.current?.taskId).toBe(2)
  })

  it('确认 404（任务已不在本人定向范围内）：摘除该条并放行，不永久卡住弹窗', async () => {
    unconfirmed.mockResolvedValue([notice(9)])
    confirm.mockRejectedValue(new ApiError('资源不存在', CODE.NOT_FOUND))
    const store = useNoticeStore()
    await store.fetchUnconfirmed()

    await expect(store.confirm(9)).resolves.toBeUndefined()

    expect(store.queue).toEqual([])
    expect(store.confirming).toBe(false)
  })

  it('确认其他失败（如网络异常）：弹窗保留，抛出以便界面提示并允许重试', async () => {
    unconfirmed.mockResolvedValue([notice(5)])
    confirm.mockRejectedValue(new ApiError('网络异常，请稍后重试', 'NETWORK_ERROR'))
    const store = useNoticeStore()
    await store.fetchUnconfirmed()

    await expect(store.confirm(5)).rejects.toThrow('网络异常')

    expect(store.queue.map((n) => n.taskId)).toEqual([5])
    expect(store.confirming).toBe(false)
  })

  it('队列按 popup_queue_max 截断（默认 5，保留最新 5 条）', async () => {
    unconfirmed.mockResolvedValue([1, 2, 3, 4, 5, 6, 7].map(notice))
    const store = useNoticeStore()

    await store.fetchUnconfirmed()

    expect(store.queue).toHaveLength(5)
    expect(store.queue.map((n) => n.taskId)).toEqual([1, 2, 3, 4, 5])
  })
})
