<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { supplierApi } from '@/api/supplier'
import ExportButton from '@/components/ExportButton.vue'
import { COPY, PERMISSIONS } from '@/utils/constants'
import type { SupplierCollegeGroup } from '@/types'

/**
 * 清单导出（供货商）（PRD 供货商-清单导出 / API.md §3.13）：
 * POST /api/supplier/export 一次导出、一个学院一个 sheet；
 * 同步/异步由后端 export.sync_row_threshold 裁决（异步任务走 /api/supplier/export-task/{id}）；
 * 每次导出后端审计留痕。字段白名单仅 书名/ISBN/数量/教师姓名/学院。
 */
const groups = ref<SupplierCollegeGroup[]>([])
const loading = ref(false)

const collegeCount = computed(() => groups.value.length)
const itemCount = computed(() => groups.value.reduce((sum, g) => sum + g.items.length, 0))

async function load() {
  loading.value = true
  try {
    groups.value = await supplierApi.orders()
  } catch (error) {
    groups.value = []
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="app-page">
    <h3 class="mb-16">订购清单导出</h3>

    <el-alert
      title="一次导出、一个学院一个 sheet；仅含 书名 / ISBN / 数量 / 教师姓名 / 学院 五类字段，无任何学生字段。"
      type="info"
      :closable="false"
      show-icon
      class="mb-16"
    />

    <el-descriptions :column="3" border class="mb-16" v-loading="loading">
      <el-descriptions-item label="涉及学院">{{ collegeCount }}</el-descriptions-item>
      <el-descriptions-item label="清单条目">{{ itemCount }}</el-descriptions-item>
      <el-descriptions-item label="导出形式">
        一学院一 sheet（服务端裁决同步 / 异步）
      </el-descriptions-item>
    </el-descriptions>

    <div class="app-toolbar">
      <ExportButton
        name="供货商清单"
        :code="PERMISSIONS.SUPPLIER_ORDER_EXPORT"
        :exporter="() => supplierApi.export({})"
      />
      <el-button @click="load">刷新清单</el-button>
    </div>

    <el-divider content-position="left">导出说明</el-divider>
    <ul class="export-notes">
      <li>
        行数 ≤ 阈值（默认 5000）同步下载
        xlsx；超过则创建异步任务，完成后通过一次性授权链接自动下载。
      </li>
      <li>每次导出后端写审计（谁 / 何时 / 范围），前端仅提示「已下载，导出行为已记录」。</li>
      <li>供货商接口为独立模块物理隔离，不提供任何学生字段路径。</li>
    </ul>
  </div>
</template>

<style scoped>
.export-notes {
  margin: 0;
  padding-left: 18px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.9;
}
</style>
