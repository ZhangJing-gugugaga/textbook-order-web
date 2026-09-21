<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { peopleApi, batchApi } from '@/api/people'
import { changeApi } from '@/api/change'
import ImportWizard from '@/components/ImportWizard.vue'
import FieldCheckResult from '@/components/FieldCheckResult.vue'
import { COPY } from '@/utils/constants'
import type { ChangeRequest, Person } from '@/types'

/**
 * 学生/教师管理（PRD 教材室-学生/教师管理）：
 * 全量 Excel 异步导入（批次进度 + 错误行下载）、检索；
 * 异动两级审批工作台：系统字段审查结果只读展示 → 内容审核通过/驳回（理由必填）。
 */
const activeTab = ref<'people' | 'change'>('people')
const personType = ref<'student' | 'teacher'>('student')
const keyword = ref('')
const rows = ref<Person[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)
const peopleError = ref('')

async function loadPeople() {
  loading.value = true
  peopleError.value = ''
  try {
    const result = await peopleApi.page({
      type: personType.value,
      keyword: keyword.value || undefined,
      page: page.value,
      size: size.value,
    })
    rows.value = result.list
    total.value = result.total
  } catch (error) {
    rows.value = []
    total.value = 0
    peopleError.value = (error as Error)?.message || COPY.FAILED
  } finally {
    loading.value = false
  }
}

function searchPeople() {
  page.value = 1
  void loadPeople()
}

/* ---------------- 异动审批工作台 ---------------- */
const changeRows = ref<ChangeRequest[]>([])
const changeTotal = ref(0)
const changePage = ref(1)
const changeSize = ref(10)
const changeStatus = ref('pending')
const changeKeyword = ref('')
const changeLoading = ref(false)
const changeError = ref('')
const selected = ref<ChangeRequest | null>(null)
const detailVisible = ref(false)
const rejectVisible = ref(false)
const rejectComment = ref('')
const processing = ref(false)
const selectedIds = ref<number[]>([])
const batchRejectVisible = ref(false)
const batchRejectComment = ref('')

async function loadChanges() {
  changeLoading.value = true
  changeError.value = ''
  try {
    const result = await changeApi.page({
      status: changeStatus.value || undefined,
      keyword: changeKeyword.value || undefined,
      page: changePage.value,
      size: changeSize.value,
    })
    changeRows.value = result.list
    changeTotal.value = result.total
  } catch (error) {
    changeRows.value = []
    changeTotal.value = 0
    changeError.value = (error as Error)?.message || COPY.FAILED
  } finally {
    changeLoading.value = false
  }
}

function searchChanges() {
  changePage.value = 1
  void loadChanges()
}

function openDetail(row: ChangeRequest) {
  selected.value = row
  detailVisible.value = true
}

function openReject(row: ChangeRequest) {
  selected.value = row
  rejectComment.value = ''
  rejectVisible.value = true
}

async function approve(row: ChangeRequest) {
  try {
    await ElMessageBox.confirm(
      `确认通过 ${row.studentName}（${row.studentNo}）的异动申请？`,
      '内容审核通过',
      { type: 'warning' },
    )
  } catch {
    return
  }
  processing.value = true
  try {
    await changeApi.approve(row.id)
    ElMessage.success('已复核通过')
    detailVisible.value = false
    await loadChanges()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    processing.value = false
  }
}

async function submitReject() {
  const comment = rejectComment.value.trim()
  if (!comment) {
    ElMessage.error('驳回理由必填')
    return
  }
  if (comment.length > 200) {
    ElMessage.error('驳回理由不超过 200 字')
    return
  }
  if (!selected.value) return
  processing.value = true
  try {
    await changeApi.reject(selected.value.id, comment)
    ElMessage.success('已驳回，申请人可补正后重新提交')
    rejectVisible.value = false
    detailVisible.value = false
    await loadChanges()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    processing.value = false
  }
}

/* ---------------- 批量通过 / 批量驳回（Q10） ---------------- */
async function batchApprove() {
  if (selectedIds.value.length === 0) return
  try {
    await ElMessageBox.confirm(
      `确认批量通过 ${selectedIds.value.length} 条异动申请？`,
      '批量通过',
      {
        type: 'warning',
      },
    )
  } catch {
    return
  }
  processing.value = true
  try {
    await changeApi.batchApprove(selectedIds.value)
    ElMessage.success('已批量通过')
    selectedIds.value = []
    detailVisible.value = false
    await loadChanges()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    processing.value = false
  }
}

