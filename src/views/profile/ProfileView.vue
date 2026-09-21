<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { ROLE_LABELS } from '@/utils/constants'

/**
 * 个人中心（PRD 公共功能）：
 * 改密码（全员唯一自助功能）、切换身份（多角色用户）。
 */
const auth = useAuthStore()
const changePasswordVisible = ref(false)
const roleSwitcherVisible = ref(false)
</script>

<template>
  <div class="app-page">
    <h2 class="mb-16">个人中心</h2>

    <el-descriptions :column="2" border>
      <el-descriptions-item label="姓名">{{ auth.user?.name }}</el-descriptions-item>
      <el-descriptions-item label="学号 / 工号">{{ auth.user?.userNo }}</el-descriptions-item>
      <el-descriptions-item label="当前身份">
        {{ ROLE_LABELS[auth.currentRole] || auth.currentRole }}
      </el-descriptions-item>
      <el-descriptions-item label="数据范围">
        <span v-if="auth.user?.collegeIds?.length">{{ auth.user.collegeIds.length }} 个学院</span>
        <span v-else>全校</span>
      </el-descriptions-item>
      <el-descriptions-item label="权限码数量">{{ auth.permissions.length }}</el-descriptions-item>
      <el-descriptions-item label="密码状态">
        <el-tag :type="auth.mustChangePassword ? 'warning' : 'success'" size="small">
          {{ auth.mustChangePassword ? '待修改初始密码' : '已设置' }}
        </el-tag>
      </el-descriptions-item>
    </el-descriptions>

    <div class="mt-16 app-table-actions">
      <el-button type="primary" @click="changePasswordVisible = true">修改密码</el-button>
      <el-button v-if="auth.roles.length > 1" @click="roleSwitcherVisible = true">
        切换身份
      </el-button>
    </div>

    <ForceChangePasswordModal
      v-if="changePasswordVisible"
      :force="false"
      @done="changePasswordVisible = false"
    />
    <RoleSwitcher v-model="roleSwitcherVisible" />
  </div>
</template>
