<script setup lang="ts">
import { ref } from 'vue'
import { orderFormApi } from '@/api/orderForm'
import { studentOrderApi } from '@/api/studentOrder'
import ExportButton from '@/components/ExportButton.vue'
import { COPY } from '@/utils/constants'
import { formatMoney, formatDateTime } from '@/utils/format'
import type { OrderForm, StudentOrder } from '@/types'

/**
 * 征订数据（PRD 教材室-征订数据）：
 * 教师征订全量明细 / 学生选购全量，多维度筛选（服务端分页）。
 */
const activeTab = ref<'teacher' | 'student'>('teacher')

/* ---------------- 教师表单明细 ---------------- */
const teacherQuery = ref<{
  status: string
  collegeId: number | undefined
  keyword: string
  page: number
  size: number
}>({ status: '', collegeId: undefined, keyword: '', page: 1, size: 10 })
const teacherRows = ref<OrderForm[]>([])
const teacherTotal = ref(0)
const teacherLoading = ref(false)

async function loadTeacher() {
  teacherLoading.value = true
  try {
    const result = await orderFormApi.page({
      status: teacherQuery.value.status || undefined,
      collegeId: teacherQuery.value.collegeId,
      keyword: teacherQuery.value.keyword || undefined,
      page: teacherQuery.value.page,
      size: teacherQuery.value.size,
    })
    teacherRows.value = result.list
    teacherTotal.value = result.total
  } catch {
    teacherRows.value = []
    teacherTotal.value = 0
  } finally {
    teacherLoading.value = false
  }
}

function searchTeacher() {
  teacherQuery.value.page = 1
  void loadTeacher()
}

/* ---------------- 学生选购明细 ---------------- */
const studentQuery = ref<{ keyword: string; page: number; size: number }>({
  keyword: '',
  page: 1,
  size: 10,
})
const studentRows = ref<StudentOrder[]>([])
const studentTotal = ref(0)
const studentLoading = ref(false)

async function loadStudent() {
  studentLoading.value = true
  try {
    const result = await studentOrderApi.myPage({
      keyword: studentQuery.value.keyword || undefined,
      page: studentQuery.value.page,
      size: studentQuery.value.size,
    })
    studentRows.value = result.list
    studentTotal.value = result.total
  } catch {
    studentRows.value = []
    studentTotal.value = 0
  } finally {
    studentLoading.value = false
  }
}

function searchStudent() {
  studentQuery.value.page = 1
  void loadStudent()
}

const STATUS_LABELS: Record<
  string,
  { label: string; type: 'success' | 'danger' | 'warning' | 'info' }
> = {
  draft: { label: '草稿', type: 'info' },
  pending_review: { label: '待复核', type: 'warning' },
  reviewed: { label: '已复核', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
}

loadTeacher()
loadStudent()
</script>

<template>
  <div class="app-page">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="教师征订明细" name="teacher">
        <div class="app-toolbar">
          <el-select
            v-model="teacherQuery.status"
            clearable
            placeholder="审查状态"
            style="width: 160px"
            @change="searchTeacher"
          >
            <el-option label="待复核" value="pending_review" />
            <el-option label="已复核" value="reviewed" />
            <el-option label="已驳回" value="rejected" />
          </el-select>
          <el-input
            v-model="teacherQuery.keyword"
            placeholder="教师 / 课程 / 教材"
            clearable
            style="width: 220px"
            @keyup.enter="searchTeacher"
            @clear="searchTeacher"
          />
          <el-button type="primary" @click="searchTeacher">查询</el-button>
          <ExportButton
            name="全院教师征订明细"
            :estimated-rows="teacherTotal"
            :params="{ status: teacherQuery.status, keyword: teacherQuery.keyword }"
          />
        </div>

        <el-table v-loading="teacherLoading" :data="teacherRows" border stripe>
          <el-table-column prop="id" label="表单号" width="90" />
          <el-table-column prop="teacherName" label="任课教师" width="120" />
          <el-table-column prop="collegeName" label="学院" min-width="140" />
          <el-table-column label="明细行数" width="100" align="center">
            <template #default="{ row }">{{ row.items.length }}</template>
          </el-table-column>
          <el-table-column label="数量合计" width="100" align="center">
            <template #default="{ row }">
              {{ row.items.reduce((s: number, i: { quantity: number }) => s + i.quantity, 0) }}
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="STATUS_LABELS[row.status].type" size="small">
                {{ STATUS_LABELS[row.status].label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="提交时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
        <div class="app-pagination">
          <el-pagination
            v-model:current-page="teacherQuery.page"
            v-model:page-size="teacherQuery.size"
            :total="teacherTotal"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next"
            background
            @current-change="loadTeacher"
            @size-change="searchTeacher"
          />
        </div>
        <el-empty
          v-if="!teacherLoading && teacherRows.length === 0"
          :description="COPY.EMPTY"
          :image-size="80"
        />
      </el-tab-pane>

      <el-tab-pane label="学生选购明细" name="student">
        <div class="app-toolbar">
          <el-input
            v-model="studentQuery.keyword"
            placeholder="姓名 / 班级"
            clearable
            style="width: 220px"
            @keyup.enter="searchStudent"
            @clear="searchStudent"
          />
          <el-button type="primary" @click="searchStudent">查询</el-button>
          <ExportButton
            name="全院学生选购明细"
            :estimated-rows="studentTotal"
            :params="{ keyword: studentQuery.keyword }"
          />
        </div>

        <el-table v-loading="studentLoading" :data="studentRows" border stripe>
          <el-table-column prop="id" label="单号" width="90" />
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
          <el-table-column prop="semesterName" label="学期" width="150" />
          <el-table-column label="提交时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.submittedAt) }}</template>
          </el-table-column>
        </el-table>
        <div class="app-pagination">
          <el-pagination
            v-model:current-page="studentQuery.page"
            v-model:page-size="studentQuery.size"
            :total="studentTotal"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next"
            background
            @current-change="loadStudent"
            @size-change="searchStudent"
          />
        </div>
        <el-empty
          v-if="!studentLoading && studentRows.length === 0"
          :description="COPY.EMPTY"
          :image-size="80"
        />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
