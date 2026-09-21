<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { studentOrderApi } from '@/api/studentOrder'
import { useWindowStore } from '@/stores/window'
import { formatDateTime, formatMoney } from '@/utils/format'
import { COPY, STUDENT_ORDER_STATUS_META, statusMetaOf } from '@/utils/constants'
import { asRow } from '@/utils/table'
import type { StudentOrder, StudentOrderListItem } from '@/types'

/**
 * 我的选购记录（PRD 学生-我的选购记录 / API.md §3.7）：
 * GET /api/student/orders 返回本人跨学期记录摘要（服务端不分页、不含明细）；
 * 明细仅当前学期可查（GET /api/student/order）；无导出。
 */
const windowStore = useWindowStore()

const rows = ref<StudentOrderListItem[]>([])
const loading = ref(false)
const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<StudentOrder | null>(null)
/** 详情请求序号：连点两条记录时只采纳最后一次响应（评审 A3） */
let detailRequestId = 0

const currentSemesterId = computed(() => windowStore.semesterId)

async function load() {
  loading.value = true
  try {
    rows.value = await studentOrderApi.myHistory()
  } catch (error) {
    rows.value = []
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    loading.value = false
  }
}

/** 仅当前学期有明细接口；历史学期后端只回摘要 */
/** el-table 行类型为 DefaultRow，此处收窄回业务类型（第三方边界） */
function canOpenDetail(raw: unknown) {
  const row = raw as StudentOrderListItem
  return currentSemesterId.value !== null && row.semesterId === currentSemesterId.value
}

async function openDetail(row: StudentOrderListItem) {
  if (!canOpenDetail(row)) return
  const current = ++detailRequestId
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    const result = await studentOrderApi.myOrder()
    if (current !== detailRequestId) return
    detail.value = result
  } catch (error) {
    if (current !== detailRequestId) return
    ElMessage.error((error as Error)?.message || COPY.FAILED)
    detailVisible.value = false
  } finally {
    detailLoading.value = false
  }
}

const detailTotalAmount = computed(() =>
  (detail.value?.items ?? []).reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0),
)

function statusLabel(status: string) {
  return statusMetaOf(STUDENT_ORDER_STATUS_META, status).label
}

onMounted(() => {
  void windowStore.fetch()
  void load()
})
</script>

<template>
  <div class="app-page">
    <div class="app-toolbar">
      <el-button @click="load">刷新</el-button>
      <span class="text-muted">本页仅本人记录（跨学期摘要），无导出入口</span>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column prop="id" label="单号" width="90" />
      <el-table-column prop="semesterName" label="学期" min-width="200" show-overflow-tooltip />
      <el-table-column prop="className" label="班级" width="150">
        <template #default="{ row }">{{ row.className || '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag size="small" :type="row.status === 'submitted' ? 'success' : 'info'">
            {{ statusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="totalQuantity" label="数量合计" width="100" align="center" />
      <el-table-column label="提交时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.submittedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-tooltip
            :disabled="canOpenDetail(row)"
            content="历史学期后端仅提供汇总，明细仅当前学期可查"
            placement="top"
          >
            <span>
              <el-button
                size="small"
                type="primary"
                text
                :disabled="!canOpenDetail(row)"
                @click="openDetail(asRow<StudentOrderListItem>(row))"
              >
                查看明细
              </el-button>
            </span>
          </el-tooltip>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :description="COPY.EMPTY" :image-size="80" />
      </template>
    </el-table>

    <el-dialog v-model="detailVisible" title="选购明细（当前学期）" width="680px" append-to-body>
      <div v-loading="detailLoading">
        <template v-if="detail">
          <el-descriptions :column="3" border size="small" class="mb-16">
            <el-descriptions-item label="学期">{{ detail.semesterName }}</el-descriptions-item>
            <el-descriptions-item label="班级">
              {{ detail.submitSnapshot?.className || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="提交时间">
              {{ formatDateTime(detail.submittedAt) }}
            </el-descriptions-item>
          </el-descriptions>
          <el-table :data="detail.items" size="small" border stripe>
            <el-table-column prop="title" label="教材" min-width="170" show-overflow-tooltip />
            <el-table-column prop="isbn" label="ISBN" width="150" />
            <el-table-column label="单价" width="100">
              <template #default="{ row }">{{ formatMoney(row.price) }}</template>
            </el-table-column>
            <el-table-column prop="quantity" label="数量" width="80" />
            <el-table-column label="小计" width="110">
              <template #default="{ row }">
                {{ formatMoney((row.price ?? 0) * row.quantity) }}
              </template>
            </el-table-column>
          </el-table>
          <div class="settle-total">
            合计 {{ detail.totalQuantity }} 本 / {{ formatMoney(detailTotalAmount) }}
          </div>
          <div class="fine-print">价格和版本以最终出版单位供应为准</div>
        </template>
        <el-empty v-else-if="!detailLoading" description="当前学期暂无选购单" :image-size="80" />
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.settle-total {
  margin-top: 10px;
  text-align: right;
  font-size: 14px;
}

.fine-print {
  margin-top: 6px;
  text-align: center;
  font-size: 12px;
  color: #b0b4c0;
}
</style>
