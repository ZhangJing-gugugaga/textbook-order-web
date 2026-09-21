<script setup lang="ts">
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { useAuthStore } from '@/stores/auth'
import ForceChangePasswordModal from '@/components/ForceChangePasswordModal.vue'
import GlobalBlockingNotice from '@/components/GlobalBlockingNotice.vue'

/**
 * 交互竞态（02 §3.3）：强制改密弹窗优先于通知弹窗——未改密不拉取业务数据。
 * 未登录（登录页）不挂载通知弹窗：避免公共页向 /notice/unconfirmed 发未鉴权请求。
 *
 * 中文语料由 `el-config-provider` 提供（Element Plus 改为按需引入后，
 * 不再通过 `app.use(ElementPlus, { locale })` 注入全局 locale）。
 */
const auth = useAuthStore()
</script>

<template>
  <el-config-provider :locale="zhCn">
    <RouterView />
    <ForceChangePasswordModal v-if="auth.isLoggedIn && auth.mustChangePassword" />
    <GlobalBlockingNotice v-else-if="auth.isLoggedIn" />
  </el-config-provider>
</template>
