<script setup lang="ts">
import { ref } from 'vue'
import { orderFormApi } from '@/api/orderForm'
import { formatMoney, formatDateTime } from '@/utils/format'
import { COPY } from '@/utils/constants'
import type { OrderForm } from '@/types'

/** 本院征订记录（PRD 学院秘书-本院征订记录）：仅本院教师提交的征订单及明细，只读 */
const query = ref<{ status: string; keyword: string; page: number; size: number }>({
  status: '',
  keyword: '',
  page: 1,
  size: 10,
})
const rows = ref<OrderForm[]>([])
const total = ref(0)
const loading = ref(false)
const detailVisible = ref(false)
const detail = ref<OrderForm | null>(null)

async function load() {
  loading.value = true
  try {
    const result = await orderFormApi.page({
      status: query.value.status || undefined,
      keyword: query.value.keyword || undefined,
      page: query.value.page,
      size: query.value.size,
    })
    rows.value = result.list
    total.value = result.total
  } catch {
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function search() {
  query.value.page = 1
  void load()
}

async function openDetail(row: OrderForm) {
  detailVisible.value = true
  detail.value = row
  try {
    detail.value = await orderFormApi.detail(row.id)
  } catch {
    detail.value = row
  }
}

const STATUS_LABELS: Record<
  string,
  { label: string; type: 'success' | 'danger' | 'warning' | 'info' }
> = {
  draft: { label: '草稿', type: 'info' },
  pending_review: { label: '待复核', type: 'warning' },
  reviewed: { label: '已复核', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
}

load()
</script>

<template>
  <div class="app-page">
    <div class="app-toolbar">
      <el-select
        v-model="query.status"
        clearable
        placeholder="审查状态"
        style="width: 160px"
        @change="search"
      >
        <el-option label="待复核" value="pending_review" />
        <el-option label="已复核" value="reviewed" />
        <el-option label="已驳回" value="rejected" />
      </el-select>
      <el-input
        v-model="query.keyword"
        placeholder="教师 / 课程 / 教材"
        clearable
        style="width: 220px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button type="primary" @click="search">查询</el-button>
      <span class="text-muted">本页为只读视图，数据范围由后端按学院隔离</span>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column prop="id" label="表单号" width="90" />
      <el-table-column prop="teacherName" label="任课教师" width="120" />
      <el-table-column prop="collegeName" label="学院" min-width="140" />
      <el-table-column label="明细行数" width="100" align="center">
        <template #default="{ row }">{{ row.items.length }}</template>
      </el-table-column>
      <el-table-column label="数量合计" width="100" align="center">
        <template #default="{ row }">
          {{ row.items.reduce((s: number, i: { quantity: number }) => s + i.quantity, 0) }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="STATUS_LABELS[row.status].type" size="small">
            {{ STATUS_LABELS[row.status].label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="primary" text @click="openDetail(row)">查看明细</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="app-pagination">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.size"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        @current-change="load"
        @size-change="search"
      />
    </div>
    <el-empty v-if="!loading && rows.length === 0" :description="COPY.EMPTY" :image-size="80" />

    <el-dialog v-model="detailVisible" title="征订明细" width="720px" append-to-body>
      <template v-if="detail">
        <el-descriptions :column="3" border size="small" class="mb-16">
          <el-descriptions-item label="表单号">{{ detail.id }}</el-descriptions-item>
          <el-descriptions-item label="任课教师">{{ detail.teacherName }}</el-descriptions-item>
          <el-descriptions-item label="学院">{{ detail.collegeName }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">
            {{ formatDateTime(detail.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="审核人">{{ detail.reviewedBy || '—' }}</el-descriptions-item>
          <el-descriptions-item label="审核意见">
            {{ detail.reviewComment || '—' }}
          </el-descriptions-item>
        </el-descriptions>
        <el-table :data="detail.items" size="small" border stripe>
          <el-table-column prop="courseName" label="课程" min-width="140" />
          <el-table-column prop="className" label="班级" width="140" />
          <el-table-column
            prop="textbookTitle"
            label="教材"
            min-width="160"
            show-overflow-tooltip
          />
          <el-table-column prop="isbn" label="ISBN" width="150" />
          <el-table-column label="单价" width="100">
            <template #default="{ row }">{{ formatMoney(row.price) }}</template>
          </el-table-column>
          <el-table-column prop="quantity" label="数量" width="90" />
        </el-table>
      </template>
    </el-dialog>
  </div>
</template>
