<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, FormInstance } from 'element-plus'
import { accountsApi } from '@/api/people'
import { orgApi } from '@/api/semester'
import { COPY, ROLE_LABELS } from '@/utils/constants'
import type { Account, RoleCode } from '@/types'

/** 账号管理（PRD 教材室-账号管理）：建号（含供货商）/ 停用启用 / 重置密码 */
const query = ref<{ keyword: string; role: string; status: string; page: number; size: number }>({
  keyword: '',
  role: '',
  status: '',
  page: 1,
  size: 10,
})
const rows = ref<Account[]>([])
const total = ref(0)
const loading = ref(false)

const colleges = ref<{ id: number; name: string }[]>([])

async function load() {
  loading.value = true
  try {
    const result = await accountsApi.page({
      keyword: query.value.keyword || undefined,
      role: query.value.role || undefined,
      status: query.value.status || undefined,
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

/* ---------------- 新建账号 ---------------- */
const createVisible = ref(false)
const creating = ref(false)
const createFormRef = ref<FormInstance>()
const createForm = reactive({
  userNo: '',
  name: '',
  role: 'teacher' as RoleCode,
  collegeId: undefined as number | undefined,
  initialPassword: '',
})
const createRules = {
  userNo: [
    { required: true, message: '请输入学号/工号', trigger: 'blur' },
    { pattern: /^[A-Za-z0-9]{4,32}$/, message: '4-32 位字母或数字', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
  initialPassword: [{ required: true, message: '请输入初始密码', trigger: 'blur' }],
}

function openCreate() {
  createForm.userNo = ''
  createForm.name = ''
  createForm.role = 'teacher'
  createForm.collegeId = undefined
  createForm.initialPassword = ''
  createVisible.value = true
}

async function submitCreate() {
  await createFormRef.value?.validate()
  creating.value = true
  try {
    await accountsApi.create({ ...createForm })
    ElMessage.success('账号已创建，初始密码请线下分发')
    createVisible.value = false
    void load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    creating.value = false
  }
}

/* ---------------- 停用 / 启用 ---------------- */
async function toggleStatus(row: Account) {
  const nextStatus = row.status === 'active' ? 'disabled' : 'active'
  const action = nextStatus === 'disabled' ? '停用' : '启用'
  try {
    await ElMessageBox.confirm(`确认${action}账号 ${row.name}（${row.userNo}）？`, action, {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await accountsApi.setStatus(row.id, nextStatus)
    ElMessage.success(`已${action}`)
    void load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}

/* ---------------- 重置密码 ---------------- */
async function resetPassword(row: Account) {
  try {
    await ElMessageBox.confirm(
      `确认重置 ${row.name}（${row.userNo}）的密码？重置后需使用初始密码登录并强制改密。`,
      '重置密码',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    const result = await accountsApi.resetPassword(row.id)
    ElMessage.success(`已重置，初始密码：${result.initialPassword}`)
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
    <div class="app-toolbar">
      <el-input
        v-model="query.keyword"
        placeholder="学号/工号/姓名"
        clearable
        style="width: 200px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-select
        v-model="query.role"
        placeholder="角色"
        clearable
        style="width: 180px"
        @change="search"
      >
        <el-option v-for="(label, key) in ROLE_LABELS" :key="key" :label="label" :value="key" />
      </el-select>
      <el-select
        v-model="query.status"
        placeholder="状态"
        clearable
        style="width: 140px"
        @change="search"
      >
        <el-option label="启用" value="active" />
        <el-option label="停用" value="disabled" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <PermButton code="sys:user:manage" @click="openCreate">新建账号</PermButton>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column prop="userNo" label="学号/工号" width="140" />
      <el-table-column prop="name" label="姓名" width="120" />
      <el-table-column label="角色" width="180">
        <template #default="{ row }">{{ ROLE_LABELS[row.role] || row.role }}</template>
      </el-table-column>
      <el-table-column prop="collegeName" label="所属学院" min-width="140" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
            {{ row.status === 'active' ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="初始密码" width="110">
        <template #default="{ row }">
          <el-tag v-if="row.mustChangePassword" type="warning" size="small">待修改</el-tag>
          <span v-else class="text-muted">已设置</span>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="{ row }">{{ row.createdAt }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <div class="app-table-actions">
            <el-button
              size="small"
              :type="row.status === 'active' ? 'danger' : 'success'"
              text
              @click="toggleStatus(row)"
            >
              {{ row.status === 'active' ? '停用' : '启用' }}
            </el-button>
            <el-button size="small" text @click="resetPassword(row)">重置密码</el-button>
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

    <el-dialog v-model="createVisible" title="新建账号" width="480px" append-to-body>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="96px">
        <el-form-item label="学号/工号" prop="userNo">
          <el-input v-model="createForm.userNo" maxlength="32" placeholder="4-32 位字母或数字" />
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="createForm.name" maxlength="32" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="createForm.role" style="width: 100%">
            <el-option v-for="(label, key) in ROLE_LABELS" :key="key" :label="label" :value="key" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="createForm.role !== 'admin'" label="所属学院">
          <el-select
            v-model="createForm.collegeId"
            placeholder="可选"
            clearable
            style="width: 100%"
          >
            <el-option
              v-for="college in colleges"
              :key="college.id"
              :label="college.name"
              :value="college.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="初始密码" prop="initialPassword">
          <el-input v-model="createForm.initialPassword" placeholder="默认学号/工号后 6 位" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>
