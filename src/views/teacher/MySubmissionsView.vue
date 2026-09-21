<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { orderFormApi } from '@/api/orderForm'
import { formatDateTime } from '@/utils/format'
import { COPY } from '@/utils/constants'
import type { OrderForm } from '@/types'

/** 我的提交记录（PRD 任课老师-我的提交记录）：历史学期列表 + 明细 + 审查状态轨迹；无导出 */
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
    const result = await orderFormApi.myPage({
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

function openDetail(row: OrderForm) {
  detail.value = row
  detailVisible.value = true
}

/** 审查状态轨迹（按时间线还原两级审查过程） */
interface TimelineStep {
  title: string
  time: string
  done: boolean
  result?: OrderForm['fieldCheck']
}

function timeline(form: OrderForm): TimelineStep[] {
  const steps: TimelineStep[] = [
    { title: '提交', time: form.createdAt, done: true },
    { title: '系统字段审查', time: form.createdAt, done: true, result: form.fieldCheck },
  ]
  if (form.status === 'pending_review') {
    steps.push({ title: '超管内容审核', time: '', done: false })
  }
  if (form.status === 'reviewed') {
    steps.push({ title: '超管内容审核 · 通过', time: form.updatedAt, done: true })
  }
  if (form.status === 'rejected') {
    steps.push({ title: '超管内容审核 · 驳回', time: form.updatedAt, done: true })
  }
  return steps
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

onMounted(load)
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
        placeholder="课程 / 教材"
        clearable
        style="width: 220px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button type="primary" @click="search">查询</el-button>
      <span class="text-muted">本页仅本人记录，无导出入口</span>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column prop="id" label="表单号" width="90" />
      <el-table-column label="课程 × 班级" min-width="200">
        <template #default="{ row }">
          <span v-for="(item, index) in row.items.slice(0, 2)" :key="item.id">
            <span v-if="index">、</span>
            {{ item.courseName }}·{{ item.className }}
          </span>
          <span v-if="row.items.length > 2" class="text-muted">等 {{ row.items.length }} 项</span>
        </template>
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
          <el-button size="small" type="primary" text @click="openDetail(row)">
            明细与轨迹
          </el-button>
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

    <el-dialog v-model="detailVisible" title="提交明细与审查轨迹" width="720px" append-to-body>
      <template v-if="detail">
        <h4>明细</h4>
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
          <el-table-column prop="quantity" label="数量" width="90" />
        </el-table>

        <h4 class="mt-16">审查轨迹</h4>
        <el-timeline>
          <el-timeline-item
            v-for="(step, index) in timeline(detail)"
            :key="index"
            :type="step.done ? 'success' : 'info'"
            :timestamp="step.time ? formatDateTime(step.time) : '待处理'"
          >
            {{ step.title }}
            <span v-if="step.result" class="text-muted">
              （{{ step.result.filter((r) => r.passed).length }}/{{ step.result.length }} 项通过）
            </span>
          </el-timeline-item>
        </el-timeline>

        <div v-if="detail.reviewComment" class="mt-8 text-danger">
          审核意见：{{ detail.reviewComment }}
        </div>
      </template>
    </el-dialog>
  </div>
</template>
