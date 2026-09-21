<script setup lang="ts" generic="T extends Record<PropertyKey, any>">
import { onMounted, ref, shallowRef } from 'vue'
import { COPY, PAGE_SIZES } from '@/utils/constants'
import type { PageResult } from '@/types'

/**
 * 列表页基座（SPEC §8）：
 * 页面自带筛选区，本组件负责「服务端分页 + 空/载/错三态 + 分页条」的统一实现，
 * 页面只需给出取数函数（`fetcher`，自行把筛选条件映射为接口参数）与列定义（默认插槽）。
 *
 * 约定：
 * 1. **筛选条件变化后由页面显式调用 `reload()`**（经模板 ref 或插槽参数），
 *    不做深度 watch —— 否则输入框每敲一个字都会打一次接口；
 * 2. 请求序号（requestId）保证并发下只采纳最后一次响应（评审 A3：快速切筛选时
 *    先发的慢响应不得覆盖后发的快响应）；
 * 3. 失败不吞错：展示错误态 + 重试入口（页面需自行接管时传 `show-error=false`）。
 *
 * 用法：
 * ```vue
 * <ServerTable ref="tableRef" :fetcher="fetchPage">
 *   <el-table-column prop="name" label="名称" />
 * </ServerTable>
 * ```
 */
const props = withDefaults(
  defineProps<{
    /** 取数函数：组件注入 page/size，其余参数由页面自行拼装 */
    fetcher: (params: { page: number; size: number }) => Promise<PageResult<T>>
    pageSize?: number
    /** 错误态由父级接管时为 false */
    showError?: boolean
    emptyText?: string
    emptyImageSize?: number
    /** el-table 附加属性（max-height / size 等） */
    tableAttrs?: Record<string, unknown>
  }>(),
  { pageSize: 10, showError: true, emptyImageSize: 80 },
)

// shallowRef：行数组整体替换，无需深层响应式（也避免泛型被 UnwrapRef 改写）
const rows = shallowRef<T[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(props.pageSize)
const loading = ref(false)
const error = ref('')

/** 请求序号：并发响应只采纳最后一次（评审 A3） */
let requestId = 0

async function load() {
  const current = ++requestId
  loading.value = true
  error.value = ''
  try {
    const result = await props.fetcher({ page: page.value, size: size.value })
    if (current !== requestId) return
    rows.value = result?.list ?? []
    total.value = result?.total ?? 0
  } catch (e) {
    if (current !== requestId) return
    rows.value = []
    total.value = 0
    error.value = (e as Error)?.message || COPY.FAILED
  } finally {
    if (current === requestId) loading.value = false
  }
}

/** el-pagination 单向绑定，须显式回写页码，否则翻页后仍取第 1 页数据 */
function onPageChange(next: number) {
  page.value = next
  void load()
}

/** 改每页条数后回到第 1 页，并回写 size */
function onSizeChange(next: number) {
  size.value = next
  page.value = 1
  void load()
}

onMounted(load)

/** 重新取数；`resetPage` 默认 true（筛选条件变化时回到第 1 页） */
function reload(resetPage = true) {
  if (resetPage) page.value = 1
  void load()
}

defineExpose({ reload, load, rows, total, page, size, loading, error })
</script>

<template>
  <div class="server-table">
    <div v-if="error && showError" class="server-table-error">
      <el-alert :title="error" type="error" :closable="false" show-icon />
      <el-button class="mt-8" size="small" @click="reload()">重试</el-button>
    </div>
    <template v-else>
      <el-table v-loading="loading" :data="rows" border stripe v-bind="tableAttrs">
        <slot :rows="rows" :loading="loading" :total="total" :reload="reload" />
        <template #empty>
          <el-empty
            :description="emptyText || COPY.EMPTY"
            :image-size="emptyImageSize"
            data-testid="server-table-empty"
          />
        </template>
      </el-table>
      <div v-if="total > 0" class="app-pagination">
        <el-pagination
          :current-page="page"
          :page-size="size"
          :total="total"
          :page-sizes="[...PAGE_SIZES]"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="onPageChange"
          @size-change="onSizeChange"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.server-table-error {
  padding: 16px 0;
}
</style>
