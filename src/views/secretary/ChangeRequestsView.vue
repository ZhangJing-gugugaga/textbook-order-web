<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { changeApi } from '@/api/change'
import { batchApi } from '@/api/people'
import { downloadErrorDetail } from '@/api/http'
import FieldCheckResult from '@/components/FieldCheckResult.vue'
import ImportWizard from '@/components/ImportWizard.vue'
import { useConfigStore } from '@/stores/config'
import {
  CHANGE_REASON_LABELS,
  CHANGE_REASON_TYPES,
  CHANGE_STATUS_META,
  CHANGE_TARGET_LABELS,
  COPY,
  statusMetaOf,
} from '@/utils/constants'
import { formatDateTime } from '@/utils/format'
import type { ChangeReasonType, ChangeRequest } from '@/types'

/**
 * 异动申请（PRD 学院秘书-异动申请 / API.md §3.8）：
 * 逐条（POST /api/secretary/change）或 Excel 批量（POST /api/secretary/change/import）提交，
 * 一律走两级审查，页面不出现「直接生效」路径；
 * 字段审查不过的记录直接落「已驳回」并回显 fieldCheckResult（不抛 400）。
 *
 * 2026-09-23（FE-W5）三处补齐：
 *  1) **异动类型**（转专业/留级/专升本/其他，BE-7a）——必填，逐条提交与导入第 6 列共用同一套取值；
 *     原「异动类型」单选组实为**异动对象**（学生/教师），已改名以免与 `changeType` 混淆；
 *  2) **模板下载**——`GET /api/secretary/change/template`（BE-7c，6 列）；
 *  3) **导入异步化**——`POST /api/secretary/change/import` 改回 `{batchId}`（BE-7b），
 *     上传后走 `ImportWizard` 的批次轮询 + 错误明细下载，不再是"上传即出统计"的同步交互。
 */
const activeTab = ref<'submit' | 'progress'>('submit')
const config = useConfigStore()

const colleges = ref<{ id: number; name: string }[]>([])
const classes = ref<{ id: number; name: string; majorId?: number }[]>([])

/* ---------------- 逐条提交 ---------------- */
const submitting = ref(false)
const form = ref({
  type: 'student' as 'student' | 'teacher',
  /** 异动类型：默认「其他」（决策 D4/D7 默认口径） */
  changeType: 'OTHER' as ChangeReasonType,
  targetUserNo: '',
  targetCollegeId: undefined as number | undefined,
  targetClassId: undefined as number | undefined,
})
const lastResult = ref<ChangeRequest | null>(null)

const reasonOptions = Object.entries(CHANGE_REASON_TYPES).map(([value, label]) => ({
  value,
  label,
}))

function validateSingle() {
  if (!form.value.targetUserNo.trim()) return '请输入目标学号/工号'
  if (!form.value.changeType) return '请选择异动类型'
  if (!form.value.targetCollegeId) return '请选择目标学院'
  if (form.value.type === 'student' && !form.value.targetClassId) return '学生异动需选择目标班级'
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
    // 教师异动仅支持变更学院：传 targetClassId 会被后端 400（W16），故按类型裁剪
    const payload = {
      type: form.value.type,
      changeType: form.value.changeType,
      targetUserNo: form.value.targetUserNo.trim(),
      targetCollegeId: form.value.targetCollegeId as number,
      targetClassId: form.value.type === 'student' ? form.value.targetClassId : undefined,
    }
    const result = await changeApi.submitBySecretary(payload)
    lastResult.value = result
    if (result.fieldCheckResult?.length) {
      ElMessage.warning('已提交，但系统字段审查未通过，记录已落「已驳回」')
    } else {
      ElMessage.success('已提交，进入两级审批流程')
    }
    form.value = {
      type: 'student',
      changeType: 'OTHER',
      targetUserNo: '',
      targetCollegeId: undefined,
      targetClassId: undefined,
    }
    await loadProgress()
  } catch (e) {
    ElMessage.error((e as Error)?.message || COPY.FAILED)
  } finally {
    submitting.value = false
  }
}

/* ---------------- Excel 批量（异步批次，ImportWizard 负责进度与错误明细） ---------------- */
function onBatchFinished() {
  // 导入完成后刷新提交记录，让新落库的异动立刻可见
  void loadProgress()
}

/* ---------------- 我的提交记录 ----------------
 * 秘书无 change:request:review，不能用 /api/admin/change（复核列表）；
 * GET /api/teacher/change 仅需 change:request:submit，返回当前用户本人的提交记录，
 * 且带 before/after 名称与 fieldCheckResult，正是提交端需要的视图。
 */
const status = ref('')
const reasonFilter = ref('')
const rows = ref<ChangeRequest[]>([])
const loading = ref(false)

async function loadProgress() {
  loading.value = true
  try {
    rows.value = await changeApi.mySubmissions()
  } catch (e) {
    rows.value = []
    ElMessage.error((e as Error)?.message || COPY.FAILED)
  } finally {
    loading.value = false
  }
}

/** 服务端返回本人全量记录，状态与异动类型筛选在前端做 */
const filtered = computed(() =>
  rows.value.filter((r) => {
    if (status.value && r.status !== status.value) return false
    // 历史数据 change_type 为 null：用 UNCLASSIFIED 兜底，便于单独筛「未分类」
    if (reasonFilter.value && (r.changeType || 'UNCLASSIFIED') !== reasonFilter.value) return false
    return true
  }),
)

