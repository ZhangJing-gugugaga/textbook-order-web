<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useNoticeStore } from '@/stores/notice'
import { useWindowStore } from '@/stores/window'
import { routes, type AppRouteMeta } from '@/router/routes'
import { canAccessRoute } from '@/router/access'
import { ROLE_LABELS } from '@/utils/constants'
import WindowBanner from '@/components/WindowBanner.vue'
import RoleSwitcher from '@/components/RoleSwitcher.vue'

interface MenuItem {
  path: string
  title: string
  icon?: string
}

const auth = useAuthStore()
const notice = useNoticeStore()
const windowStore = useWindowStore()
const route = useRoute()
const router = useRouter()

const collapsed = ref(false)
const roleSwitcherVisible = ref(false)

/**
 * 侧边栏菜单 = 全量路由表按「权限码 + 归属角色」过滤生成（SPEC §4）。
 *
 * 归属角色过滤不可省：超管持有教师/学生/秘书的角色专属权限，只按权限码过滤会让
 * 它的侧边栏出现别角色的分组（2026-09-22 线上缺陷）。判定逻辑与路由守卫共用
 * `canAccessRoute`，避免菜单能点、守卫却拦的两套口径。
 */
const menuGroups = computed(() => {
  const groups = new Map<string, MenuItem[]>()
  for (const top of routes) {
    for (const child of (top.children ?? []) as { path: string; meta?: AppRouteMeta }[]) {
      const meta = child.meta
      if (!meta || meta.hidden) continue
      if (!canAccessRoute(meta, auth.permissions, auth.roles)) continue
      const group = meta.group ?? '其他'
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group)!.push({ path: `/${child.path}`, title: meta.title, icon: meta.icon })
    }
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }))
})

const activeMenu = computed(() => route.path)
const hasMultipleRoles = computed(() => auth.roles.length > 1)
/**
 * 首登待完成（待改密/未校验）时不给切换身份入口：
 * 后端首登放行清单是显式枚举，`/api/auth/switch-role` 不在其中，点了必然 403。
 * 身份标签仍展示（用户需要知道当前身份），只隐藏切换动作。
 */
const canSwitchRole = computed(() => hasMultipleRoles.value && !auth.mustChangePassword)

async function handleLogout() {
  try {
    await ElMessageBox.confirm('确认退出登录？', '退出登录', { type: 'warning' })
  } catch {
    return
  }
  await auth.logout()
  notice.reset()
  windowStore.stopPolling()
  await router.replace('/login')
}

onMounted(() => {
  void windowStore.fetch()
  windowStore.startPolling()
})

onUnmounted(() => windowStore.stopPolling())
</script>

<template>
  <div class="app-wrapper">
    <aside class="app-sidebar">
      <div class="app-brand">
        <el-icon :size="20"><Reading /></el-icon>
        <span>教材征订系统</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        :collapse="collapsed"
        :collapse-transition="false"
        router
        class="app-menu"
      >
        <template v-for="group in menuGroups" :key="group.name">
          <el-menu-item-group v-if="group.items.length > 1" :title="group.name">
            <el-menu-item v-for="item in group.items" :key="item.path" :index="item.path">
              <el-icon v-if="item.icon"><component :is="item.icon" /></el-icon>
              <template #title>{{ item.title }}</template>
            </el-menu-item>
          </el-menu-item-group>
          <el-menu-item v-for="item in group.items" v-else :key="item.path" :index="item.path">
            <el-icon v-if="item.icon"><component :is="item.icon" /></el-icon>
            <template #title>{{ item.title }}</template>
          </el-menu-item>
        </template>
      </el-menu>
    </aside>

    <div class="app-main">
      <header class="app-header">
        <div class="flex-between" style="width: 100%">
          <WindowBanner />
          <div class="flex-between" style="gap: 8px">
            <el-tag v-if="hasMultipleRoles" type="info" size="small">
              {{ ROLE_LABELS[auth.currentRole] || auth.currentRole }}
            </el-tag>
            <el-button v-if="canSwitchRole" size="small" text @click="roleSwitcherVisible = true">
              切换身份
            </el-button>
            <el-dropdown trigger="click">
              <span class="app-user">
                <el-icon><UserFilled /></el-icon>
                {{ auth.user?.name }}（{{ auth.user?.userNo }}）
                <el-icon><ArrowDown /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="router.push('/profile')">个人中心</el-dropdown-item>
                  <el-dropdown-item divided @click="handleLogout">退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </header>

      <main class="app-content">
        <!-- 切换身份后菜单与数据全量重载，故不做 KeepAlive 缓存 -->
        <RouterView v-slot="{ Component, route: current }">
          <component :is="Component" :key="current.fullPath" />
        </RouterView>
      </main>
    </div>

    <RoleSwitcher v-model="roleSwitcherVisible" />
  </div>
</template>

<style scoped>
.app-menu {
  border-right: none;
  flex: 1;
  padding: 8px;
}

.app-user {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #333a4d;
  outline: none;
}
</style>
