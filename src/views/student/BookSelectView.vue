<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { studentOrderApi } from '@/api/studentOrder'
import { noticeApi } from '@/api/notice'
import { useWindowStore } from '@/stores/window'
import { useNoticeStore } from '@/stores/notice'
import { useConfigStore } from '@/stores/config'
import { ApiError } from '@/api/http'
import { CODE } from '@/utils/constants'
import { formatMoney } from '@/utils/format'
import { COPY } from '@/utils/constants'
import type { StudentBook } from '@/types'

interface PickRow extends StudentBook {
  quantity: number
  checked: boolean
}

/**
 * 选书页（PRD 选书页 / API.md §3.7）：
 * 窗口内按班级带出教材清单（book-list），勾选/取消、数量步进（1-9）；
 * 提交 = 覆盖更新（整单替换）；delisted 教材不可选仅提示；
 * 提交确认弹窗底部固定小字「价格和版本以最终出版单位供应为准」。
 */
const windowStore = useWindowStore()
const noticeStore = useNoticeStore()
const config = useConfigStore()

const rows = ref<PickRow[]>([])
const loading = ref(false)
const submitting = ref(false)
const confirmVisible = ref(false)

/** 学生选购：窗口 open 且学生通道开启 */
const canOrder = computed(() => windowStore.canOrder)

const selectable = computed(() => rows.value.filter((row) => !row.delisted))
const checkedRows = computed(() =>
  selectable.value.filter((row) => row.checked && row.quantity > 0),
)
const checkedCount = computed(() => checkedRows.value.length)
const totalQuantity = computed(() => checkedRows.value.reduce((sum, row) => sum + row.quantity, 0))
const totalAmount = computed(() =>
  checkedRows.value.reduce((sum, row) => sum + (row.price ?? 0) * row.quantity, 0),
)
const multipleRequired = computed(() => checkedCount.value > 1)
/** 后端校验数量 1-9 */
const stepMax = computed(() => config.studentQuantityMax)

async function load() {
  loading.value = true
  try {
    const [books, order] = await Promise.all([
      studentOrderApi.bookList(),
      studentOrderApi.myOrder(),
    ])
    const submitted = new Map((order?.items ?? []).map((item) => [item.textbookId, item.quantity]))
    rows.value = books.map((book) => ({
      ...book,
      // 回显已提交选购单：有记录即勾选并带出数量
      checked: submitted.has(book.textbookId),
      quantity: submitted.get(book.textbookId) ?? 0,
    }))
  } catch (error) {
    rows.value = []
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    loading.value = false
  }
}

function toggle(row: PickRow, value: boolean) {
  row.checked = value
  if (!value) row.quantity = 0
  else if (!row.quantity) row.quantity = 1
}

function setQuantity(row: PickRow, value: number) {
  if (value <= 0) {
    // 步进减到 0：自动取消勾选
    row.checked = false
    row.quantity = 0
    return
  }
  row.quantity = Math.min(value, stepMax.value)
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
    await studentOrderApi.submit(
      checkedRows.value.map((row) => ({ textbookId: row.textbookId, quantity: row.quantity })),
    )
    ElMessage.success('提交成功，可在我的选购记录查看')
    confirmVisible.value = false
    await load()
  } catch (error) {
    // 关窗瞬间提交：后端 409 兜底，本地勾选保留不丢失
    if (error instanceof ApiError && error.code === CODE.WINDOW_CLOSED) {
      confirmVisible.value = false
      void windowStore.fetch()
    } else if (error instanceof ApiError && error.code === CODE.BOOK_DELISTED) {
      ElMessage.warning(error.message)
      confirmVisible.value = false
      await load()
    } else {
      ElMessage.error((error as Error)?.message || COPY.FAILED)
    }
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  void windowStore.fetch()
  void config.load()
  await load()
  await confirmByEntry()
})

/**
 * 进入选书页即确认收到（BE-5g / 决策 FE-W6）。
 *
 * 语义：弹窗是主触达；本项只兜底「弹窗未出现或降级」时学生其实已经进入选书页的场景。
 * 因此**失败静默**（不弹错、不阻塞页面），且必须在清单加载成功后才调用——
 * 清单都没出来就记「已收到」不符合语义。接口本身幂等，重复进入不会重复记录。
 */
async function confirmByEntry() {
  if (!rows.value.length) return
  try {
    const result = await noticeApi.confirmByEntry()
    // 有任务被本次入口确认 → 刷新未确认队列，让被确认的任务从阻塞弹窗队列消失
    if (result?.confirmed) await noticeStore.fetchUnconfirmed()
  } catch {
    // 静默：入口确认是兜底能力，失败不影响选书主流程
  }
}
</script>

<template>
  <div class="app-page">
    <!-- 窗口三态横幅由 DefaultLayout 的全局 WindowBanner 统一渲染，页面内不重复 -->
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
        v-if="!loading && rows.length === 0"
        description="本班暂无征订书目"
        :image-size="110"
      />

      <div v-else class="book-grid">
        <div
          v-for="row in rows"
          :key="row.textbookId"
          class="book-card"
          :class="{ checked: row.checked, delisted: row.delisted }"
        >
          <div class="book-head">
            <el-checkbox
              :model-value="row.checked"
              :disabled="!canOrder || row.delisted"
              @change="(value: string | number | boolean) => toggle(row, Boolean(value))"
            >
              <span class="book-title">{{ row.title }}</span>
            </el-checkbox>
            <span class="book-tags">
              <el-tag v-if="row.required" type="danger" size="small">必修</el-tag>
              <el-tag v-if="row.delisted" type="info" size="small">已下架</el-tag>
            </span>
          </div>
          <div class="book-meta">
            <div>ISBN：{{ row.isbn }}</div>
            <div>
              作者：{{ row.author || '—' }} ｜ 出版社：{{ row.press || '—' }} ｜ 版次：{{
                row.edition || '—'
              }}
            </div>
            <div class="book-price">单价：{{ formatMoney(row.price) }}</div>
            <div v-if="row.delisted" class="book-warn">该教材已下架，不可选，仅作提示</div>
          </div>
          <div class="book-foot">
            <span class="text-muted">数量（1-{{ stepMax }}）</span>
            <el-input-number
              :model-value="row.quantity"
              :min="0"
              :max="stepMax"
              size="small"
              :disabled="!canOrder || row.delisted"
              @change="(value: string | number | undefined) => setQuantity(row, Number(value))"
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
        <p>
          {{
            windowStore.status === 'open' ? '学生选购通道已关闭' : '本期征订已截止'
          }}，可查看历史记录
        </p>
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
      <el-table :data="checkedRows" size="small" border>
        <el-table-column prop="title" label="教材" min-width="160" show-overflow-tooltip />
        <el-table-column prop="isbn" label="ISBN" width="150" />
        <el-table-column label="单价" width="100">
          <template #default="{ row }">{{ formatMoney(row.price) }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="数量" width="80" />
        <el-table-column label="小计" width="110">
          <template #default="{ row }">{{ formatMoney((row.price ?? 0) * row.quantity) }}</template>
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

.book-card.delisted {
  opacity: 0.72;
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

.book-tags {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
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

.book-warn {
  color: #d54941;
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
