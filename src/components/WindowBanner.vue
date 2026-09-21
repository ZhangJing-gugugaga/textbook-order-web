<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useWindowStore } from '@/stores/window'
import { useCountdown } from '@/composables/useCountdown'
import { formatCountdown, windowStatusText } from '@/utils/format'

/**
 * 全局窗口三态横幅（PRD 功能 2 / SPEC §8）：
 * not_open / open / closed 文案与倒计时；closed 时提示可查看历史记录。
 *
 * 倒计时用 `useCountdown` 每秒重算——该组合式函数在卸载时清理计时器，
 * 不再出现「登出/登录循环后计时器泄漏」（评审 Q8）。
 */
const windowStore = useWindowStore()
const { status } = storeToRefs(windowStore)

const remain = useCountdown(() => windowStore.remainMs)
const startRemain = useCountdown(() => windowStore.startRemainMs)

const text = computed(() => windowStatusText(status.value, remain.value, startRemain.value))
const alertType = computed<'success' | 'warning' | 'info'>(() => {
  if (status.value === 'open') return 'success'
  if (status.value === 'closed') return 'warning'
  return 'info'
})
const countdownText = computed(() => {
  if (status.value === 'not_open') return `距开始 ${formatCountdown(startRemain.value)}`
  if (status.value === 'open') return `距截止 ${formatCountdown(remain.value)}`
  return ''
})
</script>

<template>
  <div v-if="windowStore.canView" class="window-banner" data-testid="window-banner">
    <el-alert :title="text" :type="alertType" :closable="false" show-icon>
      <template v-if="countdownText" #title>
        <span>{{ text }}（{{ countdownText }}）</span>
      </template>
    </el-alert>
  </div>
</template>

<style scoped>
.window-banner {
  flex: 1;
  min-width: 0;
}

.window-banner :deep(.el-alert__title) {
  font-size: 13px;
}
</style>
