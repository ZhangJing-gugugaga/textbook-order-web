<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { FormInstance } from 'element-plus'
import { noticeApi } from '@/api/notice'
import { exportApi } from '@/api/exportTask'
import ExportButton from '@/components/ExportButton.vue'
import PermButton from '@/components/PermButton.vue'
import {
  COPY,
  NOTICE_SOURCE_LABELS,
  PERMISSIONS,
  ROLE_LABELS,
  SEND_STATUS,
} from '@/utils/constants'
import { asRow } from '@/utils/table'
import { validateForm } from '@/utils/validate'
import { formatDateTime } from '@/utils/format'
import type { NoticeFailure, NoticeProgress, NoticeTask } from '@/types'

/**
 * 通知管理（PRD 教材室-通知管理 / API.md §3.11）：
 * 手动建通知任务（同学期仅 1 个 active，重复创建 → 409）；系统自动任务（窗口变更）只读展示；
 * 进度（sent/unauthorized/failed/confirmed）与失败名单（线下兜底）可查。
 */
const activeTab = ref<'tasks' | 'create'>('tasks')
const tasks = ref<NoticeTask[]>([])
const loading = ref(false)
const progressVisible = ref(false)
const currentTask = ref<NoticeTask | null>(null)
const progress = ref<NoticeProgress | null>(null)
/** 详情请求序号：连点两条任务时只采纳最后一次响应（评审 A3） */
let progressRequestId = 0
const failures = ref<NoticeFailure[]>([])
const failuresLoading = ref(false)

async function load() {
  loading.value = true
  try {
    tasks.value = await noticeApi.tasks()
  } catch (error) {
    tasks.value = []
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    loading.value = false
  }
}

/** el-table 行类型为 DefaultRow，此处收窄回业务类型（第三方边界） */
function sourceLabel(raw: unknown) {
  const task = raw as NoticeTask
  return NOTICE_SOURCE_LABELS[task.source ?? ''] ?? '教材室'
}

async function openProgress(task: NoticeTask) {
  const current = ++progressRequestId
  currentTask.value = task
  progressVisible.value = true
  failuresLoading.value = true
  progress.value = null
  try {
    const [detail, page] = await Promise.all([
      noticeApi.progress(task.id),
      noticeApi.failures(task.id, { page: 1, size: 200 }),
    ])
    if (current !== progressRequestId) return
    progress.value = detail
    failures.value = page.list
  } catch (error) {
    if (current !== progressRequestId) return
    failures.value = []
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    if (current === progressRequestId) failuresLoading.value = false
  }
}

