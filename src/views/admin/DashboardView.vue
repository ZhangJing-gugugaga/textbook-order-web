<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { dashboardApi } from '@/api/dashboard'
import { useWindowStore } from '@/stores/window'
import { COPY } from '@/utils/constants'
import { formatCountdown } from '@/utils/format'
import type { DashboardStats } from '@/types'

/** 数据看板（PRD 教材室-数据看板 / 02 §6.2） */
const windowStore = useWindowStore()
const stats = ref<DashboardStats | null>(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    stats.value = await dashboardApi.stats()
  } catch {
    stats.value = null
  } finally {
    loading.value = false
  }
}

function pct(part: number, total: number) {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <div class="stat-grid mb-16">
      <div class="stat-card">
        <div class="stat-label">当前学期</div>
        <div class="stat-value">{{ stats?.semesterName || '—' }}</div>
        <div class="stat-sub">窗口状态：{{ windowStore.status }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">待复核表单</div>
        <div class="stat-value">{{ stats?.pendingReviewCount ?? 0 }}</div>
        <div class="stat-sub">教师提交后待超管内容审核</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">未确认通知</div>
        <div class="stat-value">{{ stats?.unconfirmedNoticeCount ?? 0 }}</div>
        <div class="stat-sub">打开 Web 阻塞弹窗确认</div>
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
        <div class="stat-sub">截止时间 {{ windowStore.windowEnd || '—' }}</div>
      </div>
    </div>

    <div class="app-page">
      <h3 class="mb-16">各学院提交进度</h3>
      <el-table :data="stats?.colleges ?? []" border stripe>
        <el-table-column prop="collegeName" label="学院" min-width="140" />
        <el-table-column label="教师表单" align="center">
          <template #default="{ row }">{{ row.submitted }} / {{ row.teacherTotal }}</template>
        </el-table-column>
        <el-table-column label="教师提交进度" min-width="200">
          <template #default="{ row }">
            <el-progress :percentage="pct(row.submitted, row.teacherTotal)" :stroke-width="10" />
          </template>
        </el-table-column>
        <el-table-column label="学生选购" align="center">
          <template #default="{ row }">{{ row.studentOrdered }} / {{ row.studentTotal }}</template>
        </el-table-column>
        <el-table-column label="学生选购进度" min-width="200">
          <template #default="{ row }">
            <el-progress
              :percentage="pct(row.studentOrdered, row.studentTotal)"
              :stroke-width="10"
            />
          </template>
        </el-table-column>
        <el-table-column label="已复核" align="center" width="110">
          <template #default="{ row }">{{ row.reviewed }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !stats" :description="COPY.EMPTY" />
    </div>
  </div>
</template>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
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
