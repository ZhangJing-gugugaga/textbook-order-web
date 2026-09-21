<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import ForceChangePasswordModal from '@/components/ForceChangePasswordModal.vue'
import GlobalBlockingNotice from '@/components/GlobalBlockingNotice.vue'

/**
 * 交互竞态（02 §3.3）：强制改密弹窗优先于通知弹窗——未改密不拉取业务数据。
 */
const auth = useAuthStore()
</script>

<template>
  <RouterView />
  <ForceChangePasswordModal v-if="auth.mustChangePassword" />
  <GlobalBlockingNotice v-else />
</template>
