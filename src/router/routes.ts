import type { RouteRecordRaw } from 'vue-router'

/** 路由元信息：权限码为提议值（SPEC §4，以后端 sys_permission 为准） */
export interface AppRouteMeta {
  title: string
  icon?: string
  permission?: string
  /** 菜单分组（无权限的分组整体不渲染） */
  group?: string
  /** 不进侧边栏菜单 */
  hidden?: boolean
  /** 布局内不缓存 */
  keepAlive?: boolean
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
    path: '/',
    component: () => import('@/layouts/DefaultLayout.vue'),
    redirect: '/dashboard',
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
          permission: 'dashboard:view',
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
          permission: 'sys:user:manage',
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
          permission: 'org:manage',
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
          permission: 'semester:manage',
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
          permission: 'textbook:manage',
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
          permission: 'course:manage',
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
          permission: 'people:manage',
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
          permission: 'review:form',
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
          permission: 'data:order:view',
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
          permission: 'export:center',
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
      /* ---------------- 学院秘书 ---------------- */
      {
        path: 'college-records',
        name: 'college-records',
        component: () => import('@/views/secretary/CollegeRecordsView.vue'),
        meta: {
          title: '本院征订记录',
          icon: 'Document',
          permission: 'data:college:view',
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
          permission: 'export:college',
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
          permission: 'window:view',
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
          permission: 'change:submit',
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
          permission: 'order:form:view',
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
          permission: 'order:form:fill',
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
          permission: 'order:form:view',
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
          permission: 'student:order:fill',
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
          permission: 'student:order:view',
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
          permission: 'supplier:list:view',
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
          permission: 'supplier:export',
          group: '教材供货商',
        },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/404' },
]

export default routes
