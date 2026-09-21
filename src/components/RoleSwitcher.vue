<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useNoticeStore } from '@/stores/notice'
import { useWindowStore } from '@/stores/window'
import { resolveLandingPath } from '@/router/guards'
import { ROLE_LABELS } from '@/utils/constants'

/**
 * 切换身份（SPEC §8 / A4-A）：
 * 切换后重拉权限与菜单，数据全量重载，回到工作台首页。
 */
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const auth = useAuthStore()
const notice = useNoticeStore()
const windowStore = useWindowStore()
const router = useRouter()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const switching = ref(false)
const selected = ref(auth.currentRole)

async function confirm() {
  if (!selected.value || selected.value === auth.currentRole) {
    visible.value = false
    return
  }
  switching.value = true
  try {
    await auth.switchRole(selected.value)
    // 清理序列：清 store → 跳转首页并重拉菜单与数据
    notice.reset()
    windowStore.stopPolling()
    await router.replace(resolveLandingPath(auth.permissions))
    visible.value = false
    ElMessage.success('已切换身份')
  } catch (error) {
    ElMessage.error((error as Error)?.message || '切换失败，请重试')
  } finally {
    switching.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="切换身份" width="400px" align-center append-to-body>
    <el-alert
      title="切换后将按新身份重新加载菜单与数据范围"
      type="info"
      :closable="false"
      show-icon
      class="mb-16"
    />
    <el-radio-group v-model="selected" class="role-radio-group">
      <el-radio v-for="role in auth.roles" :key="role" :value="role" border>
        {{ ROLE_LABELS[role] || role }}
      </el-radio>
    </el-radio-group>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="switching" @click="confirm">确认切换</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.role-radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.role-radio-group :deep(.el-radio) {
  margin-right: 0;
}
</style>
