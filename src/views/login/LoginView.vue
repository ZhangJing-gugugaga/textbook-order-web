<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useNoticeStore } from '@/stores/notice'
import { resolveLandingPath } from '@/router/guards'
import { COPY, USER_NO_PATTERN } from '@/utils/constants'
import { validateForm } from '@/utils/validate'

/**
 * 登录页（PRD 功能 1）：
 * 学号/工号 + 密码；首登强制改密由全局弹窗接管；
 * 登录后拉取未确认通知（阻塞弹窗）再进入工作台。
 */
const auth = useAuthStore()
const notice = useNoticeStore()
const router = useRouter()
const route = useRoute()

const loading = ref(false)
const form = reactive({ userNo: '', password: '' })
const formRef = ref()

const rules = {
  userNo: [
    { required: true, message: '请输入账号', trigger: 'blur' },
    { pattern: USER_NO_PATTERN, message: '请输入正确的账号', trigger: 'blur' },
  ],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function submit() {
  if (!(await validateForm(formRef.value))) return
  loading.value = true
  try {
    await auth.login(form.userNo.trim(), form.password)
    // 打开 Web 即拉取未确认通知（失败 fail-open）
    await notice.fetchUnconfirmed()
    if (auth.mustChangePassword) {
      await router.replace('/profile?forceChange=1')
      return
    }
    const redirect =
      (route.query.redirect as string) || resolveLandingPath(auth.permissions, auth.roles)
    await router.replace(redirect)
  } catch (error) {
    const message = (error as Error)?.message || COPY.FAILED
    ElMessage.error(message)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <el-icon :size="28"><Reading /></el-icon>
        <h1>教材征订系统</h1>
      </div>
      <p class="login-sub">高校教材征订 · 填报 / 审查 / 选购 / 导出一体化平台</p>

      <el-form ref="formRef" :model="form" :rules="rules" size="large" @submit.prevent="submit">
        <el-form-item prop="userNo">
          <el-input v-model="form.userNo" placeholder="学号 / 工号" maxlength="32" clearable>
            <template #prefix>
              <el-icon><User /></el-icon>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            maxlength="64"
            show-password
            @keyup.enter="submit"
          >
            <template #prefix>
              <el-icon><Lock /></el-icon>
            </template>
          </el-input>
        </el-form-item>
        <el-button
          class="login-submit"
          type="primary"
          size="large"
          :loading="loading"
          @click="submit"
        >
          登录
        </el-button>
      </el-form>

      <div class="login-tip">
        <p>
          账号由教材室统一分发，不可自主注册；初始密码默认为学号/工号后 6 位，具体以教材室通知为准。
        </p>
        <p class="text-muted">连续输错 5 次账号将锁定 15 分钟。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #eef0fb 0%, #e6ecf9 50%, #f6f2fb 100%);
}

.login-card {
  width: 420px;
  background: #ffffff;
  border-radius: 12px;
  padding: 36px 32px 28px;
  box-shadow: 0 16px 48px rgba(31, 36, 68, 0.12);
}

.login-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--el-color-primary);
}

.login-brand h1 {
  font-size: 20px;
  margin: 0;
}

.login-sub {
  margin: 6px 0 24px;
  font-size: 13px;
  color: #8a90a2;
}

.login-submit {
  width: 100%;
}

.login-tip {
  margin-top: 20px;
  font-size: 12px;
  color: #8a90a2;
  line-height: 1.7;
}
</style>
