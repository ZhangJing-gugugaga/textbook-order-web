/**
 * 全局常量：文案令牌（PRD 功能 7）、业务错误码（后端 ErrorCode 同源字符串令牌）、
 * 权限码（后端 sys_permission 37 条 · M1 冻结）。
 *
 * 契约基准：后端 API.md V1.0.0 + 实测响应（联调基线 probe-baseline.json）。
 */

/** 应用名（document.title 后缀、登录页品牌位） */
export const APP_NAME = '教材征订系统'

/** 列表分页尺寸档位（此前 10 处 `:page-sizes="[10, 20, 50]"` 各写一遍） */
export const PAGE_SIZES = [10, 20, 50] as const

/** 学号/工号格式（账号管理新建 + 登录页校验共用） */
export const USER_NO_PATTERN = /^[A-Za-z0-9]{4,32}$/

/** el-date-picker 值格式（学期窗口 / 学期生命周期共用） */
export const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss'

/** el-tag 语义类型 */
export type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'

/** 状态元信息（标签文案 + 语义色），供表格与详情共用 */
export interface StatusMeta {
  label: string
  type: TagType
}

/* ---------------- 文案令牌（PRD 功能 7 全局六类） ---------------- */
export const COPY = {
  EMPTY: '暂无数据',
  LOADING: '加载中…',
  SUCCESS: '操作成功',
  FAILED: '操作失败，请重试',
  FORBIDDEN: '无权执行该操作',
  NETWORK: '网络异常，请稍后重试',
  SERVER_ERROR: '服务开小差了，请稍后重试',
  WINDOW_CLOSED: '本期征订已截止',
  LOGIN_EXPIRED: '登录已过期，请重新登录',
  ACCOUNT_DISABLED: '账号已停用，请联系教材室',
  ACCOUNT_LOCKED: '账号已锁定，请稍后再试',
  BAD_CREDENTIAL: '账号或密码不正确',
  FIRST_LOGIN_REQUIRED: '请先完成首登校验并修改初始密码',
  /** 405 / 415：前端发起方式有误（不是服务端故障），文案不得复用 SERVER_ERROR */
  METHOD_NOT_ALLOWED: '请求方法不被支持，请刷新页面后重试',
  MEDIA_TYPE_NOT_SUPPORTED: '请求内容类型不被支持',
  /** 410：一次性下载 token 已被消费或过期，只能重新导出（原地重试必然再失败） */
  DOWNLOAD_TOKEN_INVALID: '下载链接已失效，请重新导出',
} as const

/* ---------------- 业务错误码（后端 common/error/ErrorCode 同源） ---------------- */
export const CODE = {
  OK: '0',
  /* 400 */
  PARAM_INVALID: 'PARAM_INVALID',
  FIELD_CHECK_FAILED: 'FIELD_CHECK_FAILED',
  FILE_TYPE_INVALID: 'FILE_TYPE_INVALID',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  CONFIG_VALUE_INVALID: 'CONFIG_VALUE_INVALID',
  BOOK_DELISTED: 'BOOK_DELISTED',
  PASSWORD_POLICY: 'PASSWORD_POLICY',
  /* 401 三类语义（契约冻结项） */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** access 过期：静默 refresh 后重放 */
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  /** refresh 失效 / 角色版本失效：强制登出 */
  REFRESH_INVALID: 'REFRESH_INVALID',
  /** 账号停用：强制登出 */
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  LOGIN_FAILED: 'LOGIN_FAILED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  FIRST_LOGIN_VERIFY_FAILED: 'FIRST_LOGIN_VERIFY_FAILED',
  /* 403 */
  FORBIDDEN: 'FORBIDDEN',
  RESOURCE_FORBIDDEN: 'RESOURCE_FORBIDDEN',
  /** 首登拦截：跳首登引导页（不跳登录页） */
  FIRST_LOGIN_REQUIRED: 'FIRST_LOGIN_REQUIRED',
  /* 404 */
  NOT_FOUND: 'NOT_FOUND',
  /* 405 / 415：协议边界（此前被后端兜底成 500 SERVER_ERROR，前端不得再显示「服务开小差」） */
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  MEDIA_TYPE_NOT_SUPPORTED: 'MEDIA_TYPE_NOT_SUPPORTED',
  /* 409 */
  WINDOW_CLOSED: 'WINDOW_CLOSED',
  WINDOW_NOT_OPEN: 'WINDOW_NOT_OPEN',
  CORRECTION_EXPIRED: 'CORRECTION_EXPIRED',
  STATE_CONFLICT: 'STATE_CONFLICT',
  NOTICE_TASK_EXISTS: 'NOTICE_TASK_EXISTS',
  /* 410 */
  DOWNLOAD_TOKEN_INVALID: 'DOWNLOAD_TOKEN_INVALID',
  /* 429 */
  RATE_LIMITED: 'RATE_LIMITED',
  /* 500 */
  SERVER_ERROR: 'SERVER_ERROR',
} as const

