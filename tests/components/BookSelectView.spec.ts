import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import BookSelectView from '@/views/student/BookSelectView.vue'
import type { StudentBook } from '@/types'

/**
 * 选书页「进入即确认收到」（决策 FE-W6 / BE-5g）。
 *
 * 语义要点（必须锁死，否则会被"优化"掉）：
 *   1. 只有**清单加载成功之后**才调 `confirmByEntry`——清单都没出来就记「已收到」不符合语义；
 *   2. 失败**静默**：这是弹窗主触达之外的兜底能力，不得弹错、不得阻塞选书主流程；
 *   3. 有新确认时刷新未确认队列（让被确认的任务从阻塞弹窗队列消失）；
 *   4. 接口幂等由后端保证，前端重复进入不重复记录。
 */
vi.mock('@/api/studentOrder', () => ({
  studentOrderApi: { bookList: vi.fn(), myOrder: vi.fn(), submit: vi.fn() },
}))
vi.mock('@/api/notice', () => ({
  noticeApi: { confirmByEntry: vi.fn(), unconfirmed: vi.fn() },
}))

import { studentOrderApi } from '@/api/studentOrder'
import { noticeApi } from '@/api/notice'

const bookList = vi.mocked(studentOrderApi.bookList)
const myOrder = vi.mocked(studentOrderApi.myOrder)
const confirmByEntry = vi.mocked(noticeApi.confirmByEntry)
const unconfirmed = vi.mocked(noticeApi.unconfirmed)

const BOOKS: StudentBook[] = [
  {
    textbookId: 1,
    title: '数据结构',
    isbn: '9787111128069',
    price: 45,
    required: true,
  } as StudentBook,
]

async function mountPage(books: StudentBook[] = BOOKS) {
  bookList.mockResolvedValue(books)
  myOrder.mockResolvedValue(null)
  unconfirmed.mockResolvedValue([])
  const wrapper = mount(BookSelectView, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
})

describe('选书页入口确认（FE-W6）', () => {
  it('清单加载成功后调用 confirmByEntry', async () => {
    confirmByEntry.mockResolvedValue({ confirmed: 0 })
    await mountPage()
    expect(bookList).toHaveBeenCalled()
    expect(confirmByEntry).toHaveBeenCalledTimes(1)
  })

  it('清单为空时不调用（清单都没出来，不应记「已收到」）', async () => {
    confirmByEntry.mockResolvedValue({ confirmed: 0 })
    await mountPage([])
    expect(confirmByEntry).not.toHaveBeenCalled()
  })

  it('有新确认时刷新未确认队列（被确认任务应从阻塞弹窗队列消失）', async () => {
    confirmByEntry.mockResolvedValue({ confirmed: 2 })
    await mountPage()
    // 队列刷新 = 再次拉 /notice/unconfirmed
    expect(unconfirmed).toHaveBeenCalled()
  })

  it('无新确认时不刷新队列（避免无谓请求）', async () => {
    confirmByEntry.mockResolvedValue({ confirmed: 0 })
    await mountPage()
    expect(unconfirmed).not.toHaveBeenCalled()
  })

  it('接口失败静默：不弹错、页面仍可用', async () => {
    confirmByEntry.mockRejectedValue(new Error('服务开小差了'))
    const wrapper = await mountPage()
    await flushPromises()
    // 静默兜底：不得弹错
    expect(ElMessage.error).not.toHaveBeenCalled()
    // 页面仍渲染教材清单
    expect(wrapper.text()).toContain('数据结构')
  })
})
