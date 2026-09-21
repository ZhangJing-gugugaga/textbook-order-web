<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import { reviewApi } from '@/api/orderForm'
import { noticeApi } from '@/api/notice'
import { exportApi } from '@/api/exportTask'
import { ApiError } from '@/api/http'
import { orgApi } from '@/api/semester'
import ExportButton from '@/components/ExportButton.vue'
import ServerTable from '@/components/ServerTable.vue'
import { COPY, PERMISSIONS } from '@/utils/constants'
import { formatDateTime } from '@/utils/format'
import type { College, NoticeTask } from '@/types'

/**
 * 导出中心（PRD 教材室-导出中心 / API.md §3.10）：
 * 三类超管导出（教师征订明细 / 学生选购汇总 / 通知汇总）。
 * 同步/异步由后端 export.sync_row_threshold 裁决，前端不预估行数：
 * xlsx 流直接下载；JSON 则建任务 → 轮询 → 一次性 token 下载。
 */
const activeTab = ref<'order' | 'notice'>('order')
const colleges = ref<College[]>([])
const selectedCollegeId = ref<number | undefined>(undefined)

/* ---------------- 全院征订明细 ---------------- */
const orderFilters = reactive({ status: '', teacherName: '' })
const orderTableRef = ref<{ reload: (resetPage?: boolean) => void } | null>(null)

/** 筛选条件 → 接口参数（空串不下发），分页由 ServerTable 注入 */
function fetchOrders({ page, size }: { page: number; size: number }) {
  return reviewApi.page({
    status: orderFilters.status || undefined,
    collegeId: selectedCollegeId.value,
    teacherName: orderFilters.teacherName || undefined,
    page,
    size,
  })
}

function searchOrders() {
  orderTableRef.value?.reload()
}

/* ---------------- 通知汇总 ---------------- */
const noticeTasks = ref<NoticeTask[]>([])
const noticeLoading = ref(false)

async function loadNotices() {
  noticeLoading.value = true
  try {
    noticeTasks.value = await noticeApi.tasks()
  } catch (error) {
    noticeTasks.value = []
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    noticeLoading.value = false
  }
}

const exportTypes = [
  {
    key: 'order',
    name: '教师征订明细',
    desc: '教师表单全量明细：课程 × 班级 × 教材 × 数量，含审查状态；可按学院筛选',
    code: PERMISSIONS.EXPORT_ORDER,
    run: () => exportApi.orders({ collegeId: selectedCollegeId.value }),
  },
  {
    key: 'student',
    name: '学生选购汇总',
    desc: '参考用量汇总：学院 / 班级 / ISBN / 书名 / 学生数 / 数量合计',
    code: PERMISSIONS.EXPORT_STUDENT,
    run: () => exportApi.students({}),
  },
  {
    key: 'notice',
    name: '通知汇总',
    desc: '通知任务各轮发送时间/状态、确认状态/时间，含未授权线下兜底名单',
    code: PERMISSIONS.EXPORT_NOTICE,
    run: () => {
      if (!noticeTasks.value.length) {
        ElMessage.warning('本学期暂无通知任务，无法导出通知汇总')
        return Promise.reject(
          new ApiError('本学期暂无通知任务，无法导出通知汇总', 'NO_NOTICE_TASK'),
        )
      }
      return exportApi.notice({ taskId: noticeTasks.value[0].id })
    },
  },
]

onMounted(async () => {
  colleges.value = await orgApi.colleges().catch(() => [])
  // 征订明细由 ServerTable 自行首屏取数，这里只加载通知任务（导出按钮依赖）
  await loadNotices()
})
</script>

<template>
  <div class="app-page">
    <div class="flex-between mb-16">
      <h3>导出中心</h3>
      <el-select
        v-model="selectedCollegeId"
        clearable
        placeholder="全部学院（征订明细可按学院导出）"
        style="width: 300px"
        @change="searchOrders"
      >
        <el-option
          v-for="college in colleges"
          :key="college.id"
          :label="college.name"
          :value="college.id"
        />
      </el-select>
    </div>

    <div class="export-grid">
      <div v-for="item in exportTypes" :key="item.key" class="export-card">
        <div class="export-name">{{ item.name }}</div>
        <div class="export-desc">{{ item.desc }}</div>
        <div class="flex-between mt-8">
          <span class="text-muted">服务端裁决同步/异步</span>
          <ExportButton :name="item.name" :code="item.code" :exporter="item.run" size="small" />
        </div>
      </div>
    </div>
    <el-alert
      class="mt-16"
      title="行数 ≤ 阈值（默认 5000）同步下载 xlsx；超过则创建异步导出任务，完成后通过一次性授权链接自动下载。每次导出后端均审计留痕。"
      type="info"
      :closable="false"
      show-icon
    />

    <el-tabs v-model="activeTab" class="mt-16">
      <el-tab-pane label="全院征订明细" name="order">
        <div class="app-toolbar">
          <el-select
            v-model="orderFilters.status"
            clearable
            placeholder="审查状态"
            style="width: 170px"
            @change="searchOrders"
          >
            <el-option label="待审核" value="pending_review" />
            <el-option label="已通过" value="reviewed" />
            <el-option label="已驳回" value="rejected" />
          </el-select>
          <el-input
            v-model="orderFilters.teacherName"
            placeholder="教师姓名"
            clearable
            style="width: 180px"
            @keyup.enter="searchOrders"
            @clear="searchOrders"
          />
          <el-button type="primary" @click="searchOrders">查询</el-button>
        </div>
        <ServerTable ref="orderTableRef" :fetcher="fetchOrders">
          <el-table-column prop="id" label="表单号" width="90" />
          <el-table-column prop="teacherName" label="任课教师" width="120" />
          <el-table-column prop="collegeName" label="学院" min-width="140" />
          <el-table-column prop="itemCount" label="明细行数" width="100" align="center" />
          <el-table-column prop="totalQuantity" label="数量合计" width="100" align="center" />
          <el-table-column label="提交时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.submittedAt) }}</template>
          </el-table-column>
        </ServerTable>
      </el-tab-pane>

      <el-tab-pane label="通知汇总" name="notice">
        <el-table v-loading="noticeLoading" :data="noticeTasks" border stripe>
          <el-table-column prop="id" label="任务号" width="90" />
          <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
          <el-table-column prop="targetRoles" label="发送对象" width="140" />
          <el-table-column prop="roundLimit" label="重发上限" width="110" align="center" />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'active' ? 'warning' : 'info'">
                {{ row.status === 'active' ? '进行中' : '已关闭' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <template #empty>
            <el-empty :description="COPY.EMPTY" :image-size="70" />
          </template>
        </el-table>
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
