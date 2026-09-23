<script setup lang="ts">
import { reactive, ref } from 'vue'

import { auditApi } from '@/api/dashboard'
import ServerTable from '@/components/ServerTable.vue'
import { AUDIT_ACTIONS, COPY } from '@/utils/constants'
import { formatDateTime, toWireDateTime } from '@/utils/format'
import { asRow } from '@/utils/table'
import type { AuditLog } from '@/types'

/**
 * 审计日志（决策 FE-W7 / API.md §3.12）：GET /api/admin/audit，权限 `audit:log:view`。
 *
 * 此前 `auditApi.page()` 已接线但全仓无消费页面，侧边栏也没有入口，
 * 于是「导出留痕」只能查库——甲方要求导出可追溯，本页把它变成可查能力。
 *
 * 分页与三态由 ServerTable 基座承担（SPEC §8）；动作下拉取 `AUDIT_ACTIONS`，
 * 与后端 `AuditService` 的常量一一对应，页面内不再各写一份。
 */
const filters = reactive({
  userNo: '',
  action: '',
  resource: '',
  /** el-date-picker datetimerange 的值（`yyyy-MM-dd HH:mm:ss`） */
  range: [] as string[],
})

const tableRef = ref<{ reload: (resetPage?: boolean) => void } | null>(null)

/** 筛选条件 → 接口参数（空值不下发；时间归一化为 ISO，后端两种格式都接受） */
function fetchPage({ page, size }: { page: number; size: number }) {
  const [startAt, endAt] = filters.range ?? []
  return auditApi.page({
    userNo: filters.userNo.trim() || undefined,
    action: filters.action || undefined,
    resource: filters.resource.trim() || undefined,
    startAt: toWireDateTime(startAt),
    endAt: toWireDateTime(endAt),
    page,
    size,
  })
}

function search() {
  tableRef.value?.reload()
}

/** 清空全部筛选（下拉/输入/时间范围）后回到第 1 页 */
function reset() {
  filters.userNo = ''
  filters.action = ''
  filters.resource = ''
  filters.range = []
  tableRef.value?.reload()
}

function actionLabel(action: string) {
  return AUDIT_ACTIONS[action] ?? action
}

/**
 * 插槽 row 的类型边界收在脚本内：el-table 的行类型是 `Record<PropertyKey, any>`，
 * 且**模板里不能写 `asRow<T>(row)`**——`<T>` 会被 Vue 模板编译器当成 HTML 标签，
 * 报 "Unexpected closing tag"（实测）。
 */
function actionOf(row: unknown) {
  return asRow<AuditLog>(row).action
}

function detailOf(row: unknown) {
  return detailText(asRow<AuditLog>(row).detailJson)
}

/** detailJson 折叠展示：对象转多行 JSON，空则显示占位 */
function detailText(detail?: Record<string, unknown>) {
  if (!detail || !Object.keys(detail).length) return ''
  return JSON.stringify(detail, null, 2)
}
</script>

<template>
  <div class="app-page">
    <div class="app-toolbar">
      <el-input
        v-model="filters.userNo"
        placeholder="操作者学号/工号"
        clearable
        style="width: 180px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-select v-model="filters.action" clearable placeholder="动作" style="width: 160px">
        <el-option
          v-for="(label, code) in AUDIT_ACTIONS"
          :key="code"
          :label="label"
          :value="code"
        />
      </el-select>
      <el-input
        v-model="filters.resource"
        placeholder="资源（如 order-form）"
        clearable
        style="width: 180px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-date-picker
        v-model="filters.range"
        type="datetimerange"
        value-format="YYYY-MM-DD HH:mm:ss"
        range-separator="至"
        start-placeholder="开始时间"
        end-placeholder="结束时间"
        style="width: 360px"
      />
      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
      <span class="text-muted">审计日志只读，不可修改或删除</span>
    </div>

    <ServerTable ref="tableRef" :fetcher="fetchPage" :empty-text="COPY.EMPTY">
      <el-table-column prop="at" label="时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.at) }}</template>
      </el-table-column>
      <el-table-column prop="userNo" label="操作者" width="120" />
      <el-table-column label="动作" width="140">
        <template #default="{ row }">
          <el-tag size="small" :type="actionOf(row) === 'WITHDRAW' ? 'warning' : 'info'">
            {{ actionLabel(actionOf(row)) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="resource" label="资源" min-width="160" show-overflow-tooltip />
      <el-table-column prop="resourceId" label="资源 ID" width="110" />
      <el-table-column prop="ip" label="IP" width="140" />
      <el-table-column label="详情" width="100" align="center">
        <template #default="{ row }">
          <el-popover v-if="detailOf(row)" placement="left" :width="420" trigger="click">
            <template #reference>
              <el-button size="small" text type="primary">查看</el-button>
            </template>
            <pre class="audit-detail">{{ detailOf(row) }}</pre>
          </el-popover>
          <span v-else class="text-muted">—</span>
        </template>
      </el-table-column>
    </ServerTable>
  </div>
</template>

<style scoped>
/* 详情 JSON：等宽 + 可滚动，避免长 detailJson 撑破气泡 */
.audit-detail {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
