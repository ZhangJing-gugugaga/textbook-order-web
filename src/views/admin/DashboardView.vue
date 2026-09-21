<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { dashboardApi } from '@/api/dashboard'
import { useWindowStore } from '@/stores/window'
import { COPY, WINDOW_STATUS } from '@/utils/constants'
import { formatCountdown, formatDateTime } from '@/utils/format'
import type { DashboardStats } from '@/types'

/**
 * 数据看板（PRD 教材室-数据看板 / API.md §3.12）：
 * 窗口状态 + 各学院教师提交进度 + 待复核/未确认/学生选购汇总。
 * 服务端下发 serverTime，倒计时以服务端时钟为准（不信任本地时钟）。
 */
const windowStore = useWindowStore()
const stats = ref<DashboardStats | null>(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    stats.value = await dashboardApi.stats()
  } catch (error) {
    stats.value = null
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    loading.value = false
  }
}

function pct(part: number, total: number) {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

const windowLabel = (status: string | null | undefined) =>
  status ? (WINDOW_STATUS[status as keyof typeof WINDOW_STATUS] ?? status) : '—'

onMounted(() => {
  void windowStore.fetch()
  void load()
})
</script>

<template>
  <div v-loading="loading">
    <div class="flex-between mb-16">
      <h3>数据看板</h3>
      <el-button size="small" @click="load">刷新</el-button>
    </div>

    <div class="stat-grid mb-16">
      <div class="stat-card">
        <div class="stat-label">当前学期</div>
        <div class="stat-value stat-value-sm">
          {{ stats?.semesterId ? `#${stats.semesterId}` : '未设置 active 学期' }}
        </div>
        <div class="stat-sub">
          窗口状态：{{ windowLabel(stats?.windowStatus ?? windowStore.status) }}
          <template v-if="stats?.channelOpen !== null && stats?.channelOpen !== undefined">
            ｜学生通道：{{ stats.channelOpen === 1 ? '开放' : '关闭' }}
          </template>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">待复核表单</div>
        <div class="stat-value">{{ stats?.pendingReviewTotal ?? 0 }}</div>
        <div class="stat-sub">教师提交后待超管内容审核</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">未确认通知</div>
        <div class="stat-value">{{ stats?.unconfirmedNoticeTotal ?? 0 }}</div>
        <div class="stat-sub">打开 Web 阻塞弹窗确认</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">学生选购提交</div>
        <div class="stat-value">
          {{ stats?.studentSubmittedTotal ?? 0 }} / {{ stats?.studentOrderTotal ?? 0 }}
        </div>
        <div class="stat-sub">已提交选购单 / 应有选购单</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">窗口剩余</div>
        <div class="stat-value stat-value-sm">
          {{
            windowStore.status === 'open'
              ? formatCountdown(windowStore.remainMs)
              : windowStore.status === 'not_open'
                ? formatCountdown(windowStore.startRemainMs)
                : '已截止'
          }}
        </div>
        <div class="stat-sub">截止时间 {{ formatDateTime(windowStore.windowEnd) }}</div>
      </div>
    </div>

    <div class="app-page">
      <h3 class="mb-16">各学院提交进度</h3>
      <el-table :data="stats?.colleges ?? []" border stripe>
        <el-table-column prop="collegeName" label="学院" min-width="150" />
        <el-table-column label="教师表单" align="center" width="120">
          <template #default="{ row }">{{ row.submitted }} / {{ row.teacherTotal }}</template>
        </el-table-column>
        <el-table-column label="教师提交进度" min-width="200">
          <template #default="{ row }">
            <el-progress :percentage="pct(row.submitted, row.teacherTotal)" :stroke-width="10" />
          </template>
        </el-table-column>
        <el-table-column label="待复核" align="center" width="100">
          <template #default="{ row }">{{ row.pendingReview }}</template>
        </el-table-column>
        <el-table-column label="已通过" align="center" width="100">
          <template #default="{ row }">{{ row.reviewed }}</template>
        </el-table-column>
        <el-table-column label="已驳回" align="center" width="100">
          <template #default="{ row }">{{ row.rejected }}</template>
        </el-table-column>
        <template #empty>
          <el-empty :description="COPY.EMPTY" :image-size="80" />
        </template>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
}

.stat-card {
  background: #ffffff;
  border: 1px solid #e9ebf2;
  border-radius: 8px;
  padding: 16px;
}

.stat-label {
  font-size: 13px;
  color: #8a90a2;
}

.stat-value {
  font-size: 26px;
  font-weight: 700;
  margin: 6px 0 4px;
  color: #1f2430;
}

.stat-value-sm {
  font-size: 18px;
}

.stat-sub {
  font-size: 12px;
  color: #8a90a2;
}
</style>
