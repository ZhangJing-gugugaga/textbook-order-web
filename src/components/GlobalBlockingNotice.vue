<script setup lang="ts">
import { computed, onMounted } from 'vue'

import { storeToRefs } from 'pinia'
import { useNoticeStore } from '@/stores/notice'
import { COPY } from '@/utils/constants'

/**
 * 阻塞弹窗通知（PRD 功能 4 / SPEC §8）：
 * 打开 Web 拉取未确认通知，自绘居中 Modal 逐条弹出，点「收到」确认后放行；
 * 确认失败弹窗保留可重试；拉取失败 fail-open 放行（02 §3.3）。
 * 说明：按 PRD 要求自绘 Modal（非浏览器原生弹窗、不依赖 el-dialog 离场过渡）。
 */
const notice = useNoticeStore()
const { queue, current, confirming } = storeToRefs(notice)

onMounted(() => {
  if (!notice.loaded) void notice.fetchUnconfirmed()
})

const visible = computed(() => notice.loaded && queue.value.length > 0)
const progressText = computed(() =>
  queue.value.length > 1 ? `还有 ${queue.value.length} 条通知待确认` : '',
)

async function confirm() {
  if (!current.value) return
  try {
    await notice.confirm(current.value.taskId)
  } catch (error) {
    // 确认失败：弹窗保留，可重试，不放行
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}
</script>

<template>
  <div
    v-if="visible"
    class="blocking-notice-mask"
    data-testid="blocking-notice"
    role="dialog"
    aria-modal="true"
    aria-label="新通知"
  >
    <div class="blocking-notice-dialog">
      <div class="blocking-notice-header">
        <el-icon :size="20" color="var(--el-color-primary)"><Bell /></el-icon>
        <span class="blocking-notice-heading">新通知</span>
      </div>

      <div class="blocking-notice-title">{{ current?.title }}</div>
      <div class="blocking-notice-content">{{ current?.content }}</div>
      <div class="blocking-notice-meta">
        来源：{{ current?.source === 'system_window_change' ? '系统（窗口变更）' : '教材室' }} ·
        {{ current?.createdAt }}
      </div>
      <div v-if="progressText" class="blocking-notice-meta">{{ progressText }}</div>

      <div class="blocking-notice-footer">
        <el-button type="primary" :loading="confirming" @click="confirm">收到</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.blocking-notice-dialog {
  width: 480px;
  max-width: calc(100vw - 48px);
  background: #ffffff;
  border-radius: 10px;
  padding: 24px;
  box-shadow: 0 18px 48px rgba(15, 18, 35, 0.24);
}

.blocking-notice-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid #eef0f6;
}

.blocking-notice-heading {
  font-size: 16px;
  font-weight: 600;
}

.blocking-notice-title {
  font-size: 16px;
  font-weight: 600;
  margin: 16px 0 12px;
}

.blocking-notice-content {
  font-size: 14px;
  line-height: 1.7;
  color: #333a4d;
  white-space: pre-wrap;
}

.blocking-notice-meta {
  margin-top: 12px;
  font-size: 12px;
  color: #8a90a2;
}

.blocking-notice-footer {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
</style>
