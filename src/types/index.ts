/**
 * 领域模型类型（MVP）
 * 字段来源：后端 API.md V1.0.0 + 实测响应（联调基线 probe-baseline.json），
 * 与后端 VO/entity 逐字段一致（含后端实体透出的审计字段）。
 */

/** 角色码（后端 sys_role.role_code） */
export type RoleCode = 'ADMIN' | 'SECRETARY' | 'TEACHER' | 'STUDENT' | 'SUPPLIER'

/** 登录响应（AuthResponse） */
export interface AuthResult {
  accessToken: string
  refreshToken: string
  /** access 有效期（秒） */
  expiresIn: number
  mustChangePassword: boolean
  firstLoginVerified: boolean
  roles: RoleCode[]
  currentRole: RoleCode
  userNo: string
  name: string
}

/** active 学期归属摘要（GET /me 内嵌） */
export interface ActiveSemesterBrief {
  id: number
  name: string
  windowStatus: WindowStatus
  channelOpen: number
}

/** 登录用户（GET /api/me） */
export interface UserInfo {
  userId: number
  userNo: string
  name: string
  phone?: string
  openidBound: boolean
  roles: RoleCode[]
  currentRole: RoleCode
  permissions: string[]
  /** 1/0 */
  mustChangePassword: number
  /** 1/0 */
  firstLoginVerified: number
  semesterId?: number
  collegeId?: number
  collegeName?: string
  classId?: number
  className?: string
  activeSemester?: ActiveSemesterBrief | null
}

/** 时间窗口三态（PRD 功能 2） */
export type WindowStatus = 'not_open' | 'open' | 'closed'

/** GET /api/semester/window/status */
export interface WindowState {
  serverTime: string
  semesterId: number | null
  semesterName: string | null
  windowStatus: WindowStatus | null
  windowStart: string | null
  windowEnd: string | null
  /** 1 开放 / 0 关闭（学生通道） */
  channelOpen: number | null
  activeStatus: string | null
}

/** 通用分页请求（page 从 1 开始，size 上限 200） */
export interface PageQuery {
  page: number
  size: number
  [key: string]: unknown
}

/** 通用分页结果（PageResponse） */
export interface PageResult<T> {
  list: T[]
  page: number
  size: number
  total: number
  totalPages: number
}

/** 字段审查问题项（FieldCheckIssue） */
export interface FieldCheckIssue {
  field: string
  rule: string
  message: string
}

/* ---------------- 组织三表 ---------------- */
export interface College {
  id: number
  name: string
  fullName?: string
  createdAt?: string
  updatedAt?: string
}

export interface Major {
  id: number
  collegeId: number
  name: string
  fullName?: string
}

export interface Klass {
  id: number
  majorId: number
  name: string
  grade?: string
  /** 班级人数（教师征订数量上限来源） */
  studentCount?: number
}

/* ---------------- 教材库 ---------------- */
export interface Textbook {
  id: number
  isbn: string
  title: string
  edition?: string
  author?: string
  /** 出版社（后端字段名 press） */
  press?: string
  price?: number
  /** 1 在库 / 0 停用 */
  status: number
  createdAt?: string
  updatedAt?: string
}

/* ---------------- 课程与任课 ---------------- */
export interface Course {
  id: number
  semesterId: number
  code?: string
  name: string
}

/** GET /api/admin/teacher-course */
export interface TeacherCourse {
  id: number
  semesterId: number
  teacherId: number
  teacherName: string
  courseId: number
  courseName: string
  classId: number
  className: string
}

/* ---------------- 学期与窗口 ---------------- */
export type SemesterActiveStatus = 'draft' | 'active' | 'archived'

export interface Semester {
  id: number
  name: string
  startDate: string
  endDate: string
  windowStart: string
  windowEnd: string
  channelOpen: number
  /** 1 到点自动开启 / 0 仅手动 */
  autoOpen: number
  autoClose: number
  windowStatus: WindowStatus
  activeStatus: SemesterActiveStatus
  /** 乐观锁版本（activate 需原样回传） */
  version: number
  createdAt?: string
  updatedAt?: string
}

