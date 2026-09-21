<script setup lang="ts">
import { computed } from 'vue'
import type { FieldCheckItem } from '@/types'

/**
 * 字段审查回显（SPEC §8 / O14）：
 * 按 field / rule / message 逐字段标红 + 修复提示。
 */
const props = defineProps<{
  items: FieldCheckItem[] | null
  title?: string
}>()

const failed = computed(() => (props.items ?? []).filter((item) => !item.passed))
const passed = computed(() => (props.items ?? []).filter((item) => item.passed))
const summary = computed(() => {
  if (!props.items) return ''
  if (failed.value.length === 0) return `字段审查通过（${passed.value.length} 项）`
  return `存在 ${failed.value.length} 项问题，请按提示修复后重新提交`
})
</script>

<template>
  <div v-if="items && items.length" class="field-check-result">
    <el-alert
      :title="summary"
      :type="failed.length ? 'error' : 'success'"
      :closable="false"
      show-icon
    >
      <template v-if="title" #title>
        <span>{{ title }}：{{ summary }}</span>
      </template>
    </el-alert>
    <ul class="field-check-list">
      <li
        v-for="item in items"
        :key="`${item.field}-${item.rule}`"
        :class="item.passed ? 'ok' : 'bad'"
      >
        <el-icon>
          <CircleCheckFilled v-if="item.passed" />
          <CircleCloseFilled v-else />
        </el-icon>
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
