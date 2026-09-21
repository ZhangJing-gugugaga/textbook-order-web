<script setup lang="ts">
import { reactive, ref } from 'vue'

import { reviewApi } from '@/api/orderForm'
import OrderFormItemsTable from '@/components/OrderFormItemsTable.vue'
import ServerTable from '@/components/ServerTable.vue'
import { COPY, ORDER_FORM_STATUS_META, statusMetaOf } from '@/utils/constants'
import { formatDateTime } from '@/utils/format'
import { asRow } from '@/utils/table'
import type { OrderForm, OrderFormListItem } from '@/types'

/**
 * 本院征订记录（PRD 学院秘书-本院征订记录 / API.md §3.6）：
 * GET /api/secretary/order-forms 仅返回本院教师提交的征订单（数据范围由后端隔离），只读；
 * 明细按需拉取详情（越权访问后端 403 并写审计）。
 *
 * 列表分页与三态由 ServerTable 基座承担（SPEC §8）；状态文案统一取
 * ORDER_FORM_STATUS_META，避免本页再维护一份状态字典。
 */
const filters = reactive({
  status: '',
  teacherName: '',
})
const tableRef = ref<{ reload: (resetPage?: boolean) => void } | null>(null)
const detailVisible = ref(false)
const detail = ref<OrderForm | null>(null)
const detailLoading = ref(false)

/** 筛选条件 → 接口参数（空串不下发） */
function fetchPage({ page, size }: { page: number; size: number }) {
  return reviewApi.collegePage({
    status: filters.status || undefined,
    teacherName: filters.teacherName || undefined,
    page,
    size,
  })
}

function search() {
  tableRef.value?.reload()
}

/** 详情请求序号：先发的慢响应不得覆盖后点开的那一行 */
let detailRequestId = 0

async function openDetail(row: OrderFormListItem) {
  const current = ++detailRequestId
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    const result = await reviewApi.detail(row.id)
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

function statusLabel(status: string) {
  return statusMetaOf(ORDER_FORM_STATUS_META, status).label
}
</script>

<template>
  <div class="app-page">
    <div class="app-toolbar">
      <el-select
        v-model="filters.status"
        clearable
        placeholder="全部状态"
        style="width: 170px"
        @change="search"
      >
        <el-option label="待审核" value="pending_review" />
        <el-option label="已通过" value="reviewed" />
        <el-option label="已驳回" value="rejected" />
        <el-option label="字段审查未过" value="rejected_auto" />
      </el-select>
      <el-input
        v-model="filters.teacherName"
        placeholder="教师姓名"
        clearable
        style="width: 180px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button type="primary" @click="search">查询</el-button>
      <span class="text-muted">仅本院教师记录（只读，数据范围由服务端隔离）</span>
    </div>

    <ServerTable ref="tableRef" :fetcher="fetchPage">
      <el-table-column prop="id" label="表单号" width="90" />
      <el-table-column prop="teacherName" label="任课教师" width="120" />
      <el-table-column prop="teacherNo" label="工号" width="110" />
      <el-table-column prop="itemCount" label="明细行数" width="100" align="center" />
      <el-table-column prop="totalQuantity" label="数量合计" width="100" align="center" />
      <el-table-column label="状态" width="130">
        <template #default="{ row }">
          <el-tag size="small" :type="row.status === 'reviewed' ? 'success' : 'info'">
            {{ statusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.submittedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button
            size="small"
            type="primary"
            text
            @click="openDetail(asRow<OrderFormListItem>(row))"
          >
            查看明细
          </el-button>
        </template>
      </el-table-column>
    </ServerTable>

    <el-dialog v-model="detailVisible" title="表单明细（只读）" width="760px" append-to-body>
      <div v-loading="detailLoading">
        <template v-if="detail">
          <el-descriptions :column="3" border size="small" class="mb-16">
            <el-descriptions-item label="表单号">{{ detail.id }}</el-descriptions-item>
            <el-descriptions-item label="学期">{{ detail.semesterName }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              {{ statusLabel(detail.status) }}
            </el-descriptions-item>
            <el-descriptions-item label="提交时间">
              {{ formatDateTime(detail.submittedAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="审核时间">
              {{ formatDateTime(detail.reviewAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="审核人">
              {{ detail.reviewBy ? `#${detail.reviewBy}` : '—' }}
            </el-descriptions-item>
          </el-descriptions>

          <OrderFormItemsTable :items="detail.items" />
          <div class="mt-8 text-muted">
            合计 {{ detail.totalQuantity }} 本 / {{ detail.itemCount }} 行
          </div>
          <div v-if="detail.reviewNote" class="mt-8 text-danger">
            审核意见：{{ detail.reviewNote }}
          </div>
        </template>
      </div>
    </el-dialog>
  </div>
</template>
