<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useTaskStore, isTerminalTaskError } from '@/stores/task'
import { exportTaskApi } from '@/api/exportTask'
import {
  downloadExportTask,
  triggerBrowserDownload,
  type ExportDispatch,
  type FileResult,
} from '@/api/http'
import type { ExportTask } from '@/types'

/**
 * 导出按钮（SPEC §8 / API.md §3.10）：
 * 同步/异步由后端 export.sync_row_threshold 裁决——前端不预估行数，
 * 以响应 Content-Type 分流：xlsx 流直接下载；JSON 则建任务 → 轮询 → 一次性 token 下载。
 * 异步受理体只需含 taskId（四类导出与供货商导出同形）。
 *
 * 轮询与下载端点**按角色注入**：超管/秘书用内部 `/api/export-task/{id}`，
 * 供货商必须用物理隔离的 `/api/supplier/export-task/{id}`（`supplier:order:export`）。
 * 此前本组件把内部端点写死，供货商异步导出会打到不属于它的端点。
 *
 * 一次性 token 的硬约束（A6）：token **在下载开始时即被消费**——下载中途失败、
 * 或文件已过保留期，token 就没了，必须重新导出。因此这里**不重试同一个 token**，
 * 失败即提示重新导出。`downloadToken` 只在任务所有者的轮询响应里、且任务完成后才有。
 *
 * 按钮级权限统一由本组件的 `code` 属性承担（无权限码移除 DOM），
 * 页面不再各写一套内联 computed（评审 A2）。
 */
const props = withDefaults(
  defineProps<{
    /** 导出名称（异步任务文件名兜底） */
    name: string
    /** 导出实现（返回 file | async 两种形态） */
    exporter: () => Promise<ExportDispatch<{ taskId: number }>>
    /** 按钮级权限码：无权限时移除 DOM */
    code?: string | string[]
    /** 异步任务进度查询（默认内部端点；供货商传 supplierApi.taskProgress） */
    progress?: (taskId: number) => Promise<ExportTask>
    /** 一次性授权下载（默认内部端点；供货商传 supplierApi.taskDownload） */
    download?: (taskId: number, token: string, fallbackName?: string) => Promise<FileResult>
    type?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
    size?: 'large' | 'default' | 'small'
    text?: boolean
  }>(),
  { type: 'primary', size: 'default', text: false },
)

const emit = defineEmits<{ (e: 'done', mode: 'sync' | 'async'): void }>()

const auth = useAuthStore()
const task = useTaskStore()
const running = ref(false)
const taskId = ref<number | null>(null)

const progressFetcher = computed(() => props.progress ?? exportTaskApi.progress)
const downloadFetcher = computed(() => props.download ?? downloadExportTask)

/** 按钮级权限：无权限码移除 DOM（SPEC §4） */
const allowed = computed(() => {
  if (!props.code) return true
  const codes = Array.isArray(props.code) ? props.code : [props.code]
  return codes.some((code) => auth.has(code))
})

const taskState = computed(() => (taskId.value ? task.exports[taskId.value] : undefined))
const label = computed(() => {
  const status = taskState.value?.data?.status
  if (status === 'queued' || status === 'running') {
    return `导出中 ${taskState.value?.data?.progressPct ?? 0}%`
  }
  return '导出'
})

async function run() {
  if (running.value) return
  running.value = true
  try {
    const result = await props.exporter()
    if (result.kind === 'file') {
      triggerBrowserDownload(result.blob, result.fileName || `${props.name}.xlsx`)
      ElMessage.success('已下载，导出行为已记录')
      emit('done', 'sync')
      return
    }
    const accepted = result.data
    taskId.value = accepted.taskId
    task.pollExport(accepted.taskId, progressFetcher.value)
    ElMessage.info('数据量较大，已创建导出任务，完成后自动下载')
  } catch (error) {
    ElMessage.error((error as Error)?.message || '导出失败请重试')
  } finally {
    running.value = false
  }
}

/** 轮询失败重试：再次 poll 会清空 error 并从初始间隔重新开始（评审 Q6） */
function retryPolling() {
  if (taskId.value) task.pollExport(taskId.value, progressFetcher.value)
}

/** 终态失败（404 归属失败 / 403 / 410 token 已消费）不给重试入口（A5） */
const canRetryPolling = computed(() => !isTerminalTaskError(taskState.value?.errorCode ?? ''))

// 异步任务完成 → 自动下载一次性授权链接
watch(
  () => taskState.value?.data?.status,
  async (status) => {
    if (!status || !taskId.value) return
    if (status === 'done') {
      const id = taskId.value
      const token = task.exports[id]?.data?.downloadToken
      // downloadToken 仅在任务所有者的响应里出现：拿不到就别发请求，
      // 否则只会拿到 410 并把一次性机会浪费掉
      if (!token) {
        ElMessage.error('未取到下载凭证，请重新导出')
        task.stopExport(id)
        taskId.value = null
        return
      }
      try {
        const file = await downloadFetcher.value(id, token, `${props.name}.xlsx`)
        triggerBrowserDownload(file.blob, file.fileName || `${props.name}.xlsx`)
        ElMessage.success('已下载，导出行为已记录')
        emit('done', 'async')
      } catch (error) {
        // token 已在下载开始时被消费：此处不能重试，只能重新导出
        ElMessage.error((error as Error)?.message || '导出下载失败，请重新导出')
      } finally {
        task.stopExport(id)
        taskId.value = null
      }
    } else if (status === 'failed' || status === 'expired') {
      ElMessage.error(
        taskState.value?.data?.errorMsg ||
          (status === 'expired' ? '导出文件已过期，请重新导出' : '导出失败请重试'),
      )
      task.stopExport(taskId.value)
      taskId.value = null
    }
  },
)

// 组件卸载即停止轮询，避免离开页面后仍在打接口（评审 Q8：与 ImportWizard 对齐）
onUnmounted(() => {
  if (taskId.value) task.stopExport(taskId.value)
})

defineExpose({ run })
</script>

<template>
  <span v-if="allowed" class="export-button">
    <el-button :type="type" :size="size" :text="text" :loading="running" @click="run">
      {{ label }}
    </el-button>
    <el-alert
      v-if="taskState?.error"
      class="mt-8"
      :title="`进度查询失败：${taskState.error}`"
      type="error"
      :closable="false"
      show-icon
      data-testid="export-poll-error"
    >
      <!-- 404（任务不存在/不属于本人）与 410 是终态：重试必然再失败，只给「重新导出」 -->
      <el-button v-if="canRetryPolling" class="mt-8" size="small" @click="retryPolling">
        重试
      </el-button>
      <span v-else class="text-muted">该任务已不可访问，请重新导出。</span>
    </el-alert>
  </span>
</template>

<style scoped>
.export-button {
  display: inline-block;
}
</style>
