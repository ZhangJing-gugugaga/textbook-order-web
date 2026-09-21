<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import { useTaskStore } from '@/stores/task'
import { exportTaskApi } from '@/api/exportTask'
import { triggerBrowserDownload } from '@/api/http'
import { shouldUseAsyncExport } from '@/utils/constants'

/**
 * 导出按钮（SPEC §8 / Q16）：
 * 预估 ≤5000 行同步下载；>5000 行建 export_task + 轮询 + 一次性授权链接下载。
 */
const props = withDefaults(
  defineProps<{
    /** 导出名称（用于任务与文件名） */
    name: string
    /** 预估行数，用于阈值分流 */
    estimatedRows?: number
    /** 同步导出请求体 */
    params?: Record<string, unknown>
    /** 按钮级权限码：无权限时移除 DOM */
    code?: string | string[]
    /** 自定义同步导出实现（默认走 /exports/sync） */
    syncDownloader?: (data: { name: string; params: Record<string, unknown> }) => Promise<Blob>
    type?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
    size?: 'large' | 'default' | 'small'
    text?: boolean
  }>(),
  { estimatedRows: 0, params: () => ({}), type: 'primary', size: 'default', text: false },
)

const emit = defineEmits<{ (e: 'done', mode: 'sync' | 'async'): void }>()

const config = useConfigStore()
const auth = useAuthStore()
const task = useTaskStore()
const running = ref(false)
const taskId = ref('')

/** 按钮级权限：无权限码移除 DOM（SPEC §4） */
const allowed = computed(() => {
  if (!props.code) return true
  const codes = Array.isArray(props.code) ? props.code : [props.code]
  return codes.some((code) => auth.has(code))
})

const useAsync = computed(() => shouldUseAsyncExport(props.estimatedRows, config.exportSyncMaxRows))
const taskState = computed(() => (taskId.value ? task.exports[taskId.value] : undefined))

async function run() {
  if (running.value) return
  running.value = true
  try {
    if (!useAsync.value) {
      const downloader = props.syncDownloader ?? exportTaskApi.syncDownload
      const blob = await downloader({ name: props.name, params: props.params })
      triggerBrowserDownload(blob, `${props.name}.xlsx`)
      ElMessage.success('已下载，导出行为已记录')
      emit('done', 'sync')
      return
    }

    const created = await exportTaskApi.create({
      name: props.name,
      params: props.params,
      estimatedRows: props.estimatedRows,
    })
    taskId.value = created.taskId
    task.pollExport(created.taskId, exportTaskApi.progress)
    ElMessage.info('数据量较大，已创建导出任务，完成后自动下载')
  } catch {
    ElMessage.error('导出失败请重试')
  } finally {
    running.value = false
  }
}

// 异步任务完成后自动下载一次性授权链接
watch(
  () => taskState.value?.data?.status,
  async (status) => {
    if (!status || !taskId.value) return
    if (status === 'success') {
      try {
        const blob = await exportTaskApi.download(taskId.value)
        triggerBrowserDownload(blob, `${props.name}.xlsx`)
        ElMessage.success('已下载，导出行为已记录')
        emit('done', 'async')
      } catch {
        ElMessage.error('导出失败请重试')
      } finally {
        task.stopExport(taskId.value)
      }
    } else if (status === 'failed') {
      ElMessage.error('导出失败请重试')
      task.stopExport(taskId.value)
    }
  },
)

const label = computed(() => {
  if (taskState.value?.data?.status === 'running' || taskState.value?.data?.status === 'pending') {
    return `导出中 ${taskState.value.data.progressPct}%`
  }
  return '导出'
})
</script>

<template>
  <el-button v-if="allowed" :type="type" :size="size" :text="text" :loading="running" @click="run">
    {{ label }}
  </el-button>
</template>
