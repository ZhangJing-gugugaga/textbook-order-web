<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { studentOrderApi } from '@/api/studentOrder'
import { useWindowStore } from '@/stores/window'
import { useConfigStore } from '@/stores/config'
import { ApiError } from '@/api/http'
import { formatCountdown, formatMoney, windowStatusText } from '@/utils/format'
import { COPY } from '@/utils/constants'
import type { StudentOrderItem } from '@/types'

/**
 * 选书页（PRD 选书页 / 02 §6.5）：
 * 窗口内按班级带出教材清单，勾选/取消、数量步进，提交 = 覆盖更新（整单替换）；
 * 一人一本提醒沿用 MVP；提交确认弹窗底部固定小字「价格和版本以最终出版单位供应为准」。
 */
const windowStore = useWindowStore()
const config = useConfigStore()

const books = ref<StudentOrderItem[]>([])
const loading = ref(false)
const submitting = ref(false)
const confirmVisible = ref(false)

const canOrder = computed(() => windowStore.status === 'open')
const windowText = computed(() =>
  windowStatusText(windowStore.status, windowStore.remainMs, windowStore.startRemainMs),
)

const checkedCount = computed(() => books.value.filter((item) => item.checked).length)
const totalQuantity = computed(() =>
  books.value.reduce((sum, item) => (item.checked ? sum + item.quantity : sum), 0),
)
const totalAmount = computed(() =>
  books.value.reduce((sum, item) => (item.checked ? sum + item.price * item.quantity : sum), 0),
)
const multipleRequired = computed(() => checkedCount.value > 1)
const stepMax = computed(() => Math.min(9, config.stepMax))

async function load() {
  loading.value = true
  try {
    books.value = await studentOrderApi.classBooks()
  } catch {
    books.value = []
  } finally {
    loading.value = false
  }
}

function toggle(book: StudentOrderItem, value: boolean) {
  book.checked = value
  // 取消勾选时数量归零（PRD：减到 0 自动取消勾选）
  if (!value) book.quantity = 0
  else if (!book.quantity) book.quantity = 1
}

function setQuantity(book: StudentOrderItem, value: number) {
  if (value <= 0) {
    // 步进减到 0：自动取消勾选
    book.checked = false
    book.quantity = 0
    return
  }
  book.quantity = Math.min(value, stepMax.value)
}

function openConfirm() {
  if (checkedCount.value === 0) {
    ElMessage.warning('请先勾选需要的教材')
    return
  }
  confirmVisible.value = true
}

async function submit() {
  submitting.value = true
  try {
    await studentOrderApi.submit({
      items: books.value
        .filter((item) => item.checked && item.quantity > 0)
        .map((item) => ({ textbookId: item.textbookId, quantity: item.quantity })),
    })
    ElMessage.success('提交成功，可在我的选购记录查看')
    confirmVisible.value = false
    await load()
  } catch (error) {
    // 关窗瞬间提交：后端 409 兜底，本地勾选保留不丢失
    if (error instanceof ApiError && error.code === 40901) {
      confirmVisible.value = false
    } else {
      ElMessage.error((error as Error)?.message || COPY.FAILED)
    }
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  void windowStore.fetch()
  void load()
})
</script>

