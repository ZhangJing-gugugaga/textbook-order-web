<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { FormInstance } from 'element-plus'
import { orgApi } from '@/api/semester'
import PermButton from '@/components/PermButton.vue'
import { COPY, PERMISSIONS } from '@/utils/constants'
import { asRow } from '@/utils/table'
import { validateForm } from '@/utils/validate'
import type { College, Klass, Major } from '@/types'

/**
 * 组织管理（PRD 教材室-组织管理 / API.md §3.3）：
 * 学院 / 专业 / 班级三级维护。后端为三张独立表（GET 按父级过滤），前端按需组装成树；
 * 接口不提供删除（严格模式：导入名单不自动创建组织，历史数据由软删除保留）。
 */
const colleges = ref<College[]>([])
const majors = ref<Major[]>([])
const classes = ref<Klass[]>([])
const loading = ref(false)
const activeColleges = ref<number[]>([])

async function load() {
  loading.value = true
  try {
    colleges.value = await orgApi.colleges()
    majors.value = await orgApi.majors()
    classes.value = await orgApi.classes()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    loading.value = false
  }
}

/** 学院 → 专业 → 班级 树（由三张表的父级外键组装） */
const tree = computed(() =>
  colleges.value.map((college) => ({
    ...college,
    majors: majors.value
      .filter((major) => major.collegeId === college.id)
      .map((major) => ({
        ...major,
        classes: classes.value.filter((klass) => klass.majorId === major.id),
      })),
  })),
)

/* ---------------- 学院 ---------------- */
const collegeDialog = ref(false)
const collegeSaving = ref(false)
const collegeFormRef = ref<FormInstance>()
const collegeForm = reactive({ id: 0, name: '', fullName: '' })
const collegeRules = { name: [{ required: true, message: '请输入学院名称', trigger: 'blur' }] }

function openCollege(college?: College) {
  collegeForm.id = college?.id ?? 0
  collegeForm.name = college?.name ?? ''
  collegeForm.fullName = college?.fullName ?? ''
  collegeDialog.value = true
}

async function submitCollege() {
  if (!(await validateForm(collegeFormRef.value))) return
  collegeSaving.value = true
  try {
    const payload = { name: collegeForm.name, fullName: collegeForm.fullName || undefined }
    if (collegeForm.id) await orgApi.updateCollege(collegeForm.id, payload)
    else await orgApi.createCollege(payload)
    ElMessage.success(COPY.SUCCESS)
    collegeDialog.value = false
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    collegeSaving.value = false
  }
}

/* ---------------- 专业 ---------------- */
const majorDialog = ref(false)
const majorSaving = ref(false)
const majorFormRef = ref<FormInstance>()
const majorForm = reactive({ id: 0, collegeId: 0, name: '', fullName: '' })
const majorRules = { name: [{ required: true, message: '请输入专业名称', trigger: 'blur' }] }

function openMajor(collegeId: number, major?: Major) {
  majorForm.id = major?.id ?? 0
  majorForm.collegeId = major?.collegeId ?? collegeId
  majorForm.name = major?.name ?? ''
  majorForm.fullName = major?.fullName ?? ''
  majorDialog.value = true
}

async function submitMajor() {
  if (!(await validateForm(majorFormRef.value))) return
  majorSaving.value = true
  try {
    const payload = {
      collegeId: majorForm.collegeId,
      name: majorForm.name,
      fullName: majorForm.fullName || undefined,
    }
    if (majorForm.id) await orgApi.updateMajor(majorForm.id, payload)
    else await orgApi.createMajor(payload)
    ElMessage.success(COPY.SUCCESS)
    majorDialog.value = false
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    majorSaving.value = false
  }
}

/* ---------------- 班级 ---------------- */
const classDialog = ref(false)
const classSaving = ref(false)
const classFormRef = ref<FormInstance>()
const classForm = reactive({ id: 0, majorId: 0, name: '', grade: '', studentCount: 40 })
const classRules = {
  name: [{ required: true, message: '请输入班级名称', trigger: 'blur' }],
  studentCount: [{ required: true, message: '请输入班级人数', trigger: 'blur' }],
}

function openClass(majorId: number, klass?: Klass) {
  classForm.id = klass?.id ?? 0
  classForm.majorId = klass?.majorId ?? majorId
  classForm.name = klass?.name ?? ''
  classForm.grade = klass?.grade ?? ''
  classForm.studentCount = klass?.studentCount ?? 40
  classDialog.value = true
}

