<script setup lang="ts">
import { useRouter } from 'vue-router'

/** 404 兜底页 */
const router = useRouter()
</script>

<template>
  <div class="error-page">
    <div class="error-code">404</div>
    <p class="error-text">页面不存在</p>
    <p class="error-sub">你访问的页面已被移动或删除。</p>
    <el-button type="primary" @click="router.replace('/')">返回首页</el-button>
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
