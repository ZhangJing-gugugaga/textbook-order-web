<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { FormInstance } from 'element-plus'
import { accountsApi } from '@/api/people'
import { orgApi } from '@/api/semester'
import PermButton from '@/components/PermButton.vue'
import ServerTable from '@/components/ServerTable.vue'
import { COPY, PERMISSIONS, ROLE_LABELS, ROLES, USER_NO_PATTERN } from '@/utils/constants'
import { formatDateTime } from '@/utils/format'
import { asRow } from '@/utils/table'
import { validateForm } from '@/utils/validate'
import type { Account, RoleCode } from '@/types'

/**
 * 账号管理（PRD 教材室-账号管理 / API.md §3.5）：
 * 建号（含供货商）/ 停用启用（停用即时踢下线）/ 重置密码。
 * 初始密码由后端按「学号/工号后 6 位」派生并强制首登改密，前端不下发也不回显。
 *
 * 列表分页与三态由 ServerTable 基座承担（SPEC §8）；写操作按钮统一走 PermButton
 * 做按钮级权限（无权限码移除 DOM），不再只在部分按钮上判断。
 */
const filters = reactive({
  keyword: '',
  roleCode: '',
  status: undefined as number | undefined,
})
const colleges = ref<{ id: number; name: string }[]>([])
const tableRef = ref<{ reload: (resetPage?: boolean) => void } | null>(null)

/** 筛选条件 → 接口参数（空串不下发） */
function fetchPage({ page, size }: { page: number; size: number }) {
  return accountsApi.page({
    keyword: filters.keyword || undefined,
    roleCode: filters.roleCode || undefined,
    status: filters.status,
    page,
    size,
  })
}

function search() {
  tableRef.value?.reload()
}

