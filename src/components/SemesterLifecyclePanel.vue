<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, FormInstance } from 'element-plus'
import { semesterApi } from '@/api/semester'
import { formatDateTime } from '@/utils/format'
import { validateExtendEnd, validateWindowRange } from '@/utils/validate'
import type { Semester, WindowChangeRecord } from '@/types'

/**
 * 学期生命周期面板（SPEC §8 / Q1）：
 * draft→active 激活二次确认（失败回退提示）、归档；同一时刻仅一个 active 的前端校验；
 * 窗口操作（立即开启 / 提前截止 / 延长）每次二次确认并提示将自动通知全员。
 */
const props = defineProps<{ semester: Semester }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const saving = ref(false)
const changes = ref<WindowChangeRecord[]>([])

const form = reactive({
  windowStart: props.semester.windowStart,
  windowEnd: props.semester.windowEnd,
  autoOpen: props.semester.autoOpen,
  autoClose: props.semester.autoClose,
})

const formRef = ref<FormInstance>()
const rules = {
  windowStart: [{ required: true, message: '请选择窗口开始时间', trigger: 'change' }],
  windowEnd: [{ required: true, message: '请选择窗口截止时间', trigger: 'change' }],
}

async function loadChanges() {
  changes.value = await semesterApi.changes(props.semester.id).catch(() => [])
}

async function saveWindow() {
  await formRef.value?.validate()
  const rangeError = validateWindowRange(form.windowStart, form.windowEnd)
  if (rangeError) {
    ElMessage.error(rangeError)
    return
  }
  saving.value = true
  try {
    await semesterApi.update(props.semester.id, { ...form })
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
    await semesterApi.activate(props.semester.id)
    ElMessage.success('已生效，通知将自动发送给全员')
    emit('changed')
    await loadChanges()
  } catch (error) {
    // 原子切换失败回退提示
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

function actionLabel(action: WindowChangeRecord['action']) {
  const map: Record<string, string> = {
    open: '开启窗口',
    close: '截止窗口',
    extend: '延长窗口',
    activate: '激活学期',
    archive: '归档学期',
  }
  return map[action] ?? action
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
          :type="
            semester.status === 'active' ? 'success' : semester.status === 'draft' ? 'info' : 'info'
          "
        >
          {{
            semester.status === 'active'
              ? '进行中'
              : semester.status === 'draft'
                ? '草稿'
                : '已归档'
          }}
        </el-tag>
      </div>
      <div class="app-table-actions">
        <el-button
          v-if="semester.status === 'draft'"
          type="primary"
          :loading="saving"
          @click="activate"
        >
          激活学期
        </el-button>
        <template v-if="semester.status === 'active'">
          <el-button :loading="saving" @click="openWindow">立即开启</el-button>
          <el-button type="warning" :loading="saving" @click="closeWindow">提前截止</el-button>
          <el-button type="primary" :loading="saving" @click="extendVisible = true">延长</el-button>
        </template>
        <el-button v-if="semester.status !== 'archived'" :loading="saving" @click="archive">
          归档
        </el-button>
      </div>
    </div>

    <el-form ref="formRef" :model="form" :rules="rules" inline class="semester-form">
      <el-form-item label="窗口开始" prop="windowStart">
        <el-date-picker
          v-model="form.windowStart"
          type="datetime"
          value-format="YYYY-MM-DDTHH:mm:ss"
          placeholder="选择开始时间"
        />
      </el-form-item>
      <el-form-item label="窗口截止" prop="windowEnd">
        <el-date-picker
          v-model="form.windowEnd"
          type="datetime"
          value-format="YYYY-MM-DDTHH:mm:ss"
          placeholder="选择截止时间"
        />
      </el-form-item>
      <el-form-item label="自动开启">
        <el-switch v-model="form.autoOpen" />
      </el-form-item>
      <el-form-item label="自动截止">
        <el-switch v-model="form.autoClose" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="saveWindow">保存窗口设置</el-button>
      </el-form-item>
    </el-form>
    <div class="text-muted mb-16">
      天数任意设置；窗口开始必须早于结束；同一时刻仅一个 active 学期。
    </div>

    <el-divider content-position="left">变更记录</el-divider>
    <el-table :data="changes" size="small" border stripe max-height="240">
      <el-table-column type="index" label="#" width="60" />
      <el-table-column label="操作" width="120">
        <template #default="{ row }">{{ actionLabel(row.action) }}</template>
      </el-table-column>
      <el-table-column prop="operatorName" label="操作人" width="120" />
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="原值 → 新值" min-width="220">
        <template #default="{ row }">
          {{ row.fromValue || '—' }} → {{ row.toValue || '—' }}
        </template>
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
            value-format="YYYY-MM-DDTHH:mm:ss"
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
        <el-button type="primary" :loading="saving" @click="submitExtend">确认延长</el-button>
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
