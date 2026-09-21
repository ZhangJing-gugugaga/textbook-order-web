<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, FormInstance } from 'element-plus'
import { courseApi } from '@/api/course'
import { orgApi } from '@/api/semester'
import { batchApi } from '@/api/people'
import ImportWizard from '@/components/ImportWizard.vue'
import { COPY } from '@/utils/constants'
import type { Course, TeachingAssignment } from '@/types'

/** 课程与任课管理（PRD 教材室-课程与任课管理）：课程维护 + 教师-课程-班级任课关系 + Excel 导入 */
const query = ref<{ keyword: string; collegeId: number | undefined; page: number; size: number }>({
  keyword: '',
  collegeId: undefined,
  page: 1,
  size: 10,
})
const rows = ref<Course[]>([])
const total = ref(0)
const loading = ref(false)
const colleges = ref<{ id: number; name: string }[]>([])
const assignments = ref<TeachingAssignment[]>([])

async function load() {
  loading.value = true
  try {
    const [coursePage, assignmentList] = await Promise.all([
      courseApi.page({
        keyword: query.value.keyword || undefined,
        collegeId: query.value.collegeId,
        page: query.value.page,
        size: query.value.size,
      }),
      courseApi.assignments({}),
    ])
    rows.value = coursePage.list
    total.value = coursePage.total
    assignments.value = assignmentList
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

/* ---------------- 课程 CRUD ---------------- */
const dialogVisible = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({
  id: 0,
  code: '',
  name: '',
  collegeId: undefined as number | undefined,
  credit: 2,
})
const rules = {
  code: [{ required: true, message: '请输入课程编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入课程名称', trigger: 'blur' }],
  collegeId: [{ required: true, message: '请选择开课学院', trigger: 'change' }],
}

function openCreate() {
  form.id = 0
  form.code = ''
  form.name = ''
  form.collegeId = undefined
  form.credit = 2
  dialogVisible.value = true
}

function openEdit(row: Course) {
  form.id = row.id
  form.code = row.code
  form.name = row.name
  form.collegeId = row.collegeId
  form.credit = row.credit
  dialogVisible.value = true
}

async function submit() {
  await formRef.value?.validate()
  saving.value = true
  try {
    if (form.id) await courseApi.update(form.id, { ...form })
    else await courseApi.create({ ...form })
    ElMessage.success(COPY.SUCCESS)
    dialogVisible.value = false
    void load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    saving.value = false
  }
}

async function remove(row: Course) {
  try {
    await ElMessageBox.confirm(`确认删除课程「${row.name}」？`, '删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await courseApi.remove(row.id)
    ElMessage.success('已删除')
    void load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}

/* ---------------- 任课关系 ---------------- */
const assignmentDialog = ref(false)
const assignmentSaving = ref(false)
const assignmentForm = reactive({
  courseId: undefined as number | undefined,
  teacherName: '',
  className: '',
})

function openAssignment() {
  assignmentForm.courseId = rows.value[0]?.id
  assignmentForm.teacherName = ''
  assignmentForm.className = ''
  assignmentDialog.value = true
}

async function submitAssignment() {
  if (!assignmentForm.courseId || !assignmentForm.teacherName || !assignmentForm.className) {
    ElMessage.error('请完整填写课程、教师与班级')
    return
  }
  assignmentSaving.value = true
  try {
    await courseApi.createAssignment({
      courseId: assignmentForm.courseId,
      teacherName: assignmentForm.teacherName,
      className: assignmentForm.className,
    })
    ElMessage.success(COPY.SUCCESS)
    assignmentDialog.value = false
    void load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    assignmentSaving.value = false
  }
}

async function removeAssignment(row: TeachingAssignment) {
  try {
    await ElMessageBox.confirm(
      `确认删除任课关系「${row.teacherName} - ${row.courseName} - ${row.className}」？`,
      '删除',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await courseApi.removeAssignment(row.id)
    ElMessage.success('已删除')
    void load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}

async function loadColleges() {
  colleges.value = await orgApi.colleges().catch(() => [])
}

load()
loadColleges()
</script>

<template>
  <div class="app-page">
    <h3 class="mb-16">课程维护</h3>
    <div class="app-toolbar">
      <el-input
        v-model="query.keyword"
        placeholder="课程编码 / 名称"
        clearable
        style="width: 220px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-select
        v-model="query.collegeId"
        placeholder="开课学院"
        clearable
        style="width: 200px"
        @change="search"
      >
        <el-option
          v-for="college in colleges"
          :key="college.id"
          :label="college.name"
          :value="college.id"
        />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="openCreate">新增课程</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column prop="code" label="课程编码" width="140" />
      <el-table-column prop="name" label="课程名称" min-width="180" />
      <el-table-column prop="credit" label="学分" width="90" />
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <div class="app-table-actions">
            <el-button size="small" text @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" text @click="remove(row)">删除</el-button>
          </div>
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

    <h3 class="mt-16 mb-16">
      任课关系（教师 - 课程 - 班级）
      <el-button class="ml-8" size="small" @click="openAssignment">新增任课关系</el-button>
    </h3>
    <el-table :data="assignments" border stripe>
      <el-table-column prop="courseName" label="课程" min-width="160" />
      <el-table-column prop="teacherName" label="任课教师" width="140" />
      <el-table-column prop="className" label="班级" width="160" />
      <el-table-column label="操作" width="120">
        <template #default="{ row }">
          <el-button size="small" type="danger" text @click="removeAssignment(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="assignments.length === 0" :description="COPY.EMPTY" :image-size="70" />

    <div class="mt-16">
      <ImportWizard
        title="任课关系 Excel 导入（教师-课程-班级）"
        :uploader="courseApi.importAssignments"
        :poller="batchApi.detail"
        :error-downloader="batchApi.downloadErrors"
      />
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="form.id ? '编辑课程' : '新增课程'"
      width="440px"
      append-to-body
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="课程编码" prop="code">
          <el-input v-model="form.code" maxlength="32" />
        </el-form-item>
        <el-form-item label="课程名称" prop="name">
          <el-input v-model="form.name" maxlength="64" />
        </el-form-item>
        <el-form-item label="开课学院" prop="collegeId">
          <el-select v-model="form.collegeId" style="width: 100%">
            <el-option
              v-for="college in colleges"
              :key="college.id"
              :label="college.name"
              :value="college.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="学分">
          <el-input-number v-model="form.credit" :min="0" :max="10" :precision="1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="assignmentDialog" title="新增任课关系" width="440px" append-to-body>
      <el-form :model="assignmentForm" label-width="96px">
        <el-form-item label="课程">
          <el-select v-model="assignmentForm.courseId" style="width: 100%">
            <el-option
              v-for="row in rows"
              :key="row.id"
              :label="`${row.code} ${row.name}`"
              :value="row.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="任课教师">
          <el-input v-model="assignmentForm.teacherName" placeholder="教师姓名" maxlength="32" />
        </el-form-item>
        <el-form-item label="班级">
          <el-input
            v-model="assignmentForm.className"
            placeholder="如 计算机 2301"
            maxlength="32"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="assignmentDialog = false">取消</el-button>
        <el-button type="primary" :loading="assignmentSaving" @click="submitAssignment">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
