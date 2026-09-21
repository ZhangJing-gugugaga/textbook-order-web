<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { exportTaskApi } from '@/api/exportTask'
import ExportButton from '@/components/ExportButton.vue'
import { triggerBrowserDownload } from '@/api/http'

/**
 * 本院导出（PRD 学院秘书-本院导出 / 02 §6.3 Q4）：
 * 线下签字版式 Excel（含签字栏：学院盖章 / 教材室签字 / 日期三行）；
 * 版式样张由田老师提供，逾期降级为标准表格 + 签字栏占位。
 * 导出正确性验收移 M5（Q3）。
 */
const activeTab = ref<'sign' | 'detail'>('sign')
const estimatedRows = ref(200)

async function downloadSignVersion() {
  try {
    const blob = await exportTaskApi.syncDownload({
      name: '本院征订表格（签字版）',
      params: { scope: 'college', layout: 'sign' },
    })
    triggerBrowserDownload(blob, '本院征订表格（签字版）.xlsx')
    ElMessage.success('已下载，导出行为已记录')
  } catch {
    ElMessage.error('导出失败请重试')
  }
}
</script>

<template>
  <div class="app-page">
    <h3 class="mb-16">本院征订导出</h3>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="签字版式" name="sign">
        <el-alert
          title="导出的 Excel 含签字栏（学院盖章 / 教材室签字 / 日期），用于线下签字流程。"
          type="info"
          :closable="false"
          show-icon
          class="mb-16"
        />
        <div class="app-toolbar">
          <ExportButton
            name="本院征订表格（签字版）"
            :estimated-rows="estimatedRows"
            :params="{ scope: 'college', layout: 'sign' }"
          />
          <el-button @click="downloadSignVersion">直接下载</el-button>
        </div>
        <div class="text-muted">导出范围：本学院全部教师征订单（含明细与审查状态）。</div>
      </el-tab-pane>

      <el-tab-pane label="标准表格" name="detail">
        <el-alert
          title="标准表格导出：明细行列（课程 × 班级 × 教材 × 数量 × 状态），不含签字栏。"
          type="info"
          :closable="false"
          show-icon
          class="mb-16"
        />
        <div class="app-toolbar">
          <ExportButton
            name="本院征订明细（标准）"
            :estimated-rows="estimatedRows"
            :params="{ scope: 'college', layout: 'standard' }"
          />
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-divider content-position="left">导出说明</el-divider>
    <ul class="export-notes">
      <li>导出范围由后端按账号数据范围（学院）强制过滤，前端不可越权导出他院数据。</li>
      <li>每次导出后端均写审计日志（谁 / 何时 / 范围），前端仅提示「已下载，导出行为已记录」。</li>
      <li>预估行数超过 5000 行时自动切换为异步导出任务，完成后通过一次性授权链接下载。</li>
      <li>签字版式样张由田老师提供；逾期按标准表格 + 签字栏占位输出（Q4 默认值）。</li>
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
