import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import OrderFormView from '@/views/teacher/OrderFormView.vue'
import { useWindowStore } from '@/stores/window'
import type { OrderForm, OrderFormStatus } from '@/types'

/**
 * 填报教材页 · 主动撤回（决策 FE-W3 / 决策文档 D1 口径）。
 *
 * 待审核期间表单只读（禁止无留痕覆盖），要改必须先撤回；撤回入口的可见性由
 * `canWithdraw = status === 'pending_review' && 窗口开放` 决定。本文件覆盖该分支矩阵：
 * pending_review × 窗口开/关、reviewed 终态、以及撤回后（draft + withdrawnAt）的提示。
 *
 * 关窗后不显示按钮是**有意**的：后端 `@WithinWindow` 会 409，且撤回后无法重提
 * 会把表单变成死草稿（D1 默认口径）。
 */
vi.mock('@/api/orderForm', () => ({
  orderFormApi: {
    myCourses: vi.fn(),
    myForm: vi.fn(),
    // onMounted 会预拉一次选书器（`void searchOptions()`）；返回空列表即可，
    // 返回 undefined 会让 `options.value` 变 undefined，模板 `options.length` 抛错
    searchTextbooks: vi.fn().mockResolvedValue([]),
    submit: vi.fn(),
    myHistory: vi.fn(),
    detail: vi.fn(),
    withdraw: vi.fn(),
  },
}))

import { orderFormApi } from '@/api/orderForm'

const myCourses = vi.mocked(orderFormApi.myCourses)
const myForm = vi.mocked(orderFormApi.myForm)
const withdraw = vi.mocked(orderFormApi.withdraw)

function makeForm(status: OrderFormStatus, extra: Partial<OrderForm> = {}): OrderForm {
  return {
    id: 1,
    semesterId: 1,
    semesterName: '2026-2027学年秋季学期',
    teacherId: 1,
    status,
    items: [],
    itemCount: 0,
    totalQuantity: 0,
    ...extra,
  }
}

async function mountPage(form: OrderForm, windowStatus: 'open' | 'not_open' | 'closed') {
  myCourses.mockResolvedValue([])
  myForm.mockResolvedValue(form)

  const wrapper = mount(OrderFormView, { global: { plugins: [ElementPlus] } })
  const windowStore = useWindowStore()
  windowStore.status = windowStatus
  await flushPromises()
  return wrapper
}

/** 撤回按钮（模板中唯一一处「撤回修改」按钮） */
function withdrawButton(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('button').find((btn) => btn.text().includes('撤回修改'))
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
  vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
})

describe('填报页 · 撤回修改入口（canWithdraw 分支矩阵）', () => {
  it('待审核 + 窗口开放 → 显示「撤回修改」按钮，并给出「审核前如需修改，请先撤回」引导', async () => {
    const wrapper = await mountPage(makeForm('pending_review'), 'open')

    expect(wrapper.text()).toContain('已提交，等待教材室审核。审核前如需修改，请先撤回。')
    expect(withdrawButton(wrapper)).toBeTruthy()
  })

  it('待审核 + 窗口已关闭 → 不显示按钮，改为提示联系教材室', async () => {
    const wrapper = await mountPage(makeForm('pending_review'), 'closed')

    expect(withdrawButton(wrapper)).toBeFalsy()
    expect(wrapper.text()).toContain('窗口已关闭，如需修改请联系教材室。')
  })

  it('已通过（reviewed）→ 无撤回按钮，保持终态文案', async () => {
    const wrapper = await mountPage(makeForm('reviewed'), 'open')

    expect(withdrawButton(wrapper)).toBeFalsy()
    expect(wrapper.text()).toContain('本单已定稿，不能再修改或重提')
  })

  it('撤回后（draft + withdrawnAt）→ 提示「已于 … 撤回，修改后请重新提交」', async () => {
    const wrapper = await mountPage(
      makeForm('draft', { withdrawnAt: '2026-09-23T10:15:00' }),
      'open',
    )

    expect(wrapper.text()).toContain('撤回，修改后请重新提交')
    // 草稿态不再有撤回入口（已经撤回了）
    expect(withdrawButton(wrapper)).toBeFalsy()
  })

  it('从未提交的草稿（draft 无 withdrawnAt）→ 不显示撤回提示', async () => {
    const wrapper = await mountPage(makeForm('draft'), 'open')

    expect(wrapper.text()).not.toContain('修改后请重新提交')
  })

  it('确认撤回 → 调 withdraw 并提示成功，随后重新拉取表单', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    withdraw.mockResolvedValue(makeForm('draft', { withdrawnAt: '2026-09-23T10:15:00' }))

    const wrapper = await mountPage(makeForm('pending_review'), 'open')
    const before = myForm.mock.calls.length

    await withdrawButton(wrapper)!.trigger('click')
    await flushPromises()

    expect(withdraw).toHaveBeenCalledTimes(1)
    expect(ElMessage.success).toHaveBeenCalledWith('已撤回，可修改后重新提交')
    // load() 重新拉取，状态由后端回传
    expect(myForm.mock.calls.length).toBeGreaterThan(before)
  })

  it('确认框取消 → 不发请求（不产生数据副作用）', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))

    const wrapper = await mountPage(makeForm('pending_review'), 'open')
    await withdrawButton(wrapper)!.trigger('click')
    await flushPromises()

    expect(withdraw).not.toHaveBeenCalled()
  })

  it('撤回失败（如窗口已关 409）→ 展示后端 message，不静默吞错', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    withdraw.mockRejectedValue(new Error('征订窗口已关闭，无法撤回'))

    const wrapper = await mountPage(makeForm('pending_review'), 'open')
    await withdrawButton(wrapper)!.trigger('click')
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith('征订窗口已关闭，无法撤回')
  })
})
