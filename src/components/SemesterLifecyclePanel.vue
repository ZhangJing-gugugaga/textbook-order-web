<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { FormInstance } from 'element-plus'
import { semesterApi } from '@/api/semester'
import PermButton from '@/components/PermButton.vue'
import { DATETIME_FORMAT, PERMISSIONS } from '@/utils/constants'
import { formatDateTime, toPickerDateTime } from '@/utils/format'
import { validateExtendEnd, validateForm, validateWindowRange } from '@/utils/validate'
import type { AuditLog, Semester } from '@/types'

/**
 * 学期生命周期面板（SPEC §8 / Q1 / API.md §3.2）：
 * draft→active 激活二次确认（body 带 version 乐观锁，冲突回退提示）、归档；
 * 窗口设置/立即开启/提前截止/无限次延长，每次二次确认并提示将自动通知全员；
 * 变更记录来自审计（GET /admin/semester/{id}/window/changes）。
 *
 * 时间格式：接口下发的是 ISO-8601（可能带微秒），而 el-date-picker 的
 * `value-format` 是 `yyyy-MM-dd HH:mm:ss`——回填与提交都要转换
 * （`toPickerDateTime` 回填 / 接口层的 `toWireDateTime` 提交）。
 */
const props = defineProps<{ semester: Semester }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const saving = ref(false)
const changes = ref<AuditLog[]>([])

const form = reactive({
  windowStart: toPickerDateTime(props.semester.windowStart),
  windowEnd: toPickerDateTime(props.semester.windowEnd),
  autoOpen: props.semester.autoOpen,
  autoClose: props.semester.autoClose,
})

// 切换学期（props 变化）时同步回填，否则会残留上一个学期的时间
watch(
  () => props.semester.id,
  () => {
    form.windowStart = toPickerDateTime(props.semester.windowStart)
    form.windowEnd = toPickerDateTime(props.semester.windowEnd)
    form.autoOpen = props.semester.autoOpen
    form.autoClose = props.semester.autoClose
  },
)

const formRef = ref<FormInstance>()
const rules = {
  windowStart: [{ required: true, message: '请选择窗口开始时间', trigger: 'change' }],
  windowEnd: [{ required: true, message: '请选择窗口截止时间', trigger: 'change' }],
}

async function loadChanges() {
  const result = await semesterApi
    .changes(props.semester.id, { page: 1, size: 50 })
    .catch(() => null)
  changes.value = result?.list ?? []
}

async function saveWindow() {
  if (!(await validateForm(formRef.value))) return
  const rangeError = validateWindowRange(form.windowStart, form.windowEnd)
  if (rangeError) {
    ElMessage.error(rangeError)
    return
  }
  saving.value = true
  try {
    await semesterApi.setWindow(props.semester.id, { ...form })
    ElMessage.success('已生效，通知将自动发送给全员')
    emit('changed')
    await loadChanges()
  } catch (error) {
    ElMessage.error((error as Error)?.message || '保存失败，请重试')
  } finally {
    saving.value = false
  }
}

async function activate() {
  try {
    await ElMessageBox.confirm(
      '确认激活该学期？激活后进入缓冲区数据导入阶段，同一时刻仅有一个 active 学期。',
      '激活学期',
      { type: 'warning', confirmButtonText: '确认激活' },
    )
  } catch {
    return
  }
  saving.value = true
  try {
    // 双缓冲原子切换：version 原样回传，不匹配 → 409 STATE_CONFLICT
    await semesterApi.activate(props.semester.id, props.semester.version)
    ElMessage.success('已生效，通知将自动发送给全员')
    emit('changed')
    await loadChanges()
  } catch (error) {
    // 原子切换失败回退提示（含 version 冲突）
    ElMessage.error((error as Error)?.message || '切换失败，请重试')
    emit('changed')
  } finally {
    saving.value = false
  }
}

async function archive() {
  try {
    await ElMessageBox.confirm('确认归档该学期？归档后不可再填报。', '归档学期', {
      type: 'warning',
    })
  } catch {
    return
  }
  saving.value = true
  try {
    await semesterApi.archive(props.semester.id)
    ElMessage.success('已归档')
    emit('changed')
  } catch (error) {
    ElMessage.error((error as Error)?.message || '操作失败，请重试')
  } finally {
    saving.value = false
  }
}

