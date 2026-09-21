<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { orderFormApi } from '@/api/orderForm'
import FieldCheckResult from '@/components/FieldCheckResult.vue'
import ExportButton from '@/components/ExportButton.vue'
import { COPY } from '@/utils/constants'
import { formatMoney, formatDateTime } from '@/utils/format'
import type { OrderForm } from '@/types'

/**
 * 复核工作台（PRD 复核工作台页 / 02 §6.2）：
 * 待审列表 + 系统字段审查结果（只读）+ 明细预览 + 通过/驳回（理由必填）。
 * 本页不提供修改表单内容的编辑能力——复核不改数据，驳回由教师补正。
 */
const query = ref<{
  status: string
  collegeId: number | undefined
  keyword: string
  page: number
  size: number
}>({
  status: 'pending_review',
  collegeId: undefined,
  keyword: '',
  page: 1,
  size: 10,
})
const rows = ref<OrderForm[]>([])
const total = ref(0)
const loading = ref(false)

const detailVisible = ref(false)
const detail = ref<OrderForm | null>(null)
const detailLoading = ref(false)
const rejectVisible = ref(false)
const rejectComment = ref('')
const processing = ref(false)

async function load() {
  loading.value = true
  try {
    const result = await orderFormApi.page({
      status: query.value.status || undefined,
      collegeId: query.value.collegeId,
      keyword: query.value.keyword || undefined,
      page: query.value.page,
      size: query.value.size,
    })
    rows.value = result.list
    total.value = result.total
  } catch {
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function search() {
  query.value.page = 1
  void load()
}

async function openDetail(row: OrderForm) {
  detailVisible.value = true
  detailLoading.value = true
  try {
    detail.value = await orderFormApi.detail(row.id)
  } catch {
    detail.value = row
  } finally {
    detailLoading.value = false
  }
}

async function approve() {
  if (!detail.value) return
  try {
    await ElMessageBox.confirm('确认复核通过该表单？通过后计入汇总。', '复核通过', {
      type: 'warning',
    })
  } catch {
    return
  }
  processing.value = true
  try {
    await orderFormApi.review(detail.value.id, { action: 'approve' })
    ElMessage.success('已复核通过')
    detailVisible.value = false
    void load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    processing.value = false
  }
}

async function submitReject() {
  const comment = rejectComment.value.trim()
  if (!comment) {
    ElMessage.error('驳回理由必填')
    return
  }
  if (comment.length > 200) {
    ElMessage.error('驳回理由不超过 200 字')
    return
  }
  if (!detail.value) return
  processing.value = true
  try {
    await orderFormApi.review(detail.value.id, { action: 'reject', comment })
    ElMessage.success('已驳回，教师可补正后重新提交')
    rejectVisible.value = false
    detailVisible.value = false
    void load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    processing.value = false
  }
}

const STATUS_LABELS: Record<
  string,
  { label: string; type: 'success' | 'danger' | 'warning' | 'info' }
> = {
  draft: { label: '草稿', type: 'info' },
  pending_review: { label: '待复核', type: 'warning' },
  reviewed: { label: '已复核', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
}

function formTotal(items: OrderForm['items']) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0)
}

function formQuantity(items: OrderForm['items']) {
  return items.reduce((sum, item) => sum + item.quantity, 0)
}

load()
</script>

<template>
  <div class="app-page">
    <div class="app-toolbar">
      <el-select v-model="query.status" clearable style="width: 160px" @change="search">
        <el-option label="待复核" value="pending_review" />
        <el-option label="已复核" value="reviewed" />
        <el-option label="已驳回" value="rejected" />
        <el-option label="全部" value="" />
      </el-select>
      <el-input
        v-model="query.keyword"
        placeholder="教师姓名 / 课程"
        clearable
        style="width: 200px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button type="primary" @click="search">查询</el-button>
      <ExportButton
        name="复核工作台导出"
        type="info"
        :estimated-rows="total"
        :params="{ status: query.status, keyword: query.keyword }"
      />
    </div>

    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column prop="id" label="表单号" width="100" />
      <el-table-column prop="teacherName" label="任课教师" width="120" />
      <el-table-column prop="collegeName" label="学院" min-width="140" />
      <el-table-column label="明细行数" width="100" align="center">
        <template #default="{ row }">{{ row.items.length }}</template>
      </el-table-column>
      <el-table-column label="数量合计" width="100" align="center">
        <template #default="{ row }">{{ formQuantity(row.items) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="STATUS_LABELS[row.status].type" size="small">
            {{ STATUS_LABELS[row.status].label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="primary" text @click="openDetail(row)">审查</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="app-pagination">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.size"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        @current-change="load"
        @size-change="search"
      />
    </div>
    <el-empty v-if="!loading && rows.length === 0" :description="COPY.EMPTY" :image-size="80" />

    <el-dialog v-model="detailVisible" title="表单审查" width="760px" append-to-body>
      <div v-loading="detailLoading">
        <template v-if="detail">
          <el-descriptions :column="3" border size="small" class="mb-16">
            <el-descriptions-item label="表单号">{{ detail.id }}</el-descriptions-item>
            <el-descriptions-item label="任课教师">{{ detail.teacherName }}</el-descriptions-item>
            <el-descriptions-item label="学院">{{ detail.collegeName }}</el-descriptions-item>
            <el-descriptions-item label="提交时间">
              {{ formatDateTime(detail.createdAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="STATUS_LABELS[detail.status].type" size="small">
                {{ STATUS_LABELS[detail.status].label }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="审核人">
              {{ detail.reviewedBy || '—' }}
            </el-descriptions-item>
          </el-descriptions>

          <h4>系统字段审查结果（只读）</h4>
          <FieldCheckResult :items="detail.fieldCheck" />

          <h4 class="mt-16">明细预览（课程 × 班级 × 教材 × 数量）</h4>
          <el-table :data="detail.items" size="small" border stripe>
            <el-table-column prop="courseName" label="课程" min-width="140" />
            <el-table-column prop="className" label="班级" width="140" />
            <el-table-column
              prop="textbookTitle"
              label="教材"
              min-width="160"
              show-overflow-tooltip
            />
            <el-table-column prop="isbn" label="ISBN" width="150" />
            <el-table-column label="单价" width="100">
              <template #default="{ row }">{{ formatMoney(row.price) }}</template>
            </el-table-column>
            <el-table-column prop="quantity" label="数量" width="90" />
            <el-table-column label="小计" width="110">
              <template #default="{ row }">{{ formatMoney(row.price * row.quantity) }}</template>
            </el-table-column>
          </el-table>
          <div class="flex-between mt-16">
            <span class="text-muted">
              合计 {{ formQuantity(detail.items) }} 本 / {{ formatMoney(formTotal(detail.items)) }}
            </span>
            <span v-if="detail.reviewComment" class="text-danger">
              审核意见：{{ detail.reviewComment }}
            </span>
          </div>

          <div v-if="detail.status === 'pending_review'" class="mt-16 app-table-actions">
            <el-button type="success" :loading="processing" @click="approve">通过</el-button>
            <el-button type="danger" :loading="processing" @click="rejectVisible = true">
              驳回
            </el-button>
          </div>
          <div v-else class="mt-16">
            <el-button @click="detailVisible = false">关闭</el-button>
          </div>
        </template>
      </div>
    </el-dialog>

    <el-dialog v-model="rejectVisible" title="驳回表单" width="480px" append-to-body>
      <el-input
        v-model="rejectComment"
        type="textarea"
        :rows="4"
        maxlength="200"
        show-word-limit
        placeholder="请输入驳回理由（必填，1-200 字）"
      />
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" :loading="processing" @click="submitReject">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>
