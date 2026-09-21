<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { orderFormApi } from '@/api/orderForm'
import { exportTaskApi } from '@/api/exportTask'
import ExportButton from '@/components/ExportButton.vue'
import { triggerBrowserDownload } from '@/api/http'
import { COPY } from '@/utils/constants'
import { formatDateTime } from '@/utils/format'
import type { OrderForm } from '@/types'

/**
 * 导出中心（PRD 教材室-导出中心 / 02 §6.2 Q16）：
 * 全院征订明细、通知汇总等多维度组合导出；
 * ≤5000 行同步下载，>5000 行建 export_task + 轮询 + 一次性授权下载链接。
 */
const activeTab = ref<'order' | 'notice' | 'student'>('order')

/* ---------------- 全院征订明细 ---------------- */
const orderQuery = ref<{ status: string; keyword: string; page: number; size: number }>({
  status: '',
  keyword: '',
  page: 1,
  size: 10,
})
const orderRows = ref<OrderForm[]>([])
const orderTotal = ref(0)
const orderLoading = ref(false)

async function loadOrders() {
  orderLoading.value = true
  try {
    const result = await orderFormApi.page({
      status: orderQuery.value.status || undefined,
      keyword: orderQuery.value.keyword || undefined,
      page: orderQuery.value.page,
      size: orderQuery.value.size,
    })
    orderRows.value = result.list
    orderTotal.value = result.total
  } catch {
    orderRows.value = []
    orderTotal.value = 0
  } finally {
    orderLoading.value = false
  }
}

function searchOrders() {
  orderQuery.value.page = 1
  void loadOrders()
}

/* ---------------- 通知汇总 ---------------- */
const noticeRows = ref<Record<string, unknown>[]>([])
const noticeLoading = ref(false)

async function loadNotices() {
  noticeLoading.value = true
  try {
    const { noticeApi } = await import('@/api/notice')
    const tasks = await noticeApi.tasks()
    noticeRows.value = tasks as unknown as Record<string, unknown>[]
  } catch {
    noticeRows.value = []
  } finally {
    noticeLoading.value = false
  }
}

const exportTypes = [
  {
    key: 'order-detail',
    name: '全院征订明细',
    desc: '教师表单全量明细：课程 × 班级 × 教材 × 数量，含审查状态',
    estimatedRows: 100,
  },
  {
    key: 'college-summary',
    name: '各学院汇总',
    desc: '按学院统计提交进度、复核情况与学生选购完成度',
    estimatedRows: 10,
  },
  {
    key: 'student-order',
    name: '学生选购明细',
    desc: '学生选购全量记录（含班级、品种、金额）',
    estimatedRows: 100,
  },
  {
    key: 'notice-summary',
    name: '通知确认汇总',
    desc: '通知任务发送/确认/失败名单汇总',
    estimatedRows: 20,
  },
  {
    key: 'supplier-sheet',
    name: '供货商订购清单（分学院 sheet）',
    desc: '仅 书名/ISBN/教师姓名/学院 四类字段，一个学院一个 sheet',
    estimatedRows: 100,
  },
]

async function downloadExport(item: (typeof exportTypes)[number]) {
  try {
    const blob = await exportTaskApi.syncDownload({
      name: item.name,
      params: { type: item.key },
    })
    triggerBrowserDownload(blob, `${item.name}.xlsx`)
    ElMessage.success('已下载，导出行为已记录')
  } catch {
    ElMessage.error('导出失败请重试')
  }
}

loadOrders()
loadNotices()
</script>

<template>
  <div class="app-page">
    <h3 class="mb-16">导出类型</h3>
    <div class="export-grid">
      <div v-for="item in exportTypes" :key="item.key" class="export-card">
        <div class="export-name">{{ item.name }}</div>
        <div class="export-desc">{{ item.desc }}</div>
        <div class="flex-between mt-8">
          <span class="text-muted">预估 {{ item.estimatedRows }} 行</span>
          <ExportButton
            :name="item.name"
            :estimated-rows="item.estimatedRows"
            :params="{ type: item.key }"
            size="small"
          />
        </div>
      </div>
    </div>
    <el-alert
      class="mt-16"
      title="预估 ≤5000 行同步下载；>5000 行创建异步导出任务，完成后通过一次性授权链接下载。每次导出后端均审计留痕。"
      type="info"
      :closable="false"
      show-icon
    />

    <el-tabs v-model="activeTab" class="mt-16">
      <el-tab-pane label="全院征订明细" name="order">
        <div class="app-toolbar">
          <el-select
            v-model="orderQuery.status"
            clearable
            placeholder="审查状态"
            style="width: 160px"
            @change="searchOrders"
          >
            <el-option label="待复核" value="pending_review" />
            <el-option label="已复核" value="reviewed" />
            <el-option label="已驳回" value="rejected" />
          </el-select>
          <el-input
            v-model="orderQuery.keyword"
            placeholder="教师 / 课程 / 教材"
            clearable
            style="width: 220px"
            @keyup.enter="searchOrders"
            @clear="searchOrders"
          />
          <el-button type="primary" @click="searchOrders">查询</el-button>
          <el-button @click="downloadExport(exportTypes[0])">直接下载</el-button>
        </div>
        <el-table v-loading="orderLoading" :data="orderRows" border stripe>
          <el-table-column prop="id" label="表单号" width="90" />
          <el-table-column prop="teacherName" label="任课教师" width="120" />
          <el-table-column prop="collegeName" label="学院" min-width="140" />
          <el-table-column label="明细行数" width="100" align="center">
            <template #default="{ row }">{{ row.items.length }}</template>
          </el-table-column>
          <el-table-column label="提交时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
        <div class="app-pagination">
          <el-pagination
            v-model:current-page="orderQuery.page"
            v-model:page-size="orderQuery.size"
            :total="orderTotal"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next"
            background
            @current-change="loadOrders"
            @size-change="searchOrders"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="通知汇总" name="notice">
        <el-table v-loading="noticeLoading" :data="noticeRows" border stripe>
          <el-table-column prop="id" label="任务号" width="90" />
          <el-table-column prop="title" label="标题" min-width="180" show-overflow-tooltip />
          <el-table-column prop="totalCount" label="应发送" width="100" align="center" />
          <el-table-column prop="sentCount" label="已发送" width="100" align="center" />
          <el-table-column prop="confirmedCount" label="已确认" width="100" align="center" />
          <el-table-column prop="failedCount" label="失败" width="90" align="center" />
        </el-table>
        <el-empty
          v-if="!noticeLoading && noticeRows.length === 0"
          :description="COPY.EMPTY"
          :image-size="70"
        />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.export-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.export-card {
  border: 1px solid #e9ebf2;
  border-radius: 8px;
  padding: 14px;
}

.export-name {
  font-weight: 600;
  margin-bottom: 6px;
}

.export-desc {
  font-size: 12px;
  color: #8a90a2;
  line-height: 1.6;
  min-height: 38px;
}
</style>
