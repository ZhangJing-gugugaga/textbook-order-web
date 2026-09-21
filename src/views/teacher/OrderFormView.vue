<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { orderFormApi } from '@/api/orderForm'
import { textbookApi } from '@/api/textbook'
import FieldCheckResult from '@/components/FieldCheckResult.vue'
import { useAuthStore } from '@/stores/auth'
import { useWindowStore } from '@/stores/window'
import { useConfigStore } from '@/stores/config'
import { COPY } from '@/utils/constants'
import { formatMoney, formatDateTime, windowStatusText } from '@/utils/format'
import { ApiError } from '@/api/http'
import type { FieldCheckItem, OrderForm, TeachingAssignment, Textbook } from '@/types'

interface DraftItem {
  key: string
  textbookId: number
  title: string
  isbn: string
  price: number
  quantity: number
}

/**
 * 填报教材页（PRD 填报教材页 / 功能 3）：
 * 窗口内逐课程选教材、填数量；提交先过系统字段审查（逐字段提示可修复重提）
 * 再转超管内容审核；被驳回表单解锁补正重提；关窗锁定。
 */
const route = useRoute()
const auth = useAuthStore()
const windowStore = useWindowStore()
const config = useConfigStore()

const assignments = ref<TeachingAssignment[]>([])
const myForms = ref<OrderForm[]>([])
const loading = ref(false)
const submitting = ref(false)

const activeKey = ref('') // `${courseId}:${classId}`
const drafts = ref<Record<string, DraftItem[]>>({})
const remarks = ref<Record<string, string>>({})
const fieldChecks = ref<Record<string, FieldCheckItem[]>>({})
const searchKeyword = ref('')
const searchResults = ref<Textbook[]>([])
const searching = ref(false)

const canFill = computed(() => windowStore.status === 'open')

const pairs = computed(() =>
  assignments.value.map((item) => ({
    key: `${item.courseId}:${item.classId}`,
    courseId: item.courseId,
    courseName: item.courseName,
    classId: item.classId,
    className: item.className,
  })),
)

const activePair = computed(() => pairs.value.find((item) => item.key === activeKey.value) ?? null)
const activeItems = computed(() => drafts.value[activeKey.value] ?? [])
const activeForm = computed(() => myForms.value.find((f) => isFormOf(f, activePair.value)) ?? null)

function isFormOf(form: OrderForm, pair: { courseId: number; classId: number } | null) {
  if (!pair) return false
  return form.items.some((item) => item.courseId === pair.courseId && item.classId === pair.classId)
}

function quantityMax() {
  const klass = activePair.value
  const fromClass = klass ? 200 : 100
  return Math.min(config.quantityMax, fromClass)
}

async function load() {
  loading.value = true
  try {
    const [list, forms] = await Promise.all([
      orderFormApi.myCourses(),
      orderFormApi.myPage({ page: 1, size: 100 }),
    ])
    assignments.value = list
    myForms.value = forms.list
    // 初始化草稿：已有表单载入明细，否则空草稿
    for (const pair of pairs.value) {
      if (drafts.value[pair.key]) continue
      const form = myForms.value.find((f) => isFormOf(f, pair))
      drafts.value[pair.key] = form
        ? form.items.map((item) => ({
            key: `${item.textbookId}`,
            textbookId: item.textbookId,
            title: item.textbookTitle,
            isbn: item.isbn,
            price: item.price,
            quantity: item.quantity,
          }))
        : []
    }
    const queryCourse = Number(route.query.courseId)
    const queryClass = Number(route.query.classId)
    const matched = pairs.value.find(
      (item) => item.courseId === queryCourse && item.classId === queryClass,
    )
    if (matched) activeKey.value = matched.key
    else if (!activeKey.value && pairs.value.length) activeKey.value = pairs.value[0].key
  } catch {
    assignments.value = []
  } finally {
    loading.value = false
  }
}

async function searchTextbooks() {
  const keyword = searchKeyword.value.trim()
  if (!keyword) {
    searchResults.value = []
    return
  }
  searching.value = true
  try {
    searchResults.value = await textbookApi.search(keyword)
  } catch {
    searchResults.value = []
  } finally {
    searching.value = false
  }
}

function addTextbook(book: Textbook) {
  if (!activeKey.value) return
  if (book.status !== 'active') {
    ElMessage.warning('该教材已停用，不可选用')
    return
  }
  const list = drafts.value[activeKey.value] ?? []
  if (list.some((item) => item.textbookId === book.id)) {
    ElMessage.warning('该教材已在明细中')
    return
  }
  list.push({
    key: `${book.id}`,
    textbookId: book.id,
    title: book.title,
    isbn: book.isbn,
    price: book.price,
    quantity: 1,
  })
  drafts.value[activeKey.value] = [...list]
  searchKeyword.value = ''
  searchResults.value = []
}

function removeItem(index: number) {
  const list = [...(drafts.value[activeKey.value] ?? [])]
  list.splice(index, 1)
  drafts.value[activeKey.value] = list
}

