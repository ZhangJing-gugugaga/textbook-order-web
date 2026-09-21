<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useTaskStore } from '@/stores/task'
import { exportTaskApi } from '@/api/exportTask'
import { downloadExportTask, triggerBrowserDownload, type ExportDispatch } from '@/api/http'

/**
 * 导出按钮（SPEC §8 / API.md §3.10）：
 * 同步/异步由后端 export.sync_row_threshold 裁决——前端不预估行数，
 * 以响应 Content-Type 分流：xlsx 流直接下载；JSON 则建任务 → 轮询 → 一次性 token 下载。
 * 异步受理体只需含 taskId（四类导出与供货商导出同形）。
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
    task.pollExport(accepted.taskId, exportTaskApi.progress)
    ElMessage.info('数据量较大，已创建导出任务，完成后自动下载')
  } catch (error) {
    ElMessage.error((error as Error)?.message || '导出失败请重试')
  } finally {
    running.value = false
  }
}

/** 轮询失败重试：再次 poll 会清空 error 并从初始间隔重新开始（评审 Q6） */
function retryPolling() {
  if (taskId.value) task.pollExport(taskId.value, exportTaskApi.progress)
}

// 异步任务完成 → 自动下载一次性授权链接
watch(
  () => taskState.value?.data?.status,
  async (status) => {
    if (!status || !taskId.value) return
    if (status === 'done') {
      const id = taskId.value
      try {
        // 统一走 api/http 的 downloadExportTask（此前本文件自行拼同一 URL，helper 无人引用）
        const file = await downloadExportTask(
          id,
          task.exports[id]?.data?.downloadToken ?? '',
          `${props.name}.xlsx`,
        )
        triggerBrowserDownload(file.blob, file.fileName || `${props.name}.xlsx`)
        ElMessage.success('已下载，导出行为已记录')
        emit('done', 'async')
      } catch (error) {
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
      <el-button class="mt-8" size="small" @click="retryPolling">重试</el-button>
    </el-alert>
  </span>
</template>

<style scoped>
.export-button {
  display: inline-block;
}
</style>
