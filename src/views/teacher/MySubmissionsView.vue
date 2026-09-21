<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { orderFormApi } from '@/api/orderForm'
import { formatDateTime } from '@/utils/format'
import { COPY, ORDER_FORM_STATUS_META, statusMetaOf } from '@/utils/constants'
import OrderFormItemsTable from '@/components/OrderFormItemsTable.vue'
import { asRow } from '@/utils/table'
import type { OrderForm, OrderFormListItem } from '@/types'

/**
 * 我的提交记录（PRD 任课老师-我的提交记录 / API.md §3.6）：
 * GET /api/teacher/order-forms 返回本人跨学期全部记录（服务端不分页），
 * 明细与审查轨迹按需拉取 GET /api/admin/order-forms/{id}；无导出。
 */
const rows = ref<OrderFormListItem[]>([])
const loading = ref(false)
const statusFilter = ref('')
const detailVisible = ref(false)
const detail = ref<OrderForm | null>(null)
const detailLoading = ref(false)
/** 详情请求序号：连点两条记录时只采纳最后一次响应（评审 A3） */
let detailRequestId = 0

async function load() {
  loading.value = true
  try {
    rows.value = await orderFormApi.myHistory()
  } catch (error) {
    rows.value = []
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    loading.value = false
  }
}

/** 服务端返回全量，状态筛选在前端做 */
const filtered = computed(() =>
  statusFilter.value ? rows.value.filter((row) => row.status === statusFilter.value) : rows.value,
)

async function openDetail(row: OrderFormListItem) {
  const current = ++detailRequestId
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    const result = await orderFormApi.detail(row.id)
    if (current !== detailRequestId) return
    detail.value = result
  } catch (error) {
    if (current !== detailRequestId) return
    ElMessage.error((error as Error)?.message || COPY.FAILED)
    detailVisible.value = false
  } finally {
    if (current === detailRequestId) detailLoading.value = false
  }
}

/** 审查状态轨迹（按时间线还原两级审查过程） */
interface TimelineStep {
  title: string
  time?: string
  done: boolean
}

function timeline(form: OrderForm): TimelineStep[] {
  const steps: TimelineStep[] = [{ title: '提交', time: form.submittedAt, done: true }]
  if (form.fieldCheckResult?.length) {
    steps.push({
      title: `系统字段审查未通过（${form.fieldCheckResult.length} 项）`,
      time: form.submittedAt,
      done: true,
    })
  }
  if (form.status === 'pending_review') {
    steps.push({ title: '超管内容审核（待处理）', done: false })
  }
  if (form.status === 'reviewed') {
    steps.push({ title: '超管内容审核 · 通过', time: form.reviewAt, done: true })
  }
  if (form.status === 'rejected') {
    steps.push({ title: '超管内容审核 · 驳回', time: form.reviewAt, done: true })
  }
  if (form.status === 'rejected_auto') {
    steps.push({ title: '系统字段审查未过（可修复重提）', time: form.reviewAt, done: true })
  }
  return steps
}

function statusMeta(status: string) {
  return statusMetaOf(ORDER_FORM_STATUS_META, status)
}

onMounted(load)
</script>

<template>
  <div class="app-page">
    <div class="app-toolbar">
      <el-select v-model="statusFilter" clearable placeholder="审查状态" style="width: 170px">
        <el-option label="待审核" value="pending_review" />
        <el-option label="已通过" value="reviewed" />
        <el-option label="已驳回" value="rejected" />
        <el-option label="字段审查未过" value="rejected_auto" />
      </el-select>
      <el-button @click="load">刷新</el-button>
      <span class="text-muted">本页仅本人记录（跨学期），无导出入口</span>
    </div>

    <el-table v-loading="loading" :data="filtered" border stripe>
      <el-table-column prop="id" label="表单号" width="90" />
      <el-table-column prop="semesterName" label="学期" min-width="200" show-overflow-tooltip />
      <el-table-column prop="itemCount" label="明细行数" width="100" align="center" />
      <el-table-column prop="totalQuantity" label="数量合计" width="100" align="center" />
      <el-table-column label="状态" width="130">
        <template #default="{ row }">
          <el-tag :type="statusMeta(row.status).type" size="small">
            {{ statusMeta(row.status).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.submittedAt) }}</template>
      </el-table-column>
      <el-table-column label="审核时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.reviewAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button
            size="small"
            type="primary"
            text
            @click="openDetail(asRow<OrderFormListItem>(row))"
          >
            明细与轨迹
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :description="COPY.EMPTY" :image-size="80" />
      </template>
    </el-table>

    <el-dialog v-model="detailVisible" title="提交明细与审查轨迹" width="760px" append-to-body>
      <div v-loading="detailLoading">
        <template v-if="detail">
          <div class="flex-between mb-8">
            <span class="text-muted">{{ detail.semesterName }}</span>
            <el-tag :type="statusMeta(detail.status).type" size="small">
              {{ statusMeta(detail.status).label }}
            </el-tag>
          </div>
          <OrderFormItemsTable :items="detail.items" />

          <h4 class="mt-16">审查轨迹</h4>
          <el-timeline>
            <el-timeline-item
              v-for="(step, index) in timeline(detail)"
              :key="index"
              :type="step.done ? 'success' : 'info'"
              :timestamp="step.time ? formatDateTime(step.time) : '待处理'"
            >
              {{ step.title }}
            </el-timeline-item>
          </el-timeline>

          <div v-if="detail.reviewNote" class="mt-8 text-danger">
            审核意见：{{ detail.reviewNote }}
          </div>
          <div v-if="detail.correctDeadline" class="mt-8 text-muted">
            补正截止：{{ formatDateTime(detail.correctDeadline) }}
          </div>
        </template>
      </div>
    </el-dialog>
  </div>
</template>
