<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { resolveLandingPath } from '@/router/guards'
import { COPY } from '@/utils/constants'

/**
 * 强制改密弹窗（PRD 功能 1 / SPEC §8）：
 * 不可关闭/跳过，优先级最高。force=false 时为个人中心自助改密。
 */
const props = withDefaults(defineProps<{ force?: boolean }>(), { force: true })
const emit = defineEmits<{ (e: 'done'): void }>()

const auth = useAuthStore()
const router = useRouter()
const visible = ref(true)
const submitting = ref(false)

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})

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

const formRef = ref()

async function submit() {
  await formRef.value?.validate()
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
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="force ? '首次登录，请修改初始密码' : '修改密码'"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="!force"
    width="440px"
    align-center
    append-to-body
    destroy-on-close
    class="force-change-password"
  >
    <el-alert
      v-if="force"
      title="为保障账号安全，请先修改初始密码后再使用系统功能"
      type="warning"
      :closable="false"
      show-icon
      class="mb-16"
    />
    <el-form ref="formRef" :model="form" :rules="rules" label-width="96px" @submit.prevent>
      <el-form-item label="原密码" prop="oldPassword">
        <el-input
          v-model="form.oldPassword"
          type="password"
          show-password
          placeholder="请输入原密码"
        />
      </el-form-item>
      <el-form-item label="新密码" prop="newPassword">
        <el-input
          v-model="form.newPassword"
          type="password"
          show-password
          placeholder="8 位以上，含字母和数字"
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
    <template #footer>
      <el-button type="primary" :loading="submitting" @click="submit">确认修改</el-button>
      <el-button v-if="!force" @click="visible = false">取消</el-button>
    </template>
  </el-dialog>
</template>
