<script setup lang="ts">
import { computed } from 'vue'
import type { FieldCheckIssue } from '@/types'

/**
 * 字段审查回显（SPEC §8 / O14）：
 * 后端 FIELD_CHECK_FAILED 的 data 为逐项 [{field, rule, message}]（契约冻结回显格式），
 * 仅含未通过项；此处按 field / rule / message 逐字段标红 + 修复提示。
 */
const props = defineProps<{
  items: FieldCheckIssue[] | null
  title?: string
}>()

const issues = computed(() => props.items ?? [])
const summary = computed(() => {
  if (!props.items || props.items.length === 0) return ''
  return `存在 ${props.items.length} 项问题，请按提示修复后重新提交`
})
</script>

<template>
  <div v-if="issues.length" class="field-check-result">
    <el-alert
      :title="title ? `${title}：${summary}` : summary"
      type="error"
      :closable="false"
      show-icon
    />
    <ul class="field-check-list">
      <li v-for="item in issues" :key="`${item.field}-${item.rule}`" class="bad">
        <el-icon><CircleCloseFilled /></el-icon>
        <span class="field-name">{{ item.field }}</span>
        <span class="field-rule">[{{ item.rule }}]</span>
        <span class="field-message">{{ item.message }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.field-check-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-check-list li {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 13px;
  line-height: 1.6;
}

.field-check-list li.bad {
  color: #d54941;
}

.field-check-list li.ok {
  color: #2ba471;
}

.field-name {
  font-weight: 600;
}

.field-rule {
  color: #8a90a2;
}
</style>
