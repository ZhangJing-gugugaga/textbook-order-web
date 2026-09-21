<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { supplierApi } from '@/api/supplier'
import { orgApi } from '@/api/semester'
import ExportButton from '@/components/ExportButton.vue'
import type { SupplierOrderRow } from '@/types'

/**
 * 订购清单（供货商）（PRD 订购清单页 / 功能 6）：
 * 只读查看与导出；列固定四项（书名/ISBN/教师姓名/学院），不可增删；
 * 接口层即不返回学生任何字段，页面亦无学生字段渲染路径。
 */
const colleges = ref<{ id: number; name: string }[]>([])
const collegeId = ref<number | undefined>(undefined)
const keyword = ref('')
const page = ref(1)
const size = ref(10)
const rows = ref<SupplierOrderRow[]>([])
const total = ref(0)
const loading = ref(false)

const estimatedRows = computed(() => Math.max(total.value, 1))

async function load() {
  loading.value = true
  try {
    const result = await supplierApi.page({
      collegeId: collegeId.value,
      keyword: keyword.value || undefined,
      page: page.value,
      size: size.value,
    })
    rows.value = result.list
    total.value = result.total
  } catch {
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  void load()
}

onMounted(async () => {
  colleges.value = await orgApi.colleges().catch(() => [])
  await load()
})
</script>

<template>
  <div class="app-page">
    <div class="app-toolbar">
      <el-select
        v-model="collegeId"
        placeholder="学院筛选（仅切换视角）"
        clearable
        style="width: 220px"
        @change="search"
      >
        <el-option
          v-for="college in colleges"
          :key="college.id"
          :label="college.name"
          :value="college.id"
        />
      </el-select>
      <el-input
        v-model="keyword"
        placeholder="书名 / ISBN / 教师姓名"
        clearable
        style="width: 220px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button type="primary" @click="search">查询</el-button>
      <ExportButton
        code="supplier:export"
        name="订购清单（分学院 sheet）"
        :estimated-rows="estimatedRows"
        :params="{ collegeId: collegeId }"
      />
    </div>

    <el-alert
      class="mb-16"
      title="本页仅展示 书名 / ISBN / 教师姓名 / 学院 四类字段；不含任何学生数据，也不提供新增/修改入口。"
      type="info"
      :closable="false"
      show-icon
    />

    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column prop="title" label="书名" min-width="220" show-overflow-tooltip />
      <el-table-column prop="isbn" label="ISBN" width="170" />
      <el-table-column prop="teacherName" label="教师姓名" width="150" />
      <el-table-column prop="collegeName" label="所属学院" min-width="180" />
    </el-table>

    <div class="app-pagination">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        @current-change="load"
        @size-change="search"
      />
    </div>
    <el-empty
      v-if="!loading && rows.length === 0"
      description="该学院暂无征订数据"
      :image-size="90"
    />
  </div>
</template>
