import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ElAlert, ElPagination, ElTableColumn } from 'element-plus'
import { h } from 'vue'
import ServerTable from '@/components/ServerTable.vue'
import type { PageResult } from '@/types'

/**
 * ServerTable 列表基座（SPEC §8）：
 * 首屏取数、空/载/错三态、`reload()` 语义，以及**请求序号保证**——
 * 并发下只采纳最后一次发出的请求（评审 A3：快速切筛选时先发的慢响应
 * 不得覆盖后发的快响应）。
 */

interface Row {
  id: number
  name: string
}

type Fetcher = (params: { page: number; size: number }) => Promise<PageResult<Row>>

function page(list: Row[], overrides: Partial<PageResult<Row>> = {}): PageResult<Row> {
  return { list, page: 1, size: 10, total: list.length, totalPages: 1, ...overrides }
}

/** 手动控制 resolve/reject 时机的 Promise（构造「先发后到」的并发场景） */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function mountTable(
  fetcher: Fetcher,
  props: Partial<{ pageSize: number; showError: boolean; emptyText: string }> = {},
) {
  return mount(ServerTable, {
    props: { fetcher, ...props },
    slots: { default: () => h(ElTableColumn, { prop: 'name', label: '名称' }) },
    global: { plugins: [createPinia()] },
  })
}

