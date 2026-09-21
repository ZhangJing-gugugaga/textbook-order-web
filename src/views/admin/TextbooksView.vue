<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, FormInstance } from 'element-plus'
import { textbookApi } from '@/api/textbook'
import { batchApi } from '@/api/people'
import ImportWizard from '@/components/ImportWizard.vue'
import { COPY } from '@/utils/constants'
import { formatMoney, formatDateTime } from '@/utils/format'
import type { Textbook } from '@/types'

/** 教材库（PRD 教材室-教材库维护）：CRUD + 导入 + 停用；教材按 ISBN 唯一，跨学期共用 */
const query = ref<{ keyword: string; status: string; page: number; size: number }>({
  keyword: '',
  status: '',
  page: 1,
  size: 10,
})
const rows = ref<Textbook[]>([])
const total = ref(0)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const result = await textbookApi.page({
      keyword: query.value.keyword || undefined,
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

/* ---------------- 新建 / 编辑 ---------------- */
const dialogVisible = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({
  id: 0,
  isbn: '',
  title: '',
  author: '',
  publisher: '',
  edition: '',
  price: 0,
})
const rules = {
  isbn: [
    { required: true, message: '请输入 ISBN', trigger: 'blur' },
    { pattern: /^978\d{10}$/, message: 'ISBN 需为 13 位且以 978 开头', trigger: 'blur' },
  ],
  title: [{ required: true, message: '请输入书名', trigger: 'blur' }],
  author: [{ required: true, message: '请输入作者', trigger: 'blur' }],
  publisher: [{ required: true, message: '请输入出版社', trigger: 'blur' }],
  edition: [{ required: true, message: '请输入版次', trigger: 'blur' }],
  price: [{ required: true, message: '请输入单价', trigger: 'blur' }],
}

function openCreate() {
  form.id = 0
  form.isbn = ''
  form.title = ''
  form.author = ''
  form.publisher = ''
  form.edition = ''
  form.price = 0
  dialogVisible.value = true
}

function openEdit(row: Textbook) {
  form.id = row.id
  form.isbn = row.isbn
  form.title = row.title
  form.author = row.author
  form.publisher = row.publisher
  form.edition = row.edition
  form.price = row.price
  dialogVisible.value = true
}

async function submit() {
  await formRef.value?.validate()
  saving.value = true
  try {
    if (form.id) await textbookApi.update(form.id, { ...form })
    else await textbookApi.create({ ...form })
    ElMessage.success(COPY.SUCCESS)
    dialogVisible.value = false
    void load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    saving.value = false
  }
}

/* ---------------- 停用 / 启用 / 删除 ---------------- */
async function toggleStatus(row: Textbook) {
  const disabling = row.status === 'active'
  try {
    await ElMessageBox.confirm(
      disabling ? `确认停用教材「${row.title}」？` : `确认重新启用教材「${row.title}」？`,
      disabling ? '停用' : '启用',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    if (disabling) await textbookApi.disable(row.id)
    else await textbookApi.enable(row.id)
    ElMessage.success(COPY.SUCCESS)
    void load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}

async function remove(row: Textbook) {
  try {
    await ElMessageBox.confirm(`确认删除教材「${row.title}」？删除后不可恢复。`, '删除', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await textbookApi.remove(row.id)
    ElMessage.success('已删除')
    void load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}

load()
</script>

<template>
  <div class="app-page">
    <div class="app-toolbar">
      <el-input
        v-model="query.keyword"
        placeholder="书名 / ISBN"
        clearable
        style="width: 220px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-select
        v-model="query.status"
        placeholder="状态"
        clearable
        style="width: 140px"
        @change="search"
      >
        <el-option label="在库" value="active" />
        <el-option label="停用" value="disabled" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="openCreate">新增教材</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column prop="isbn" label="ISBN" width="150" />
      <el-table-column prop="title" label="书名" min-width="200" show-overflow-tooltip />
      <el-table-column prop="author" label="作者" width="120" />
      <el-table-column prop="publisher" label="出版社" width="150" />
      <el-table-column prop="edition" label="版次" width="90" />
      <el-table-column label="单价" width="110">
        <template #default="{ row }">{{ formatMoney(row.price) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
            {{ row.status === 'active' ? '在库' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <div class="app-table-actions">
            <el-button size="small" text @click="openEdit(row)">编辑</el-button>
            <el-button
              size="small"
              :type="row.status === 'active' ? 'warning' : 'success'"
              text
              @click="toggleStatus(row)"
            >
              {{ row.status === 'active' ? '停用' : '启用' }}
            </el-button>
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

    <div class="mt-16">
      <ImportWizard
        title="教材库 Excel 导入（按 ISBN 幂等 upsert）"
        :uploader="textbookApi.importExcel"
        :poller="batchApi.detail"
        :error-downloader="batchApi.downloadErrors"
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
          <el-input v-model="form.isbn" maxlength="13" placeholder="13 位，978 开头" />
        </el-form-item>
        <el-form-item label="书名" prop="title">
          <el-input v-model="form.title" maxlength="64" />
        </el-form-item>
        <el-form-item label="作者" prop="author">
          <el-input v-model="form.author" maxlength="32" />
        </el-form-item>
        <el-form-item label="出版社" prop="publisher">
          <el-input v-model="form.publisher" maxlength="64" />
        </el-form-item>
        <el-form-item label="版次" prop="edition">
          <el-input v-model="form.edition" maxlength="16" placeholder="如 第3版" />
        </el-form-item>
        <el-form-item label="单价" prop="price">
          <el-input-number v-model="form.price" :min="0" :precision="2" :step="1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
