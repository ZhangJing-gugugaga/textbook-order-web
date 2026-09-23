<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'

import { permissionApi, roleApi } from '@/api/role'
import PermButton from '@/components/PermButton.vue'
import { COPY, PERMISSIONS } from '@/utils/constants'
import { asRow } from '@/utils/table'
import type { PermissionGroup, RoleListItem } from '@/types'

/**
 * 角色管理（BE-2 / 决策 FE-W2）：超管可管理角色（新建/改名/删除）并给角色勾选权限。
 *
 * **口径（决策 D2）**：角色配置只作用于**权限码集合**（接口可达性 + 按钮级权限）；
 * 页面归属仍由路由 `meta.roles` 静态白名单决定——新建的自定义角色不会自动获得
 * 管理台页面。这条限制写进页面提示，避免被当成缺陷。
 *
 * 超管权限由系统内置（ADMIN 行不可配权限、不可删），后端亦有兜底。
 */
const roles = ref<RoleListItem[]>([])
const loading = ref(false)

/* ---------------- 新建 / 编辑 ---------------- */
const dialogVisible = ref(false)
const editing = ref<RoleListItem | null>(null)
const submitting = ref(false)
const form = reactive({ roleCode: '', roleName: '', sort: 0 })
const formRef = ref()

const rules = {
  roleCode: [
    { required: true, message: '请输入角色编码', trigger: 'blur' },
    {
      pattern: /^[A-Z][A-Z0-9_]{1,31}$/,
      message: '大写字母开头，可含数字与下划线，2–32 位',
      trigger: 'blur',
    },
  ],
  roleName: [
    { required: true, message: '请输入角色名称', trigger: 'blur' },
    { max: 64, message: '不超过 64 字', trigger: 'blur' },
  ],
}

const dialogTitle = computed(() => (editing.value ? '编辑角色' : '新建角色'))

