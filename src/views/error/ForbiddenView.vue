<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { computed } from 'vue'

/**
 * 403 兜底页（PRD 功能 7：无权限访问由路由守卫重定向）
 */
const router = useRouter()
const route = useRoute()
const target = computed(() => (route.query.from as string) || '/')
</script>

<template>
  <div class="error-page">
    <div class="error-code">403</div>
    <p class="error-text">无权访问该页面</p>
    <p class="error-sub">你的角色不具备该页面权限，请联系教材室开通。</p>
    <el-button type="primary" @click="router.replace(target)">返回工作台</el-button>
  </div>
</template>

<style scoped>
.error-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.error-code {
  font-size: 72px;
  font-weight: 700;
  color: var(--el-color-primary);
}

.error-text {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.error-sub {
  color: #8a90a2;
  margin: 0 0 16px;
}
</style>
