<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ElEmpty } from 'element-plus'
import { COPY } from '@/utils/constants'
import type { PageResult } from '@/types'

/**
 * 列表页基座（SPEC §8）：
 * 筛选区由页面自带；本组件负责 el-table + 服务端分页（page/size）+ 空/载/错三态统一。
 */
export interface ServerTableFetcher {
  (params: Record<string, unknown>): Promise<PageResult<unknown>>
}

const props = withDefaults(
  defineProps<{
    fetcher: ServerTableFetcher
    pageSize?: number
    /** 错误提示由父级接管时为 false */
    showError?: boolean
  }>(),
  { pageSize: 10, showError: true },
)

const query = defineModel<Record<string, unknown>>('query', { default: () => ({}) })

const rows = ref<unknown[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(props.pageSize)
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await props.fetcher({ ...query.value, page: page.value, size: size.value })
    rows.value = result?.list ?? []
    total.value = result?.total ?? 0
  } catch (e) {
    rows.value = []
    total.value = 0
    error.value = (e as Error)?.message || COPY.FAILED
  } finally {
    loading.value = false
  }
}

watch(
  query,
  () => {
    page.value = 1
    void load()
  },
  { deep: true },
)

watch([page, size], () => void load())

onMounted(load)

function reload(resetPage = true) {
  if (resetPage) page.value = 1
  void load()
}

defineExpose({ reload, load, rows, total, page, size, loading, error })
</script>

<template>
  <div class="server-table" v-loading="loading">
    <div v-if="error && showError" class="server-table-error">
      <el-alert :title="error" type="error" :closable="false" show-icon />
      <el-button class="mt-8" size="small" @click="reload()">重试</el-button>
    </div>
    <el-empty
      v-else-if="!loading && rows.length === 0"
      :description="COPY.EMPTY"
      :image-size="90"
    />
    <slot
      v-else
      :rows="rows"
      :total="total"
      :loading="loading"
      :reload="reload"
      :page="page"
      :size="size"
    >
      <el-table :data="rows" stripe border>
        <el-table-column type="index" label="#" width="52" />
      </el-table>
    </slot>
    <div v-if="total > 0" class="app-pagination">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
      />
    </div>
  </div>
</template>

<style scoped>
.server-table-error {
  padding: 16px 0;
}
</style>
