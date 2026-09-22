<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

import { useConfigStore } from '@/stores/config'
import { useTaskStore, isTerminalTaskError } from '@/stores/task'
import { triggerBrowserDownload } from '@/api/http'
import { COPY } from '@/utils/constants'
import type { ImportBatch } from '@/types'

/**
 * Excel 异步导入（PRD 功能 5 / SPEC §8）：
 * 上传（.xlsx ≤ import.max_file_mb）→ 批次轮询进度（/api/batch/{id}）→
 * 结果摘要 + 错误明细下载（/api/batch/{id}/errors）+ 错误行预览。
 * 禁用前端解析；导入逻辑全部在服务端。
 */
const emit = defineEmits<{
  (e: 'uploaded', batchId: number): void
  (e: 'finished', batch: ImportBatch): void
}>()

const props = defineProps<{
  title: string
  uploader: (file: File) => Promise<{ batchId: number }>
  poller: (batchId: number) => Promise<ImportBatch>
  errorDownloader?: (batchId: number) => Promise<{ blob: Blob; fileName: string }>
  /** 模板下载（后端文件流，需带鉴权头，故用按钮而非 <a href>） */
  templateDownloader?: () => Promise<{ blob: Blob; fileName: string }>
}>()

const config = useConfigStore()
const task = useTaskStore()

const uploading = ref(false)
const batchId = ref<number | null>(null)
const state = computed(() => (batchId.value ? task.imports[batchId.value] : undefined))
const batch = computed(() => state.value?.data ?? null)
const polling = computed(() => state.value?.polling ?? false)
const progress = computed(() => batch.value?.progressPct ?? 0)
const errorRows = computed(() => batch.value?.errorDetail ?? [])
/** 轮询失败：必须展示并提供重试，否则界面表现为进度条永久卡住（评审 Q6） */
const pollError = computed(() => state.value?.error ?? '')
/** 终态失败（批次不存在/不属于本人 → 404，A5）不给重试入口：重试必然再失败 */
const canRetryPolling = computed(() => !isTerminalTaskError(state.value?.errorCode ?? ''))

watch(
  () => batch.value?.status,
  (status) => {
    if (status && status !== 'running' && batch.value) emit('finished', batch.value)
  },
)

const statusText = computed(() => {
  if (!batch.value) return ''
  if (batch.value.status === 'running') return `正在解析，已完成 ${batch.value.progressPct ?? 0}%`
  if (batch.value.status === 'failed') return '解析失败，请下载错误明细核对后重试'
  const ok = batch.value.okCount ?? 0
  const bad = batch.value.errorCount ?? 0
  return `导入完成：成功 ${ok} 行，失败 ${bad} 行`
})

const statusType = computed<'info' | 'success' | 'warning' | 'error'>(() => {
  if (!batch.value) return 'info'
  if (batch.value.status === 'running') return 'info'
  if (batch.value.status === 'failed') return 'error'
  return (batch.value.errorCount ?? 0) > 0 ? 'warning' : 'success'
})

onUnmounted(() => {
  if (batchId.value) task.stopImport(batchId.value)
})

async function handleFile(file: File) {
  if (!/\.xlsx$/i.test(file.name)) {
    ElMessage.error('仅支持 .xlsx 文件')
    return false
  }
  if (file.size > config.importMaxSizeMb * 1024 * 1024) {
    ElMessage.error(`文件大小超过 ${config.importMaxSizeMb}MB 限制`)
    return false
  }
  uploading.value = true
  try {
    const result = await props.uploader(file)
    batchId.value = result.batchId
    emit('uploaded', result.batchId)
    task.pollImport(result.batchId, props.poller)
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    uploading.value = false
  }
  return false
}

async function downloadErrors() {
  if (!batchId.value || !props.errorDownloader) return
  try {
    const file = await props.errorDownloader(batchId.value)
    triggerBrowserDownload(file.blob, file.fileName)
  } catch (error) {
    ElMessage.error((error as Error)?.message || '错误明细下载失败')
  }
}

async function downloadTemplate() {
  if (!props.templateDownloader) return
  try {
    const file = await props.templateDownloader()
    triggerBrowserDownload(file.blob, file.fileName)
  } catch (error) {
    ElMessage.error((error as Error)?.message || '模板下载失败')
  }
}

/** 轮询失败重试：再次 poll 会清空 error 并从初始间隔重新开始 */
function retryPolling() {
  if (batchId.value) task.pollImport(batchId.value, props.poller)
}

function reset() {
  if (batchId.value) task.stopImport(batchId.value)
  batchId.value = null
}

defineExpose({ reset, batchId })
</script>

<template>
  <div class="import-wizard">
    <div class="flex-between mb-8">
      <span class="import-wizard-title">{{ title }}</span>
      <el-button v-if="templateDownloader" link type="primary" @click="downloadTemplate">
        下载导入模板
      </el-button>
    </div>

    <el-upload
      drag
      :auto-upload="true"
      :show-file-list="false"
      :before-upload="handleFile"
      accept=".xlsx"
      action="#"
    >
      <div class="import-drop">
        <el-icon :size="32"><UploadFilled /></el-icon>
        <div class="import-drop-text">
          将 .xlsx 文件拖到此处，或
          <em>点击上传</em>
        </div>
        <div class="text-muted">
          单文件 ≤ {{ config.importMaxSizeMb }}MB；服务端逐行严格校验，不自动创建学院/班级
        </div>
      </div>
    </el-upload>

    <div v-if="uploading || polling || batch" class="mt-16">
      <div class="flex-between mb-8">
        <span class="text-muted">批次号：{{ batchId }}</span>
        <el-button v-if="batch" size="small" text @click="reset">重新上传</el-button>
      </div>
      <el-progress
        :percentage="progress"
        :status="
          statusType === 'error' ? 'exception' : statusType === 'success' ? 'success' : undefined
        "
        :stroke-width="14"
      />
      <el-alert
        v-if="pollError"
        class="mt-8"
        :title="`进度查询失败：${pollError}`"
        type="error"
        :closable="false"
        show-icon
        data-testid="import-poll-error"
      >
        <el-button v-if="canRetryPolling" class="mt-8" size="small" @click="retryPolling">
          重试
        </el-button>
        <span v-else class="text-muted">该批次已不可访问，请重新上传。</span>
      </el-alert>
      <el-alert
        v-else-if="batch"
        class="mt-8"
        :title="statusText"
        :type="statusType"
        :closable="false"
        show-icon
      />

      <template v-if="batch && batch.status !== 'running' && errorRows.length">
        <div class="flex-between mt-16 mb-8">
          <span class="text-muted">错误行预览（前 {{ errorRows.length }} 行）</span>
          <el-button v-if="errorDownloader" size="small" @click="downloadErrors">
            下载错误明细
          </el-button>
        </div>
        <el-table :data="errorRows" size="small" border stripe max-height="240">
          <el-table-column prop="row" label="行号" width="90" />
          <el-table-column prop="reason" label="错误原因" show-overflow-tooltip />
        </el-table>
      </template>
    </div>
  </div>
</template>

<style scoped>
.import-wizard-title {
  font-weight: 600;
}

.import-drop {
  padding: 12px 0;
}

.import-drop-text {
  margin: 8px 0 4px;
  font-size: 14px;
}

.import-drop-text em {
  color: var(--el-color-primary);
  font-style: normal;
}
</style>