function setQuantity(index: number, value: number) {
  const list = [...(drafts.value[activeKey.value] ?? [])]
  if (!list[index]) return
  list[index].quantity = value
  drafts.value[activeKey.value] = list
}

function totalQuantity() {
  return activeItems.value.reduce((sum, item) => sum + (item.quantity || 0), 0)
}

function totalAmount() {
  return activeItems.value.reduce((sum, item) => sum + item.price * (item.quantity || 0), 0)
}

async function submit() {
  const pair = activePair.value
  if (!pair) return
  const items = activeItems.value
  if (items.length === 0) {
    ElMessage.error('请先从教材库选择教材')
    return
  }
  if (items.some((item) => !item.quantity || item.quantity <= 0)) {
    ElMessage.error('数量需大于 0')
    return
  }
  submitting.value = true
  try {
    const payload = {
      teacherId: auth.user?.id ?? 0,
      items: items.map((item) => ({
        courseId: pair.courseId,
        classId: pair.classId,
        textbookId: item.textbookId,
        quantity: item.quantity,
      })),
      remark: remarks.value[activeKey.value] || undefined,
    }
    const isResubmit = activeForm.value?.status === 'rejected'
    const result =
      isResubmit && activeForm.value
        ? await orderFormApi.resubmit(activeForm.value.id, payload)
        : await orderFormApi.submit(payload)

    if (result.fieldCheck && result.fieldCheck.some((item) => !item.passed)) {
      fieldChecks.value[activeKey.value] = result.fieldCheck
      ElMessage.error(
        `存在 ${result.fieldCheck.filter((i) => !i.passed).length} 项问题，请按提示修复后重新提交`,
      )
    } else {
      delete fieldChecks.value[activeKey.value]
      ElMessage.success('已提交，等待复核')
      await load()
    }
  } catch (error) {
    // 422 字段审查失败：逐字段回显
    if (
      error instanceof ApiError &&
      error.code === 42200 &&
      Array.isArray((error.data as { errors?: unknown })?.errors)
    ) {
      fieldChecks.value[activeKey.value] = (error.data as { errors: FieldCheckItem[] }).errors
      ElMessage.error('存在未通过的字段审查，请按提示修复后重新提交')
    } else {
      ElMessage.error((error as Error)?.message || COPY.FAILED)
    }
  } finally {
    submitting.value = false
  }
}

const STATUS_LABELS: Record<
  string,
  { label: string; type: 'success' | 'danger' | 'warning' | 'info' }
