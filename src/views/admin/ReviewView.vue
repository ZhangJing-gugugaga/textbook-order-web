<script setup lang="ts">
import { reactive, ref } from 'vue'

import { reviewApi } from '@/api/orderForm'
import { exportApi } from '@/api/exportTask'
import { ApiError } from '@/api/http'
import FieldCheckResult from '@/components/FieldCheckResult.vue'
import ExportButton from '@/components/ExportButton.vue'
import OrderFormItemsTable from '@/components/OrderFormItemsTable.vue'
import PermButton from '@/components/PermButton.vue'
import ServerTable from '@/components/ServerTable.vue'
import { CODE, COPY, ORDER_FORM_STATUS_META, PERMISSIONS, statusMetaOf } from '@/utils/constants'
import { formatDateTime } from '@/utils/format'
import { asRow } from '@/utils/table'
import type { OrderForm, OrderFormListItem } from '@/types'

/**
 * 复核工作台（PRD 复核工作台页 / API.md §3.6）：
 * 待审列表（GET /api/admin/order-forms）+ 系统字段审查结果（只读）+ 明细预览 +
 * 通过/驳回（reject 理由必填 1-200 字，仅 pending_review 可审）。
 * 本页不提供修改表单内容的编辑能力——复核不改数据，驳回由教师补正。
 *
 * 审核走 **contentVersion CAS**：详情读到的版本号原样回传，服务端比对不一致即 409
 * STATE_CONFLICT（教师在此期间重提过）。此时**重新拉详情**并让管理员重新确认，
 * 绝不自动重试——自动重试等于替他确认了没看过的内容。
 *
 * 列表分页与三态由 ServerTable 基座承担（SPEC §8）；状态文案统一取
 * ORDER_FORM_STATUS_META（原先本页自带的 STATUS_META 已删，避免文案漂移）。
 */
const filters = reactive({
  status: 'pending_review',
  collegeId: undefined as number | undefined,
  teacherName: '',
})
const tableRef = ref<{ reload: (resetPage?: boolean) => void } | null>(null)

const detailVisible = ref(false)
const detail = ref<OrderForm | null>(null)
const detailLoading = ref(false)
const rejectVisible = ref(false)
const rejectReason = ref('')
const processing = ref(false)

/** 筛选条件 → 接口参数（空串不下发） */
function fetchPage({ page, size }: { page: number; size: number }) {
  return reviewApi.page({
    status: filters.status || undefined,
    collegeId: filters.collegeId,
    teacherName: filters.teacherName || undefined,
    page,
    size,
  })
}

function search() {
  tableRef.value?.reload()
}

/** 详情请求序号：先发的慢响应不得覆盖后点开的那一行 */
let detailRequestId = 0

async function openDetail(row: OrderFormListItem) {
  const current = ++detailRequestId
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    const result = await reviewApi.detail(row.id)
    if (current !== detailRequestId) return
    detail.value = result
  } catch (error) {
    if (current !== detailRequestId) return
    ElMessage.error((error as Error)?.message || COPY.FAILED)
    detailVisible.value = false
  } finally {
    if (current === detailRequestId) detailLoading.value = false
  }
}

/** 审核冲突（409 STATE_CONFLICT）：内容已被教师重提，重拉详情让管理员重新确认，不自动重试 */
async function refetchAfterConflict() {
  if (!detail.value) return
  try {
    detail.value = await reviewApi.detail(detail.value.id)
    ElMessage.warning('表单内容已变更，已刷新为最新版本，请重新确认后再操作')
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
    detailVisible.value = false
  }
}

/**
 * 提交审核（带内容版本 CAS）。
 * @returns 是否成功——失败（含 409 冲突）时调用方不应关闭弹窗或刷新列表
 */
async function runReview(payload: {
  action: 'pass' | 'reject'
  reason?: string
}): Promise<boolean> {
  const form = detail.value
  if (!form) return false
  // 版本号缺失时无法保证 CAS：宁可不提交，也不让审批落在未确认的内容上
  if (form.contentVersion == null) {
    ElMessage.error('未取到表单内容版本号，请关闭后重新打开详情再操作')
    return false
  }
  processing.value = true
  try {
    await reviewApi.review(form.id, { ...payload, contentVersion: form.contentVersion })
    return true
  } catch (error) {
    if (error instanceof ApiError && error.code === CODE.STATE_CONFLICT) {
      await refetchAfterConflict()
      return false
    }
    ElMessage.error((error as Error)?.message || COPY.FAILED)
    return false
  } finally {
    processing.value = false
  }
}

async function approve() {
  if (!detail.value) return
  try {
    await ElMessageBox.confirm(
      '确认复核通过该表单？通过后计入汇总并进入学生清单，且不可再修改。',
      '复核通过',
      { type: 'warning' },
    )
  } catch {
    return
  }
  if (!(await runReview({ action: 'pass' }))) return
  ElMessage.success('已复核通过')
  detailVisible.value = false
  tableRef.value?.reload(false)
}

