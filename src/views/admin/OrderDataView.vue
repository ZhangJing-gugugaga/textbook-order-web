<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import { reviewApi } from '@/api/orderForm'
import { studentOrderApi } from '@/api/studentOrder'
import { orgApi } from '@/api/semester'
import { exportApi } from '@/api/exportTask'
import ExportButton from '@/components/ExportButton.vue'
import ServerTable from '@/components/ServerTable.vue'
import { ORDER_FORM_STATUS_META, PERMISSIONS, statusMetaOf } from '@/utils/constants'
import { formatDateTime } from '@/utils/format'
import type { College } from '@/types'

/**
 * 征订数据（PRD 教材室-征订数据 / API.md §3.6 §3.7）：
 * 教师征订全量（GET /api/admin/order-forms）与学生选购全量（GET /api/admin/student-orders），
 * 多维度筛选 + 服务端分页（分页与三态由 ServerTable 基座承担，SPEC §8）。
 */
const activeTab = ref<'teacher' | 'student'>('teacher')
const colleges = ref<College[]>([])

/* ---------------- 教师表单明细 ---------------- */
const teacherFilters = reactive({
  status: '',
  collegeId: undefined as number | undefined,
  teacherName: '',
})
const teacherTableRef = ref<{ reload: (resetPage?: boolean) => void } | null>(null)

/** 筛选条件 → 接口参数（空串不下发），分页由 ServerTable 注入 */
function fetchTeacherPage({ page, size }: { page: number; size: number }) {
  return reviewApi.page({
    status: teacherFilters.status || undefined,
    collegeId: teacherFilters.collegeId,
    teacherName: teacherFilters.teacherName || undefined,
    page,
    size,
  })
}

function searchTeacher() {
  teacherTableRef.value?.reload()
}

/* ---------------- 学生选购明细 ---------------- */
const studentFilters = reactive({
  collegeId: undefined as number | undefined,
  classId: undefined as number | undefined,
  studentName: '',
})
const studentTableRef = ref<{ reload: (resetPage?: boolean) => void } | null>(null)

/** 筛选条件 → 接口参数（空串不下发），分页由 ServerTable 注入 */
function fetchStudentPage({ page, size }: { page: number; size: number }) {
  return studentOrderApi.page({
    collegeId: studentFilters.collegeId,
    classId: studentFilters.classId,
    studentName: studentFilters.studentName || undefined,
    page,
    size,
  })
}

function searchStudent() {
  studentTableRef.value?.reload()
}

onMounted(async () => {
  colleges.value = await orgApi.colleges().catch(() => [])
})
</script>

<template>
  <div class="app-page">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="教师征订明细" name="teacher">
        <div class="app-toolbar">
          <el-select
            v-model="teacherFilters.status"
            clearable
            placeholder="审查状态"
            style="width: 170px"
            @change="searchTeacher"
          >
            <el-option label="待审核" value="pending_review" />
            <el-option label="已通过" value="reviewed" />
            <el-option label="已驳回" value="rejected" />
            <el-option label="字段审查未过" value="rejected_auto" />
          </el-select>
          <el-select
            v-model="teacherFilters.collegeId"
            clearable
            placeholder="学院"
            style="width: 170px"
            @change="searchTeacher"
          >
            <el-option
              v-for="college in colleges"
              :key="college.id"
              :label="college.name"
              :value="college.id"
            />
          </el-select>
          <el-input
            v-model="teacherFilters.teacherName"
            placeholder="教师姓名"
            clearable
            style="width: 180px"
            @keyup.enter="searchTeacher"
            @clear="searchTeacher"
          />
          <el-button type="primary" @click="searchTeacher">查询</el-button>
          <ExportButton
            name="教师征订明细"
            :code="PERMISSIONS.EXPORT_ORDER"
            :exporter="() => exportApi.orders({ collegeId: teacherFilters.collegeId })"
          />
        </div>

        <ServerTable ref="teacherTableRef" :fetcher="fetchTeacherPage">
          <el-table-column prop="id" label="表单号" width="90" />
          <el-table-column prop="teacherName" label="任课教师" width="120" />
          <el-table-column prop="teacherNo" label="工号" width="110" />
          <el-table-column prop="collegeName" label="学院" min-width="140" />
          <el-table-column prop="itemCount" label="明细行数" width="100" align="center" />
          <el-table-column prop="totalQuantity" label="数量合计" width="100" align="center" />
          <el-table-column label="状态" width="130">
            <template #default="{ row }">
              <el-tag size="small" :type="statusMetaOf(ORDER_FORM_STATUS_META, row.status).type">
                {{ statusMetaOf(ORDER_FORM_STATUS_META, row.status).label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="提交时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.submittedAt) }}</template>
          </el-table-column>
        </ServerTable>
      </el-tab-pane>

      <el-tab-pane label="学生选购明细" name="student">
        <div class="app-toolbar">
          <el-select
            v-model="studentFilters.collegeId"
            clearable
            placeholder="学院"
            style="width: 170px"
            @change="searchStudent"
          >
            <el-option
              v-for="college in colleges"
              :key="college.id"
              :label="college.name"
              :value="college.id"
            />
          </el-select>
          <el-input
            v-model="studentFilters.studentName"
            placeholder="学生姓名"
            clearable
            style="width: 180px"
            @keyup.enter="searchStudent"
            @clear="searchStudent"
          />
          <el-button type="primary" @click="searchStudent">查询</el-button>
          <ExportButton
            name="学生选购汇总"
            :code="PERMISSIONS.EXPORT_STUDENT"
            :exporter="() => exportApi.students({})"
          />
        </div>

        <ServerTable ref="studentTableRef" :fetcher="fetchStudentPage">
          <el-table-column prop="id" label="单号" width="90" />
          <el-table-column prop="studentName" label="姓名" width="110" />
          <el-table-column prop="studentNo" label="学号" width="130" />
          <el-table-column prop="collegeName" label="学院" width="150" show-overflow-tooltip />
          <el-table-column prop="className" label="班级" width="150" show-overflow-tooltip />
          <el-table-column prop="totalQuantity" label="数量合计" width="100" align="center" />
          <el-table-column prop="semesterName" label="学期" min-width="180" show-overflow-tooltip />
          <el-table-column label="提交时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.submittedAt) }}</template>
          </el-table-column>
        </ServerTable>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
