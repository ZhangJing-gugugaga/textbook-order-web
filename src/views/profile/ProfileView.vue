<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { ROLE_LABELS, ROLES } from '@/utils/constants'

/**
 * 个人中心（PRD 公共功能 / API.md §3.1）：
 * 改密码（全员唯一自助功能，改密后旧 refresh 全部撤销并重发新令牌）、
 * 切换身份（多角色用户，切换后重拉权限码；数据范围不变）。
 *
 * 首登待完成时**不提供切换身份**：本页正是首登强制跳转的落地页，
 * 而后端首登放行清单是显式枚举，`/api/auth/switch-role` 不在其中（点了必然 403）。
 */
const auth = useAuthStore()
const changePasswordVisible = ref(false)
const roleSwitcherVisible = ref(false)

/** 首登未完成时禁用切换身份（store 内亦有前置拦截，双保险） */
const canSwitchRole = computed(() => auth.roles.length > 1 && !auth.mustChangePassword)
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
        <span v-if="auth.user?.collegeName">{{ auth.user.collegeName }}</span>
        <span v-else-if="auth.currentRole === ROLES.SECRETARY">本院</span>
        <span v-else>全校</span>
      </el-descriptions-item>
      <el-descriptions-item label="班级">
        <span>{{ auth.user?.className || '—' }}</span>
      </el-descriptions-item>
      <el-descriptions-item label="手机号">
        <span>{{ auth.user?.phone || '—' }}</span>
      </el-descriptions-item>
      <el-descriptions-item label="当前学期">
        <span>{{ auth.user?.activeSemester?.name || '未设置' }}</span>
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
      <el-button v-if="canSwitchRole" @click="roleSwitcherVisible = true">切换身份</el-button>
    </div>

    <ForceChangePasswordModal
      v-if="changePasswordVisible"
      :force="false"
      @done="changePasswordVisible = false"
    />
    <RoleSwitcher v-model="roleSwitcherVisible" />
  </div>
</template>
