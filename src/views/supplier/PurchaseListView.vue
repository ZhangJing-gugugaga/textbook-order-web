<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { supplierApi } from '@/api/supplier'
import { useWindowStore } from '@/stores/window'
import { COPY } from '@/utils/constants'
import type { SupplierCollegeGroup } from '@/types'

/**
 * 订购清单（供货商）（PRD 订购清单页 / API.md §3.13）：
 * GET /api/supplier/orders 按学院分组返回，字段白名单仅 书名/ISBN/数量/教师姓名/学院；
 * 接口层即不返回学生任何字段，页面亦无学生字段渲染路径（物理隔离）。
 */
const windowStore = useWindowStore()
const groups = ref<SupplierCollegeGroup[]>([])
const loading = ref(false)

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

const totalRows = computed(() => groups.value.reduce((sum, group) => sum + group.items.length, 0))

/** 按学院分组展开为表格行（一学院一 sheet 的预览形态） */
const flatRows = computed(() =>
  groups.value.flatMap((group) =>
    group.items.map((item, index) => ({
      key: `${group.collegeId}-${index}`,
      collegeName: group.collegeName,
      ...item,
    })),
  ),
)

onMounted(() => {
  void windowStore.fetch()
  void load()
})
</script>

<template>
  <div class="app-page">
    <div class="flex-between mb-16">
      <span class="text-muted">
        只读清单，仅展示 书名 / ISBN / 数量 / 教师姓名 / 学院（接口层无学生字段）。
      </span>
      <el-button size="small" @click="load">刷新</el-button>
    </div>

    <el-descriptions :column="3" border class="mb-16">
      <el-descriptions-item label="当前学期">
        {{ windowStore.semesterName || '未设置' }}
      </el-descriptions-item>
      <el-descriptions-item label="学院数">{{ groups.length }}</el-descriptions-item>
      <el-descriptions-item label="条目数">{{ totalRows }}</el-descriptions-item>
    </el-descriptions>

    <el-table v-loading="loading" :data="flatRows" border stripe>
      <el-table-column prop="collegeName" label="学院" min-width="170" show-overflow-tooltip />
      <el-table-column prop="title" label="书名" min-width="220" show-overflow-tooltip />
      <el-table-column prop="isbn" label="ISBN" width="160" />
      <el-table-column prop="quantity" label="数量" width="100" align="center" />
      <el-table-column prop="teacherName" label="教师姓名" width="130" />
      <template #empty>
        <el-empty description="暂无征订数据（需教师表单复核通过后生成）" :image-size="90" />
      </template>
    </el-table>

    <div v-if="groups.length" class="mt-16">
      <h4 class="mb-8">按学院分组（一学院一 sheet 导出预览）</h4>
      <el-collapse>
        <el-collapse-item
          v-for="group in groups"
          :key="group.collegeId"
          :title="`${group.collegeName}（${group.items.length} 条）`"
          :name="group.collegeId"
        >
          <el-table :data="group.items" size="small" border stripe>
            <el-table-column prop="title" label="书名" min-width="220" show-overflow-tooltip />
            <el-table-column prop="isbn" label="ISBN" width="160" />
            <el-table-column prop="quantity" label="数量" width="100" align="center" />
            <el-table-column prop="teacherName" label="教师姓名" width="130" />
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </div>
  </div>
</template>