async function submitBatchReject() {
  const comment = batchRejectComment.value.trim()
  if (!comment) {
    ElMessage.error('驳回理由必填')
    return
  }
  if (comment.length > 200) {
    ElMessage.error('驳回理由不超过 200 字')
    return
  }
  processing.value = true
  try {
    await changeApi.batchReject(selectedIds.value, comment)
    ElMessage.success('已批量驳回')
    batchRejectVisible.value = false
    detailVisible.value = false
    selectedIds.value = []
    await loadChanges()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    processing.value = false
  }
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  transfer_in: '转入',
  transfer_out: '转出',
  suspend: '休学',
  resume: '复学',
  info_fix: '信息修正',
}

const CHANGE_STATUS_LABELS: Record<
  string,
  { label: string; type: 'success' | 'danger' | 'warning' }
> = {
  approved: { label: '已通过', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
  pending: { label: '待审核', type: 'warning' },
}

// 进入页面即拉取师生名册与异动审批列表
void loadPeople()
void loadChanges()
</script>

<template>
  <div class="app-page">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="学生/教师管理" name="people">
        <div class="app-toolbar">
          <el-radio-group v-model="personType" @change="searchPeople">
            <el-radio-button value="student">学生</el-radio-button>
            <el-radio-button value="teacher">教师</el-radio-button>
          </el-radio-group>
          <el-input
            v-model="keyword"
            :placeholder="personType === 'student' ? '学号 / 姓名' : '工号 / 姓名'"
            clearable
            style="width: 220px"
            @keyup.enter="searchPeople"
            @clear="searchPeople"
          />
          <el-button type="primary" @click="searchPeople">查询</el-button>
        </div>

        <el-alert
          v-if="peopleError"
          :title="peopleError"
          type="error"
          :closable="false"
          show-icon
          class="mb-16"
        />
        <el-table v-loading="loading" :data="rows" border stripe>
          <el-table-column prop="userNo" label="学号/工号" width="140" />
          <el-table-column prop="name" label="姓名" width="110" />
          <el-table-column prop="collegeName" label="学院" min-width="140" />
          <el-table-column prop="majorName" label="专业" min-width="140" />
          <el-table-column prop="className" label="班级" width="140" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
                {{ row.status === 'active' ? '正常' : '停用' }}
              </el-tag>
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
            @current-change="loadPeople"
            @size-change="searchPeople"
          />
        </div>

        <div class="mt-16">
          <ImportWizard
            :title="`${personType === 'student' ? '学生' : '教师'}全量 Excel 导入（异步批次）`"
            :uploader="peopleApi.importExcel"
            :poller="batchApi.detail"
            :error-downloader="batchApi.downloadErrors"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="异动审批工作台" name="change">
        <div class="app-toolbar">
          <el-select v-model="changeStatus" clearable style="width: 160px" @change="searchChanges">
            <el-option label="待审核" value="pending" />
            <el-option label="已通过" value="approved" />
            <el-option label="已驳回" value="rejected" />
          </el-select>
          <el-input
            v-model="changeKeyword"
            placeholder="学号 / 姓名"
            clearable
            style="width: 200px"
            @keyup.enter="searchChanges"
            @clear="searchChanges"
          />
          <el-button type="primary" @click="searchChanges">查询</el-button>
          <template v-if="selectedIds.length">
            <el-button type="success" :loading="processing" @click="batchApprove">
              批量通过（{{ selectedIds.length }}）
            </el-button>
            <el-button type="danger" :loading="processing" @click="batchRejectVisible = true">
              批量驳回（{{ selectedIds.length }}）
            </el-button>
          </template>
        </div>

        <el-alert
          v-if="changeError"
          :title="changeError"
          type="error"
          :closable="false"
          show-icon
          class="mb-16"
        />
        <el-table
          v-loading="changeLoading"
          :data="changeRows"
          border
          stripe
          @selection-change="
            (selection: ChangeRequest[]) =>
              (selectedIds = selection.filter((r) => r.status === 'pending').map((r) => r.id))
          "
        >
          <el-table-column
            type="selection"
            width="48"
            :selectable="(row: ChangeRequest) => row.status === 'pending'"
          />
          <el-table-column prop="studentNo" label="学号" width="140" />
          <el-table-column prop="studentName" label="姓名" width="110" />
          <el-table-column label="异动类型" width="120">
            <template #default="{ row }">{{ CHANGE_TYPE_LABELS[row.type] || row.type }}</template>
          </el-table-column>
          <el-table-column prop="submitterName" label="申请人" width="120" />
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
              <el-tag :type="CHANGE_STATUS_LABELS[row.status].type" size="small">
                {{ CHANGE_STATUS_LABELS[row.status].label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <div class="app-table-actions">
                <el-button size="small" text @click="openDetail(row)">审查详情</el-button>
                <template v-if="row.status === 'pending'">
                  <el-button size="small" type="success" text @click="approve(row)">通过</el-button>
                  <el-button size="small" type="danger" text @click="openReject(row)">
                    驳回
                  </el-button>
                </template>
              </div>
            </template>
          </el-table-column>
        </el-table>
        <div class="app-pagination">
          <el-pagination
            v-model:current-page="changePage"
            v-model:page-size="changeSize"
            :total="changeTotal"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next"
            background
            @current-change="loadChanges"
            @size-change="searchChanges"
          />
        </div>
        <el-empty
          v-if="!changeLoading && changeRows.length === 0"
          :description="COPY.EMPTY"
          :image-size="80"
        />
      </el-tab-pane>
    </el-tabs>

    <!-- 审查详情：系统字段审查结果只读展示 -->
    <el-dialog v-model="detailVisible" title="异动审查详情" width="620px" append-to-body>
      <template v-if="selected">
        <el-descriptions :column="2" border size="small" class="mb-16">
          <el-descriptions-item label="学号">{{ selected.studentNo }}</el-descriptions-item>
          <el-descriptions-item label="姓名">{{ selected.studentName }}</el-descriptions-item>
          <el-descriptions-item label="异动类型">
            {{ CHANGE_TYPE_LABELS[selected.type] || selected.type }}
          </el-descriptions-item>
          <el-descriptions-item label="申请人">{{ selected.submitterName }}</el-descriptions-item>
          <el-descriptions-item label="异动说明" :span="2">
            {{ selected.reason || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="审核意见" :span="2">
            {{ selected.reviewComment || '—' }}
          </el-descriptions-item>
        </el-descriptions>

        <h4>系统字段审查结果（只读）</h4>
        <FieldCheckResult :items="selected.fieldCheck" />

        <div class="mt-16 app-table-actions">
          <template v-if="selected.status === 'pending'">
            <el-button type="success" :loading="processing" @click="approve(selected)">
              内容审核通过
            </el-button>
            <el-button type="danger" :loading="processing" @click="openReject(selected)">
              驳回
            </el-button>
          </template>
          <el-button v-else @click="detailVisible = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 驳回：理由必填 -->
    <el-dialog v-model="rejectVisible" title="驳回异动申请" width="480px" append-to-body>
      <el-input
        v-model="rejectComment"
        type="textarea"
        :rows="4"
        maxlength="200"
        show-word-limit
        placeholder="请输入驳回理由（必填，1-200 字）"
      />
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" :loading="processing" @click="submitReject">确认驳回</el-button>
      </template>
    </el-dialog>

    <!-- 批量驳回：理由必填 -->
    <el-dialog v-model="batchRejectVisible" title="批量驳回异动申请" width="480px" append-to-body>
      <el-alert
        :title="`将对选中的 ${selectedIds.length} 条待审核申请执行驳回`"
        type="info"
        :closable="false"
        show-icon
        class="mb-16"
      />
      <el-input
        v-model="batchRejectComment"
        type="textarea"
        :rows="4"
        maxlength="200"
        show-word-limit
        placeholder="请输入驳回理由（必填，1-200 字）"
      />
      <template #footer>
        <el-button @click="batchRejectVisible = false">取消</el-button>
        <el-button type="danger" :loading="processing" @click="submitBatchReject">
          确认驳回
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