/* ---------------- 新建账号 ---------------- */
const createVisible = ref(false)
const creating = ref(false)
const createFormRef = ref<FormInstance>()
const createForm = reactive({
  userNo: '',
  name: '',
  phone: '',
  roleCodes: [ROLES.TEACHER] as RoleCode[],
  collegeId: undefined as number | undefined,
})
const createRules = {
  userNo: [
    { required: true, message: '请输入学号/工号', trigger: 'blur' },
    { pattern: USER_NO_PATTERN, message: '4-32 位字母或数字', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  roleCodes: [{ required: true, message: '请选择角色', trigger: 'change' }],
}

function openCreate() {
  Object.assign(createForm, {
    userNo: '',
    name: '',
    phone: '',
    roleCodes: [ROLES.TEACHER],
    collegeId: undefined,
  })
  createVisible.value = true
}

async function submitCreate() {
  if (!(await validateForm(createFormRef.value))) return
  creating.value = true
  try {
    await accountsApi.create({
      userNo: createForm.userNo.trim(),
      name: createForm.name.trim(),
      phone: createForm.phone || undefined,
      collegeId: createForm.collegeId,
      roleCodes: createForm.roleCodes,
    })
    ElMessage.success('账号已创建，初始密码为学号/工号后 6 位，请线下分发')
    createVisible.value = false
    tableRef.value?.reload(false)
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    creating.value = false
  }
}

/* ---------------- 停用 / 启用 ---------------- */
async function toggleStatus(row: Account) {
  const disabling = row.status === 1
  const action = disabling ? '停用' : '启用'
  try {
    await ElMessageBox.confirm(
      disabling
        ? `确认停用账号 ${row.name}（${row.userNo}）？停用后该账号立即被踢下线。`
        : `确认启用账号 ${row.name}（${row.userNo}）？`,
      action,
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await accountsApi.setStatus(row.id, disabling ? 0 : 1)
    ElMessage.success(`已${action}`)
    tableRef.value?.reload(false)
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}

/* ---------------- 重置密码 ---------------- */
async function resetPassword(row: Account) {
  try {
    await ElMessageBox.confirm(
      `确认重置 ${row.name}（${row.userNo}）的密码？将重置为学号/工号后 6 位并强制其首登改密。`,
      '重置密码',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await accountsApi.resetPassword(row.id)
    ElMessage.success(`已重置为「${row.userNo}」后 6 位，请线下告知本人`)
    tableRef.value?.reload(false)
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}

onMounted(async () => {
  colleges.value = await orgApi.colleges().catch(() => [])
})
</script>

<template>
  <div class="app-page">
    <div class="app-toolbar">
      <el-input
        v-model="filters.keyword"
        placeholder="学号/工号/姓名"
        clearable
        style="width: 200px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-select
        v-model="filters.roleCode"
        placeholder="角色"
        clearable
        style="width: 190px"
        @change="search"
      >
        <el-option v-for="(label, key) in ROLE_LABELS" :key="key" :label="label" :value="key" />
      </el-select>
      <el-select
        v-model="filters.status"
        placeholder="状态"
        clearable
        style="width: 130px"
        @change="search"
      >
        <el-option label="启用" :value="1" />
        <el-option label="停用" :value="0" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <PermButton :code="PERMISSIONS.USER_MANAGE" @click="openCreate">新建账号</PermButton>
    </div>

    <ServerTable ref="tableRef" :fetcher="fetchPage">
      <el-table-column prop="userNo" label="学号/工号" width="140" />
      <el-table-column prop="name" label="姓名" width="120" />
      <el-table-column label="角色" min-width="200">
        <template #default="{ row }">
          <el-tag v-for="code in row.roles" :key="code" class="mr-4" size="small" type="info">
            {{ ROLE_LABELS[code] || code }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="所属学院" min-width="140">
        <template #default="{ row }">{{ row.collegeName || '—' }}</template>
      </el-table-column>
      <el-table-column label="班级" min-width="130">
        <template #default="{ row }">{{ row.className || '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">
            {{ row.status === 1 ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="密码状态" width="110">
        <template #default="{ row }">
          <el-tag v-if="row.mustChangePassword === 1" type="warning" size="small">待修改</el-tag>
          <span v-else class="text-muted">已设置</span>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <div class="app-table-actions">
            <PermButton
              :code="PERMISSIONS.USER_MANAGE"
              size="small"
              :type="row.status === 1 ? 'danger' : 'success'"
              text
              @click="toggleStatus(asRow<Account>(row))"
            >
              {{ row.status === 1 ? '停用' : '启用' }}
            </PermButton>
            <PermButton
              :code="PERMISSIONS.USER_RESET"
              size="small"
              text
              @click="resetPassword(asRow<Account>(row))"
            >
              重置密码
            </PermButton>
          </div>
        </template>
      </el-table-column>
    </ServerTable>

    <el-dialog v-model="createVisible" title="新建账号" width="480px" append-to-body>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="100px">
        <el-form-item label="学号/工号" prop="userNo">
          <el-input v-model="createForm.userNo" maxlength="32" placeholder="4-32 位字母或数字" />
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="createForm.name" maxlength="32" />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input
            v-model="createForm.phone"
            maxlength="20"
            placeholder="选填，用于首登校验后 4 位"
          />
        </el-form-item>
        <el-form-item label="角色" prop="roleCodes">
          <el-select v-model="createForm.roleCodes" multiple style="width: 100%">
            <el-option v-for="(label, key) in ROLE_LABELS" :key="key" :label="label" :value="key" />
          </el-select>
        </el-form-item>
        <el-form-item label="所属学院">
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
      </el-form>
      <el-alert
        title="初始密码 = 学号/工号后 6 位，首次登录须校验手机号后 4 位并强制改密"
        type="info"
        :closable="false"
        show-icon
      />
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <PermButton :code="PERMISSIONS.USER_MANAGE" :loading="creating" @click="submitCreate">
          创建
        </PermButton>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.mr-4 {
  margin-right: 4px;
}
</style>
