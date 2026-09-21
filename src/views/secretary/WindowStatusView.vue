<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { semesterApi } from '@/api/semester'
import { useWindowStore } from '@/stores/window'
import { formatDateTime, windowStatusText } from '@/utils/format'
import type { Semester, WindowChangeRecord } from '@/types'

/** 窗口状态（秘书）：本院窗口只读视图 */
const windowStore = useWindowStore()
const { status } = storeToRefs(windowStore)

const semester = ref<Semester | null>(null)
const changes = ref<WindowChangeRecord[]>([])

const text = computed(() =>
  windowStatusText(status.value, windowStore.remainMs, windowStore.startRemainMs),
)

async function load() {
  try {
    const list = await semesterApi.list()
    semester.value = list.find((item) => item.status === 'active') ?? list[0] ?? null
    if (semester.value) changes.value = await semesterApi.changes(semester.value.id)
  } catch {
    semester.value = null
  }
}

onMounted(() => {
  void windowStore.fetch()
  void load()
})
</script>

<template>
  <div class="app-page">
    <h3 class="mb-16">当前窗口状态（只读）</h3>

    <el-descriptions :column="2" border>
      <el-descriptions-item label="当前学期">{{ semester?.name || '—' }}</el-descriptions-item>
      <el-descriptions-item label="窗口状态">
        <el-tag :type="status === 'open' ? 'success' : status === 'closed' ? 'warning' : 'info'">
          {{ status === 'open' ? '进行中' : status === 'closed' ? '已截止' : '未开始' }}
        </el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="窗口开始">
        {{ semester?.windowStart ? formatDateTime(semester.windowStart) : '—' }}
      </el-descriptions-item>
      <el-descriptions-item label="窗口截止">
        {{ semester?.windowEnd ? formatDateTime(semester.windowEnd) : '—' }}
      </el-descriptions-item>
      <el-descriptions-item label="状态说明" :span="2">{{ text }}</el-descriptions-item>
      <el-descriptions-item label="自动开启">
        <el-tag size="small" :type="semester?.autoOpen ? 'success' : 'info'">
          {{ semester?.autoOpen ? '已开启' : '未开启' }}
        </el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="自动截止">
        <el-tag size="small" :type="semester?.autoClose ? 'success' : 'info'">
          {{ semester?.autoClose ? '已开启' : '未开启' }}
        </el-tag>
      </el-descriptions-item>
    </el-descriptions>

    <el-alert
      class="mt-16"
      :title="
        status === 'open'
          ? '窗口开放中：本院教师可填报教材需求'
          : status === 'closed'
            ? '本期征订已截止，可查看历史记录'
            : '窗口尚未开始'
      "
      :type="status === 'open' ? 'success' : status === 'closed' ? 'warning' : 'info'"
      :closable="false"
      show-icon
    />

    <h4 class="mt-16">窗口变更记录</h4>
    <el-table :data="changes" size="small" border stripe>
      <el-table-column type="index" label="#" width="60" />
      <el-table-column label="操作" width="130">
        <template #default="{ row }">
          {{
            row.action === 'open'
              ? '开启窗口'
              : row.action === 'close'
                ? '截止窗口'
                : row.action === 'extend'
                  ? '延长窗口'
                  : row.action === 'activate'
                    ? '激活学期'
                    : '归档学期'
          }}
        </template>
      </el-table-column>
      <el-table-column prop="operatorName" label="操作人" width="120" />
      <el-table-column label="时间" width="180">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="原值 → 新值" min-width="220">
        <template #default="{ row }">
          {{ row.fromValue || '—' }} → {{ row.toValue || '—' }}
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="changes.length === 0" description="暂无变更记录" :image-size="70" />
  </div>
</template>