/** 导出阈值默认值（真源为 system_config.export.sync_row_threshold） */
export const EXPORT_SYNC_MAX_ROWS = 5000

/** 轮询参数（SPEC §7 task store：2s 起步、退避至上限 10s） */
export const POLL_INTERVAL_START = 2000
export const POLL_INTERVAL_MAX = 10000

/** 窗口状态轮询间隔 */
export const WINDOW_POLL_INTERVAL = 60000

/** system_config 8 键（后端 §3.12，键名即真源） */
export const CONFIG_KEYS = {
  NOTICE_ROUND_LIMIT: 'notice.round_limit',
  NOTICE_INTERVAL_HOURS: 'notice.interval_hours',
  NOTICE_POPUP_QUEUE_MAX: 'notice.popup_queue_max',
  ORDER_QUANTITY_MAX_DEFAULT: 'order.quantity.max_default',
  ORDER_CORRECT_WINDOW_DAYS: 'order.correct_window_days',
  EXPORT_SYNC_ROW_THRESHOLD: 'export.sync_row_threshold',
  EXPORT_DOWNLOAD_TOKEN_MINUTES: 'export.download_token_minutes',
  IMPORT_MAX_FILE_MB: 'import.max_file_mb',
} as const

/* ---------------- 权限码（后端 sys_permission 37 条 · M1 冻结） ---------------- */
export const PERMISSIONS = {
  // semester
  SEMESTER_MANAGE: 'semester:semester:manage',
  SEMESTER_ACTIVATE: 'semester:semester:activate',
  WINDOW_MANAGE: 'semester:window:manage',
  WINDOW_VIEW: 'semester:window:view',
  // account
  USER_MANAGE: 'user:account:manage',
  USER_RESET: 'user:account:reset',
  // org
  ORG_COLLEGE_MANAGE: 'org:college:manage',
  ORG_MAJOR_MANAGE: 'org:major:manage',
  ORG_CLASS_MANAGE: 'org:class:manage',
  // textbook
  TEXTBOOK_MANAGE: 'textbook:book:manage',
  TEXTBOOK_IMPORT: 'textbook:book:import',
  // course
  COURSE_MANAGE: 'course:course:manage',
  TEACHER_COURSE_MANAGE: 'course:teacher:manage',
  // people
  STUDENT_IMPORT: 'people:student:import',
  TEACHER_IMPORT: 'people:teacher:import',
  // import batch
  IMPORT_BATCH_VIEW: 'import:batch:view',
  // 教师征订
  ORDER_FORM_SUBMIT: 'order:form:submit',
  ORDER_FORM_VIEW_SELF: 'order:form:view:self',
  ORDER_FORM_VIEW_COLLEGE: 'order:form:view:college',
  ORDER_FORM_VIEW_ALL: 'order:form:view:all',
  ORDER_FORM_REVIEW: 'order:form:review',
  // 学生选购
  STUDENT_ORDER_SUBMIT: 'student:order:submit',
  STUDENT_ORDER_VIEW_SELF: 'student:order:view:self',
  STUDENT_ORDER_VIEW_ALL: 'student:order:view:all',
  // 异动
  CHANGE_SUBMIT: 'change:request:submit',
  CHANGE_REVIEW: 'change:request:review',
  // 导出
  EXPORT_ORDER: 'export:order:create',
  EXPORT_SIGNATURE: 'export:signature:create',
  EXPORT_STUDENT: 'export:student:create',
  EXPORT_NOTICE: 'export:notice:create',
  // 通知
  NOTICE_TASK_MANAGE: 'notice:task:manage',
  NOTICE_TASK_VIEW: 'notice:task:view',
  // 配置 / 审计 / 看板
  CONFIG_MANAGE: 'config:config:manage',
  AUDIT_VIEW: 'audit:log:view',
  DASHBOARD_VIEW: 'dashboard:stat:view',
  // 供货商（物理隔离）
  SUPPLIER_ORDER_VIEW: 'supplier:order:view',
  SUPPLIER_ORDER_EXPORT: 'supplier:order:export',
} as const

/** 角色码（后端 sys_role.role_code，大写） */
export const ROLES = {
  ADMIN: 'ADMIN',
  SECRETARY: 'SECRETARY',
  TEACHER: 'TEACHER',
  STUDENT: 'STUDENT',
  SUPPLIER: 'SUPPLIER',
} as const

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: '教材室（超级管理员）',
  SECRETARY: '学院秘书',
  TEACHER: '任课教师',
  STUDENT: '学生',
  SUPPLIER: '教材供货商',
}

