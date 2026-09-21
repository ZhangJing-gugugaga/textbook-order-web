/**
 * 领域模型类型（MVP）
 * 说明：字段命名对齐 03 号文档 M1 契约冻结前的提议值，契约冻结后仅需调整本文件与 api 层映射。
 */

/** 角色枚举（前端仅用于展示与数据范围推断，鉴权一律以权限码为准） */
export type RoleCode = 'admin' | 'secretary' | 'teacher' | 'student' | 'supplier'

/** 登录用户 */
export interface UserInfo {
  id: number
  userNo: string
  name: string
  roles: RoleCode[]
  /** 当前身份（多角色切换后变化） */
  currentRole: RoleCode
  /** 数据范围：学院 id 列表（秘书/教师/学生由后端下发） */
  collegeIds: number[]
  mustChangePassword: boolean
}

export interface PermissionBundle {
  roles: RoleCode[]
  permissions: string[]
  currentRole: RoleCode
  /** 角色版本号：失效时后端返回 40103 */
  roleVersion: number
}

/** 时间窗口三态（PRD 功能 2） */
export type WindowStatus = 'not_open' | 'open' | 'closed'

export interface WindowState {
  status: WindowStatus
  windowStart: string
  windowEnd: string
  serverTime: string
  semesterId: number
  semesterName: string
}

/** 通用分页结果 */
export interface PageResult<T> {
  list: T[]
  total: number
}

export interface PageQuery {
  page: number
  size: number
  [key: string]: unknown
}

/* ---------------- 组织 ---------------- */
export interface College {
  id: number
  name: string
  code: string
}
export interface Major {
  id: number
  collegeId: number
  name: string
}
export interface Klass {
  id: number
  majorId: number
  collegeId: number
  name: string
  /** 班级人数（教师填报数量上限） */
  studentCount: number
}
export interface OrgTree extends College {
  majors: (Major & { classes: Klass[] })[]
}

/* ---------------- 教材库 ---------------- */
export interface Textbook {
  id: number
  isbn: string
  title: string
  author: string
  publisher: string
  edition: string
  price: number
  /** 在库 / 停用 */
  status: 'active' | 'disabled'
  createdAt: string
}

/* ---------------- 课程与任课 ---------------- */
export interface Course {
  id: number
  code: string
  name: string
  collegeId: number
  credit: number
}
export interface TeachingAssignment {
  id: number
  courseId: number
  courseName: string
  teacherId: number
  teacherName: string
  classId: number
  className: string
  collegeId: number
  semesterId: number
}

/* ---------------- 学期与窗口 ---------------- */
export type SemesterStatus = 'draft' | 'active' | 'archived'

export interface Semester {
  id: number
  name: string
  startDate: string
  endDate: string
  status: SemesterStatus
  windowStart: string
  windowEnd: string
  autoOpen: boolean
  autoClose: boolean
  createdAt: string
}

export interface WindowChangeRecord {
  id: number
  semesterId: number
  action: 'open' | 'close' | 'extend' | 'activate' | 'archive'
  operatorName: string
  createdAt: string
  fromValue: string
  toValue: string
}

/* ---------------- 账号 ---------------- */
export interface Account {
  id: number
  userNo: string
  name: string
  role: RoleCode
  collegeId: number | null
  collegeName: string
  status: 'active' | 'disabled'
  mustChangePassword: boolean
  createdAt: string
}

/* ---------------- 师生 ---------------- */
export interface Person {
  id: number
  userNo: string
  name: string
  type: 'student' | 'teacher'
  gender: 'M' | 'F'
  collegeId: number
  collegeName: string
  majorId: number | null
  majorName: string
  classId: number | null
  className: string
  phone: string
  status: 'active' | 'disabled'
}

/* ---------------- 导入批次 ---------------- */
export type BatchStatus = 'parsing' | 'success' | 'partial' | 'failed'

export interface ImportBatch {
  batchId: string
  bizType: 'student' | 'teacher' | 'textbook' | 'course' | 'change'
  fileName: string
  status: BatchStatus
  progressPct: number
  totalRows: number
  successRows: number
  errorRows: number
  message: string
  createdAt: string
  /** 错误行预览（前 N 行，万行走错误明细下载） */
  errorPreview: { row: number; reason: string }[]
}

/* ---------------- 异动申请 ---------------- */
export type ChangeStatus = 'pending' | 'approved' | 'rejected'

export interface ChangeRequest {
  id: number
  batchId: string | null
  semesterId: number
  studentNo: string
  studentName: string
  type: 'transfer_in' | 'transfer_out' | 'suspend' | 'resume' | 'info_fix'
  reason: string
  submitterName: string
  status: ChangeStatus
  /** 系统字段审查结果 */
  fieldCheck: FieldCheckItem[] | null
  reviewComment: string | null
  reviewedBy: string | null
  createdAt: string
}

/* ---------------- 教师填报（两级审查） ---------------- */
export type OrderFormStatus = 'draft' | 'pending_review' | 'reviewed' | 'rejected'

export interface OrderFormItem {
  id: number
  courseId: number
  courseName: string
  classId: number
  className: string
  textbookId: number
  textbookTitle: string
  isbn: string
  price: number
  quantity: number
}

export interface OrderForm {
  id: number
  semesterId: number
  teacherId: number
  teacherName: string
  collegeId: number
  collegeName: string
  status: OrderFormStatus
  items: OrderFormItem[]
  /** 系统字段审查结果（逐字段） */
  fieldCheck: FieldCheckItem[] | null
  reviewComment: string | null
  reviewedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface FieldCheckItem {
  field: string
  rule: string
  passed: boolean
  message: string
}

/* ---------------- 学生选购 ---------------- */
export interface StudentOrderItem {
  textbookId: number
  textbookTitle: string
  isbn: string
  price: number
  edition: string
  publisher: string
  author: string
  required: boolean
  quantity: number
  checked: boolean
}

export interface StudentOrder {
  id: number
  semesterId: number
  semesterName: string
  studentId: number
  classId: number
  className: string
  items: StudentOrderItem[]
  totalAmount: number
  totalQuantity: number
  submittedAt: string
}

/* ---------------- 通知 ---------------- */
export interface NoticeTask {
  id: number
  title: string
  content: string
  /** manual=手动创建；system=窗口变更自动创建（只读） */
  source: 'manual' | 'system'
  scope: string
  status: 'sending' | 'finished' | 'closed'
  totalCount: number
  sentCount: number
  confirmedCount: number
  failedCount: number
  createdAt: string
}

export interface NoticeFailure {
  id: number
  taskId: number
  userName: string
  userNo: string
  role: RoleCode
  reason: string
  round: number
  createdAt: string
}

/* ---------------- 供货商 ---------------- */
export interface SupplierOrderRow {
  id: number
  title: string
  isbn: string
  teacherName: string
  collegeName: string
}

/* ---------------- 数据看板 ---------------- */
export interface DashboardStats {
  windowStatus: WindowStatus
  windowEnd: string
  semesterName: string
  colleges: {
    collegeId: number
    collegeName: string
    teacherTotal: number
    submitted: number
    reviewed: number
    studentTotal: number
    studentOrdered: number
  }[]
  pendingReviewCount: number
  unconfirmedNoticeCount: number
}

/* ---------------- 导出任务 ---------------- */
export interface ExportTask {
  taskId: string
  name: string
  status: 'pending' | 'running' | 'success' | 'failed'
  progressPct: number
  estimatedRows: number
  message: string
  createdAt: string
}
