<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { orderFormApi } from '@/api/orderForm'
import FieldCheckResult from '@/components/FieldCheckResult.vue'
import { useWindowStore } from '@/stores/window'
import { useConfigStore } from '@/stores/config'
import { CODE, COPY, ORDER_FORM_STATUS } from '@/utils/constants'
import { asRow } from '@/utils/table'
import { formatDateTime, formatMoney, windowStatusText } from '@/utils/format'
import { ApiError } from '@/api/http'
import type { FieldCheckIssue, OrderForm, TeacherCourseGroup, TeacherTextbookOption } from '@/types'

interface DraftRow {
  /** 行内唯一键（课程×班级×教材） */
  key: string
  courseId: number
  classId: number
  textbookId: number
  quantity: number
}

/**
 * 填报教材页（PRD 填报教材页 / API.md §3.6）：
 * 后端模型为「一教师一学期一单」，明细每行 = 课程 × 班级 × 教材 × 数量；
 * 提交先过系统字段审查（400 FIELD_CHECK_FAILED 逐字段回显，可修复重提），
 * 再转超管内容审核；被驳回表单在 correctDeadline 前可补正重提（关窗后仍可）。
 */
const windowStore = useWindowStore()
const config = useConfigStore()

const groups = ref<TeacherCourseGroup[]>([])
const form = ref<OrderForm | null>(null)
const rows = ref<DraftRow[]>([])
const fieldIssues = ref<FieldCheckIssue[]>([])
const loading = ref(false)
const submitting = ref(false)

/* ---------------- 选书器 ---------------- */
const picker = reactive({
  courseId: undefined as number | undefined,
  classId: undefined as number | undefined,
  keyword: '',
})
const options = ref<TeacherTextbookOption[]>([])
const searching = ref(false)

/** 课程 × 班级 扁平选项（选书器与明细共用） */
const pairs = computed(() =>
  groups.value.flatMap((group) =>
    group.courses.map((course) => ({
      key: `${course.courseId}:${group.classId}`,
      courseId: course.courseId,
      courseName: course.courseName,
      classId: group.classId,
      className: group.className,
    })),
  ),
)

/**
 * 数量输入上限。
 *
 * 真实上限是**班级人数**（后端提交时按 `QTY_RANGE` 校验），但班级人数当前未随
 * `GET /api/teacher/my-courses` 下发（`docs/12` W-G2，跨端依赖），故前端回退
 * `order.quantity.max_default`（默认 999）做**预校验**。
 *
 * 这里已按 classId 预留取值入口：后端一旦下发 `studentCount`，无需改本函数。
 * 未下发时页面**显式提示**（见模板 `classSizeMissing` 告警），不静默按 999 放行——
 * 否则教师会以为 999 就是合法上限，提交后才被后端驳回。
 */
function quantityMax(classId?: number) {
  const group = groups.value.find((item) => item.classId === classId)
  return group?.studentCount ?? config.quantityMax
}

/** 班级人数未下发（当前恒为 true，直到后端补字段） */
const classSizeMissing = computed(
  () => groups.value.length > 0 && groups.value.every((group) => !group.studentCount),
)

const canFill = computed(() => windowStore.status === 'open')
/** 补正豁免窗口：被驳回表单在 correctDeadline 前可重提 */
const isCorrectable = computed(() => {
  const status = form.value?.status
  if (status !== 'rejected' && status !== 'rejected_auto') return false
  if (!form.value?.correctDeadline) return true
  return new Date(form.value.correctDeadline).getTime() > Date.now() + windowStore.serverTimeOffset
})
const editable = computed(() => canFill.value || isCorrectable.value)
const isLockedByReview = computed(
  () => form.value?.status === 'pending_review' || form.value?.status === 'reviewed',
)

const withdrawing = ref(false)

/**
 * 可撤回（决策 D1 口径）：待审核 **且** 窗口开放期。
 * 关窗后不显示撤回按钮——撤回会得到 409 WINDOW_CLOSED（后端 `@WithinWindow`），
 * 且撤回后无法重提会把表单变成死草稿。
 */
const canWithdraw = computed(() => form.value?.status === 'pending_review' && canFill.value)