async function load() {
  loading.value = true
  try {
    roles.value = await roleApi.list()
  } catch (error) {
    roles.value = []
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.roleCode = ''
  form.roleName = ''
  form.sort = 0
  dialogVisible.value = true
}

function openEdit(row: RoleListItem) {
  editing.value = row
  form.roleCode = row.roleCode
  form.roleName = row.roleName
  form.sort = row.sort ?? 0
  dialogVisible.value = true
}

async function submit() {
  if (!(await formRef.value?.validate().catch(() => false))) return
  submitting.value = true
  try {
    if (editing.value) {
      // 编码不可改，只提交名称与排序
      await roleApi.update(editing.value.id, { roleName: form.roleName, sort: form.sort })
      ElMessage.success('角色已更新')
    } else {
      await roleApi.create({ roleCode: form.roleCode, roleName: form.roleName, sort: form.sort })
      ElMessage.success('角色已创建')
    }
    dialogVisible.value = false
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    submitting.value = false
  }
}

async function remove(row: RoleListItem) {
  try {
    await ElMessageBox.confirm('删除后该角色权限配置一并清除，且不可恢复。', '删除角色', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await roleApi.remove(row.id)
    ElMessage.success('角色已删除')
    await load()
  } catch (error) {
    // 409 时后端 message 已含「该角色仍有 N 个账号，请先调整账号角色」，原样展示
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}

/* ---------------- 配置权限 ---------------- */
const drawerVisible = ref(false)
const currentRole = ref<RoleListItem | null>(null)
const catalog = ref<PermissionGroup[]>([])
const catalogLoading = ref(false)
const savingPerms = ref(false)
const treeRef = ref()

/** el-tree 数据：模块为父节点（不可选），权限码为叶子 */
const treeData = computed(() =>
  catalog.value.map((group) => ({
    id: `module:${group.module}`,
    label: group.module,
    disabled: true,
    children: group.perms.map((perm) => ({
      id: perm.permCode,
      label: perm.permName,
      permCode: perm.permCode,
    })),
  })),
)

async function openPermissions(row: RoleListItem) {
  currentRole.value = row
  drawerVisible.value = true
  if (!catalog.value.length) {
    catalogLoading.value = true
    try {
      catalog.value = await permissionApi.catalog()
    } catch (error) {
      ElMessage.error((error as Error)?.message || COPY.FAILED)
    } finally {
      catalogLoading.value = false
    }
  }
  // 勾选现有权限（父节点由子节点半选自动推导）
  await nextTick()
  treeRef.value?.setCheckedKeys(row.permCodes ?? [], false)
}

async function savePermissions() {
  if (!currentRole.value) return
  // 只取叶子节点，父节点（module）不是权限码
  const checked = (treeRef.value?.getCheckedKeys(true) ?? []) as string[]
  savingPerms.value = true
  try {
    await roleApi.assignPermissions(currentRole.value.id, checked)
    ElMessage.success('权限已保存')
    drawerVisible.value = false
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    savingPerms.value = false
  }
}

function permCount(row: unknown) {
  return asRow<RoleListItem>(row).permCodes?.length ?? 0
}

/**
 * 插槽 row 的类型边界收在脚本内。
 * **模板里不能写 `asRow<T>(row)`**——插值中的 `<T>` 会被 Vue 模板编译器当成 HTML 标签
 * （报 "Unexpected closing tag"），故字段读取一律走下面这几个函数。
 */
function isBuiltIn(row: unknown) {
  return asRow<RoleListItem>(row).builtIn
}

function isAdminRole(row: unknown) {
  return asRow<RoleListItem>(row).roleCode === 'ADMIN'
}

onMounted(load)
</script>

<template>
  <div class="app-page">
    <div class="app-toolbar">
      <PermButton :code="PERMISSIONS.ROLE_MANAGE" type="primary" icon="Plus" @click="openCreate">
        新建角色
      </PermButton>
      <el-button @click="load">刷新</el-button>
      <span class="text-muted">
        角色配置只影响权限码（接口与按钮）；页面归属仍由系统内置规则决定，自定义角色不会自动获得管理台页面
      </span>
    </div>

    <el-table v-loading="loading" :data="roles" border stripe>
      <el-table-column prop="roleName" label="角色名称" min-width="160" />
      <el-table-column prop="roleCode" label="角色编码" min-width="160" />
      <el-table-column label="类型" width="100" align="center">
        <template #default="{ row }">
          <el-tag v-if="isBuiltIn(row)" type="info" size="small">内置</el-tag>
          <el-tag v-else type="success" size="small">自定义</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="userCount" label="账号数" width="90" align="center" />
      <el-table-column label="权限数" width="90" align="center">
        <template #default="{ row }">{{ permCount(row) }}</template>
      </el-table-column>
      <el-table-column prop="sort" label="排序" width="80" align="center" />
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <!-- 超管权限由系统内置：ADMIN 行的「配置权限」不可点（后端亦有兜底） -->
          <el-tooltip
            v-if="isAdminRole(row)"
            content="超管权限由系统内置，不可修改"
            placement="top"
          >
            <span>
              <el-button size="small" text type="primary" disabled>配置权限</el-button>
            </span>
          </el-tooltip>
          <el-button
            v-else
            size="small"
            text
            type="primary"
            @click="openPermissions(asRow<RoleListItem>(row))"
          >
            配置权限
          </el-button>
          <el-button size="small" text type="primary" @click="openEdit(asRow<RoleListItem>(row))">
            编辑
          </el-button>
          <el-button
            size="small"
            text
            type="danger"
            :disabled="isBuiltIn(row)"
            @click="remove(asRow<RoleListItem>(row))"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :description="COPY.EMPTY" :image-size="80" />
      </template>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="460px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="角色编码" prop="roleCode">
          <el-input
            v-model="form.roleCode"
            :disabled="!!editing"
            placeholder="大写字母开头，可含数字与下划线，2–32 位"
            maxlength="32"
          />
        </el-form-item>
        <el-form-item label="角色名称" prop="roleName">
          <el-input v-model="form.roleName" maxlength="64" />
        </el-form-item>
        <el-form-item label="排序" prop="sort">
          <el-input-number v-model="form.sort" :min="0" :max="9999" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="drawerVisible"
      :title="`配置权限 · ${currentRole?.roleName ?? ''}`"
      size="480px"
    >
      <div v-loading="catalogLoading">
        <el-tree
          ref="treeRef"
          :data="treeData"
          show-checkbox
          node-key="id"
          default-expand-all
          :props="{ label: 'label', children: 'children' }"
        >
          <template #default="{ data }">
            <span>
              {{ data.label }}
              <span v-if="data.permCode" class="text-muted perm-code">{{ data.permCode }}</span>
            </span>
          </template>
        </el-tree>
      </div>
      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingPerms" @click="savePermissions">保存</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.perm-code {
  margin-left: 8px;
  font-size: 12px;
}
</style>
