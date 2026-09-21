<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useConfigStore } from '@/stores/config'
import { useTaskStore } from '@/stores/task'
import { triggerBrowserDownload } from '@/api/http'
import { COPY } from '@/utils/constants'
import type { ImportBatch } from '@/types'

/**
 * Excel 异步导入（PRD 功能 5 / SPEC §8）：
 * 上传（.xlsx ≤10MB）→ 批次轮询进度 → 结果摘要 + 错误明细下载 + 前 N 行预览。
 * 禁用前端解析；导入逻辑全部在服务端。
 */
const emit = defineEmits<{
  (e: 'uploaded', batchId: string): void
  (e: 'finished', batch: ImportBatch): void
}>()

const props = defineProps<{
  title: string
  uploader: (file: File) => Promise<{ batchId: string }>
  poller: (batchId: string) => Promise<ImportBatch>
  errorDownloader?: (batchId: string) => Promise<Blob>
  templateUrl?: string
}>()

const config = useConfigStore()
const task = useTaskStore()

const uploading = ref(false)
const batchId = ref('')
const state = computed(() => (batchId.value ? task.imports[batchId.value] : undefined))
const batch = computed(() => state.value?.data ?? null)
const polling = computed(() => state.value?.polling ?? false)
const progress = computed(() => batch.value?.progressPct ?? 0)

watch(
  () => batch.value?.status,
  (status) => {
    if (status && status !== 'parsing' && batch.value) emit('finished', batch.value)
  },
)

const statusText = computed(() => {
  if (!batch.value) return ''
  if (batch.value.status === 'parsing') return `正在解析，已完成 ${batch.value.progressPct}%`
  if (batch.value.status === 'failed') return `解析失败：${batch.value.message || '未知原因'}`
  return `导入完成：成功 ${batch.value.successRows} 行，失败 ${batch.value.errorRows} 行`
})

const statusType = computed<'info' | 'success' | 'warning' | 'error'>(() => {
  if (!batch.value) return 'info'
  if (batch.value.status === 'parsing') return 'info'
  if (batch.value.status === 'failed') return 'error'
  return batch.value.errorRows > 0 ? 'warning' : 'success'
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
    const blob = await props.errorDownloader(batchId.value)
    triggerBrowserDownload(blob, `导入错误明细-${batchId.value}.xlsx`)
  } catch {
    ElMessage.error('导出失败请重试')
  }
}

function reset() {
  if (batchId.value) task.stopImport(batchId.value)
  batchId.value = ''
}

defineExpose({ reset, batchId })
</script>

<template>
  <div class="import-wizard">
    <div class="flex-between mb-8">
      <span class="import-wizard-title">{{ title }}</span>
      <a v-if="templateUrl" :href="templateUrl" target="_blank" rel="noopener">下载导入模板</a>
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
        v-if="batch"
        class="mt-8"
        :title="statusText"
        :type="statusType"
        :closable="false"
        show-icon
      />

      <template v-if="batch && batch.status !== 'parsing' && batch.errorPreview.length">
        <div class="flex-between mt-16 mb-8">
          <span class="text-muted">错误行预览（前 {{ batch.errorPreview.length }} 行）</span>
          <el-button v-if="errorDownloader" size="small" @click="downloadErrors">
            下载错误明细
          </el-button>
        </div>
        <el-table :data="batch.errorPreview" size="small" border stripe max-height="240">
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