async function openWindow() {
  try {
    await ElMessageBox.confirm('确认立即开启征订窗口？将自动通知全员。', '立即开启', {
      type: 'warning',
    })
  } catch {
    return
  }
  saving.value = true
  try {
    await semesterApi.openWindow(props.semester.id)
    ElMessage.success('已生效，通知将自动发送给全员')
    emit('changed')
    await loadChanges()
  } catch (error) {
    ElMessage.error((error as Error)?.message || '操作失败，请重试')
  } finally {
    saving.value = false
  }
}

async function closeWindow() {
  try {
    await ElMessageBox.confirm('确认提前截止？截止后填报与选购将锁定。', '提前截止', {
      type: 'warning',
      confirmButtonText: '确认截止',
    })
  } catch {
    return
  }
  saving.value = true
  try {
    await semesterApi.closeWindow(props.semester.id)
    ElMessage.success('已生效，通知将自动发送给全员')
    emit('changed')
    await loadChanges()
  } catch (error) {
    ElMessage.error((error as Error)?.message || '操作失败，请重试')
  } finally {
    saving.value = false
  }
}

const extendVisible = ref(false)
const extendForm = reactive({ windowEnd: '' })

async function submitExtend() {
  const extendError = validateExtendEnd(extendForm.windowEnd)
  if (extendError) {
    ElMessage.error(extendError)
    return
  }
  saving.value = true
  try {
    await semesterApi.extendWindow(props.semester.id, extendForm.windowEnd)
    ElMessage.success('已生效，通知将自动发送给全员')
    extendVisible.value = false
    emit('changed')
    await loadChanges()
  } catch (error) {
    ElMessage.error((error as Error)?.message || '操作失败，请重试')
  } finally {
    saving.value = false
  }
}

/** 审计 action → 中文动作名 */
function actionLabel(action: string) {
  const map: Record<string, string> = {
    WINDOW_OPEN: '开启窗口',
    WINDOW_CLOSE: '截止窗口',
    WINDOW_EXTEND: '延长窗口',
    WINDOW_SET: '设置窗口',
    SEMESTER_ACTIVATE: '激活学期',
    SEMESTER_ARCHIVE: '归档学期',
    UPDATE: '设置窗口',
    ACTIVATE: '激活学期',
    ARCHIVE: '归档学期',
  }
  return map[action] ?? action
}

/** 审计明细 → 原值 → 新值 摘要 */
function detailText(detail: Record<string, unknown> | undefined) {
  if (!detail) return '—'
  const from = detail.before ?? detail.oldWindowEnd ?? detail.from
  const to = detail.after ?? detail.windowEnd ?? detail.to
  const render = (v: unknown) =>
    v === undefined || v === null
      ? '—'
      : typeof v === 'object'
        ? Object.entries(v as Record<string, unknown>)
            .map(([k, val]) => `${k}=${val}`)
            .join(', ')
        : String(v)
  if (from === undefined && to === undefined) {
    return Object.entries(detail)
      .map(([k, val]) => `${k}=${render(val)}`)
      .join('；')
  }
  return `${render(from)} → ${render(to)}`
}

loadChanges()
</script>

