<script setup lang="ts">
import { onMounted } from 'vue'
import { useWindowStore } from '@/stores/window'
import { formatDateTime } from '@/utils/format'
import { WINDOW_STATUS } from '@/utils/constants'

/**
 * 窗口状态（秘书，只读 / API.md §3.2）：
 * 秘书仅有 semester:window:view，故只消费 GET /api/semester/window/status
 * （学期列表与窗口变更记录属超管权限，秘书端不展示）。
 * 倒计时以服务端 serverTime 为准，不信任本地时钟。
 */
const windowStore = useWindowStore()

onMounted(() => {
  void windowStore.fetch()
  windowStore.startPolling()
})
</script>

<template>
  <div class="app-page">
    <div class="flex-between mb-16">
      <h3>当前窗口状态（只读）</h3>
      <el-button size="small" @click="windowStore.fetch()">刷新</el-button>
    </div>

    <!-- 窗口三态横幅由全局 WindowBanner 统一渲染，本页只展示明细 -->
    <el-descriptions :column="2" border>
      <el-descriptions-item label="当前学期">
        {{ windowStore.semesterName || '未设置 active 学期' }}
      </el-descriptions-item>
      <el-descriptions-item label="窗口状态">
        <el-tag
          :type="
            windowStore.status === 'open'
              ? 'success'
              : windowStore.status === 'closed'
                ? 'warning'
                : 'info'
          "
        >
          {{ WINDOW_STATUS[windowStore.status] ?? windowStore.status }}
        </el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="窗口开始">
        {{ formatDateTime(windowStore.windowStart) }}
      </el-descriptions-item>
      <el-descriptions-item label="窗口截止">
        {{ formatDateTime(windowStore.windowEnd) }}
      </el-descriptions-item>
      <el-descriptions-item label="学生选购通道">
        <el-tag :type="windowStore.channelOpen === 1 ? 'success' : 'info'" size="small">
          {{ windowStore.channelOpen === 1 ? '开放' : '关闭' }}
        </el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="服务器时间">
        {{ formatDateTime(windowStore.serverTime) }}
      </el-descriptions-item>
    </el-descriptions>

    <el-alert
      class="mt-16"
      title="窗口的开启、截止与延长由教材室操作，变更会自动通知全员；本页仅供查看。"
      type="info"
      :closable="false"
      show-icon
    />
  </div>
</template>