/** 撤回后提示：区分「从未提交的草稿」与「撤回后待重提」 */
const withdrawnHint = computed(() =>
  form.value?.status === 'draft' && form.value.withdrawnAt
    ? `已于 ${formatDateTime(form.value.withdrawnAt)} 撤回，修改后请重新提交。`
    : '',
)

/**
 * 主动撤回：待审核期间表单只读（禁止无留痕覆盖），要改必须先撤回。
 * 撤回后回到 draft，明细保留（教师从当前内容继续改），可编辑重提。
 */
async function confirmWithdraw() {
  try {
    await ElMessageBox.confirm(
      '撤回后表单回到可编辑状态，需重新提交才进入审核；审核老师若已打开旧内容，其审核将被拒绝。',
      '确认撤回本次填报？',
      { type: 'warning', confirmButtonText: '撤回修改', cancelButtonText: '再想想' },
    )
  } catch {
    return
  }
  withdrawing.value = true
  try {
    await orderFormApi.withdraw()
    ElMessage.success('已撤回，可修改后重新提交')
    await load()
  } catch (error) {
    // 409 时后端 message 已含分档文案（窗口已关闭 / 已通过审核…），直接展示
    ElMessage.error((error as Error)?.message || '撤回失败，请重试')
  } finally {
    withdrawing.value = false
  }
}

function rowKey(courseId: number, classId: number, textbookId: number) {
  return `${courseId}:${classId}:${textbookId}`
}

async function load() {
  loading.value = true
  try {
    const [courseGroups, myForm] = await Promise.all([
      orderFormApi.myCourses(),
      orderFormApi.myForm(),
    ])
    groups.value = courseGroups
    form.value = myForm
    fieldIssues.value = myForm?.fieldCheckResult ?? []
    rows.value = (myForm?.items ?? []).map((item) => ({
      key: rowKey(item.courseId, item.classId, item.textbookId),
      courseId: item.courseId,
      classId: item.classId,
      textbookId: item.textbookId,
      quantity: item.quantity,
    }))
    if (!picker.classId && pairs.value.length) {
      picker.courseId = pairs.value[0].courseId
      picker.classId = pairs.value[0].classId
    }
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    loading.value = false
  }
}

async function searchOptions() {
  searching.value = true
  try {
    options.value = await orderFormApi.searchTextbooks(picker.keyword.trim() || undefined)
  } catch (error) {
    options.value = []
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    searching.value = false
  }
}

function addRow(option: TeacherTextbookOption) {
  if (!picker.courseId || !picker.classId) {
    ElMessage.warning('请先选择课程与班级')
    return
  }
  const key = rowKey(picker.courseId, picker.classId, option.textbookId)
  if (rows.value.some((row) => row.key === key)) {
    ElMessage.warning('该教材已在明细中')
    return
  }
  rows.value = [
    ...rows.value,
    {
      key,
      courseId: picker.courseId,
      classId: picker.classId,
      textbookId: option.textbookId,
      quantity: 1,
    },
  ]
}

function removeRow(key: string) {
  rows.value = rows.value.filter((row) => row.key !== key)
}

/** el-table 行类型为 DefaultRow，此处收窄回业务类型（第三方边界） */
function labelOf(raw: unknown) {
  const row = raw as DraftRow
  const pair = pairs.value.find((p) => p.courseId === row.courseId && p.classId === row.classId)
  const book = options.value.find((o) => o.textbookId === row.textbookId)
  return {
    course: pair
      ? `${pair.courseName} · ${pair.className}`
      : `课程#${row.courseId} 班级#${row.classId}`,
    book: book
      ? `${book.title}（${book.isbn}）`
      : form.value?.items.find((i) => i.textbookId === row.textbookId)?.textbookTitle ||
        `教材#${row.textbookId}`,
  }
}

const totalQuantity = computed(() => rows.value.reduce((sum, row) => sum + (row.quantity || 0), 0))

