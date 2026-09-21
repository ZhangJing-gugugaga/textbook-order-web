<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { resolveLandingPath } from '@/router/guards'
import { COPY } from '@/utils/constants'
import { validateForm } from '@/utils/validate'

/**
 * 强制改密弹窗（PRD 功能 1 / API.md §4.1）：
 * 后端要求「先首登校验（手机号后 4 位）→ 再改密」，否则改密返回 401 FIRST_LOGIN_VERIFY_FAILED。
 * 因此 force=true 时走两步；不可关闭/跳过。force=false 时为个人中心自助改密（跳过校验步骤）。
 */
const props = withDefaults(defineProps<{ force?: boolean }>(), { force: true })
const emit = defineEmits<{ (e: 'done'): void }>()

const auth = useAuthStore()
const router = useRouter()
const visible = ref(true)
const submitting = ref(false)

/** 步骤：verify 首登校验 → password 改密 */
const step = ref<'verify' | 'password'>(
  props.force && !auth.firstLoginVerified ? 'verify' : 'password',
)

const verifyForm = reactive({ phoneTail: '' })
const verifyFormRef = ref()

const form = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })
const formRef = ref()

/** 手机号脱敏提示（如 137****0001），不泄露完整号码 */
const phoneHint = computed(() => {
  const phone = auth.user?.phone
  if (!phone || phone.length < 7) return '请联系教材室核对预留手机号'
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
})

const verifyRules = {
  phoneTail: [
    { required: true, message: '请输入手机号后 4 位', trigger: 'blur' },
    { pattern: /^\d{4}$/, message: '请输入 4 位数字', trigger: 'blur' },
  ],
}

const rules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    {
      pattern: /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/,
      message: '新密码需 8 位以上且含字母和数字',
      trigger: 'blur',
    },
  ],
  confirmPassword: [{ required: true, message: '请确认新密码', trigger: 'blur' }],
}

async function submitVerify() {
  if (!(await validateForm(verifyFormRef.value))) return
  submitting.value = true
  try {
    await auth.verifyFirstLogin(verifyForm.phoneTail.trim())
    ElMessage.success('校验通过，请设置新密码')
    step.value = 'password'
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    submitting.value = false
  }
}

async function submit() {
  if (!(await validateForm(formRef.value))) return
  if (form.newPassword !== form.confirmPassword) {
    ElMessage.error('两次输入不一致')
    return
  }
  submitting.value = true
  try {
    await auth.changePassword(form.oldPassword, form.newPassword)
    ElMessage.success('密码修改成功')
    visible.value = false
    emit('done')
    if (props.force) {
      await router.replace(resolveLandingPath(auth.permissions))
    }
  } catch (error) {
    // 校验态失效（如换设备/过期）→ 退回校验步骤
    if ((error as { code?: string })?.code === 'FIRST_LOGIN_VERIFY_FAILED') {
      step.value = 'verify'
    }
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="force ? '首次登录，请完成校验并修改初始密码' : '修改密码'"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="!force"
    width="460px"
    align-center
    append-to-body
    destroy-on-close
    class="force-change-password"
  >
    <el-alert
      v-if="force"
      title="为保障账号安全，请先完成首登校验，再修改初始密码后使用系统功能"
      type="warning"
      :closable="false"
      show-icon
      class="mb-16"
    />

    <!-- 步骤一：首登校验 -->
    <template v-if="step === 'verify'">
      <el-form
        ref="verifyFormRef"
        :model="verifyForm"
        :rules="verifyRules"
        label-width="120px"
        @submit.prevent
      >
        <el-form-item label="手机号后 4 位" prop="phoneTail">
          <el-input
            v-model="verifyForm.phoneTail"
            maxlength="4"
            placeholder="请输入预留手机号后 4 位"
            @keyup.enter="submitVerify"
          />
        </el-form-item>
      </el-form>
      <div class="text-muted">预留手机号：{{ phoneHint }}</div>
    </template>

    <!-- 步骤二：改密 -->
    <template v-else>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px" @submit.prevent>
        <el-form-item label="原密码" prop="oldPassword">
          <el-input
            v-model="form.oldPassword"
            type="password"
            show-password
            placeholder="初始密码为学号/工号后 6 位"
          />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="form.newPassword"
            type="password"
            show-password
            placeholder="8-64 位，含字母和数字"
          />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            show-password
            placeholder="请再次输入新密码"
          />
        </el-form-item>
      </el-form>
    </template>

    <template #footer>
      <template v-if="step === 'verify'">
        <el-button type="primary" :loading="submitting" @click="submitVerify">下一步</el-button>
      </template>
      <template v-else>
        <el-button type="primary" :loading="submitting" @click="submit">确认修改</el-button>
        <el-button v-if="!force" @click="visible = false">取消</el-button>
      </template>
    </template>
  </el-dialog>
</template>