describe('ServerTable 取数与三态', () => {
  it('挂载即取第 1 页，并渲染返回的行', async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      page(
        [
          { id: 1, name: '高等数学（上册）' },
          { id: 2, name: '大学英语（第三版）' },
        ],
        { total: 2 },
      ),
    )
    const wrapper = mountTable(fetcher)

    await vi.waitFor(() => expect(wrapper.text()).toContain('高等数学（上册）'))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith({ page: 1, size: 10 })
    expect(wrapper.text()).toContain('大学英语（第三版）')
    expect(wrapper.vm.rows).toHaveLength(2)
    expect(wrapper.vm.total).toBe(2)
    // total > 0 才展示分页条，且分页条读到的是返回的 total
    expect(wrapper.findComponent(ElPagination).props('total')).toBe(2)
    wrapper.unmount()
  })

  it('reload() 回到第 1 页并重新取数；reload(false) 保留当前页', async () => {
    const fetcher = vi.fn<Fetcher>(async ({ page: current }) =>
      page([{ id: current, name: `第${current}页数据` }], { page: current, total: 30 }),
    )
    const wrapper = mountTable(fetcher)

    await vi.waitFor(() => expect(wrapper.text()).toContain('第1页数据'))
    expect(fetcher).toHaveBeenLastCalledWith({ page: 1, size: 10 })

    // 移到第 3 页后 reload(false)：保留页码，仅重新取数
    wrapper.vm.page = 3
    wrapper.vm.reload(false)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(fetcher).toHaveBeenLastCalledWith({ page: 3, size: 10 })
    await vi.waitFor(() => expect(wrapper.text()).toContain('第3页数据'))

    // 默认 reload()：回到第 1 页
    wrapper.vm.reload()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(fetcher).toHaveBeenLastCalledWith({ page: 1, size: 10 })
    expect(wrapper.vm.page).toBe(1)
    await vi.waitFor(() => expect(wrapper.text()).toContain('第1页数据'))
    wrapper.unmount()
  })

  /**
   * 翻页回归：el-pagination 是单向绑定（:current-page / :page-size + 事件），
   * 组件必须把事件参数回写到内部 page/size，否则分页器高亮第 N 页、
   * 数据却永远停在第一页（历史缺陷）。
   */
  it('分页器翻页与改每页条数都会驱动重新取数', async () => {
    const fetcher = vi.fn<Fetcher>(async ({ page: current, size }) =>
      page([{ id: current, name: `第${current}页/${size}条` }], { page: current, total: 100 }),
    )
    const wrapper = mountTable(fetcher)
    // 等 DOM 真正完成首屏渲染（分页条 v-if="total > 0"，需 total 已回填）
    await vi.waitFor(() => expect(wrapper.text()).toContain('第1页/10条'))

    // 按组件名查找：组件由 unplugin-vue-components 从 'element-plus/es' 解析，
    // 与测试直接 import 的 'element-plus' 不是同一个模块实例，故不能用引用比对
    const pagination = wrapper.findComponent({ name: 'ElPagination' })
    expect(pagination.exists()).toBe(true)

    // 翻到第 2 页
    pagination.vm.$emit('current-change', 2)
    await vi.waitFor(() => expect(fetcher).toHaveBeenLastCalledWith({ page: 2, size: 10 }))
    expect(wrapper.vm.page).toBe(2)
    await vi.waitFor(() => expect(wrapper.text()).toContain('第2页/10条'))

    // 改成每页 20 条：size 生效且回到第 1 页
    pagination.vm.$emit('size-change', 20)
    await vi.waitFor(() => expect(fetcher).toHaveBeenLastCalledWith({ page: 1, size: 20 }))
    expect(wrapper.vm.size).toBe(20)
    expect(wrapper.vm.page).toBe(1)
    await vi.waitFor(() => expect(wrapper.text()).toContain('第1页/20条'))

    wrapper.unmount()
  })

  it('请求序号：先发的慢响应不得覆盖后发请求的结果', async () => {
    const slow = deferred<PageResult<Row>>()
    const fast = deferred<PageResult<Row>>()
    const fetcher = vi
      .fn<Fetcher>()
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)

    const wrapper = mountTable(fetcher)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

    // 第二次请求（如筛选条件变化后的 reload）与第一次请求并发在途
    wrapper.vm.reload()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))

    // 后发的先返回 → 采纳
    fast.resolve(page([{ id: 2, name: '第二次请求的数据' }], { total: 1 }))
    await vi.waitFor(() => expect(wrapper.text()).toContain('第二次请求的数据'))

    // 先发的慢响应后返回 → 必须被丢弃（否则表格会显示过期数据）
    slow.resolve(page([{ id: 1, name: '第一次请求的过期数据' }], { total: 99 }))
    await flushPromises()

    expect(wrapper.text()).not.toContain('第一次请求的过期数据')
    expect(wrapper.text()).toContain('第二次请求的数据')
    expect(wrapper.vm.rows).toEqual([{ id: 2, name: '第二次请求的数据' }])
    expect(wrapper.vm.total).toBe(1)
    expect(wrapper.vm.loading).toBe(false)
    wrapper.unmount()
  })

  it('取数失败：渲染错误提示与重试按钮，点击重试后恢复', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockRejectedValueOnce(new Error('网络异常，请稍后重试'))
      .mockResolvedValueOnce(page([{ id: 1, name: '高等数学（上册）' }], { total: 1 }))

    const wrapper = mountTable(fetcher)
    await vi.waitFor(() => expect(wrapper.findComponent(ElAlert).exists()).toBe(true))

    const alert = wrapper.findComponent(ElAlert)
    expect(alert.props('type')).toBe('error')
    expect(alert.props('title')).toBe('网络异常，请稍后重试')
    expect(wrapper.text()).toContain('网络异常，请稍后重试')
    expect(wrapper.vm.error).toBe('网络异常，请稍后重试')
    expect(wrapper.vm.rows).toEqual([])

    const retry = wrapper.findAll('button').find((button) => button.text().includes('重试'))
    expect(retry).toBeDefined()
    await retry?.trigger('click')

    await vi.waitFor(() => expect(wrapper.text()).toContain('高等数学（上册）'))
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenLastCalledWith({ page: 1, size: 10 })
    expect(wrapper.vm.error).toBe('')
    expect(wrapper.findComponent(ElAlert).exists()).toBe(false)
    wrapper.unmount()
  })

  it('show-error=false：错误态由父级接管，不渲染错误提示', async () => {
    const fetcher = vi.fn<Fetcher>().mockRejectedValue(new Error('接口不可用'))

    const wrapper = mountTable(fetcher, { showError: false })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await flushPromises()

    // 状态仍然写入（父级可读取），只是不渲染
    expect(wrapper.vm.error).toBe('接口不可用')
    expect(wrapper.findComponent(ElAlert).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('接口不可用')
    expect(wrapper.findAll('button').some((button) => button.text().includes('重试'))).toBe(false)
    wrapper.unmount()
  })
})