/** 审计日志（窗口变更记录 = action/resource 过滤后的审计） */
export interface AuditLog {
  id: number
  userId?: number
  userNo?: string
  action: string
  resource: string
  resourceId?: string
  detailJson?: Record<string, unknown>
  ip?: string
  at: string
}

/* ---------------- 账号（UserListItem） ---------------- */
export interface Account {
  id: number
  userNo: string
  name: string
  phone?: string
  collegeId?: number
  collegeName?: string
  classId?: number
  className?: string
  /** 1 正常 / 0 停用 */
  status: number
  /** 1 待改密 / 0 已改密 */
  mustChangePassword: number
  firstLoginVerified: number
  openidBound?: boolean
  lockUntil?: string
  roles: RoleCode[]
  createdAt?: string
}

/* ---------------- 导入批次（ImportBatch） ---------------- */
export type BatchStatus = 'running' | 'done' | 'failed'

export interface ImportBatch {
  id: number
  bizType: string
  semesterId?: number
  fileName?: string
  total?: number
  okCount?: number
  errorCount?: number
  progressPct?: number
  status: BatchStatus
  errorDetail?: { row?: number; reason?: string; [k: string]: unknown }[]
  batchNo?: string
  createdAt?: string
  updatedAt?: string
}

/* ---------------- 导入预览（局部名单防护，B13） ---------------- */

/** 单个班级的人数 diff（`POST /api/admin/user/import/preview`） */
export interface ClassSizeDiff {
  classId: number
  className: string
  majorName?: string
  collegeName?: string
  /** 库中当前人数（教师填报数量上限来源） */
  currentCount: number
  /** 文件内该班去重学生数（导入后的新值） */
  incomingCount: number
  /** 下调人数（未下调为 0） */
  drop: number
  /** 下调比例（百分数） */
  dropPct: number
  /** 是否命中阈值，导入需显式确认 */
  requiresConfirm: boolean
}

/** 导入预览（只读，不落库、不建批次） */
export interface ImportPreview {
  bizType: string
  semesterId?: number
  totalRows: number
  okRows: number
  errorRows: number
  errorSamples?: { row?: number; message?: string }[]
  /** 本次将新建的账号数 */
  newUserCount: number
  /** 是否执行了「不在名单内即停用」的比对（仅目标学期 = active 学期时为真） */
  disableComparisonApplies: boolean
  /** 比对将停用的账号数 */
  disableEstimate: number
  classSizeDiffs: ClassSizeDiff[]
  requiresConfirm: boolean
  shrinkConfirmPct: number
  shrinkConfirmMinDrop: number
}

/* ---------------- 异动申请 ---------------- */
export type ChangeStatus = 'pending_review' | 'approved' | 'rejected'

export type ChangeType = 'student' | 'teacher'

/** ChangeRequestVO（提交端与审批详情） */
export interface ChangeRequest {
  id: number
  semesterId: number
  type: ChangeType | string
  targetUserId?: number
  targetUserNo: string
  targetUserName?: string
  beforeCollegeId?: number
  beforeCollegeName?: string
  beforeClassId?: number
  beforeClassName?: string
  afterCollegeId?: number
  afterCollegeName?: string
  afterClassId?: number
  afterClassName?: string
  status: ChangeStatus | string
  batchNo?: string
  applicantId?: number
  applicantName?: string
  reviewerId?: number
  reason?: string
  /** 系统字段审查结果 */
  fieldCheckResult?: FieldCheckIssue[]
  reviewAt?: string
  createdAt?: string
}

/** ChangeRequestListItem（审批列表） */
export interface ChangeRequestListItem {
  id: number
  semesterId: number
  type: ChangeType | string
  targetUserId?: number
  targetUserName?: string
  targetUserNo?: string
  currentCollegeName?: string
  currentClassName?: string
  /** { before:{collegeId,classId}, after:{collegeId,classId} } */
  payloadJson?: {
    before?: { collegeId?: number; classId?: number }
    after?: { collegeId?: number; classId?: number }
  }
  status: ChangeStatus | string
  batchNo?: string
  applicantId?: number
  applicantName?: string
  reason?: string
  createdAt?: string
  reviewAt?: string
}