async function closeTask(task: NoticeTask) {
  try {
    await noticeApi.closeTask(task.id)
    ElMessage.success('已关闭该通知任务')
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}

/* ---------------- 手动创建 ---------------- */
const creating = ref(false)
const createFormRef = ref<FormInstance>()
const createForm = reactive({ title: '', content: '', targetRoles: 'STUDENT' })
const createRules = {
  title: [{ required: true, message: '请输入通知标题', trigger: 'blur' }],
  content: [{ required: true, message: '请输入通知内容', trigger: 'blur' }],
}

async function submitCreate() {
  if (!(await validateForm(createFormRef.value))) return
  creating.value = true
  try {
    await noticeApi.createTask({
      title: createForm.title,
      content: createForm.content,
      targetRoles: createForm.targetRoles || undefined,
    })
    ElMessage.success('通知任务已创建，学生端将以阻塞弹窗触达')
    activeTab.value = 'tasks'
    createForm.title = ''
    createForm.content = ''
    createForm.targetRoles = 'STUDENT'
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    creating.value = false
  }
}

const progressPct = (value: number | undefined, total: number) =>
  total > 0 ? Math.round(((value ?? 0) / total) * 100) : 0

onMounted(load)
</script>

<template>
  <div class="app-page">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="通知任务" name="tasks">
        <div class="flex-between mb-16">
          <span class="text-muted">
            系统自动任务（窗口变更）只读展示；「未授权」= 未确认者（一次性订阅一次授权一条）。
          </span>
          <ExportButton
            v-if="tasks.length"
            name="通知汇总"
            type="info"
            :code="PERMISSIONS.EXPORT_NOTICE"
            :exporter="() => exportApi.notice({ taskId: tasks[0].id })"
          />
        </div>

        <el-table v-loading="loading" :data="tasks" border stripe>
          <el-table-column prop="id" label="任务号" width="90" />
          <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
          <el-table-column label="来源" width="150">
            <template #default="{ row }">
              <el-tag
                :type="row.source === 'system_window_change' ? 'info' : 'success'"
                size="small"
              >
                {{ sourceLabel(row) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="发送范围" width="120">
            <template #default="{ row }">{{ row.targetRoles || '—' }}</template>
          </el-table-column>
          <el-table-column label="重发上限 / 间隔" width="150">
            <template #default="{ row }">
              {{ row.roundLimit ?? '—' }} 轮 / {{ row.intervalHours ?? '—' }} 小时
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'warning' : 'info'" size="small">
                {{ row.status === 'active' ? '进行中' : '已关闭' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <div class="app-table-actions">
                <el-button size="small" text @click="openProgress(asRow<NoticeTask>(row))">
                  进度与失败名单
                </el-button>
                <PermButton
                  v-if="row.status === 'active'"
                  :code="PERMISSIONS.NOTICE_TASK_MANAGE"
                  size="small"
                  type="warning"
                  text
                  @click="closeTask(asRow<NoticeTask>(row))"
                >
                  关闭
                </PermButton>
              </div>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty :description="COPY.EMPTY" :image-size="80" />
          </template>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="创建通知" name="create">
        <el-form
          ref="createFormRef"
          :model="createForm"
          :rules="createRules"
          label-width="96px"
          style="max-width: 560px"
        >
          <el-form-item label="通知标题" prop="title">
            <el-input
              v-model="createForm.title"
              maxlength="120"
              placeholder="如 请尽快完成教材填报"
            />
          </el-form-item>
          <el-form-item label="通知内容" prop="content">
            <el-input
              v-model="createForm.content"
              type="textarea"
              :rows="5"
              maxlength="500"
              show-word-limit
            />
          </el-form-item>
          <el-form-item label="发送对象">
            <el-select v-model="createForm.targetRoles" style="width: 100%">
              <el-option :label="ROLE_LABELS.STUDENT" value="STUDENT" />
              <el-option :label="ROLE_LABELS.TEACHER" value="TEACHER" />
              <el-option :label="ROLE_LABELS.SECRETARY" value="SECRETARY" />
              <el-option label="学生 + 教师" value="STUDENT,TEACHER" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <PermButton
              :code="PERMISSIONS.NOTICE_TASK_MANAGE"
              type="primary"
              :loading="creating"
              @click="submitCreate"
            >
              创建并发送
            </PermButton>
          </el-form-item>
        </el-form>
        <el-alert
          title="同学期仅允许一个进行中的通知任务；若已存在会提示合并/关闭后再建"
          type="info"
          :closable="false"
          show-icon
          style="max-width: 560px"
        />
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="progressVisible" title="通知进度与失败名单" width="760px" append-to-body>
      <template v-if="currentTask">
        <el-descriptions :column="3" border size="small" class="mb-16">
          <el-descriptions-item label="任务号">{{ currentTask.id }}</el-descriptions-item>
          <el-descriptions-item label="标题" :span="2">
            {{ currentTask.title }}
          </el-descriptions-item>
          <el-descriptions-item label="已发送">{{ progress?.sent ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="已确认">
            {{ progress?.confirmed ?? '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="未授权">
            {{ progress?.unauthorized ?? '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="发送失败">
            {{ progress?.failed ?? '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="重发上限">
            {{ progress?.roundLimit ?? '—' }} 轮
          </el-descriptions-item>
          <el-descriptions-item label="确认率">
            {{
              progress ? `${progressPct(progress.confirmed, progress.sent)}%（已确认/已发送）` : '—'
            }}
          </el-descriptions-item>
        </el-descriptions>

        <h4>未授权 / 失败名单（线下兜底）</h4>
        <el-table
          v-loading="failuresLoading"
          :data="failures"
          size="small"
          border
          stripe
          max-height="300"
        >
          <el-table-column prop="userNo" label="学号/工号" width="130" />
          <el-table-column prop="name" label="姓名" width="110" />
          <el-table-column label="角色" width="120">
            <template #default="{ row }">{{ ROLE_LABELS[row.role] || row.role }}</template>
          </el-table-column>
          <el-table-column prop="collegeName" label="学院" width="130" show-overflow-tooltip />
          <el-table-column prop="className" label="班级" width="130" show-overflow-tooltip />
          <el-table-column label="发送状态" width="110">
            <template #default="{ row }">
              <el-tag size="small" type="warning">
                {{ SEND_STATUS[row.sendStatus as keyof typeof SEND_STATUS] ?? row.sendStatus }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="roundNo" label="轮次" width="80" />
          <el-table-column label="发送时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.sentAt) }}</template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无失败记录" :image-size="60" />
          </template>
        </el-table>
      </template>
    </el-dialog>
  </div>
</template>
