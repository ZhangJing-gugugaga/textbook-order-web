<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { FormInstance } from 'element-plus'
import { courseApi } from '@/api/course'
import { orgApi } from '@/api/semester'
import { accountsApi, batchApi } from '@/api/people'
import { downloadErrorDetail } from '@/api/http'
import ImportWizard from '@/components/ImportWizard.vue'
import PermButton from '@/components/PermButton.vue'
import { useWindowStore } from '@/stores/window'
import { COPY, PERMISSIONS, ROLES } from '@/utils/constants'
import { asRow } from '@/utils/table'
import { validateForm } from '@/utils/validate'
import type { Course, Klass, TeacherCourse } from '@/types'

/**
 * 课程与任课管理（PRD 教材室-课程与任课管理 / API.md §3.4）：
 * 课程按学期维护（GET /api/admin/course?semesterId=，不分页）+ 任课关系（教师-课程-班级）+ Excel 导入。
 * 征订范围 = 任课关系表：某课程本学期不征订 = 不建立该任课关系。
 */
const windowStore = useWindowStore()

const courses = ref<Course[]>([])
const assignments = ref<TeacherCourse[]>([])
const classes = ref<Klass[]>([])
const teachers = ref<{ id: number; name: string; userNo: string }[]>([])
const loading = ref(false)

const semesterId = computed(() => windowStore.semesterId ?? undefined)

async function load() {
  loading.value = true
  try {
    const [courseList, assignmentList] = await Promise.all([
      courseApi.list(semesterId.value),
      courseApi.assignments({ semesterId: semesterId.value }),
    ])
    courses.value = courseList
    assignments.value = assignmentList
  } catch (error) {
    courses.value = []
    assignments.value = []
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    loading.value = false
  }
}

async function loadRefs() {
  classes.value = await orgApi.classes().catch(() => [])
  const page = await accountsApi
    .page({ roleCode: ROLES.TEACHER, status: 1, page: 1, size: 200 })
    .catch(() => null)
  teachers.value = (page?.list ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    userNo: item.userNo,
  }))
}

/* ---------------- 课程维护 ---------------- */
const dialogVisible = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({ id: 0, code: '', name: '' })
const rules = { name: [{ required: true, message: '请输入课程名称', trigger: 'blur' }] }

function openCreate() {
  Object.assign(form, { id: 0, code: '', name: '' })
  dialogVisible.value = true
}

function openEdit(row: Course) {
  Object.assign(form, { id: row.id, code: row.code ?? '', name: row.name })
  dialogVisible.value = true
}

async function submit() {
  if (!(await validateForm(formRef.value))) return
  saving.value = true
  try {
    // 同学期同 code 重复 → 409 STATE_CONFLICT（后端裁决）
    if (form.id) {
      await courseApi.update(form.id, { code: form.code || undefined, name: form.name })
    } else {
      await courseApi.create({
        semesterId: semesterId.value,
        code: form.code || undefined,
        name: form.name,
      })
    }
    ElMessage.success(COPY.SUCCESS)
    dialogVisible.value = false
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    saving.value = false
  }
}

/* ---------------- 任课关系 ---------------- */
const assignmentDialog = ref(false)
const assignmentSaving = ref(false)
const assignmentForm = reactive({
  teacherId: undefined as number | undefined,
  courseId: undefined as number | undefined,
  classId: undefined as number | undefined,
})

function openAssignment() {
  assignmentForm.teacherId = undefined
  assignmentForm.courseId = undefined
  assignmentForm.classId = undefined
  assignmentDialog.value = true
}

async function submitAssignment() {
  const { teacherId, courseId, classId } = assignmentForm
  if (!teacherId || !courseId || !classId) {
    ElMessage.error('请完整选择教师、课程与班级')
    return
  }
  assignmentSaving.value = true
  try {
    await courseApi.createAssignment({
      semesterId: semesterId.value,
      teacherId,
      courseId,
      classId,
    })
    ElMessage.success(COPY.SUCCESS)
    assignmentDialog.value = false
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    assignmentSaving.value = false
  }
}