/**
 * 异动类型展示文案。入参收 `unknown` 并在函数内收窄——el-table 的 slot 行类型是
 * `DefaultRow`，而模板插值里写 `asRow<T>(row)` 会被 Prettier 的 Vue 解析器误判为标签。
 */
const reasonText = (raw: unknown) => {
  const row = raw as ChangeRequest
  return CHANGE_REASON_LABELS[row.changeType ?? 'UNCLASSIFIED'] ?? '未分类'
}

/** el-table 行类型为 DefaultRow，此处收窄回业务类型（第三方边界） */
function beforeText(raw: unknown) {
  const row = raw as ChangeRequest
  return `${row.beforeCollegeName || '—'} / ${row.beforeClassName || '—'}`
}

function afterText(raw: unknown) {
  const row = raw as ChangeRequest
  return `${row.afterCollegeName || '—'}${row.afterClassName ? ` / ${row.afterClassName}` : ''}`
}

onMounted(async () => {
  void config.load()
  // 组织三表为超管专属，此处用异动提交端的最小权限选项接口
  const options = await changeApi.orgOptions().catch(() => null)
  colleges.value = options?.colleges ?? []
  classes.value = options?.classes ?? []
  await loadProgress()
})
</script>

<template>
  <div class="app-page">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="提交异动" name="submit">
        <el-card shadow="never" style="max-width: 620px">
          <el-form :model="form" label-width="120px">
            <el-form-item label="异动对象">
              <el-radio-group v-model="form.type">
                <el-radio-button value="student">学生异动</el-radio-button>
                <el-radio-button value="teacher">教师异动</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="异动类型" required>
              <el-select
                v-model="form.changeType"
                style="width: 100%"
                data-testid="change-reason-select"
              >
                <el-option
                  v-for="item in reasonOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="目标学号/工号" required>
              <el-input v-model="form.targetUserNo" maxlength="32" placeholder="如 20230102" />
            </el-form-item>
            <el-form-item label="目标学院" required>
              <el-select v-model="form.targetCollegeId" filterable style="width: 100%">
                <el-option
                  v-for="college in colleges"
                  :key="college.id"
                  :label="college.name"
                  :value="college.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item v-if="form.type === 'student'" label="目标班级" required>
              <el-select v-model="form.targetClassId" filterable style="width: 100%">
                <el-option
                  v-for="klass in classes"
                  :key="klass.id"
                  :label="klass.name"
                  :value="klass.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item v-else label="目标班级">
              <span class="text-muted">教师异动仅支持变更学院（不填写班级）</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="submitting" @click="submitSingle">
                提交异动申请
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <FieldCheckResult
          v-if="lastResult?.fieldCheckResult?.length"
          class="mt-16"
          :items="lastResult.fieldCheckResult"
          title="系统字段审查"
        />

        <div class="mt-16" style="max-width: 760px">
          <ImportWizard
            title="异动名单 Excel 批量提交（学号/工号、异动对象、目标学院、目标班级、原因、异动类型）"
            :uploader="changeApi.importBatch"
            :poller="batchApi.detail"
            :error-downloader="downloadErrorDetail"
            :template-downloader="changeApi.template"
            @finished="onBatchFinished"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="审批进度" name="progress">
        <div class="app-toolbar">
          <el-select v-model="status" clearable placeholder="全部状态" style="width: 150px">
            <el-option label="待审批" value="pending_review" />
            <el-option label="已通过" value="approved" />
            <el-option label="已驳回" value="rejected" />
          </el-select>
          <el-select
            v-model="reasonFilter"
            clearable
            placeholder="全部异动类型"
            style="width: 160px"
            data-testid="change-reason-filter"
          >
            <el-option
              v-for="item in reasonOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
            <el-option label="未分类" value="UNCLASSIFIED" />
          </el-select>
          <el-button @click="loadProgress">刷新</el-button>
          <span class="text-muted">
            仅本人提交记录；字段审查不过的记录直接落「已驳回」并回显原因
          </span>
        </div>

        <el-table v-loading="loading" :data="filtered" border stripe>
          <el-table-column prop="id" label="编号" width="90" />
          <el-table-column prop="targetUserNo" label="学号/工号" width="140" />
          <el-table-column prop="targetUserName" label="姓名" width="110">
            <template #default="{ row }">{{ row.targetUserName || '—' }}</template>
          </el-table-column>
          <el-table-column label="异动对象" width="110">
            <template #default="{ row }">
              {{ CHANGE_TARGET_LABELS[row.type] || row.type }}
            </template>
          </el-table-column>
          <el-table-column label="异动类型" width="110">
            <template #default="{ row }">
              <el-tag size="small" type="info">{{ reasonText(row) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="当前归属" min-width="170">
            <template #default="{ row }">{{ beforeText(row) }}</template>
          </el-table-column>
          <el-table-column label="变更后" min-width="170">
            <template #default="{ row }">{{ afterText(row) }}</template>
          </el-table-column>
          <el-table-column label="字段审查" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.fieldCheckResult?.length" type="danger" size="small">
                {{ row.fieldCheckResult.length }} 项未过
              </el-tag>
              <span v-else class="text-muted">通过</span>
            </template>
          </el-table-column>
          <el-table-column prop="batchNo" label="批次号" width="130">
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
          <template #empty>
            <el-empty :description="COPY.EMPTY" :image-size="80" />
          </template>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