/**
 * 教师征订单状态（后端 §1.7）。
 * `draft` 现在是真的会出现：教师「撤回修改」（BE-4）会把 pending_review 打回 draft。
 * 此前的 `submitted` 是死值（后端从不产出），已移除——留着会出现在筛选下拉里，
 * 选了永远查不到数据。
 */
export const ORDER_FORM_STATUS = {
  draft: '草稿',
  pending_review: '待审核',
  reviewed: '已通过',
  rejected: '已驳回',
  rejected_auto: '字段审查未过',
} as const

/** 学生选购单状态 */
export const STUDENT_ORDER_STATUS = {
  draft: '草稿',
  submitted: '已提交',
} as const

/**
 * 异动状态。
 * 此前的 `pending_field_check` 是死值（异动不走字段审查机，后端从不产出），已移除。
 */
export const CHANGE_STATUS = {
  pending_review: '待审批',
  approved: '已通过',
  rejected: '已驳回',
} as const

/** 异动类型 */
export const CHANGE_TYPE_LABELS: Record<string, string> = {
  student: '学生异动',
  teacher: '教师异动',
}

/**
 * 状态 → 标签（文案 + 语义色）。
 * 文案一律从上面的状态字典取，保证「一处改文案、处处生效」；
 * 此前 ReviewView / MySubmissionsView 各写一份 STATUS_META，
 * PeopleView / ChangeRequestsView 各写一份异动映射，文案已出现漂移。
 */
export const ORDER_FORM_STATUS_META: Record<string, StatusMeta> = {
  draft: { label: ORDER_FORM_STATUS.draft, type: 'info' },
  pending_review: { label: ORDER_FORM_STATUS.pending_review, type: 'warning' },
  reviewed: { label: ORDER_FORM_STATUS.reviewed, type: 'success' },
  rejected: { label: ORDER_FORM_STATUS.rejected, type: 'danger' },
  rejected_auto: { label: ORDER_FORM_STATUS.rejected_auto, type: 'danger' },
}

export const STUDENT_ORDER_STATUS_META: Record<string, StatusMeta> = {
  draft: { label: STUDENT_ORDER_STATUS.draft, type: 'info' },
  submitted: { label: STUDENT_ORDER_STATUS.submitted, type: 'success' },
}

export const CHANGE_STATUS_META: Record<string, StatusMeta> = {
  pending_review: { label: CHANGE_STATUS.pending_review, type: 'warning' },
  approved: { label: CHANGE_STATUS.approved, type: 'success' },
  rejected: { label: CHANGE_STATUS.rejected, type: 'danger' },
}

/**
 * 审计日志动作令牌（`audit_log.action`）。
 *
 * 与后端 `AuditService` 的常量**一一对应**（13 个），是筛选下拉的唯一来源——
 * 页面内不再各写一份，避免后端新增动作后前端筛不到。
 * 键即后端存的值（英文令牌），值是给人看的中文。
 */
export const AUDIT_ACTIONS: Record<string, string> = {
  LOGIN: '登录',
  LOGOUT: '登出',
  EXPORT: '导出',
  ACCOUNT: '账号变更',
  WINDOW: '窗口操作',
  SEMESTER_SWITCH: '学期切换',
  REVIEW: '内容审核',
  CHANGE: '学籍异动',
  CONFIG: '系统配置',
  IMPORT: '名单导入',
  NOTICE: '通知任务',
  ROLE: '角色/权限变更',
  WITHDRAW: '教师撤回',
}

/** 通知来源（通知管理页与全局阻塞弹窗共用） */
export const NOTICE_SOURCE_LABELS: Record<string, string> = {
  system_window_change: '系统（窗口变更）',
  manual: '教材室',
}

/** 未知状态兜底：原样回显后端码值 */
export function statusMetaOf(
  dict: Record<string, StatusMeta>,
  status: string | undefined,
): StatusMeta {
  if (!status) return { label: '—', type: 'info' }
  return dict[status] ?? { label: status, type: 'info' }
}

/** 导入批次状态 */
export const BATCH_STATUS = {
  running: '处理中',
  done: '已完成',
  failed: '已失败',
} as const

/** 导出任务状态 */
export const EXPORT_TASK_STATUS = {
  queued: '排队中',
  running: '导出中',
  done: '已完成',
  failed: '已失败',
  expired: '已过期',
} as const

/** 窗口三态 */
export const WINDOW_STATUS = {
  not_open: '未开始',
  open: '进行中',
  closed: '已截止',
} as const

/** 学期生命周期 */
export const SEMESTER_ACTIVE_STATUS = {
  draft: '可导入',
  active: '当前学期',
  archived: '已归档',
} as const

/** 通知发送状态 */
export const SEND_STATUS = {
  sent: '已发送',
  unauthorized: '未授权',
  failed: '失败',
} as const
