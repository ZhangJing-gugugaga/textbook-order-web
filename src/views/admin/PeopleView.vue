<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue'
import type { VNode } from 'vue'

import { accountsApi, batchApi } from '@/api/people'
import { changeApi } from '@/api/change'
import { orgApi } from '@/api/semester'
import { downloadErrorDetail } from '@/api/http'
import ImportWizard from '@/components/ImportWizard.vue'
import PermButton from '@/components/PermButton.vue'
import ServerTable from '@/components/ServerTable.vue'
import { useWindowStore } from '@/stores/window'
import {
  CHANGE_STATUS_META,
  CHANGE_TYPE_LABELS,
  COPY,
  PERMISSIONS,
  ROLE_LABELS,
  ROLES,
  statusMetaOf,
} from '@/utils/constants'
import { formatDateTime } from '@/utils/format'
import { asRow } from '@/utils/table'
import type { ChangeRequestListItem, ClassSizeDiff, College, ImportPreview } from '@/types'

/**
 * 学生/教师管理 + 异动审批工作台（PRD 教材室-学生/教师管理 / API.md §3.5 §3.8）：
 * 名册检索（GET /api/admin/user?roleCode=）+ 名单 Excel 异步导入（批次进度 + 错误明细）；
 * 异动审批（GET /api/admin/change）：系统字段审查不过的记录直接落 rejected，
 * 因此进入「待审批」即代表字段审查已通过，审批只做内容审核。
 * 两个列表的分页与空/载/错三态均由 ServerTable 基座承担（SPEC §8）。
 */
const activeTab = ref<'people' | 'change'>('people')

/* ---------------- 名册 ---------------- */
const personType = ref<'student' | 'teacher'>('student')
const peopleFilters = reactive({ keyword: '' })
const peopleTableRef = ref<{ reload: (resetPage?: boolean) => void } | null>(null)
const colleges = ref<College[]>([])
const semesterId = ref<number | null>(null)

/** 筛选条件 → 接口参数（空串不下发），分页由 ServerTable 注入 */
function fetchPeoplePage({ page, size }: { page: number; size: number }) {
  return accountsApi.page({
    roleCode: personType.value === 'student' ? ROLES.STUDENT : ROLES.TEACHER,
    keyword: peopleFilters.keyword || undefined,
    page,
    size,
  })
}

function searchPeople() {
  peopleTableRef.value?.reload()
}

/* ---------------- 异动审批工作台 ---------------- */
const changeFilters = reactive({ status: 'pending_review', batchNo: '' })
const changeTableRef = ref<{ reload: (resetPage?: boolean) => void } | null>(null)
const selected = ref<ChangeRequestListItem | null>(null)
const detailVisible = ref(false)
const rejectVisible = ref(false)
const rejectReason = ref('')
const processing = ref(false)
const batchRejectVisible = ref(false)
const batchRejectReason = ref('')
const batchAction = ref<ChangeRequestListItem | null>(null)

/** 筛选条件 → 接口参数（空串不下发），分页由 ServerTable 注入 */
function fetchChangesPage({ page, size }: { page: number; size: number }) {
  return changeApi.page({
    status: changeFilters.status || undefined,
    batchNo: changeFilters.batchNo || undefined,
    page,
    size,
  })
}

function searchChanges() {
  changeTableRef.value?.reload()
}

function openDetail(row: ChangeRequestListItem) {
  selected.value = row
  detailVisible.value = true
}

function openReject(row: ChangeRequestListItem) {
  selected.value = row
  rejectReason.value = ''
  rejectVisible.value = true
}

/** 逐条审批：通过后对 active 学期立即生效 */
async function approve(row: ChangeRequestListItem) {
  try {
    await ElMessageBox.confirm(
      `确认通过 ${row.targetUserName || row.targetUserNo} 的异动申请？通过后对当前学期立即生效。`,
      '内容审核通过',
      { type: 'warning' },
    )
  } catch {
    return
  }
  processing.value = true
  try {
    await changeApi.review(row.id, { action: 'pass' })
    ElMessage.success('已复核通过，立即生效')
    detailVisible.value = false
    changeTableRef.value?.reload(false)
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    processing.value = false
  }
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
  if (!selected.value) return
  processing.value = true
  try {
    await changeApi.review(selected.value.id, { action: 'reject', reason })
    ElMessage.success('已驳回')
    rejectVisible.value = false
    detailVisible.value = false
    changeTableRef.value?.reload(false)
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    processing.value = false
  }
}

