<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { changeApi } from '@/api/change'
import ImportWizard from '@/components/ImportWizard.vue'
import BatchProgressDrawer from '@/components/BatchProgressDrawer.vue'
import FieldCheckResult from '@/components/FieldCheckResult.vue'
import { COPY } from '@/utils/constants'
import type { ChangeRequest, ImportBatch } from '@/types'

/**
 * 异动申请（PRD 学院秘书-异动申请 / 02 §6.3 Q10）：
 * 逐条或 Excel 提交学生异动，查看两级审批进度。
 * Excel 一律生成批量 change_request 走两级审查，页面不出现"直接生效"路径。
 */
const activeTab = ref<'submit' | 'progress'>('submit')

/* ---------------- 逐条提交 ---------------- */
const submitting = ref(false)
const form = ref({
  studentNo: '',
  studentName: '',
  type: 'transfer_in' as ChangeRequest['type'],
  reason: '',
})
const lastBatchId = ref('')
const drawerVisible = ref(false)

function validateSingle() {
  if (!form.value.studentNo.trim()) return '请输入学生学号'
  if (!form.value.studentName.trim()) return '请输入学生姓名'
  if (!form.value.reason.trim()) return '请输入异动原因'
  if (form.value.reason.length > 200) return '异动原因不超过 200 字'
  return ''
}

async function submitSingle() {
  const error = validateSingle()
  if (error) {
    ElMessage.error(error)
    return
  }
  submitting.value = true
  try {
    await changeApi.submit({ ...form.value })
    ElMessage.success('已提交，进入两级审批流程')
    form.value = { studentNo: '', studentName: '', type: 'transfer_in', reason: '' }
  } catch (e) {
    ElMessage.error((e as Error)?.message || COPY.FAILED)
  } finally {
    submitting.value = false
  }
}

function handleBatchUploaded(batchId: string) {
  lastBatchId.value = batchId
  ElMessage.success('批次已创建，正在逐行走两级审查')
  drawerVisible.value = true
  activeTab.value = 'progress'
}

/** 批次进度接口返回行列表，适配为 ImportBatch 形态供 ImportWizard 展示 */
function toBatch(list: ChangeRequest[]): ImportBatch {
  const total = list.length
  const done = list.filter((row) => row.status !== 'pending').length
  return {
    batchId: list[0]?.batchId || '',
    bizType: 'change',
    fileName: '异动名单.xlsx',
    status: total > 0 && done >= total ? 'success' : 'parsing',
    progressPct: total ? Math.round((done / total) * 100) : 0,
    totalRows: total,
    successRows: done,
    errorRows: 0,
    message: '',
    createdAt: '',
    errorPreview: [],
  }
}

/* ---------------- 进度查询 ---------------- */
const keyword = ref('')
const status = ref('')
const page = ref(1)
const size = ref(10)
const rows = ref<ChangeRequest[]>([])
const total = ref(0)
const loading = ref(false)
const detailVisible = ref(false)
const detail = ref<ChangeRequest | null>(null)