async function removeAssignment(row: TeacherCourse) {
  try {
    await ElMessageBox.confirm(
      `确认删除任课关系「${row.teacherName} - ${row.courseName} - ${row.className}」？删除后该教师不再填报此课程。`,
      '删除',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await courseApi.removeAssignment(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}

onMounted(async () => {
  await windowStore.fetch()
  await Promise.all([load(), loadRefs()])
})
</script>

<template>
  <div class="app-page">
    <h3 class="mb-16">课程维护（当前学期）</h3>
    <div class="app-toolbar">
      <span class="text-muted">
        课程按学期维护，同 code 重复将提示冲突；课程删除请通过不建立任课关系实现（征订范围 =
        任课关系表）。
      </span>
      <PermButton :code="PERMISSIONS.COURSE_MANAGE" type="primary" @click="openCreate">
        新增课程
      </PermButton>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="courses" border stripe>
      <el-table-column prop="id" label="编号" width="90" />
      <el-table-column prop="code" label="课程编码" width="150">
        <template #default="{ row }">{{ row.code || '—' }}</template>
      </el-table-column>
      <el-table-column prop="name" label="课程名称" min-width="200" />
      <el-table-column prop="semesterId" label="学期" width="100" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <PermButton
            :code="PERMISSIONS.COURSE_MANAGE"
            size="small"
            text
            @click="openEdit(asRow<Course>(row))"
          >
            编辑
          </PermButton>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :description="COPY.EMPTY" :image-size="80" />
      </template>
    </el-table>

    <h3 class="mt-16 mb-16">
      任课关系（教师 - 课程 - 班级）
      <PermButton
        :code="PERMISSIONS.TEACHER_COURSE_MANAGE"
        class="ml-8"
        size="small"
        @click="openAssignment"
      >
        新增任课关系
      </PermButton>
    </h3>
    <el-table :data="assignments" border stripe>
      <el-table-column prop="courseName" label="课程" min-width="160" />
      <el-table-column prop="teacherName" label="任课教师" width="140" />
      <el-table-column prop="className" label="班级" width="160" />
      <el-table-column label="操作" width="120">
        <template #default="{ row }">
          <PermButton
            :code="PERMISSIONS.TEACHER_COURSE_MANAGE"
            size="small"
            type="danger"
            text
            @click="removeAssignment(asRow<TeacherCourse>(row))"
          >
            删除
          </PermButton>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :description="COPY.EMPTY" :image-size="70" />
      </template>
    </el-table>

    <div class="mt-16">
      <ImportWizard
        title="任课关系 Excel 导入（课程代码 / 课程名 / 教师工号 / 班级名称 / 学期）"
        :uploader="(file: File) => courseApi.importAssignments(file, semesterId)"
        :poller="batchApi.detail"
        :error-downloader="downloadErrorDetail"
        :template-downloader="courseApi.assignmentTemplate"
      />
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="form.id ? '编辑课程' : '新增课程'"
      width="440px"
      append-to-body
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="课程编码">
          <el-input v-model="form.code" maxlength="32" placeholder="如 CS101" />
        </el-form-item>
        <el-form-item label="课程名称" prop="name">
          <el-input v-model="form.name" maxlength="64" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <PermButton
          :code="PERMISSIONS.COURSE_MANAGE"
          type="primary"
          :loading="saving"
          @click="submit"
        >
          保存
        </PermButton>
      </template>
    </el-dialog>

    <el-dialog v-model="assignmentDialog" title="新增任课关系" width="440px" append-to-body>
      <el-form :model="assignmentForm" label-width="96px">
        <el-form-item label="任课教师" required>
          <el-select v-model="assignmentForm.teacherId" filterable style="width: 100%">
            <el-option
              v-for="teacher in teachers"
              :key="teacher.id"
              :label="`${teacher.name}（${teacher.userNo}）`"
              :value="teacher.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="课程" required>
          <el-select v-model="assignmentForm.courseId" filterable style="width: 100%">
            <el-option
              v-for="course in courses"
              :key="course.id"
              :label="`${course.code || ''} ${course.name}`"
              :value="course.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="班级" required>
          <el-select v-model="assignmentForm.classId" filterable style="width: 100%">
            <el-option
              v-for="klass in classes"
              :key="klass.id"
              :label="klass.name"
              :value="klass.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="assignmentDialog = false">取消</el-button>
        <PermButton
          :code="PERMISSIONS.TEACHER_COURSE_MANAGE"
          type="primary"
          :loading="assignmentSaving"
          @click="submitAssignment"
        >
          保存
        </PermButton>
      </template>
    </el-dialog>
  </div>
</template>
