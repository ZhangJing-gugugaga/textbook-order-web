<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { ChangeRequest } from '@/types'

/**
 * 异动批量 change_request 进度抽屉（SPEC §8 / Q10）：
 * 复用 task 轮询；展示逐行审查结果（系统字段审查 → 内容审核）。
 */
const props = defineProps<{
  batchId: string
  fetcher: (batchId: string) => Promise<ChangeRequest[]>
  title?: string
}>()

// 批次逐行审查结果
const rows = ref<ChangeRequest[]>([])

onMounted(() => {
  void refresh()
})

watch(
  () => props.batchId,
  () => void refresh(),
)

async function refresh() {
  if (!props.batchId) return
  try {
    rows.value = await props.fetcher(props.batchId)
  } catch {
    rows.value = []
  }
}

const stats = computed(() => ({
  total: rows.value.length,
  pending: rows.value.filter((r) => r.status === 'pending').length,
  approved: rows.value.filter((r) => r.status === 'approved').length,
  rejected: rows.value.filter((r) => r.status === 'rejected').length,
}))

function statusTag(status: ChangeRequest['status']) {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  return 'warning'
}

function statusText(status: ChangeRequest['status']) {
  if (status === 'approved') return '已通过'
  if (status === 'rejected') return '已驳回'
  return '待审核'
}
</script>

<template>
  <div class="batch-progress-drawer">
    <div class="flex-between mb-16">
      <span class="text-muted">批次号：{{ batchId }}</span>
      <el-button size="small" @click="refresh">刷新</el-button>
    </div>
    <el-descriptions :column="4" border size="small">
      <el-descriptions-item label="总行数">{{ stats.total }}</el-descriptions-item>
      <el-descriptions-item label="待审核">{{ stats.pending }}</el-descriptions-item>
      <el-descriptions-item label="已通过">{{ stats.approved }}</el-descriptions-item>
      <el-descriptions-item label="已驳回">{{ stats.rejected }}</el-descriptions-item>
    </el-descriptions>
    <el-table :data="rows" size="small" border stripe class="mt-16" max-height="360">
      <el-table-column prop="studentNo" label="学号" width="120" />
      <el-table-column prop="studentName" label="姓名" width="100" />
      <el-table-column prop="type" label="异动类型" width="120" />
      <el-table-column label="系统字段审查" min-width="160">
        <template #default="{ row }">
          <span v-if="!row.fieldCheck || row.fieldCheck.length === 0" class="text-muted">—</span>
          <span
            v-else-if="row.fieldCheck.every((f: { passed: boolean }) => f.passed)"
            class="text-success"
          >
            全部通过
          </span>
          <span v-else class="text-danger">
            {{ row.fieldCheck.filter((f: { passed: boolean }) => !f.passed).length }} 项未通过
          </span>
        </template>
      </el-table-column>
      <el-table-column label="内容审核" width="110">
        <template #default="{ row }">
          <el-tag :type="statusTag(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column
        prop="reviewComment"
        label="审核意见"
        min-width="140"
        show-overflow-tooltip
      />
    </el-table>
  </div>
</template>