async function loadProgress() {
  loading.value = true
  try {
    const result = await changeApi.page({
      keyword: keyword.value || undefined,
      status: status.value || undefined,
      page: page.value,
      size: size.value,
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

function searchProgress() {
  page.value = 1
  void loadProgress()
}

function openDetail(row: ChangeRequest) {
  detail.value = row
  detailVisible.value = true
}

const TYPE_LABELS: Record<string, string> = {
  transfer_in: '转入',
  transfer_out: '转出',
  suspend: '休学',
  resume: '复学',
  info_fix: '信息修正',
}

const STATUS_LABELS: Record<string, { label: string; type: 'success' | 'danger' | 'warning' }> = {
  approved: { label: '已通过', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
  pending: { label: '待审核', type: 'warning' },
}

// 进入页面即拉取异动审批进度
void loadProgress()
</script>

<template>
  <div class="app-page">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="提交异动" name="submit">
        <h4 class="mb-16">逐条提交</h4>
        <el-form :model="form" label-width="96px" style="max-width: 560px">
          <el-form-item label="学生学号" required>
            <el-input v-model="form.studentNo" maxlength="32" placeholder="请输入学生学号" />
          </el-form-item>
          <el-form-item label="学生姓名" required>
            <el-input v-model="form.studentName" maxlength="32" placeholder="请输入学生姓名" />
          </el-form-item>
          <el-form-item label="异动类型" required>
            <el-select v-model="form.type" style="width: 100%">
              <el-option label="转入" value="transfer_in" />
              <el-option label="转出" value="transfer_out" />
              <el-option label="休学" value="suspend" />
              <el-option label="复学" value="resume" />
              <el-option label="信息修正" value="info_fix" />
            </el-select>
          </el-form-item>
          <el-form-item label="异动原因" required>
            <el-input
              v-model="form.reason"
              type="textarea"
              :rows="3"
              maxlength="200"
              show-word-limit
              placeholder="请说明异动原因（必填，不超过 200 字）"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="submitting" @click="submitSingle">
              提交申请
            </el-button>
            <span class="text-muted ml-8">提交后进入「系统字段审查 → 超管内容审核」两级流程</span>
          </el-form-item>
        </el-form>

        <el-divider content-position="left">Excel 批量提交</el-divider>
        <el-alert
          title="一个上传批次 = 一个 change_request 批次（逐行生成、共享批次号），全部走两级审查，不允许绕过审查直落库。"
          type="info"
          :closable="false"
          show-icon
          class="mb-16"
        />
        <ImportWizard
          title="异动名单 Excel 导入"
          :uploader="changeApi.submitBatch"
          :poller="(id) => changeApi.batchProgress(id).then((list) => toBatch(list))"
          @uploaded="handleBatchUploaded"
        />
      </el-tab-pane>

      <el-tab-pane label="审批进度" name="progress">
        <div class="app-toolbar">
          <el-select
            v-model="status"
            clearable
            placeholder="审核状态"
            style="width: 160px"
            @change="searchProgress"
          >
            <el-option label="待审核" value="pending" />
            <el-option label="已通过" value="approved" />
            <el-option label="已驳回" value="rejected" />
          </el-select>
          <el-input
            v-model="keyword"
            placeholder="学号 / 姓名"
            clearable
            style="width: 200px"
            @keyup.enter="searchProgress"
            @clear="searchProgress"
          />
          <el-button type="primary" @click="searchProgress">查询</el-button>
        </div>

        <el-table v-loading="loading" :data="rows" border stripe>
          <el-table-column prop="studentNo" label="学号" width="140" />
          <el-table-column prop="studentName" label="姓名" width="110" />
          <el-table-column label="异动类型" width="120">
            <template #default="{ row }">{{ TYPE_LABELS[row.type] || row.type }}</template>
          </el-table-column>
          <el-table-column label="批次" width="150">
            <template #default="{ row }">{{ row.batchId || '逐条提交' }}</template>
          </el-table-column>
          <el-table-column label="系统字段审查" width="130">
            <template #default="{ row }">
              <span v-if="!row.fieldCheck || row.fieldCheck.length === 0" class="text-muted">
                —
              </span>
              <span
                v-else-if="row.fieldCheck.every((f: { passed: boolean }) => f.passed)"
                class="text-success"
              >
                全部通过
              </span>
              <span v-else class="text-danger">
                {{ row.fieldCheck.filter((f: { passed: boolean }) => !f.passed).length }} 项未通过
              </span>
            </template>
          </el-table-column>
          <el-table-column label="内容审核" width="110">
            <template #default="{ row }">
              <el-tag :type="STATUS_LABELS[row.status].type" size="small">
                {{ STATUS_LABELS[row.status].label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button size="small" text @click="openDetail(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="app-pagination">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="size"
            :total="total"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next"
            background
            @current-change="loadProgress"
            @size-change="searchProgress"
          />
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-drawer v-model="drawerVisible" title="批量异动审查进度" size="680px" append-to-body>
      <BatchProgressDrawer
        v-if="lastBatchId"
        :batch-id="lastBatchId"
        :fetcher="changeApi.batchProgress"
      />
    </el-drawer>

    <el-dialog v-model="detailVisible" title="异动详情" width="600px" append-to-body>
      <template v-if="detail">
        <el-descriptions :column="2" border size="small" class="mb-16">
          <el-descriptions-item label="学号">{{ detail.studentNo }}</el-descriptions-item>
          <el-descriptions-item label="姓名">{{ detail.studentName }}</el-descriptions-item>
          <el-descriptions-item label="异动类型">
            {{ TYPE_LABELS[detail.type] || detail.type }}
          </el-descriptions-item>
          <el-descriptions-item label="申请人">{{ detail.submitterName }}</el-descriptions-item>
          <el-descriptions-item label="异动原因" :span="2">
            {{ detail.reason }}
          </el-descriptions-item>
          <el-descriptions-item label="审核意见" :span="2">
            {{ detail.reviewComment || '—' }}
          </el-descriptions-item>
        </el-descriptions>
        <h4>系统字段审查结果</h4>
        <FieldCheckResult :items="detail.fieldCheck" />
      </template>
    </el-dialog>
  </div>
</template>