async function submit() {
  if (rows.value.length === 0) {
    ElMessage.error('请先添加教材明细')
    return
  }
  if (rows.value.some((row) => !row.quantity || row.quantity < 1)) {
    ElMessage.error('数量需为 1 以上整数')
    return
  }
  submitting.value = true
  try {
    // 覆盖语义：重提 = 整单替换；补正重提与首次提交同一端点
    form.value = await orderFormApi.submit(
      rows.value.map((row) => ({
        courseId: row.courseId,
        classId: row.classId,
        textbookId: row.textbookId,
        quantity: row.quantity,
      })),
    )
    fieldIssues.value = form.value?.fieldCheckResult ?? []
    ElMessage.success('已提交，等待复核')
  } catch (error) {
    // 400 FIELD_CHECK_FAILED：data 为逐项 [{field, rule, message}]
    if (
      error instanceof ApiError &&
      error.code === CODE.FIELD_CHECK_FAILED &&
      Array.isArray(error.data)
    ) {
      fieldIssues.value = error.data as FieldCheckIssue[]
      ElMessage.error((error as Error).message || '存在未通过的字段审查，请按提示修复后重新提交')
    } else if (
      error instanceof ApiError &&
      (error.code === CODE.STATE_CONFLICT ||
        error.code === CODE.WINDOW_CLOSED ||
        error.code === CODE.CORRECTION_EXPIRED)
    ) {
      // 本页状态已过期（如管理员刚通过/驳回、窗口刚截止）：重拉最新状态再让用户决定，
      // 不自动重试——重试只会再次被同一个状态机拒绝
      ElMessage.warning((error as Error).message || '表单状态已变更，已为你刷新')
      await load()
    } else {
      ElMessage.error((error as Error)?.message || COPY.FAILED)
    }
  } finally {
    submitting.value = false
  }
}

const statusMeta = computed(() => {
  const status = form.value?.status
  if (!status) return null
  return { label: ORDER_FORM_STATUS[status as keyof typeof ORDER_FORM_STATUS] ?? status, status }
})

onMounted(() => {
  void windowStore.fetch()
  void config.load()
  void searchOptions()
  void load()
})
</script>