<template>
  <div class="app-page">
    <!-- 窗口横幅 -->
    <el-alert
      class="mb-16"
      :title="windowText"
      :type="
        windowStore.status === 'open'
          ? 'success'
          : windowStore.status === 'closed'
            ? 'warning'
            : 'info'
      "
      :closable="false"
      show-icon
    >
      <template v-if="windowStore.status === 'open'" #title>
        <span>{{ windowText }}（距截止 {{ formatCountdown(windowStore.remainMs) }}）</span>
      </template>
    </el-alert>

    <!-- 一人一本提醒 -->
    <el-alert
      v-if="multipleRequired"
      class="mb-16"
      title="你勾选了多种教材，请确认是否需要多本"
      type="warning"
      :closable="false"
      show-icon
    />

    <div v-loading="loading">
      <el-empty
        v-if="!loading && books.length === 0"
        description="本班暂无征订书目"
        :image-size="110"
      />

      <div v-else class="book-grid">
        <div
          v-for="book in books"
          :key="book.textbookId"
          class="book-card"
          :class="{ checked: book.checked }"
        >
          <div class="book-head">
            <el-checkbox
              :model-value="book.checked"
              :disabled="!canOrder"
              @change="(value: string | number | boolean) => toggle(book, Boolean(value))"
            >
              <span class="book-title">{{ book.textbookTitle }}</span>
            </el-checkbox>
            <el-tag v-if="book.required" type="danger" size="small">必修</el-tag>
          </div>
          <div class="book-meta">
            <div>ISBN：{{ book.isbn }}</div>
            <div>
              作者：{{ book.author }} ｜ 出版社：{{ book.publisher }} ｜ 版次：{{ book.edition }}
            </div>
            <div class="book-price">单价：{{ formatMoney(book.price) }}</div>
          </div>
          <div class="book-foot">
            <span class="text-muted">数量（1-{{ stepMax }}）</span>
            <el-input-number
              :model-value="book.quantity"
              :min="0"
              :max="stepMax"
              size="small"
              :disabled="!canOrder"
              @change="(value: string | number | undefined) => setQuantity(book, Number(value))"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 底部结算栏 -->
    <div v-if="checkedCount > 0" class="settle-bar">
      <div class="settle-info">
        已选 {{ checkedCount }} 种 / {{ totalQuantity }} 本 ｜ 合计
        <strong>{{ formatMoney(totalAmount) }}</strong>
      </div>
      <el-button type="primary" :loading="submitting" :disabled="!canOrder" @click="openConfirm">
        提交
      </el-button>
    </div>

    <!-- 截止遮罩 -->
    <div v-if="!canOrder" class="closed-mask">
      <div class="closed-mask-inner">
        <el-icon :size="44"><Lock /></el-icon>
        <p>本期征订已截止，可查看历史记录</p>
        <el-button type="primary" text @click="$router.push('/my-orders')">
          查看我的选购记录
        </el-button>
      </div>
    </div>

    <!-- 提交确认弹窗 -->
    <el-dialog
      v-model="confirmVisible"
      title="确认提交选购清单"
      width="520px"
      align-center
      append-to-body
      :close-on-click-modal="false"
    >
      <el-table :data="books.filter((item) => item.checked)" size="small" border>
        <el-table-column prop="textbookTitle" label="教材" min-width="160" show-overflow-tooltip />
        <el-table-column prop="isbn" label="ISBN" width="150" />
        <el-table-column label="单价" width="100">
          <template #default="{ row }">{{ formatMoney(row.price) }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="数量" width="80" />
        <el-table-column label="小计" width="110">
          <template #default="{ row }">{{ formatMoney(row.price * row.quantity) }}</template>
        </el-table-column>
      </el-table>
      <div class="settle-total">合计 {{ totalQuantity }} 本 / {{ formatMoney(totalAmount) }}</div>
      <div class="fine-print">价格和版本以最终出版单位供应为准</div>
      <template #footer>
        <el-button @click="confirmVisible = false">再想想</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">确认提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.book-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.book-card {
  border: 1px solid #e9ebf2;
  border-radius: 8px;
  padding: 14px;
  transition: border-color 0.2s;
}

.book-card.checked {
  border-color: var(--el-color-primary);
  background: #f7f6fe;
}

.book-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.book-title {
  font-weight: 600;
}

.book-meta {
  margin: 8px 0;
  font-size: 12px;
  color: #6b7280;
  line-height: 1.8;
}

.book-price {
  color: var(--el-color-primary);
  font-weight: 600;
}

.book-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px dashed #e6e8f0;
  padding-top: 10px;
}

.settle-bar {
  position: sticky;
  bottom: 0;
  margin-top: 16px;
  background: #ffffff;
  border: 1px solid #e9ebf2;
  border-radius: 8px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 -4px 16px rgba(31, 36, 68, 0.06);
}

.settle-info {
  font-size: 14px;
}

.settle-total {
  margin-top: 10px;
  text-align: right;
  font-size: 14px;
}

/* 提交确认弹窗底部固定小字（最新决策 2） */
.fine-print {
  margin-top: 8px;
  text-align: center;
  font-size: 12px;
  color: #b0b4c0;
}

.closed-mask {
  position: fixed;
  inset: 0;
  background: rgba(255, 255, 255, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.closed-mask-inner {
  text-align: center;
  color: #6b7280;
}

.closed-mask-inner p {
  margin: 10px 0;
  font-size: 15px;
  font-weight: 600;
}
</style>