<template>
  <div class="semester-panel">
    <div class="flex-between mb-16">
      <div>
        <span class="semester-name">{{ semester.name }}</span>
        <el-tag
          class="ml-8"
          size="small"
          :type="semester.activeStatus === 'active' ? 'success' : 'info'"
        >
          {{
            semester.activeStatus === 'active'
              ? '当前学期'
              : semester.activeStatus === 'draft'
                ? '可导入'
                : '已归档'
          }}
        </el-tag>
        <el-tag
          class="ml-8"
          size="small"
          :type="semester.windowStatus === 'open' ? 'success' : 'warning'"
        >
          {{
            semester.windowStatus === 'open'
              ? '窗口进行中'
              : semester.windowStatus === 'closed'
                ? '窗口已截止'
                : '窗口未开始'
          }}
        </el-tag>
      </div>
      <div class="app-table-actions">
        <PermButton
          v-if="semester.activeStatus === 'draft'"
          :code="PERMISSIONS.SEMESTER_MANAGE"
          type="primary"
          :loading="saving"
          @click="activate"
        >
          激活学期
        </PermButton>
        <template v-if="semester.activeStatus === 'active'">
          <PermButton :code="PERMISSIONS.WINDOW_MANAGE" :loading="saving" @click="openWindow">
            立即开启
          </PermButton>
          <PermButton
            :code="PERMISSIONS.WINDOW_MANAGE"
            type="warning"
            :loading="saving"
            @click="closeWindow"
          >
            提前截止
          </PermButton>
          <PermButton
            :code="PERMISSIONS.WINDOW_MANAGE"
            type="primary"
            :loading="saving"
            @click="extendVisible = true"
          >
            延长
          </PermButton>
        </template>
        <PermButton
          v-if="semester.activeStatus !== 'archived'"
          :code="PERMISSIONS.SEMESTER_MANAGE"
          :loading="saving"
          @click="archive"
        >
          归档
        </PermButton>
      </div>
    </div>

    <el-form ref="formRef" :model="form" :rules="rules" inline class="semester-form">
      <el-form-item label="窗口开始" prop="windowStart">
        <el-date-picker
          v-model="form.windowStart"
          type="datetime"
          :value-format="DATETIME_FORMAT"
          placeholder="选择开始时间"
        />
      </el-form-item>
      <el-form-item label="窗口截止" prop="windowEnd">
        <el-date-picker
          v-model="form.windowEnd"
          type="datetime"
          :value-format="DATETIME_FORMAT"
          placeholder="选择截止时间"
        />
      </el-form-item>
      <el-form-item label="自动开启">
        <el-switch v-model="form.autoOpen" :active-value="1" :inactive-value="0" />
      </el-form-item>
      <el-form-item label="自动截止">
        <el-switch v-model="form.autoClose" :active-value="1" :inactive-value="0" />
      </el-form-item>
      <el-form-item>
        <PermButton
          :code="PERMISSIONS.WINDOW_MANAGE"
          type="primary"
          :loading="saving"
          @click="saveWindow"
        >
          保存窗口设置
        </PermButton>
      </el-form-item>
    </el-form>
    <div class="text-muted mb-16">
      天数任意设置；窗口开始必须早于截止；同一时刻仅一个 active
      学期；置「自动」为关则到点不动，保留手动控制。
    </div>

    <el-divider content-position="left">变更记录</el-divider>
    <el-table :data="changes" size="small" border stripe max-height="240">
      <el-table-column type="index" label="#" width="60" />
      <el-table-column label="操作" width="120">
        <template #default="{ row }">{{ actionLabel(row.action) }}</template>
      </el-table-column>
      <el-table-column label="操作人" width="120">
        <template #default="{ row }">{{ row.userNo || '—' }}</template>
      </el-table-column>
      <el-table-column label="时间" width="180">
        <template #default="{ row }">{{ formatDateTime(row.at) }}</template>
      </el-table-column>
      <el-table-column label="原值 → 新值" min-width="260">
        <template #default="{ row }">{{ detailText(row.detailJson) }}</template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="extendVisible"
      title="延长征订窗口"
      width="420px"
      align-center
      append-to-body
    >
      <el-form :model="extendForm" label-width="96px">
        <el-form-item label="新截止时间" required>
          <el-date-picker
            v-model="extendForm.windowEnd"
            type="datetime"
            :value-format="DATETIME_FORMAT"
            placeholder="必须晚于当前时间"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <el-alert
        title="延长将自动通知全员，并提醒尽快提交"
        type="info"
        :closable="false"
        show-icon
      />
      <template #footer>
        <el-button @click="extendVisible = false">取消</el-button>
        <PermButton
          :code="PERMISSIONS.WINDOW_MANAGE"
          type="primary"
          :loading="saving"
          @click="submitExtend"
        >
          确认延长
        </PermButton>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.semester-name {
  font-size: 15px;
  font-weight: 600;
}

.semester-form :deep(.el-form-item) {
  margin-bottom: 8px;
}
</style>