/* ---------------- 教师填报（两级审查） ---------------- */
export type OrderFormStatus = 'draft' | 'pending_review' | 'reviewed' | 'rejected' | 'rejected_auto'

/** OrderFormItemVO */
export interface OrderFormItem {
  id: number
  courseId: number
  courseName: string
  classId: number
  className: string
  textbookId: number
  textbookTitle: string
  isbn: string
  quantity: number
}

/** OrderFormDetailVO */
export interface OrderForm {
  id: number
  semesterId: number
  semesterName: string
  teacherId: number
  status: OrderFormStatus
  fieldCheckResult?: FieldCheckIssue[]
  submittedAt?: string
  reviewAt?: string
  reviewBy?: number
  reviewNote?: string
  /** 补正截止时间（被驳回后下发） */
  correctDeadline?: string
  /**
   * 最近一次主动撤回时间（BE-4）。
   * 教师把 pending_review 撤回为 draft 后落此值；前端据此在草稿态提示
   * 「已于 … 撤回，修改后请重新提交」，以区分「从未提交」与「撤回后待重提」。
   */
  withdrawnAt?: string | null
  /**
   * 内容版本号（每次提交整单覆盖即自增）。
   * 审核接口以它做 CAS：审核页把读到的值原样回传，服务端比对不一致即 409，
   * 防止「管理员打开页面 → 教师又重提 → 管理员点通过」落在没看过的内容上。
   */
  contentVersion?: number
  items: OrderFormItem[]
  itemCount: number
  totalQuantity: number
}

/** OrderFormListItem（列表/历史） */ export interface OrderFormListItem {
  id: number
  semesterId: number
  semesterName?: string
  teacherId: number
  teacherName?: string
  teacherNo?: string
  collegeId?: number
  collegeName?: string
  status: OrderFormStatus
  submittedAt?: string
  reviewAt?: string
  reviewNote?: string
  correctDeadline?: string
  itemCount: number
  totalQuantity: number
}

/** 教师任课范围（GET /api/teacher/my-courses） */
export interface TeacherCourseGroup {
  classId: number
  className: string
  courses: { courseId: number; courseName: string }[]
}

/** 教师选书器选项（GET /api/teacher/textbook，仅在库教材） */
export interface TeacherTextbookOption {
  textbookId: number
  isbn: string
  title: string
  edition?: string
  author?: string
  press?: string
  price?: number
}

/* ---------------- 学生选购 ---------------- */
/** StudentBookVO（本班教材清单） */
export interface StudentBook {
  textbookId: number
  isbn: string
  title: string
  edition?: string
  author?: string
  press?: string
  price?: number
  /** 必修 */
  required: boolean
  /** 已下架（不可选，仅提示） */
  delisted: boolean
}

/** StudentOrderItemVO */
export interface StudentOrderItem {
  id: number
  textbookId: number
  isbn: string
  title: string
  edition?: string
  author?: string
  press?: string
  price?: number
  delisted?: boolean
  quantity: number
  courseId?: number
}

/** StudentOrderDetailVO */
export interface StudentOrder {
  id: number
  semesterId: number
  semesterName: string
  status: string
  submitSnapshot?: {
    collegeId?: number
    collegeName?: string
    classId?: number
    className?: string
  }
  submittedAt?: string
  items: StudentOrderItem[]
  totalQuantity: number
}

/** StudentOrderListItem（历史记录） */
export interface StudentOrderListItem {
  id: number
  semesterId: number
  semesterName?: string
  studentId: number
  studentName?: string
  studentNo?: string
  collegeId?: number
  collegeName?: string
  classId?: number
  className?: string
  status: string
  submittedAt?: string
  submitSnapshot?: Record<string, unknown>
  totalQuantity: number
}