async function submitClass() {
  if (!(await validateForm(classFormRef.value))) return
  classSaving.value = true
  try {
    const payload = {
      majorId: classForm.majorId,
      name: classForm.name,
      grade: classForm.grade || undefined,
      studentCount: classForm.studentCount,
    }
    if (classForm.id) await orgApi.updateClass(classForm.id, payload)
    else await orgApi.createClass(payload)
    ElMessage.success(COPY.SUCCESS)
    classDialog.value = false
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    classSaving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="app-page" v-loading="loading">
    <div class="flex-between mb-16">
      <span class="text-muted">
        学院 / 专业 /
        班级三级组织维护；班级人数是教师征订数量上限的来源（严格模式：导入名单不会自动创建组织）。
      </span>
      <PermButton :code="PERMISSIONS.ORG_COLLEGE_MANAGE" type="primary" @click="openCollege()">
        新增学院
      </PermButton>
    </div>

    <el-collapse v-model="activeColleges">
      <el-collapse-item v-for="college in tree" :key="college.id" :name="college.id">
        <template #title>
          <div class="flex-between collapse-title">
            <span>
              <strong>{{ college.name }}</strong>
              <span class="text-muted">
                （{{ college.fullName || '—' }} · {{ college.majors.length }} 个专业）
              </span>
            </span>
            <div class="app-table-actions" @click.stop>
              <PermButton
                :code="PERMISSIONS.ORG_MAJOR_MANAGE"
                size="small"
                text
                @click="openMajor(college.id)"
              >
                新增专业
              </PermButton>
              <PermButton
                :code="PERMISSIONS.ORG_COLLEGE_MANAGE"
                size="small"
                text
                @click="openCollege(college)"
              >
                编辑
              </PermButton>
            </div>
          </div>
        </template>

        <div v-for="major in college.majors" :key="major.id" class="major-block">
          <div class="flex-between">
            <span>
              <strong>{{ major.name }}</strong>
              <span class="text-muted">（{{ major.classes.length }} 个班级）</span>
            </span>
            <div class="app-table-actions">
              <PermButton
                :code="PERMISSIONS.ORG_CLASS_MANAGE"
                size="small"
                text
                @click="openClass(major.id)"
              >
                新增班级
              </PermButton>
              <PermButton
                :code="PERMISSIONS.ORG_MAJOR_MANAGE"
                size="small"
                text
                @click="openMajor(college.id, major)"
              >
                编辑
              </PermButton>
            </div>
          </div>
          <el-table :data="major.classes" size="small" border class="mt-8">
            <el-table-column prop="name" label="班级" min-width="140" />
            <el-table-column prop="grade" label="年级" width="100">
              <template #default="{ row }">{{ row.grade || '—' }}</template>
            </el-table-column>
            <el-table-column prop="studentCount" label="班级人数" width="110">
              <template #default="{ row }">{{ row.studentCount ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="100">
              <template #default="{ row }">
                <PermButton
                  :code="PERMISSIONS.ORG_CLASS_MANAGE"
                  size="small"
                  text
                  @click="openClass(major.id, asRow<Klass>(row))"
                >
                  编辑
                </PermButton>
              </template>
            </el-table-column>
            <template #empty>
              <el-empty :description="COPY.EMPTY" :image-size="50" />
            </template>
          </el-table>
        </div>
        <el-empty v-if="college.majors.length === 0" :image-size="60" description="暂无专业" />
      </el-collapse-item>
    </el-collapse>

    <el-empty v-if="!loading && tree.length === 0" :description="COPY.EMPTY" />

    <!-- 学院弹窗 -->
    <el-dialog
      v-model="collegeDialog"
      :title="collegeForm.id ? '编辑学院' : '新增学院'"
      width="420px"
      append-to-body
    >
      <el-form ref="collegeFormRef" :model="collegeForm" :rules="collegeRules" label-width="88px">
        <el-form-item label="学院名称" prop="name">
          <el-input v-model="collegeForm.name" maxlength="32" />
        </el-form-item>
        <el-form-item label="全称">
          <el-input v-model="collegeForm.fullName" maxlength="64" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="collegeDialog = false">取消</el-button>
        <PermButton
          :code="PERMISSIONS.ORG_COLLEGE_MANAGE"
          type="primary"
          :loading="collegeSaving"
          @click="submitCollege"
        >
          保存
        </PermButton>
      </template>
    </el-dialog>

    <!-- 专业弹窗 -->
    <el-dialog
      v-model="majorDialog"
      :title="majorForm.id ? '编辑专业' : '新增专业'"
      width="420px"
      append-to-body
    >
      <el-form ref="majorFormRef" :model="majorForm" :rules="majorRules" label-width="88px">
        <el-form-item label="所属学院">
          <el-select v-model="majorForm.collegeId" style="width: 100%">
            <el-option
              v-for="college in colleges"
              :key="college.id"
              :label="college.name"
              :value="college.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="专业名称" prop="name">
          <el-input v-model="majorForm.name" maxlength="32" />
        </el-form-item>
        <el-form-item label="全称">
          <el-input v-model="majorForm.fullName" maxlength="64" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="majorDialog = false">取消</el-button>
        <PermButton
          :code="PERMISSIONS.ORG_MAJOR_MANAGE"
          type="primary"
          :loading="majorSaving"
          @click="submitMajor"
        >
          保存
        </PermButton>
      </template>
    </el-dialog>

    <!-- 班级弹窗 -->
    <el-dialog
      v-model="classDialog"
      :title="classForm.id ? '编辑班级' : '新增班级'"
      width="420px"
      append-to-body
    >
      <el-form ref="classFormRef" :model="classForm" :rules="classRules" label-width="88px">
        <el-form-item label="所属专业">
          <el-select v-model="classForm.majorId" style="width: 100%">
            <el-option
              v-for="major in majors"
              :key="major.id"
              :label="major.name"
              :value="major.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="班级名称" prop="name">
          <el-input v-model="classForm.name" maxlength="32" placeholder="如 软工2023-1" />
        </el-form-item>
        <el-form-item label="年级">
          <el-input v-model="classForm.grade" maxlength="8" placeholder="如 2023" />
        </el-form-item>
        <el-form-item label="班级人数" prop="studentCount">
          <el-input-number v-model="classForm.studentCount" :min="1" :max="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="classDialog = false">取消</el-button>
        <PermButton
          :code="PERMISSIONS.ORG_CLASS_MANAGE"
          type="primary"
          :loading="classSaving"
          @click="submitClass"
        >
          保存
        </PermButton>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.collapse-title {
  width: 100%;
  padding-right: 12px;
}

.major-block {
  padding: 12px 0;
  border-bottom: 1px dashed #e6e8f0;
}

.major-block:last-child {
  border-bottom: none;
}
</style>