> = {
  draft: { label: '草稿', type: 'info' },
  pending_review: { label: '已提交，待复核', type: 'warning' },
  reviewed: { label: '已复核', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
}

onMounted(() => {
  void windowStore.fetch()
  void load()
})
</script>

<template>
  <div class="app-page">
    <div class="flex-between mb-16">
      <span class="text-muted">
        {{ windowStatusText(windowStore.status, windowStore.remainMs, windowStore.startRemainMs) }}
      </span>
      <span class="text-muted">数量上限 {{ quantityMax() }}（来自 system_config 与班级人数）</span>
    </div>

    <div v-loading="loading" class="order-form-layout">
      <!-- 课程 × 班级 列表 -->
      <div class="order-form-side">
        <div class="side-title">我的课程 × 班级</div>
        <el-menu :default-active="activeKey" class="side-menu">
          <el-menu-item
            v-for="pair in pairs"
            :key="pair.key"
            :index="pair.key"
            @click="activeKey = pair.key"
          >
            <div class="side-item">
              <div class="side-course">{{ pair.courseName }}</div>
              <div class="side-class">
                {{ pair.className }}
                <el-tag
                  v-if="myForms.find((f) => isFormOf(f, pair))"
                  size="small"
                  :type="STATUS_LABELS[myForms.find((f) => isFormOf(f, pair))!.status].type"
                >
                  {{ STATUS_LABELS[myForms.find((f) => isFormOf(f, pair))!.status].label }}
                </el-tag>
              </div>
            </div>
          </el-menu-item>
        </el-menu>
        <el-empty
          v-if="pairs.length === 0"
          description="暂无任课关系，请联系教材室导入"
          :image-size="70"
        />
      </div>

      <!-- 明细编辑 -->
      <div class="order-form-main">
        <template v-if="activePair">
          <h3 class="mb-16">{{ activePair.courseName }} · {{ activePair.className }}</h3>

          <!-- 驳回补正横幅 -->
          <el-alert
            v-if="activeForm && activeForm.status === 'rejected'"
            class="mb-16"
            :title="`表单被驳回，理由：${activeForm.reviewComment || '未填写'}，已解锁可补正重提`"
            type="error"
            :closable="false"
            show-icon
          />

          <!-- 审查状态条 -->
          <el-alert
            v-if="activeForm && activeForm.status === 'pending_review'"
            class="mb-16"
            title="已提交，等待复核（超管内容审核中，暂不可修改）"
            type="warning"
            :closable="false"
            show-icon
          />
          <el-alert
            v-if="activeForm && activeForm.status === 'reviewed'"
            class="mb-16"
            :title="`已复核通过${activeForm.reviewedBy ? `（${activeForm.reviewedBy}）` : ''}`"
            type="success"
            :closable="false"
            show-icon
          />

          <!-- 字段审查回显 -->
          <FieldCheckResult
            v-if="fieldChecks[activeKey]"
            class="mb-16"
            :items="fieldChecks[activeKey]"
            title="系统字段审查"
          />

          <!-- 教材选择器 -->
          <div v-if="canFill && (!activeForm || activeForm.status === 'rejected')" class="mb-16">
            <el-input
              v-model="searchKeyword"
              placeholder="搜索教材库（书名 / ISBN）"
              clearable
              style="max-width: 360px"
              :loading="searching"
              @input="searchTextbooks"
              @clear="searchResults = []"
            />
            <el-table
              v-if="searchResults.length"
              :data="searchResults"
              size="small"
              border
              class="mt-8"
              max-height="220"
            >
              <el-table-column prop="isbn" label="ISBN" width="150" />
              <el-table-column prop="title" label="书名" min-width="160" show-overflow-tooltip />
              <el-table-column prop="author" label="作者" width="110" />
              <el-table-column prop="publisher" label="出版社" width="140" />
              <el-table-column prop="edition" label="版次" width="90" />
              <el-table-column label="单价" width="100">
                <template #default="{ row }">{{ formatMoney(row.price) }}</template>
              </el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
                    {{ row.status === 'active' ? '在库' : '停用' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="90">
                <template #default="{ row }">
                  <el-button
                    size="small"
                    type="primary"
                    text
                    :disabled="row.status !== 'active'"
                    @click="addTextbook(row)"
                  >
                    选用
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <!-- 明细编辑 -->
          <el-table :data="activeItems" border stripe>
            <el-table-column prop="title" label="教材" min-width="180" show-overflow-tooltip />
            <el-table-column prop="isbn" label="ISBN" width="150" />
            <el-table-column label="单价" width="110">
              <template #default="{ row }">{{ formatMoney(row.price) }}</template>
            </el-table-column>
            <el-table-column label="数量" width="200">
              <template #default="{ row, $index }">
                <el-input-number
                  :model-value="row.quantity"
                  :min="0"
                  :max="quantityMax()"
                  size="small"
                  :disabled="!canFill || (activeForm && activeForm.status !== 'rejected')"
                  @change="
                    (value: string | number | undefined) => setQuantity($index, Number(value))
                  "
                />
              </template>
            </el-table-column>
            <el-table-column label="小计" width="110">
              <template #default="{ row }">
                {{ formatMoney(row.price * (row.quantity || 0)) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90">
              <template #default="{ $index }">
                <el-button
                  size="small"
                  type="danger"
                  text
                  :disabled="!canFill || (activeForm && activeForm.status !== 'rejected')"
                  @click="removeItem($index)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="flex-between mt-16">
            <span class="text-muted">
              合计 {{ totalQuantity() }} 本 / {{ formatMoney(totalAmount()) }}
            </span>
            <span v-if="activeForm" class="text-muted">
              最近更新：{{ formatDateTime(activeForm.updatedAt) }}
            </span>
          </div>

          <div v-if="canFill && (!activeForm || activeForm.status === 'rejected')" class="mt-16">
            <el-input
              :model-value="remarks[activeKey] || ''"
              type="textarea"
              :rows="2"
              maxlength="200"
              show-word-limit
              placeholder="补正说明（选填，200 字以内）"
              @update:model-value="(value: string | number) => (remarks[activeKey] = String(value))"
            />
            <el-button class="mt-8" type="primary" :loading="submitting" @click="submit">
              {{ activeForm?.status === 'rejected' ? '补正重提' : '提交' }}
            </el-button>
          </div>

          <!-- 关窗遮罩 -->
          <div v-if="!canFill" class="closed-mask">
            <div class="closed-mask-inner">
              <el-icon :size="40"><Lock /></el-icon>
              <p>本期征订已截止，可查看历史记录</p>
            </div>
          </div>
        </template>
        <el-empty v-else description="请选择左侧课程 × 班级" :image-size="90" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.order-form-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.order-form-side {
  width: 260px;
  flex-shrink: 0;
  border: 1px solid #e9ebf2;
  border-radius: 8px;
  padding: 8px;
  max-height: 640px;
  overflow-y: auto;
}

.side-title {
  font-size: 13px;
  color: #8a90a2;
  padding: 4px 8px 8px;
}

.side-menu {
  border-right: none;
}

.side-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.side-course {
  font-size: 13px;
  font-weight: 600;
}

.side-class {
  font-size: 12px;
  color: #8a90a2;
  display: flex;
  align-items: center;
  gap: 6px;
}

.order-form-main {
  flex: 1;
  min-width: 0;
  position: relative;
}

.closed-mask {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
}

.closed-mask-inner {
  text-align: center;
  color: #6b7280;
}

.closed-mask-inner p {
  margin: 8px 0 0;
  font-size: 14px;
}
</style>
