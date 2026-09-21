<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

/**
 * 按钮级权限（SPEC §8）：无权限码移除 DOM（非置灰）。
 */
const props = defineProps<{
  code: string | string[]
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'default'
  size?: 'large' | 'default' | 'small'
  icon?: unknown
  loading?: boolean
  disabled?: boolean
  text?: boolean
}>()

const auth = useAuthStore()
const allowed = computed(() => {
  const codes = Array.isArray(props.code) ? props.code : [props.code]
  return codes.some((code) => auth.has(code))
})
</script>

<template>
  <el-button
    v-if="allowed"
    :type="type || 'primary'"
    :size="size || 'default'"
    :icon="icon"
    :loading="loading"
    :disabled="disabled"
    :text="text"
  >
    <slot />
  </el-button>
</template>
