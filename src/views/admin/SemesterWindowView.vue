<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { FormInstance } from 'element-plus'
import { semesterApi } from '@/api/semester'
import SemesterLifecyclePanel from '@/components/SemesterLifecyclePanel.vue'
import { COPY, DATETIME_FORMAT, SEMESTER_ACTIVE_STATUS, WINDOW_STATUS } from '@/utils/constants'
import { formatDate, formatDateTime } from '@/utils/format'
import { validateForm } from '@/utils/validate'
import type { Semester } from '@/types'

/**
 * 学期与窗口引擎（PRD 征订窗口管理页 / API.md §3.2）：
 * 学期列表 + 生命周期（新建 draft → 激活双缓冲切换 → 归档）+ 窗口操作，唯一控制入口。
 * 时间格式统一 yyyy-MM-dd HH:mm:ss（后端 spring.mvc.format.date-time）。
 */
const semesters = ref<Semester[]>([])
const selectedId = ref(0)
const loading = ref(false)
const selected = computed(() => semesters.value.find((s) => s.id === selectedId.value) ?? null)

async function load() {
  loading.value = true
  try {
    semesters.value = await semesterApi.list()
    if (!selectedId.value || !semesters.value.some((s) => s.id === selectedId.value)) {
      selectedId.value =
        semesters.value.find((s) => s.activeStatus === 'active')?.id ?? semesters.value[0]?.id ?? 0
    }
  } catch (error) {
    semesters.value = []
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    loading.value = false
  }
}

/* ---------------- 新建学期 ---------------- */
const createVisible = ref(false)
const creating = ref(false)
const createFormRef = ref<FormInstance>()
const createForm = reactive({
  name: '',
  startDate: '',
  endDate: '',
  windowStart: '',
  windowEnd: '',
  autoOpen: 1,
  autoClose: 1,
})
const createRules = {
  name: [{ required: true, message: '请输入学期名称', trigger: 'blur' }],
  startDate: [{ required: true, message: '请选择学期开始日期', trigger: 'change' }],
  endDate: [{ required: true, message: '请选择学期结束日期', trigger: 'change' }],
  windowStart: [{ required: true, message: '请选择窗口开始时间', trigger: 'change' }],
  windowEnd: [{ required: true, message: '请选择窗口截止时间', trigger: 'change' }],
}

function openCreate() {
  Object.assign(createForm, {
    name: '',
    startDate: '',
    endDate: '',
    windowStart: '',
    windowEnd: '',
    autoOpen: 1,
    autoClose: 1,
  })
  createVisible.value = true
}

async function submitCreate() {
  if (!(await validateForm(createFormRef.value))) return
  if (new Date(createForm.windowStart) >= new Date(createForm.windowEnd)) {
    ElMessage.error('窗口开始时间必须早于结束时间')
    return
  }
  creating.value = true
  try {
    const created = await semesterApi.create({ ...createForm })
    ElMessage.success('学期已创建（可导入），激活后进入缓冲区数据导入')
    createVisible.value = false
    await load()
    selectedId.value = created.id
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    creating.value = false
  }
}

function semesterStatusLabel(status: string) {
  return SEMESTER_ACTIVE_STATUS[status as keyof typeof SEMESTER_ACTIVE_STATUS] ?? status
}

function windowStatusLabel(status: string) {
  return WINDOW_STATUS[status as keyof typeof WINDOW_STATUS] ?? status
}

onMounted(load)
</script>

<template>
  <div class="app-page" v-loading="loading">
    <div class="flex-between mb-16">
      <span class="text-muted">同一时刻仅一个 active 学期；窗口变更将自动通知全员。</span>
      <el-button type="primary" @click="openCreate">新建学期</el-button>
    </div>

    <el-table :data="semesters" border stripe @row-click="(row: Semester) => (selectedId = row.id)">
      <el-table-column label="选择" width="70">
        <template #default="{ row }">
          <el-radio :model-value="selectedId" :value="row.id" @change="selectedId = row.id">
            &nbsp;
          </el-radio>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="学期" min-width="180" />
      <el-table-column label="学期起止" min-width="200">
        <template #default="{ row }">
          {{ formatDate(row.startDate) }} ~ {{ formatDate(row.endDate) }}
        </template>
      </el-table-column>
      <el-table-column label="窗口起止" min-width="300">
        <template #default="{ row }">
          <span v-if="row.windowStart">
            {{ formatDateTime(row.windowStart) }} ~ {{ formatDateTime(row.windowEnd) }}
          </span>
          <span v-else class="text-muted">未设置</span>
        </template>
      </el-table-column>
      <el-table-column label="学期状态" width="110">
        <template #default="{ row }">
          <el-tag :type="row.activeStatus === 'active' ? 'success' : 'info'" size="small">
            {{ semesterStatusLabel(row.activeStatus) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="窗口状态" width="110">
        <template #default="{ row }">
          <el-tag :type="row.windowStatus === 'open' ? 'success' : 'warning'" size="small">
            {{ windowStatusLabel(row.windowStatus) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="自动开关窗" width="150">
        <template #default="{ row }">
          <el-tag size="small" :type="row.autoOpen === 1 ? 'success' : 'info'">
            开窗{{ row.autoOpen === 1 ? '自动' : '手动' }}
          </el-tag>
          <el-tag size="small" :type="row.autoClose === 1 ? 'success' : 'info'" class="ml-8">
            截止{{ row.autoClose === 1 ? '自动' : '手动' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="version" label="版本" width="80" align="center" />
      <template #empty>
        <el-empty :description="COPY.EMPTY" :image-size="80" />
      </template>
    </el-table>

    <div v-if="selected" class="mt-16">
      <SemesterLifecyclePanel :key="selected.id" :semester="selected" @changed="load" />
    </div>
    <el-empty v-else :description="COPY.EMPTY" />

    <el-dialog v-model="createVisible" title="新建学期" width="560px" append-to-body>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="120px">
        <el-form-item label="学期名称" prop="name">
          <el-input
            v-model="createForm.name"
            placeholder="如 2027-2028学年秋季学期"
            maxlength="32"
          />
        </el-form-item>
        <el-form-item label="学期起止" required>
          <div class="flex-between">
            <el-date-picker
              v-model="createForm.startDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="开始日期"
            />
            <span class="text-muted">~</span>
            <el-date-picker
              v-model="createForm.endDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="结束日期"
            />
          </div>
        </el-form-item>
        <el-form-item label="窗口开始" prop="windowStart">
          <el-date-picker
            v-model="createForm.windowStart"
            type="datetime"
            :value-format="DATETIME_FORMAT"
            placeholder="选择窗口开始时间"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="窗口截止" prop="windowEnd">
          <el-date-picker
            v-model="createForm.windowEnd"
            type="datetime"
            :value-format="DATETIME_FORMAT"
            placeholder="选择窗口截止时间（天数任意）"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="自动开启">
          <el-switch v-model="createForm.autoOpen" :active-value="1" :inactive-value="0" />
        </el-form-item>
        <el-form-item label="自动截止">
          <el-switch v-model="createForm.autoClose" :active-value="1" :inactive-value="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>