/* ---------------- 按批次批量处理（后端仅支持按 batchNo） ---------------- */
function openBatch(row: ChangeRequestListItem) {
  batchAction.value = row
  batchRejectReason.value = ''
  batchRejectVisible.value = true
}

async function submitBatch(action: 'pass' | 'reject') {
  const batchNo = batchAction.value?.batchNo
  if (!batchNo) {
    ElMessage.error('该记录不属于任何批次')
    return
  }
  const reason = batchRejectReason.value.trim()
  if (action === 'reject' && !reason) {
    ElMessage.error('驳回理由必填')
    return
  }
  processing.value = true
  try {
    const result = await changeApi.reviewBatch({
      batchNo,
      action,
      reason: action === 'reject' ? reason : undefined,
    })
    ElMessage.success(`批次 ${batchNo} 已处理 ${result.count} 条`)
    batchRejectVisible.value = false
    detailVisible.value = false
    changeTableRef.value?.reload(false)
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    processing.value = false
  }
}

function afterText(row: ChangeRequestListItem) {
  const after = row.payloadJson?.after
  if (!after) return '—'
  return `学院#${after.collegeId ?? '—'}${after.classId ? ` / 班级#${after.classId}` : ''}`
}

/**
 * 表格插槽里的 row 是 el-table 的 DefaultRow，收窄后交给 afterText。
 * 模板插值中不能直接写 `asRow<ChangeRequestListItem>(row)`：`<` 会被 Vue 模板解析器当成标签起始。
 */
function afterTextOf(row: unknown) {
  return afterText(asRow<ChangeRequestListItem>(row))
}

function beforeText(row: ChangeRequestListItem) {
  const before = row.payloadJson?.before
  if (!before) {
    return `${row.currentCollegeName || '—'} / ${row.currentClassName || '—'}`
  }
  return `学院#${before.collegeId ?? '—'}${before.classId ? ` / 班级#${before.classId}` : ''}`
}

onMounted(async () => {
  const windowStore = useWindowStore()
  await windowStore.fetch()
  semesterId.value = windowStore.semesterId
  colleges.value = await orgApi.colleges().catch(() => [])
})

/* ---------------- 名单导入（局部名单门禁，B13） ---------------- */

/**
 * 导入前的「班级人数 diff 强确认」。
 *
 * 背景（后端测试报告 B13）：学生名单导入会把班级人数重算为文件内该班去重人数，而班级人数是
 * 教师填报数量的硬上限——局部名单会把上限压小（线上实测 50 → 2，该班教师随即无法填报）。
 * 后端现在对「下调比例超阈值且不少于下限人数」的导入直接 409；前端在导入前先调预览接口，
 * 把 diff 摆到管理员面前确认，确认后再带 confirmClassSizeShrink=true 重提。
 */
function buildPreviewMessage(preview: ImportPreview, diffs: ClassSizeDiff[]) {
  const children: (VNode | null)[] = [
    h(
      'p',
      `本次导入会把 ${diffs.length} 个班级的人数下调超过阈值（> ${preview.shrinkConfirmPct}% 且不少于 ${preview.shrinkConfirmMinDrop} 人）：`,
    ),
    ...diffs
      .slice(0, 8)
      .map((diff) =>
        h(
          'p',
          { style: 'margin: 2px 0' },
          `${diff.className}（${diff.collegeName || '—'}/${diff.majorName || '—'}）${diff.currentCount} → ${diff.incomingCount}（-${diff.drop}，${diff.dropPct}%）`,
        ),
      ),
    diffs.length > 8 ? h('p', `…等共 ${diffs.length} 个班级`) : null,
    h(
      'p',
      `文件共 ${preview.totalRows} 行（有效 ${preview.okRows} 行），将新建 ${preview.newUserCount} 个账号。`,
    ),
    preview.disableComparisonApplies && preview.disableEstimate > 0
      ? h(
          'p',
          `另有 ${preview.disableEstimate} 个在册账号不在名单内，导入后将被停用（范围仅限文件内学院+角色）。`,
        )
      : null,
    h('p', '班级人数是教师填报数量的上限，下调会立即收紧该班教师可填数量。确认这是完整名单吗？'),
  ]
  return h('div', children)
}

