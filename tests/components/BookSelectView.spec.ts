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

async function mountPage(books: StudentBook[] = BOOKS, order: unknown = null) {
  bookList.mockResolvedValue(books)
  myOrder.mockResolvedValue(order as never)
  unconfirmed.mockResolvedValue([])
  const wrapper = mount(BookSelectView, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return wrapper
}

/** 取每张教材卡片的勾选态与数量（按渲染顺序，与 books 同序） */
function pickState(wrapper: Awaited<ReturnType<typeof mountPage>>) {
  const checked = wrapper
    .findAllComponents({ name: 'ElCheckbox' })
    .map((c) => c.props('modelValue'))
  const quantity = wrapper
    .findAllComponents({ name: 'ElInputNumber' })
    .map((c) => c.props('modelValue'))
  return { checked, quantity }
}

const REQUIRED_BOOK: StudentBook = {
  textbookId: 1,
  title: '数据结构',
  isbn: '9787111128069',
  price: 45,
  required: true,
} as StudentBook

const OPTIONAL_BOOK: StudentBook = {
  textbookId: 2,
  title: '算法导论',
  isbn: '9787111407010',
  price: 128,
  required: false,
} as StudentBook

const DELISTED_REQUIRED_BOOK: StudentBook = {
  textbookId: 3,
  title: '已下架必修书',
  isbn: '9787111111111',
  price: 60,
  required: true,
  delisted: true,
} as StudentBook

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

/**
 * 必修教材默认勾选 1 本（PRD 选书页字段规范 / W-G1）。
 *
 * 关键约束：**只在首次进入时预勾**。学生提交过一次之后，整单以回显为准——
 * 否则「我明明没勾的书被勾上了」会直接导致误提交。
 */
describe('必修教材默认勾选（W-G1）', () => {
  beforeEach(() => {
    confirmByEntry.mockResolvedValue({ confirmed: 0 })
  })

  it('首次进入（无已提交单）：必修默认勾选且数量 1，非必修不勾', async () => {
    const wrapper = await mountPage([REQUIRED_BOOK, OPTIONAL_BOOK], null)
    const { checked, quantity } = pickState(wrapper)
    expect(checked).toEqual([true, false])
    expect(quantity).toEqual([1, 0])
  })

  it('已提交过的单：整单以回显为准，必修书未在单里就不勾选', async () => {
    const order = { items: [{ textbookId: OPTIONAL_BOOK.textbookId, quantity: 3 }] }
    const wrapper = await mountPage([REQUIRED_BOOK, OPTIONAL_BOOK], order)
    const { checked, quantity } = pickState(wrapper)
    // 必修书未被勾选（回显优先于预勾），非必修书按回显带出数量
    expect(checked).toEqual([false, true])
    expect(quantity).toEqual([0, 3])
  })

  it('已提交过的单：必修书在单里则按回显数量，不覆盖成 1', async () => {
    const order = { items: [{ textbookId: REQUIRED_BOOK.textbookId, quantity: 4 }] }
    const wrapper = await mountPage([REQUIRED_BOOK], order)
    const { checked, quantity } = pickState(wrapper)
    expect(checked).toEqual([true])
    expect(quantity).toEqual([4])
  })

  it('已下架的必修书不预勾选（不可选，预勾会直接触发 BOOK_DELISTED）', async () => {
    const wrapper = await mountPage([DELISTED_REQUIRED_BOOK], null)
    const { checked, quantity } = pickState(wrapper)
    expect(checked).toEqual([false])
    expect(quantity).toEqual([0])
  })
})
