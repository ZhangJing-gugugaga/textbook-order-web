/**
 * 全局常量：文案令牌（PRD 功能 7）、错误码（401 三类细分，M1 契约冻结后回填）、
 * 权限码提议值（SPEC §4，以后端 sys_permission 为准）。
 */

/* ---------------- 文案令牌（PRD 功能 7 全局六类） ---------------- */
export const COPY = {
  EMPTY: '暂无数据',
  LOADING: '加载中…',
  SUCCESS: '操作成功',
  FAILED: '操作失败，请重试',
  FORBIDDEN: '无权访问该页面',
  NETWORK: '网络异常，请稍后重试',
  SERVER_ERROR: '服务开小差了，请重试',
  WINDOW_CLOSED: '本期征订已截止，提交未生效',
  LOGIN_EXPIRED: '登录已过期，请重新登录',
  ROLE_CHANGED: '账号信息已变更，请重新登录',
  ACCOUNT_DISABLED: '账号已停用，请联系教材室',
  ACCOUNT_LOCKED: '账号已锁定，请稍后再试',
  BAD_CREDENTIAL: '账号或密码不正确',
} as const

/* ---------------- 业务错误码（提议值，M1 契约冻结后回填） ---------------- */
export const CODE = {
  OK: 0,
  /** access token 过期：静默 refresh 后重放 */
  ACCESS_EXPIRED: 40101,
  /** refresh 失效：强制登出 */
  REFRESH_INVALID: 40102,
  /** 角色版本失效：强制登出 */
  ROLE_VERSION_INVALID: 40103,
  /** 账号停用：强制登出 */
  ACCOUNT_DISABLED: 40104,
  /** 无权限 */
  FORBIDDEN: 40300,
  /** 关窗瞬间提交 */
  WINDOW_CLOSED: 40901,
  /** 字段审查未通过（data.errors 为 FieldCheckItem[]） */
  FIELD_CHECK_FAILED: 42200,
} as const

/** 导出阈值：≤5000 行同步下载，>5000 行建 export_task（Q16） */
export const EXPORT_SYNC_MAX_ROWS = 5000

/**
 * 导出分流判定（SPEC §8 / Q16）：
 * 预估行数超过阈值走异步导出任务，否则同步下载。
 */
export function shouldUseAsyncExport(
  estimatedRows: number,
  threshold = EXPORT_SYNC_MAX_ROWS,
): boolean {
  return estimatedRows > threshold
}

/** 轮询参数（SPEC §7 task store：2s 起步、退避至上限 10s） */
export const POLL_INTERVAL_START = 2000
export const POLL_INTERVAL_MAX = 10000

/** 窗口状态轮询间隔 */
export const WINDOW_POLL_INTERVAL = 60000

/* ---------------- 权限码提议值（SPEC §4） ---------------- */
export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard:view',
  USER_MANAGE: 'sys:user:manage',
  ORG_MANAGE: 'org:manage',
  SEMESTER_MANAGE: 'semester:manage',
  TEXTBOOK_MANAGE: 'textbook:manage',
  COURSE_MANAGE: 'course:manage',
  PEOPLE_MANAGE: 'people:manage',
  CHANGE_APPROVE: 'change:approve',
  REVIEW_FORM: 'review:form',
  ORDER_DATA_VIEW: 'data:order:view',
  EXPORT_CENTER: 'export:center',
  NOTICE_TASK_MANAGE: 'notice:task:manage',
  COLLEGE_DATA_VIEW: 'data:college:view',
  COLLEGE_EXPORT: 'export:college',
  WINDOW_VIEW: 'window:view',
  CHANGE_SUBMIT: 'change:submit',
  ORDER_FORM_VIEW: 'order:form:view',
  ORDER_FORM_FILL: 'order:form:fill',
  STUDENT_ORDER_FILL: 'student:order:fill',
  STUDENT_ORDER_VIEW: 'student:order:view',
  SUPPLIER_LIST_VIEW: 'supplier:list:view',
  SUPPLIER_EXPORT: 'supplier:export',
} as const

/** 角色 → 权限码映射（仅用于本地 mock 种子数据；真实权限码以后端 sys_permission 为准） */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.ORG_MANAGE,
    PERMISSIONS.SEMESTER_MANAGE,
    PERMISSIONS.TEXTBOOK_MANAGE,
    PERMISSIONS.COURSE_MANAGE,
    PERMISSIONS.PEOPLE_MANAGE,
    PERMISSIONS.CHANGE_APPROVE,
    PERMISSIONS.REVIEW_FORM,
    PERMISSIONS.ORDER_DATA_VIEW,
    PERMISSIONS.EXPORT_CENTER,
    PERMISSIONS.NOTICE_TASK_MANAGE,
  ],
  secretary: [
    PERMISSIONS.COLLEGE_DATA_VIEW,
    PERMISSIONS.COLLEGE_EXPORT,
    PERMISSIONS.WINDOW_VIEW,
    PERMISSIONS.CHANGE_SUBMIT,
  ],
  teacher: [PERMISSIONS.ORDER_FORM_VIEW, PERMISSIONS.ORDER_FORM_FILL, PERMISSIONS.CHANGE_SUBMIT],
  student: [PERMISSIONS.STUDENT_ORDER_FILL, PERMISSIONS.STUDENT_ORDER_VIEW],
  supplier: [PERMISSIONS.SUPPLIER_LIST_VIEW, PERMISSIONS.SUPPLIER_EXPORT],
}

export const ROLE_LABELS: Record<string, string> = {
  admin: '教材室（超级管理员）',
  secretary: '学院秘书',
  teacher: '任课老师',
  student: '学生',
  supplier: '教材供货商',
}
