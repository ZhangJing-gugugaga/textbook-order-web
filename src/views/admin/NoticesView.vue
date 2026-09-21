<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, FormInstance } from 'element-plus'
import { noticeApi } from '@/api/notice'
import ExportButton from '@/components/ExportButton.vue'
import { COPY } from '@/utils/constants'
import { formatDateTime } from '@/utils/format'
import type { NoticeFailure, NoticeTask } from '@/types'

/**
 * 通知管理（PRD 教材室-通知管理 / 02 §6.2）：
 * 手动建通知任务；系统自动任务（窗口变更）只读展示；
 * 发送/确认进度与失败名单。
 */
const activeTab = ref<'tasks' | 'create'>('tasks')
const tasks = ref<NoticeTask[]>([])
const loading = ref(false)
const progressVisible = ref(false)
const currentTask = ref<NoticeTask | null>(null)
const failures = ref<NoticeFailure[]>([])
const failuresLoading = ref(false)

async function load() {
  loading.value = true
  try {
    tasks.value = await noticeApi.tasks()
  } catch {
    tasks.value = []
  } finally {
    loading.value = false
  }
}

function sourceLabel(task: NoticeTask) {
  return task.source === 'system' ? '系统（窗口变更）' : '手动创建'
}

async function openProgress(task: NoticeTask) {
  currentTask.value = task
  progressVisible.value = true
  failuresLoading.value = true
  try {
    failures.value = await noticeApi.failures(task.id)
  } catch {
    failures.value = []
  } finally {
    failuresLoading.value = false
  }
}

/* ---------------- 手动创建 ---------------- */
const creating = ref(false)
const createFormRef = ref<FormInstance>()
const createForm = reactive({ title: '', content: '', scope: 'all' })
const createRules = {
  title: [{ required: true, message: '请输入通知标题', trigger: 'blur' }],
  content: [{ required: true, message: '请输入通知内容', trigger: 'blur' }],
}

async function submitCreate() {
  await createFormRef.value?.validate()
  creating.value = true
  try {
    await noticeApi.createTask({ ...createForm })
    ElMessage.success('通知任务已创建，发送后可查看进度')
    activeTab.value = 'tasks'
    createForm.title = ''
    createForm.content = ''
    createForm.scope = 'all'
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    creating.value = false
  }
}

load()
</script>

<template>
  <div class="app-page">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="通知任务" name="tasks">
        <div class="flex-between mb-16">
          <span class="text-muted">系统自动任务（窗口变更）只读展示；发送进度与失败名单可查。</span>
          <ExportButton
            name="通知确认汇总"
            type="info"
            :estimated-rows="tasks.length"
            :params="{}"
          />
        </div>

        <el-table v-loading="loading" :data="tasks" border stripe>
          <el-table-column prop="id" label="任务号" width="90" />
          <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
          <el-table-column label="来源" width="150">
            <template #default="{ row }">
              <el-tag :type="row.source === 'system' ? 'info' : 'success'" size="small">
                {{ sourceLabel(row) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="进度" min-width="240">
            <template #default="{ row }">
              <div>发送 {{ row.sentCount }}/{{ row.totalCount }}</div>
              <el-progress
                :percentage="
                  row.totalCount ? Math.round((row.confirmedCount / row.totalCount) * 100) : 0
                "
                :stroke-width="8"
              />
            </template>
          </el-table-column>
          <el-table-column label="已确认" width="100" align="center">
            <template #default="{ row }">{{ row.confirmedCount }}</template>
          </el-table-column>
          <el-table-column label="失败" width="90" align="center">
            <template #default="{ row }">
              <span :class="row.failedCount ? 'text-danger' : ''">{{ row.failedCount }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag
                :type="
                  row.status === 'finished'
                    ? 'success'
                    : row.status === 'closed'
                      ? 'info'
                      : 'warning'
                "
                size="small"
              >
                {{
                  row.status === 'finished'
                    ? '已完成'
                    : row.status === 'closed'
                      ? '已关闭'
                      : '发送中'
                }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button size="small" text @click="openProgress(row)">进度与失败名单</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty
          v-if="!loading && tasks.length === 0"
          :description="COPY.EMPTY"
          :image-size="80"
        />
      </el-tab-pane>

      <el-tab-pane label="创建通知" name="create">
        <el-form
          ref="createFormRef"
          :model="createForm"
          :rules="createRules"
          label-width="88px"
          style="max-width: 560px"
        >
          <el-form-item label="通知标题" prop="title">
            <el-input
              v-model="createForm.title"
              maxlength="64"
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
          <el-form-item label="发送范围">
            <el-select v-model="createForm.scope" style="width: 100%">
              <el-option label="全员（秘书+教师+学生）" value="all" />
              <el-option label="仅任课教师" value="teacher" />
              <el-option label="仅学生" value="student" />
              <el-option label="仅学院秘书" value="secretary" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="creating" @click="submitCreate">
              创建并发送
            </el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="progressVisible" title="通知进度" width="720px" append-to-body>
      <template v-if="currentTask">
        <el-descriptions :column="3" border size="small" class="mb-16">
          <el-descriptions-item label="任务号">{{ currentTask.id }}</el-descriptions-item>
          <el-descriptions-item label="标题" :span="2">
            {{ currentTask.title }}
          </el-descriptions-item>
          <el-descriptions-item label="应发送">{{ currentTask.totalCount }}</el-descriptions-item>
          <el-descriptions-item label="已发送">{{ currentTask.sentCount }}</el-descriptions-item>
          <el-descriptions-item label="已确认">
            {{ currentTask.confirmedCount }}
          </el-descriptions-item>
          <el-descriptions-item label="发送失败">
            {{ currentTask.failedCount }}
          </el-descriptions-item>
          <el-descriptions-item label="范围" :span="2">
            {{ currentTask.scope }}
          </el-descriptions-item>
        </el-descriptions>

        <h4>失败名单</h4>
        <el-table
          v-loading="failuresLoading"
          :data="failures"
          size="small"
          border
          stripe
          max-height="280"
        >
          <el-table-column prop="userNo" label="学号/工号" width="140" />
          <el-table-column prop="userName" label="姓名" width="120" />
          <el-table-column prop="role" label="角色" width="120" />
          <el-table-column prop="round" label="轮次" width="90" />
          <el-table-column prop="reason" label="失败原因" min-width="180" show-overflow-tooltip />
        </el-table>
        <el-empty
          v-if="!failuresLoading && failures.length === 0"
          description="暂无失败记录"
          :image-size="60"
        />
      </template>
    </el-dialog>
  </div>
</template>
