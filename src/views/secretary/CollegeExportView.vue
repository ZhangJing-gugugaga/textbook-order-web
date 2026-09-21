<script setup lang="ts">
import { ref } from 'vue'
import { exportApi } from '@/api/exportTask'
import ExportButton from '@/components/ExportButton.vue'
import { PERMISSIONS } from '@/utils/constants'

/**
 * 本院导出（PRD 学院秘书-本院导出 / API.md §3.10）：
 * POST /api/secretary/export/signature — 本院签字版式 Excel（含签字栏三行）；
 * 学院范围由后端取当前用户 active 学期归属强制过滤，前端不可越权导出他院数据。
 * 版式样张由田老师提供，逾期降级为标准表格 + 签字栏占位（Q4 默认值）。
 */
const notes = [
  '导出范围由后端按账号数据范围（学院）强制过滤，前端不可越权导出他院数据。',
  '每次导出后端均写审计日志（谁 / 何时 / 范围），前端仅提示「已下载，导出行为已记录」。',
  '行数 ≤ 阈值（默认 5000）同步下载；超过则创建异步导出任务，完成后通过一次性授权链接自动下载。',
  '签字版式样张由田老师提供；逾期按标准表格 + 签字栏占位输出（Q4 默认值）。',
]
const noteVisible = ref(true)
</script>

<template>
  <div class="app-page">
    <h3 class="mb-16">本院征订导出（签字版）</h3>

    <el-alert
      title="导出的 Excel 含签字栏（学院盖章 / 教材室签字 / 日期三行），用于线下签字流程。"
      type="info"
      :closable="false"
      show-icon
      class="mb-16"
    />

    <div class="app-toolbar">
      <ExportButton
        name="教材征订签字版"
        :code="PERMISSIONS.EXPORT_SIGNATURE"
        :exporter="() => exportApi.signature({})"
      />
      <span class="text-muted">导出范围：本学院全部教师征订单（含明细与审查状态）</span>
    </div>

    <el-divider content-position="left">导出说明</el-divider>
    <ul v-if="noteVisible" class="export-notes">
      <li v-for="(note, index) in notes" :key="index">{{ note }}</li>
    </ul>
  </div>
</template>

<style scoped>
.export-notes {
  margin: 0;
  padding-left: 18px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.9;
}
</style>
