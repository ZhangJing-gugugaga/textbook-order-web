<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { studentOrderApi } from '@/api/studentOrder'
import { formatDateTime, formatMoney } from '@/utils/format'
import { COPY } from '@/utils/constants'
import type { StudentOrder } from '@/types'

/** 我的选购记录（PRD 学生-我的选购记录）：历史学期选购记录查看，无导出 */
const query = ref<{ keyword: string; page: number; size: number }>({
  keyword: '',
  page: 1,
  size: 10,
})
const rows = ref<StudentOrder[]>([])
const total = ref(0)
const loading = ref(false)
const detailVisible = ref(false)
const detail = ref<StudentOrder | null>(null)

async function load() {
  loading.value = true
  try {
    const result = await studentOrderApi.myPage({
      keyword: query.value.keyword || undefined,
      page: query.value.page,
      size: query.value.size,
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
  query.value.page = 1
  void load()
}

function openDetail(row: StudentOrder) {
  detail.value = row
  detailVisible.value = true
}

onMounted(load)
</script>

<template>
  <div class="app-page">
    <div class="app-toolbar">
      <el-input
        v-model="query.keyword"
        placeholder="学期 / 班级"
        clearable
        style="width: 220px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button type="primary" @click="search">查询</el-button>
      <span class="text-muted">本页仅本人记录，无导出入口</span>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column prop="id" label="单号" width="90" />
      <el-table-column prop="semesterName" label="学期" width="170" />
      <el-table-column prop="className" label="班级" width="160" />
      <el-table-column label="品种数" width="100" align="center">
        <template #default="{ row }">
          {{ row.items.filter((i: { checked: boolean }) => i.checked).length }}
        </template>
      </el-table-column>
      <el-table-column label="数量合计" width="100" align="center">
        <template #default="{ row }">{{ row.totalQuantity }}</template>
      </el-table-column>
      <el-table-column label="合计金额" width="120">
        <template #default="{ row }">{{ formatMoney(row.totalAmount) }}</template>
      </el-table-column>
      <el-table-column label="提交时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.submittedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="primary" text @click="openDetail(row)">查看明细</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="app-pagination">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.size"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        @current-change="load"
        @size-change="search"
      />
    </div>
    <el-empty v-if="!loading && rows.length === 0" :description="COPY.EMPTY" :image-size="80" />

    <el-dialog v-model="detailVisible" title="选购明细" width="640px" append-to-body>
      <template v-if="detail">
        <el-descriptions :column="3" border size="small" class="mb-16">
          <el-descriptions-item label="学期">{{ detail.semesterName }}</el-descriptions-item>
          <el-descriptions-item label="班级">{{ detail.className }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">
            {{ formatDateTime(detail.submittedAt) }}
          </el-descriptions-item>
        </el-descriptions>
        <el-table :data="detail.items.filter((i) => i.checked)" size="small" border stripe>
          <el-table-column
            prop="textbookTitle"
            label="教材"
            min-width="170"
            show-overflow-tooltip
          />
          <el-table-column prop="isbn" label="ISBN" width="150" />
          <el-table-column label="单价" width="100">
            <template #default="{ row }">{{ formatMoney(row.price) }}</template>
          </el-table-column>
          <el-table-column prop="quantity" label="数量" width="80" />
          <el-table-column label="小计" width="110">
            <template #default="{ row }">{{ formatMoney(row.price * row.quantity) }}</template>
          </el-table-column>
        </el-table>
        <div class="settle-total">
          合计 {{ detail.totalQuantity }} 本 / {{ formatMoney(detail.totalAmount) }}
        </div>
        <div class="fine-print">价格和版本以最终出版单位供应为准</div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.settle-total {
  margin-top: 10px;
  text-align: right;
  font-size: 14px;
}

.fine-print {
  margin-top: 6px;
  text-align: center;
  font-size: 12px;
  color: #b0b4c0;
}
</style>