/* ---------------- 通知 ---------------- */
/** UnconfirmedNoticeItem（阻塞弹窗数据源） */
export interface UnconfirmedNotice {
  taskId: number
  title: string
  content: string
  /** manual 手动 / system_window_change 窗口变更自动 */
  source: string
  createdAt?: string
  roundStopped: boolean
}

/**
 * MyNoticeItem（GET /api/notice/mine · 全量通知，含已确认与已关闭）。
 * 与 /unconfirmed 同口径：按 `notice_task.target_roles` 定向，只返回面向本人角色的任务
 * （ADMIN 全量可见）。空列表 = 没有面向本角色的通知，是正常状态而非故障。
 */
export interface MyNotice {
  taskId: number
  title: string
  content: string
  source: string
  status: string
  createdAt?: string
  /** 为 null / 缺省表示待确认 */
  confirmedAt?: string | null
}

/** NoticeTaskListItem */
export interface NoticeTask {
  id: number
  semesterId: number
  title: string
  content: string
  targetRoles?: string
  roundLimit?: number
  intervalHours?: number
  source: string
  status: string
  createdAt?: string
  closedBy?: number
  closedAt?: string
}

/** NoticeProgressResponse */
export interface NoticeProgress {
  sent: number
  unauthorized: number
  failed: number
  confirmed: number
  roundLimit: number
}

/** NoticeFailureItem（线下兜底名单） */
export interface NoticeFailure {
  userId: number
  userNo: string
  name: string
  role: string
  collegeId?: number
  collegeName?: string
  classId?: number
  className?: string
  sendStatus: string
  roundNo?: number
  sentAt?: string
}

/* ---------------- 供货商（只读四类字段） ---------------- */
export interface SupplierOrderItem {
  teacherName: string
  isbn: string
  title: string
  quantity: number
}

export interface SupplierCollegeGroup {
  collegeId: number
  collegeName: string
  items: SupplierOrderItem[]
}

/* ---------------- 数据看板 ---------------- */
export interface CollegeProgress {
  collegeId: number
  collegeName: string
  teacherTotal: number
  submitted: number
  pendingReview: number
  reviewed: number
  rejected: number
}

export interface DashboardStats {
  semesterId: number | null
  windowStatus: WindowStatus | null
  channelOpen: number | null
  serverTime: string
  colleges: CollegeProgress[]
  pendingReviewTotal: number
  unconfirmedNoticeTotal: number
  studentOrderTotal: number
  studentSubmittedTotal: number
}

/* ---------------- 导出任务 ---------------- */
export type ExportTaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'expired'

export interface ExportTask {
  id: number
  bizType: string
  paramsJson?: Record<string, unknown>
  rowEstimate?: number
  downloadToken?: string
  tokenExpireAt?: string
  expiresAt?: string
  status: ExportTaskStatus
  progressPct?: number
  errorMsg?: string
  createdAt?: string
  updatedAt?: string
}

/** 异步导出受理结果（同步导出时后端直接回 xlsx 流，无此结构） */
export interface AsyncExportAccepted {
  taskId: number
  async: true
  rowEstimate?: number
}

/** 异动 Excel 批量提交结果 */
export interface ChangeImportResult {
  batchId: number
  batchNo: string
  total: number
  okCount: number
  errorCount: number
}

/** 系统配置项 */
export interface SystemConfigItem {
  id: number
  configKey: string
  configValue: string
  remark?: string
}

/* ---------------- 角色与权限（BE-2 / 决策 FE-W2） ---------------- */

/** RoleListItem（GET /api/admin/role） */
export interface RoleListItem {
  id: number
  roleCode: string
  roleName: string
  sort?: number
  /** 内置角色（ADMIN/SECRETARY/TEACHER/STUDENT/SUPPLIER）：编码不可改，超管权限不可改 */
  builtIn: boolean
  /** 该角色下的账号数：删除时后端以它做 409 兜底 */
  userCount: number
  /** 已分配的权限码 */
  permCodes: string[]
}

/** 权限目录（GET /api/admin/permission）：按模块分组，供权限树两级展示 */
export interface PermissionItem {
  permCode: string
  permName: string
}

export interface PermissionGroup {
  module: string
  perms: PermissionItem[]
}