<template>
  <div class="app-page" v-loading="loading">
    <div class="flex-between mb-16">
      <span class="text-muted">
        {{ windowStatusText(windowStore.status, windowStore.remainMs, windowStore.startRemainMs) }}
      </span>
      <span class="text-muted">
        数量上限 {{ quantityMax() }}（班级人数缺失时回退 system_config）
      </span>
    </div>

    <!-- W-G2：班级人数未下发时显式提示，不让「999」被当成真实上限 -->
    <el-alert
      v-if="classSizeMissing"
      class="mb-16"
      type="info"
      :closable="false"
      show-icon
      title="数量上限暂按系统配置预校验"
    >
      班级人数尚未由接口下发，此处上限为系统配置的回退值；
      <strong>提交时后端会按班级人数校验</strong>
      ，超出部分会被驳回并提示具体行。
    </el-alert>

    <!-- 审查 / 驳回状态条 -->
    <el-alert
      v-if="form?.status === 'rejected' || form?.status === 'rejected_auto'"
      class="mb-16"
      type="error"
      :closable="false"
      show-icon
      :title="`表单被驳回，理由：${form?.reviewNote || '见字段审查结果'}，已解锁可补正重提${form?.correctDeadline ? `（补正截止 ${formatDateTime(form.correctDeadline)}）` : ''}`"
    />
    <el-alert
      v-else-if="form?.status === 'pending_review'"
      class="mb-16"
      type="warning"
      :closable="false"
      show-icon
      title="已提交，等待教材室审核。审核前如需修改，请先撤回。"
    >
      <el-button
        v-if="canWithdraw"
        type="warning"
        plain
        :loading="withdrawing"
        @click="confirmWithdraw"
      >
        撤回修改
      </el-button>
      <span v-else class="text-muted">窗口已关闭，如需修改请联系教材室。</span>
    </el-alert>
    <el-alert
      v-else-if="form?.status === 'reviewed'"
      class="mb-16"
      type="success"
      :closable="false"
      show-icon
      :title="`已复核通过${form?.reviewBy ? `（审核人 #${form.reviewBy}）` : ''}，本单已定稿，不能再修改或重提`"
    >
      已通过审核的表单是终态：后端会拒绝再次提交（409）。如内容确需调整，
      请联系教材室按线下流程处理。
    </el-alert>
    <el-alert
      v-else-if="withdrawnHint"
      class="mb-16"
      type="info"
      :closable="false"
      show-icon
      :title="withdrawnHint"
    />

    <FieldCheckResult
      v-if="fieldIssues.length"
      class="mb-16"
      :items="fieldIssues"
      title="系统字段审查"
    />

    <!-- 选书器 -->
    <el-card v-if="editable && !isLockedByReview" class="mb-16" shadow="never">
      <template #header>
        <span>添加教材明细</span>
      </template>
      <div class="picker-bar">
        <el-select v-model="picker.courseId" placeholder="选择课程" style="width: 220px" filterable>
          <el-option
            v-for="pair in pairs"
            :key="pair.key"
            :label="`${pair.courseName} · ${pair.className}`"
            :value="pair.courseId"
            @click="picker.classId = pair.classId"
          />
        </el-select>
        <el-select v-model="picker.classId" placeholder="选择班级" style="width: 180px" filterable>
          <el-option
            v-for="group in groups"
            :key="group.classId"
            :label="group.className"
            :value="group.classId"
          />
        </el-select>
        <el-input
          v-model="picker.keyword"
          placeholder="搜索教材库（书名 / ISBN / 作者 / 出版社）"
          clearable
          style="max-width: 320px"
          @keyup.enter="searchOptions"
          @clear="searchOptions"
        >
          <template #append>
            <el-button :loading="searching" @click="searchOptions">搜索</el-button>
          </template>
        </el-input>
      </div>

      <el-table
        v-if="options.length"
        :data="options"
        size="small"
        border
        class="mt-8"
        max-height="240"
      >
        <el-table-column prop="isbn" label="ISBN" width="150" />
        <el-table-column prop="title" label="书名" min-width="180" show-overflow-tooltip />
        <el-table-column prop="edition" label="版次" width="90" />
        <el-table-column prop="author" label="作者" width="110" />
        <el-table-column prop="press" label="出版社" width="150" show-overflow-tooltip />
        <el-table-column label="单价" width="100">
          <template #default="{ row }">{{ formatMoney(row.price) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button
              size="small"
              type="primary"
              text
              @click="addRow(asRow<TeacherTextbookOption>(row))"
            >
              选用
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="无在库教材，请联系教材室维护教材库" :image-size="70" />
    </el-card>

    <!-- 明细 -->
    <div class="flex-between mb-8">
      <span class="detail-title">
        我的填报明细
        <el-tag v-if="statusMeta" class="ml-8" size="small" type="info">
          {{ statusMeta.label }}
        </el-tag>
      </span>
      <span v-if="form" class="text-muted">最近提交：{{ formatDateTime(form.submittedAt) }}</span>
    </div>

    <el-table :data="rows" border stripe>
      <el-table-column type="index" label="#" width="60" />
      <el-table-column label="课程 · 班级" min-width="200">
        <template #default="{ row }">{{ labelOf(row).course }}</template>
      </el-table-column>
      <el-table-column label="教材" min-width="240" show-overflow-tooltip>
        <template #default="{ row }">{{ labelOf(row).book }}</template>
      </el-table-column>
      <el-table-column label="数量" width="180">
        <template #default="{ row }">
          <el-input-number
            v-model="row.quantity"
            :min="1"
            :max="quantityMax(row.classId)"
            size="small"
            :disabled="!editable || isLockedByReview"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="90">
        <template #default="{ row }">
          <el-button
            size="small"
            type="danger"
            text
            :disabled="!editable || isLockedByReview"
            @click="removeRow(row.key)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="尚未添加教材明细" :image-size="70" />
      </template>
    </el-table>

    <div class="flex-between mt-16">
      <span class="text-muted">合计 {{ totalQuantity }} 本</span>
      <el-button
        v-if="editable && !isLockedByReview"
        type="primary"
        :loading="submitting"
        :disabled="rows.length === 0"
        @click="submit"
      >
        {{ isCorrectable ? '补正重提' : '提交' }}
      </el-button>
    </div>

    <el-alert
      v-if="!canFill && !isCorrectable"
      class="mt-16"
      type="info"
      :closable="false"
      show-icon
      title="本期征订已截止，可查看历史记录（被驳回表单在补正截止前仍可重提）"
    />
  </div>
</template>

<style scoped>
.picker-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.detail-title {
  font-size: 15px;
  font-weight: 600;
}
</style>
