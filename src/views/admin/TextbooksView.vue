<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { FormInstance } from 'element-plus'
import { textbookApi } from '@/api/textbook'
import { batchApi } from '@/api/people'
import { downloadErrorDetail } from '@/api/http'
import ImportWizard from '@/components/ImportWizard.vue'
import PermButton from '@/components/PermButton.vue'
import ServerTable from '@/components/ServerTable.vue'
import { COPY, PERMISSIONS } from '@/utils/constants'
import { formatMoney, formatDateTime } from '@/utils/format'
import { asRow } from '@/utils/table'
import { validateForm } from '@/utils/validate'
import type { Textbook } from '@/types'

/**
 * 教材库（PRD 教材室-教材库维护 / API.md §3.4）：
 * 分页检索 + 新增/编辑 + 停用启用 + Excel 导入；教材按 ISBN 唯一，跨学期共用。
 * 后端不提供删除（软删除口径），停用即下架（学生端 delisted、教师端不可选）。
 *
 * 列表分页与三态由 ServerTable 基座承担（SPEC §8）；筛选变化后由本页显式 reload。
 */
const filters = reactive({
  isbn: '',
  title: '',
  author: '',
  press: '',
  status: undefined as number | undefined,
})
const tableRef = ref<{ reload: (resetPage?: boolean) => void } | null>(null)

/** 筛选条件 → 接口参数（空串不下发） */
function fetchPage({ page, size }: { page: number; size: number }) {
  return textbookApi.page({
    isbn: filters.isbn || undefined,
    title: filters.title || undefined,
    author: filters.author || undefined,
    press: filters.press || undefined,
    status: filters.status,
    page,
    size,
  })
}

function search() {
  tableRef.value?.reload()
}

/* ---------------- 新建 / 编辑 ---------------- */
const dialogVisible = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({
  id: 0,
  isbn: '',
  title: '',
  author: '',
  press: '',
  edition: '',
  price: 0,
  status: 1,
})
const rules = {
  isbn: [{ required: true, message: '请输入 ISBN', trigger: 'blur' }],
  title: [{ required: true, message: '请输入书名', trigger: 'blur' }],
}

function openCreate() {
  Object.assign(form, {
    id: 0,
    isbn: '',
    title: '',
    author: '',
    press: '',
    edition: '',
    price: 0,
    status: 1,
  })
  dialogVisible.value = true
}

function openEdit(row: Textbook) {
  Object.assign(form, {
    id: row.id,
    isbn: row.isbn,
    title: row.title,
    author: row.author ?? '',
    press: row.press ?? '',
    edition: row.edition ?? '',
    price: row.price ?? 0,
    status: row.status,
  })
  dialogVisible.value = true
}

async function submit() {
  if (!(await validateForm(formRef.value))) return
  saving.value = true
  try {
    const payload = {
      isbn: form.isbn.trim(),
      title: form.title.trim(),
      author: form.author || undefined,
      press: form.press || undefined,
      edition: form.edition || undefined,
      price: form.price,
      status: form.status,
    }
    // ISBN 重复 → 409 STATE_CONFLICT（后端裁决）
    if (form.id) await textbookApi.update(form.id, payload)
    else await textbookApi.create(payload)
    ElMessage.success(COPY.SUCCESS)
    dialogVisible.value = false
    tableRef.value?.reload(false)
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    saving.value = false
  }
}

/* ---------------- 停用 / 启用 ---------------- */
async function toggleStatus(row: Textbook) {
  const disabling = row.status === 1
  try {
    await ElMessageBox.confirm(
      disabling
        ? `确认停用教材「${row.title}」？停用后学生端标记已下架、教师端不可选。`
        : `确认重新启用教材「${row.title}」？`,
      disabling ? '停用' : '启用',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await textbookApi.setStatus(row.id, disabling ? 0 : 1)
    ElMessage.success(COPY.SUCCESS)
    tableRef.value?.reload(false)
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}
</script>

<template>
  <div class="app-page">
    <div class="app-toolbar">
      <el-input
        v-model="filters.isbn"
        placeholder="ISBN（前缀）"
        clearable
        style="width: 170px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-input
        v-model="filters.title"
        placeholder="书名"
        clearable
        style="width: 160px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-input
        v-model="filters.author"
        placeholder="作者"
        clearable
        style="width: 140px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-input
        v-model="filters.press"
        placeholder="出版社"
        clearable
        style="width: 150px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-select
        v-model="filters.status"
        placeholder="状态"
        clearable
        style="width: 130px"
        @change="search"
      >
        <el-option label="在库" :value="1" />
        <el-option label="停用" :value="0" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <PermButton :code="PERMISSIONS.TEXTBOOK_MANAGE" @click="openCreate">新增教材</PermButton>
    </div>

    <ServerTable ref="tableRef" :fetcher="fetchPage">
      <el-table-column prop="isbn" label="ISBN" width="150" />
      <el-table-column prop="title" label="书名" min-width="200" show-overflow-tooltip />
      <el-table-column prop="edition" label="版次" width="90" />
      <el-table-column prop="author" label="作者" width="120" />
      <el-table-column prop="press" label="出版社" width="160" show-overflow-tooltip />
      <el-table-column label="单价" width="110">
        <template #default="{ row }">{{ formatMoney(row.price) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
            {{ row.status === 1 ? '在库' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <div class="app-table-actions">
            <PermButton
              :code="PERMISSIONS.TEXTBOOK_MANAGE"
              size="small"
              text
              @click="openEdit(asRow<Textbook>(row))"
            >
              编辑
            </PermButton>
            <PermButton
              :code="PERMISSIONS.TEXTBOOK_MANAGE"
              size="small"
              :type="row.status === 1 ? 'warning' : 'success'"
              text
              @click="toggleStatus(asRow<Textbook>(row))"
            >
              {{ row.status === 1 ? '停用' : '启用' }}
            </PermButton>
          </div>
        </template>
      </el-table-column>
    </ServerTable>

    <div class="mt-16">
      <ImportWizard
        title="教材库 Excel 导入"
        :uploader="textbookApi.importExcel"
        :poller="batchApi.detail"
        :error-downloader="downloadErrorDetail"
        :template-downloader="textbookApi.template"
      />
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="form.id ? '编辑教材' : '新增教材'"
      width="520px"
      append-to-body
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="88px">
        <el-form-item label="ISBN" prop="isbn">
          <el-input v-model="form.isbn" maxlength="20" placeholder="13 位，978 开头" />
        </el-form-item>
        <el-form-item label="书名" prop="title">
          <el-input v-model="form.title" maxlength="64" />
        </el-form-item>
        <el-form-item label="版次">
          <el-input v-model="form.edition" maxlength="16" placeholder="如 第3版" />
        </el-form-item>
        <el-form-item label="作者">
          <el-input v-model="form.author" maxlength="32" />
        </el-form-item>
        <el-form-item label="出版社">
          <el-input v-model="form.press" maxlength="64" />
        </el-form-item>
        <el-form-item label="单价">
          <el-input-number v-model="form.price" :min="0" :precision="2" :step="1" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio :value="1">在库</el-radio>
            <el-radio :value="0">停用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <PermButton
          :code="PERMISSIONS.TEXTBOOK_MANAGE"
          type="primary"
          :loading="saving"
          @click="submit"
        >
          保存
        </PermButton>
      </template>
    </el-dialog>
  </div>
</template>
