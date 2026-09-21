<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { orgApi } from '@/api/semester'
import { supplierApi } from '@/api/supplier'
import ExportButton from '@/components/ExportButton.vue'
import type { SupplierOrderRow } from '@/types'

/**
 * 清单导出（供货商）（PRD 供货商-清单导出 / 功能 6）：
 * 一次导出、一个学院一个 sheet；每次导出后端审计留痕。
 * 异步阈值同导出中心（Q16）：≤5000 行同步下载，>5000 行走 export_task。
 */
const colleges = ref<{ id: number; name: string }[]>([])
const collegeId = ref<number | undefined>(undefined)
const rows = ref<SupplierOrderRow[]>([])
const total = ref(0)
const loading = ref(false)

const estimatedRows = computed(() => Math.max(total.value, 1))

async function load() {
  loading.value = true
  try {
    const result = await supplierApi.page({ collegeId: collegeId.value, page: 1, size: 100 })
    rows.value = result.list
    total.value = result.total
  } catch {
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  colleges.value = await orgApi.colleges().catch(() => [])
  await load()
})
</script>

<template>
  <div class="app-page">
    <h3 class="mb-16">订购清单导出</h3>

    <el-alert
      class="mb-16"
      title="一次导出、一个学院一个 sheet；仅含 书名 / ISBN / 教师姓名 / 学院 四类字段。每次导出后端均审计留痕。"
      type="info"
      :closable="false"
      show-icon
    />

    <div class="app-toolbar">
      <el-select
        v-model="collegeId"
        placeholder="导出范围（全部学院或单个学院）"
        clearable
        style="width: 240px"
        @change="load"
      >
        <el-option label="全部学院" :value="undefined" />
        <el-option
          v-for="college in colleges"
          :key="college.id"
          :label="college.name"
          :value="college.id"
        />
      </el-select>
      <ExportButton
        code="supplier:export"
        name="订购清单（分学院 sheet）"
        :estimated-rows="estimatedRows"
        :params="{ collegeId: collegeId }"
      />
      <span class="text-muted">预估 {{ estimatedRows }} 行</span>
    </div>

    <h4 class="mb-8">当前范围预览</h4>
    <el-table v-loading="loading" :data="rows" border stripe max-height="420">
      <el-table-column prop="title" label="书名" min-width="220" show-overflow-tooltip />
      <el-table-column prop="isbn" label="ISBN" width="170" />
      <el-table-column prop="teacherName" label="教师姓名" width="150" />
      <el-table-column prop="collegeName" label="所属学院" min-width="180" />
    </el-table>
    <el-empty
      v-if="!loading && rows.length === 0"
      description="该学院暂无征订数据"
      :image-size="90"
    />

    <div class="text-muted mt-16">
      说明：无数据学院导出空 sheet
      并提示；导出失败可重试。本页不展示学生任何字段，也不提供新增/修改入口。
    </div>
  </div>
</template>
