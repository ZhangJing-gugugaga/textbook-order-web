/**
 * 图标按需注册（SPEC §8）：
 * 原实现 `import * as ElementPlusIconsVue` 会把约 2000 个图标整体打进入口 chunk（约 316KB），
 * 此处改为「显式列举 + 按需注册」——只保留模板与路由 meta 真正用到的图标。
 *
 * 新增图标时：在 `APP_ICONS` 中显式引入，并在 `main.ts` 通过 `registerAppIcons()` 注册；
 * 路由 meta.icon 取的是图标组件名（PascalCase），无需前缀。
 */
import {
  ArrowDown,
  Avatar,
  Bell,
  Calendar,
  CircleCloseFilled,
  DataBoard,
  Document,
  Download,
  EditPen,
  Files,
  Finished,
  List,
  Lock,
  Notebook,
  OfficeBuilding,
  Reading,
  ShoppingCart,
  Switch,
  TrendCharts,
  UploadFilled,
  User,
  UserFilled,
} from '@element-plus/icons-vue'
import type { App, Component } from 'vue'

/** 应用实际使用的图标集合（键即模板中的组件名） */
export const APP_ICONS: Record<string, Component> = {
  ArrowDown,
  Avatar,
  Bell,
  Calendar,
  CircleCloseFilled,
  DataBoard,
  Document,
  Download,
  EditPen,
  Files,
  Finished,
  List,
  Lock,
  Notebook,
  OfficeBuilding,
  Reading,
  ShoppingCart,
  Switch,
  TrendCharts,
  UploadFilled,
  User,
  UserFilled,
}

/** 全局注册应用图标（仅注册上表列举的图标，不再全量注册） */
export function registerAppIcons(app: App) {
  for (const [name, component] of Object.entries(APP_ICONS)) {
    app.component(name, component)
  }
}

export default registerAppIcons
