import type { AppRouteMeta } from './routes'

/**
 * 页面可访问判定（唯一实现，守卫 / 侧边栏菜单 / 落地页解析三处共用）。
 *
 * 两条约束**同时**成立才放行：
 * 1. `meta.permission` 声明的权限码在当前身份下持有；
 * 2. `meta.roles` 声明的归属角色在当前身份下持有（未声明则不限角色）。
 *
 * 第 2 条是 2026-09-22 线上缺陷的修复：超管在后端持有「除供货商外全部」权限，
 * 其中含教师/学生/秘书的角色专属权限，只按权限码过滤会让超管侧边栏渲染出
 * 「学院秘书 / 任课老师 / 学生」三组别角色的自助页菜单。
 *
 * 注意：这只是**显示层**过滤，真正的数据边界由后端执行（README「关键实现约定」）。
 */
export function canAccessRoute(
  meta: AppRouteMeta | undefined,
  permissions: readonly string[],
  roles: readonly string[],
): boolean {
  if (!meta) return true
  if (meta.permission && !permissions.includes(meta.permission)) return false
  if (meta.roles?.length && !meta.roles.some((role) => roles.includes(role))) return false
  return true
}

export default canAccessRoute