async function submitReject() {
  const reason = rejectReason.value.trim()
  if (!reason) {
    ElMessage.error('驳回理由必填')
    return
  }
  if (reason.length > 200) {
    ElMessage.error('驳回理由不超过 200 字')
    return
  }
  if (!(await runReview({ action: 'reject', reason }))) return
  ElMessage.success('已驳回，教师可补正后重新提交')
  rejectVisible.value = false
  detailVisible.value = false
  tableRef.value?.reload(false)
}
</script>

<template>
  <div class="app-page">
    <div class="app-toolbar">
      <el-select
        v-model="filters.status"
        clearable
        placeholder="全部状态"
        style="width: 170px"
        @change="search"
      >
        <el-option :label="ORDER_FORM_STATUS_META.pending_review.label" value="pending_review" />
        <el-option :label="ORDER_FORM_STATUS_META.reviewed.label" value="reviewed" />
        <el-option :label="ORDER_FORM_STATUS_META.rejected.label" value="rejected" />
        <el-option :label="ORDER_FORM_STATUS_META.rejected_auto.label" value="rejected_auto" />
      </el-select>
      <el-input
        v-model="filters.teacherName"
        placeholder="教师姓名"
        clearable
        style="width: 180px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button type="primary" @click="search">查询</el-button>
      <ExportButton
        name="教师征订明细"
        type="info"
        :code="PERMISSIONS.EXPORT_ORDER"
        :exporter="() => exportApi.orders({ semesterId: undefined, collegeId: filters.collegeId })"
      />
    </div>

    <ServerTable ref="tableRef" :fetcher="fetchPage">
      <el-table-column prop="id" label="表单号" width="100" />
      <el-table-column prop="teacherName" label="任课教师" width="120" />
      <el-table-column prop="teacherNo" label="工号" width="110" />
      <el-table-column prop="collegeName" label="学院" min-width="140" />
      <el-table-column prop="itemCount" label="明细行数" width="100" align="center" />
      <el-table-column prop="totalQuantity" label="数量合计" width="100" align="center" />
      <el-table-column label="状态" width="130">
        <template #default="{ row }">
          <el-tag :type="statusMetaOf(ORDER_FORM_STATUS_META, row.status).type" size="small">
            {{ statusMetaOf(ORDER_FORM_STATUS_META, row.status).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.submittedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button
            size="small"
            type="primary"
            text
            @click="openDetail(asRow<OrderFormListItem>(row))"
          >
            审查
          </el-button>
        </template>
      </el-table-column>
    </ServerTable>

    <el-dialog v-model="detailVisible" title="表单审查" width="780px" append-to-body>
      <div v-loading="detailLoading">
        <template v-if="detail">
          <el-descriptions :column="3" border size="small" class="mb-16">
            <el-descriptions-item label="表单号">{{ detail.id }}</el-descriptions-item>
            <el-descriptions-item label="学期">{{ detail.semesterName }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="statusMetaOf(ORDER_FORM_STATUS_META, detail.status).type" size="small">
                {{ statusMetaOf(ORDER_FORM_STATUS_META, detail.status).label }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="提交时间">
              {{ formatDateTime(detail.submittedAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="审核时间">
              {{ formatDateTime(detail.reviewAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="审核人">
              {{ detail.reviewBy ? `#${detail.reviewBy}` : '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="内容版本">
              {{ detail.contentVersion ?? '—' }}
            </el-descriptions-item>
          </el-descriptions>

          <template v-if="detail.fieldCheckResult?.length">
            <h4>系统字段审查结果（只读）</h4>
            <FieldCheckResult :items="detail.fieldCheckResult" />
          </template>

          <h4 class="mt-16">明细预览（课程 × 班级 × 教材 × 数量）</h4>
          <OrderFormItemsTable :items="detail.items" />
          <div class="flex-between mt-16">
            <span class="text-muted">
              合计 {{ detail.totalQuantity }} 本 / {{ detail.itemCount }} 行
            </span>
            <span v-if="detail.reviewNote" class="text-danger">
              审核意见：{{ detail.reviewNote }}
            </span>
          </div>
          <div v-if="detail.correctDeadline" class="mt-8 text-muted">
            补正截止：{{ formatDateTime(detail.correctDeadline) }}
          </div>

          <div v-if="detail.status === 'pending_review'" class="mt-16 app-table-actions">
            <PermButton
              :code="PERMISSIONS.ORDER_FORM_REVIEW"
              type="success"
              :loading="processing"
              @click="approve"
            >
              通过
            </PermButton>
            <PermButton
              :code="PERMISSIONS.ORDER_FORM_REVIEW"
              type="danger"
              :loading="processing"
              @click="rejectVisible = true"
            >
              驳回
            </PermButton>
          </div>
          <div v-else class="mt-16">
            <el-button @click="detailVisible = false">关闭</el-button>
          </div>
        </template>
      </div>
    </el-dialog>

    <el-dialog v-model="rejectVisible" title="驳回表单" width="480px" append-to-body>
      <el-input
        v-model="rejectReason"
        type="textarea"
        :rows="4"
        maxlength="200"
        show-word-limit
        placeholder="请输入驳回理由（必填，1-200 字）"
      />
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <PermButton
          :code="PERMISSIONS.ORDER_FORM_REVIEW"
          type="danger"
          :loading="processing"
          @click="submitReject"
        >
          确认驳回
        </PermButton>
      </template>
    </el-dialog>
  </div>
</template>
