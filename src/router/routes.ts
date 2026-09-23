import type { RouteRecordRaw } from 'vue-router'
import type { RoleCode } from '@/types'

/** 路由元信息：权限码取后端 sys_permission（M1 冻结 37 条） */
export interface AppRouteMeta {
  /** 页面标题：侧边栏文案 + document.title（守卫 afterEach 写入） */
  title: string
  icon?: string
  permission?: string
  /**
   * 页面归属角色（自助类页面的归属约束）。
   *
   * 为什么需要它：超管在后端拿到「除供货商外全部」权限，其中含教师填报、学生选购、
   * 秘书签字版导出等**角色专属**权限（权限名本身即写明归属，如「教师填报提交」）。
   * 只按权限码过滤菜单，超管侧边栏就会冒出「学院秘书 / 任课老师 / 学生」三个别角色的
   * 分组，且点进去都是对超管无意义的自助页（我的课程为空、选书无班级可归）。
   *
   * 规则：声明了 `roles` 的页面，访问需**同时**满足「持有权限码」与「持有该角色」；
   * 未声明的属管理台页面（导出中心由后端支持「秘书本院 / 教材室全院」两种范围，
   * 是有意共享），保持仅按权限码过滤。
   */
  roles?: RoleCode[]
  /** 菜单分组（无权限的分组整体不渲染） */
  group?: string
  /** 不进侧边栏菜单 */
  hidden?: boolean
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/LoginView.vue'),
    meta: { title: '登录', hidden: true },
  },
  {
    path: '/403',
    name: 'forbidden',
    component: () => import('@/views/error/ForbiddenView.vue'),
    meta: { title: '无权访问', hidden: true },
  },
  {
    path: '/404',
    name: 'not-found',
    component: () => import('@/views/error/NotFoundView.vue'),
    meta: { title: '页面不存在', hidden: true },
  },
  {
    // 根路径不做静态 redirect：落地页依赖登录用户的权限码，
    // 由守卫调用 resolveLandingPath() 动态解析（详见 router/guards.ts）
    path: '/',
    component: () => import('@/layouts/DefaultLayout.vue'),
    children: [
      {
        path: 'profile',
        name: 'profile',
        component: () => import('@/views/profile/ProfileView.vue'),
        meta: { title: '个人中心', icon: 'User', hidden: true },
      },
      /* ---------------- 教材室（超级管理员） ---------------- */
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/admin/DashboardView.vue'),
        meta: {
          title: '数据看板',
          icon: 'DataBoard',
          permission: 'dashboard:stat:view',
          group: '教材室',
        },
      },
      {
        path: 'accounts',
        name: 'accounts',
        component: () => import('@/views/admin/AccountsView.vue'),
        meta: {
          title: '账号管理',
          icon: 'User',
          permission: 'user:account:manage',
          group: '教材室',
        },
      },
      {
        path: 'org',
        name: 'org',
        component: () => import('@/views/admin/OrgView.vue'),
        meta: {
          title: '组织管理',
          icon: 'OfficeBuilding',
          permission: 'org:college:manage',
          group: '教材室',
        },
      },
      {
        path: 'semester-window',
        name: 'semester-window',
        component: () => import('@/views/admin/SemesterWindowView.vue'),
        meta: {
          title: '学期与窗口引擎',
          icon: 'Calendar',
          permission: 'semester:semester:manage',
          group: '教材室',
        },
      },
      {
        path: 'textbooks',
        name: 'textbooks',
        component: () => import('@/views/admin/TextbooksView.vue'),
        meta: {
          title: '教材库',
          icon: 'Reading',
          permission: 'textbook:book:manage',
          group: '教材室',
        },
      },
      {
        path: 'courses',
        name: 'courses',
        component: () => import('@/views/admin/CoursesView.vue'),
        meta: {
          title: '课程与任课管理',
          icon: 'Notebook',
          permission: 'course:course:manage',
          group: '教材室',
        },
      },
      {
        path: 'people',
        name: 'people',
        component: () => import('@/views/admin/PeopleView.vue'),
        meta: {
          title: '学生/教师管理',
          icon: 'Avatar',
          permission: 'people:student:import',
          group: '教材室',
        },
      },
      {
        path: 'review',
        name: 'review',
        component: () => import('@/views/admin/ReviewView.vue'),
        meta: {
          title: '复核工作台',
          icon: 'Finished',
          permission: 'order:form:review',
          group: '教材室',
        },
      },
      {
        path: 'order-data',
        name: 'order-data',
        component: () => import('@/views/admin/OrderDataView.vue'),
        meta: {
          title: '征订数据',
          icon: 'TrendCharts',
          permission: 'order:form:view:all',
          group: '教材室',
        },
      },
      {
        path: 'export-center',
        name: 'export-center',
        component: () => import('@/views/admin/ExportCenterView.vue'),
        meta: {
          title: '导出中心',
          icon: 'Download',
          permission: 'export:order:create',
          // 秘书虽有 export:order:create（后端支持「秘书本院」范围），但本页会无条件拉取
          // 学院列表 / 通知任务 / 全院表单等超管专属数据 → 秘书进来立刻吃 403 被弹到 /403 页
          // （2026-09-22 全页面矩阵走查发现）。SPEC §4 亦将该页归属超管；
          // 秘书的导出入口是「本院导出（签字版）」。故此处限定归属角色，避免菜单能点、进去被拦。
          roles: ['ADMIN'],
          group: '教材室',
        },
      },
      {
        path: 'notices',
        name: 'notices',
        component: () => import('@/views/admin/NoticesView.vue'),
        meta: {
          title: '通知管理',
          icon: 'Bell',
          permission: 'notice:task:manage',
          group: '教材室',
        },
      },
      {
        path: 'audit',
        name: 'audit',
        component: () => import('@/views/admin/AuditView.vue'),
        meta: {
          title: '审计日志',
          icon: 'Document',
          permission: 'audit:log:view',
          group: '教材室',
        },
      },
      {
        path: 'roles',
        name: 'roles',
        component: () => import('@/views/admin/RoleView.vue'),
        meta: {
          title: '角色管理',
          icon: 'Lock',
          permission: 'role:manage',
          group: '教材室',
        },
      },
      /* ---------------- 学院秘书 ---------------- */
      {
        path: 'college-records',
        name: 'college-records',
        component: () => import('@/views/secretary/CollegeRecordsView.vue'),
        meta: {
          title: '本院征订记录',
          icon: 'Document',
          permission: 'order:form:view:college',
          roles: ['SECRETARY'],
          group: '学院秘书',
        },
      },
      {
        path: 'college-export',
        name: 'college-export',
        component: () => import('@/views/secretary/CollegeExportView.vue'),
        meta: {
          title: '本院导出（签字版）',
          icon: 'Download',
          permission: 'export:signature:create',
          roles: ['SECRETARY'],
          group: '学院秘书',
        },
      },
      {
        path: 'window-status',
        name: 'window-status',
        component: () => import('@/views/secretary/WindowStatusView.vue'),
        meta: {
          title: '窗口状态',
          icon: 'Calendar',
          permission: 'semester:window:view',
          roles: ['SECRETARY'],
          group: '学院秘书',
        },
      },
      {
        path: 'change-requests',
        name: 'change-requests',
        component: () => import('@/views/secretary/ChangeRequestsView.vue'),
        meta: {
          title: '异动申请',
          icon: 'Switch',
          permission: 'change:request:submit',
          // 异动由「知道真实变动的人」提交（PRD：秘书与任课教师同链），教材室只做审批
          roles: ['SECRETARY', 'TEACHER'],
          group: '学院秘书',
        },
      },
      /* ---------------- 任课老师 ---------------- */
      {
        path: 'my-courses',
        name: 'my-courses',
        component: () => import('@/views/teacher/MyCoursesView.vue'),
        meta: {
          title: '我的课程',
          icon: 'Reading',
          permission: 'order:form:view:self',
          roles: ['TEACHER'],
          group: '任课老师',
        },
      },
      {
        path: 'order-form',
        name: 'order-form',
        component: () => import('@/views/teacher/OrderFormView.vue'),
        meta: {
          title: '填报教材',
          icon: 'EditPen',
          permission: 'order:form:submit',
          roles: ['TEACHER'],
          group: '任课老师',
        },
      },
      {
        path: 'my-submissions',
        name: 'my-submissions',
        component: () => import('@/views/teacher/MySubmissionsView.vue'),
        meta: {
          title: '我的提交记录',
          icon: 'List',
          permission: 'order:form:view:self',
          roles: ['TEACHER'],
          group: '任课老师',
        },
      },
      /* ---------------- 学生 ---------------- */
      {
        path: 'book-select',
        name: 'book-select',
        component: () => import('@/views/student/BookSelectView.vue'),
        meta: {
          title: '选书',
          icon: 'ShoppingCart',
          permission: 'student:order:submit',
          roles: ['STUDENT'],
          group: '学生',
        },
      },
      {
        path: 'my-orders',
        name: 'my-orders',
        component: () => import('@/views/student/MyOrdersView.vue'),
        meta: {
          title: '我的选购记录',
          icon: 'List',
          permission: 'student:order:view:self',
          roles: ['STUDENT'],
          group: '学生',
        },
      },
      /* ---------------- 供货商 ---------------- */
      {
        path: 'purchase-list',
        name: 'purchase-list',
        component: () => import('@/views/supplier/PurchaseListView.vue'),
        meta: {
          title: '订购清单',
          icon: 'Files',
          permission: 'supplier:order:view',
          roles: ['SUPPLIER'],
          group: '教材供货商',
        },
      },
      {
        path: 'supplier-export',
        name: 'supplier-export',
        component: () => import('@/views/supplier/SupplierExportView.vue'),
        meta: {
          title: '清单导出',
          icon: 'Download',
          permission: 'supplier:order:export',
          roles: ['SUPPLIER'],
          group: '教材供货商',
        },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/404' },
]

export default routes