/** 上传入口：学生名单先预览 → 命中阈值则强确认 → 带确认标记重提 */
async function uploadPeopleFile(file: File) {
  const target = semesterId.value ?? undefined
  const role = personType.value
  if (role !== 'student') {
    return accountsApi.importExcel(file, role, target)
  }
  try {
    const preview = await accountsApi.previewImport(file, role, target)
    const flagged = preview.classSizeDiffs.filter((diff) => diff.requiresConfirm)
    if (preview.requiresConfirm && flagged.length > 0) {
      await ElMessageBox.confirm(buildPreviewMessage(preview, flagged), '班级人数将被下调', {
        type: 'warning',
        confirmButtonText: '确认导入',
        cancelButtonText: '取消（改用完整名单）',
      })
      return accountsApi.importExcel(file, role, target, true)
    }
  } catch (error) {
    const apiError = error as { code?: string; message?: string }
    // 预览未命中阈值 → 直接导入；但若后端仍 409（如预览与导入之间数据变化），
    // 用后端 message 做一次强确认后带标记重提，不把「需要确认」伪装成失败。
    if (
      apiError?.code !== 'STATE_CONFLICT' ||
      !apiError.message?.includes('confirmClassSizeShrink')
    ) {
      throw error
    }
    await ElMessageBox.confirm(apiError.message, '班级人数将被下调', {
      type: 'warning',
      confirmButtonText: '确认导入',
      cancelButtonText: '取消',
    })
    return accountsApi.importExcel(file, role, target, true)
  }
  return accountsApi.importExcel(file, role, target)
}
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
            v-model="peopleFilters.keyword"
            :placeholder="personType === 'student' ? '学号 / 姓名' : '工号 / 姓名'"
            clearable
            style="width: 220px"
            @keyup.enter="searchPeople"
            @clear="searchPeople"
          />
          <el-button type="primary" @click="searchPeople">查询</el-button>
        </div>

        <ServerTable ref="peopleTableRef" :fetcher="fetchPeoplePage">
          <el-table-column prop="userNo" label="学号/工号" width="140" />
          <el-table-column prop="name" label="姓名" width="110" />
          <el-table-column label="角色" width="140">
            <template #default="{ row }">
              {{ row.roles.map((r: string) => ROLE_LABELS[r] || r).join('、') }}
            </template>
          </el-table-column>
          <el-table-column prop="collegeName" label="学院" min-width="140">
            <template #default="{ row }">{{ row.collegeName || '—' }}</template>
          </el-table-column>
          <el-table-column prop="className" label="班级" width="140">
            <template #default="{ row }">{{ row.className || '—' }}</template>
          </el-table-column>
          <el-table-column prop="phone" label="手机号" width="140">
            <template #default="{ row }">{{ row.phone || '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">
                {{ row.status === 1 ? '正常' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
        </ServerTable>

        <div class="mt-16">
          <ImportWizard
            :title="`${personType === 'student' ? '学生' : '教师'}名单 Excel 导入（异步批次）`"
            :uploader="uploadPeopleFile"
            :poller="batchApi.detail"
            :error-downloader="downloadErrorDetail"
            :template-downloader="() => accountsApi.template(personType)"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="异动审批工作台" name="change">
        <div class="app-toolbar">
          <el-select
            v-model="changeFilters.status"
            clearable
            placeholder="全部状态"
            style="width: 170px"
            @change="searchChanges"
          >
            <el-option label="待审批" value="pending_review" />
            <el-option label="字段审查中" value="pending_field_check" />
            <el-option label="已通过" value="approved" />
            <el-option label="已驳回" value="rejected" />
          </el-select>
          <el-input
            v-model="changeFilters.batchNo"
            placeholder="批次号"
            clearable
            style="width: 180px"
            @keyup.enter="searchChanges"
            @clear="searchChanges"
          />
          <el-button type="primary" @click="searchChanges">查询</el-button>
          <span class="text-muted">批量处理按批次号执行（后端 /admin/change/batch/review）</span>
        </div>

        <ServerTable ref="changeTableRef" :fetcher="fetchChangesPage">
          <el-table-column prop="targetUserNo" label="学号/工号" width="140" />
          <el-table-column prop="targetUserName" label="姓名" width="110">
            <template #default="{ row }">{{ row.targetUserName || '—' }}</template>
          </el-table-column>
          <el-table-column label="异动类型" width="120">
            <template #default="{ row }">{{ CHANGE_TYPE_LABELS[row.type] || row.type }}</template>
          </el-table-column>
          <el-table-column label="当前归属" min-width="180">
            <template #default="{ row }">
              {{ row.currentCollegeName || '—' }} / {{ row.currentClassName || '—' }}
            </template>
          </el-table-column>
          <el-table-column label="变更后" min-width="180">
            <template #default="{ row }">{{ afterTextOf(row) }}</template>
          </el-table-column>
          <el-table-column prop="applicantName" label="申请人" width="110">
            <template #default="{ row }">{{ row.applicantName || '—' }}</template>
          </el-table-column>
          <el-table-column label="批次号" width="130">
            <template #default="{ row }">{{ row.batchNo || '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="statusMetaOf(CHANGE_STATUS_META, row.status).type" size="small">
                {{ statusMetaOf(CHANGE_STATUS_META, row.status).label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="提交时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <div class="app-table-actions">
                <el-button size="small" text @click="openDetail(asRow<ChangeRequestListItem>(row))">
                  审查详情
                </el-button>
                <template v-if="row.status === 'pending_review'">
                  <PermButton
                    :code="PERMISSIONS.CHANGE_REVIEW"
                    size="small"
                    type="success"
                    text
                    @click="approve(asRow<ChangeRequestListItem>(row))"
                  >
                    通过
                  </PermButton>
                  <PermButton
                    :code="PERMISSIONS.CHANGE_REVIEW"
                    size="small"
                    type="danger"
                    text
                    @click="openReject(asRow<ChangeRequestListItem>(row))"
                  >
                    驳回
                  </PermButton>
                </template>
                <el-button
                  v-if="row.batchNo"
                  size="small"
                  text
                  @click="openBatch(asRow<ChangeRequestListItem>(row))"
                >
                  按批次
                </el-button>
              </div>
            </template>
          </el-table-column>
        </ServerTable>
      </el-tab-pane>
    </el-tabs>

    <!-- 审查详情 -->
    <el-dialog v-model="detailVisible" title="异动审查详情" width="620px" append-to-body>
      <template v-if="selected">
        <el-descriptions :column="2" border size="small" class="mb-16">
          <el-descriptions-item label="学号/工号">{{ selected.targetUserNo }}</el-descriptions-item>
          <el-descriptions-item label="姓名">
            {{ selected.targetUserName || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="异动类型">
            {{ CHANGE_TYPE_LABELS[selected.type] || selected.type }}
          </el-descriptions-item>
          <el-descriptions-item label="申请人">
            {{ selected.applicantName || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="当前归属" :span="2">
            {{ beforeText(selected) }}
          </el-descriptions-item>
          <el-descriptions-item label="变更后" :span="2">
            {{ afterText(selected) }}
          </el-descriptions-item>
          <el-descriptions-item label="批次号">{{ selected.batchNo || '—' }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">
            {{ formatDateTime(selected.createdAt) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-alert
          title="系统字段审查不过的记录会直接落「已驳回」，因此进入「待审批」即表示字段审查已通过，此处只需内容审核。"
          type="info"
          :closable="false"
          show-icon
        />

        <div class="mt-16 app-table-actions">
          <template v-if="selected.status === 'pending_review'">
            <PermButton
              :code="PERMISSIONS.CHANGE_REVIEW"
              type="success"
              :loading="processing"
              @click="approve(selected)"
            >
              内容审核通过
            </PermButton>
            <PermButton
              :code="PERMISSIONS.CHANGE_REVIEW"
              type="danger"
              :loading="processing"
              @click="openReject(selected)"
            >
              驳回
            </PermButton>
          </template>
          <el-button v-if="selected.batchNo" @click="openBatch(selected)">按批次处理</el-button>
          <el-button @click="detailVisible = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 驳回：理由必填 -->
    <el-dialog v-model="rejectVisible" title="驳回异动申请" width="480px" append-to-body>
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
          :code="PERMISSIONS.CHANGE_REVIEW"
          type="danger"
          :loading="processing"
          @click="submitReject"
        >
          确认驳回
        </PermButton>
      </template>
    </el-dialog>

    <!-- 按批次批量处理 -->
    <el-dialog v-model="batchRejectVisible" title="按批次批量处理" width="500px" append-to-body>
      <el-alert
        :title="`将对批次 ${batchAction?.batchNo || '—'} 下全部待审批记录执行操作`"
        type="info"
        :closable="false"
        show-icon
        class="mb-16"
      />
      <el-input
        v-model="batchRejectReason"
        type="textarea"
        :rows="4"
        maxlength="200"
        show-word-limit
        placeholder="驳回理由（驳回时必填，1-200 字）"
      />
      <template #footer>
        <el-button @click="batchRejectVisible = false">取消</el-button>
        <PermButton
          :code="PERMISSIONS.CHANGE_REVIEW"
          type="success"
          :loading="processing"
          @click="submitBatch('pass')"
        >
          批量通过
        </PermButton>
        <PermButton
          :code="PERMISSIONS.CHANGE_REVIEW"
          type="danger"
          :loading="processing"
          @click="submitBatch('reject')"
        >
          批量驳回
        </PermButton>
      </template>
    </el-dialog>
  </div>
</template>
