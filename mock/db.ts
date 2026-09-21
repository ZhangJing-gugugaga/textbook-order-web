/**
 * mock 内存数据库与种子数据（仅本地开发环境）。
 * 契约冻结后由 Vite proxy 切换真实后端，页面代码零改动（SPEC §3 / Q5）。
 */
import type {
  ChangeRequest,
  ChangeStatus,
  Course,
  ImportBatch,
  Klass,
  Major,
  NoticeTask,
  OrderForm,
  OrderFormStatus,
  Person,
  RoleCode,
  Semester,
  SemesterStatus,
  Textbook,
  WindowChangeRecord,
} from '@/types'

const HOUR = 3600 * 1000
const DAY = 24 * HOUR

/** 相对当前时间构造 ISO 串，保证演示数据的窗口状态始终有效 */
function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

/**
 * 初始口令派生（PRD 功能 1 / G1 定稿：初始密码 = 学号/工号后 6 位）。
 * mock 不落任何明文口令：种子账号一律按该规则校验，与真实后端口径一致。
 */
export function initialPassword(userNo: string): string {
  return userNo.slice(-6)
}

export interface MockUser {
  id: number
  userNo: string
  name: string
  password: string
  roles: RoleCode[]
  collegeIds: number[]
  mustChangePassword: boolean
  status: 'active' | 'disabled'
}

export interface MockAccount extends MockUser {
  collegeName: string
  createdAt: string
}

export interface MockOrderForm extends OrderForm {}
export interface MockChangeRequest extends ChangeRequest {}
export interface MockStudentOrder {
  id: number
  semesterId: number
  semesterName: string
  studentId: number
  classId: number
  className: string
  items: {
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
  }[]
  totalAmount: number
  totalQuantity: number
  submittedAt: string
}

export const colleges: { id: number; name: string; code: string }[] = [
  { id: 1, name: '计算机学院', code: 'CS' },
  { id: 2, name: '经济管理学院', code: 'EM' },
  { id: 3, name: '外国语学院', code: 'FL' },
]

export const majors: Major[] = [
  { id: 11, collegeId: 1, name: '计算机科学与技术' },
  { id: 12, collegeId: 1, name: '软件工程' },
  { id: 21, collegeId: 2, name: '会计学' },
  { id: 31, collegeId: 3, name: '英语' },
]

export const classes: Klass[] = [
  { id: 101, majorId: 11, collegeId: 1, name: '计算机 2301', studentCount: 42 },
  { id: 102, majorId: 11, collegeId: 1, name: '计算机 2302', studentCount: 40 },
  { id: 103, majorId: 12, collegeId: 1, name: '软工 2301', studentCount: 38 },
  { id: 201, majorId: 21, collegeId: 2, name: '会计 2301', studentCount: 45 },
  { id: 301, majorId: 31, collegeId: 3, name: '英语 2301', studentCount: 35 },
]

export const textbooks: Textbook[] = [
  {
    id: 1,
    isbn: '9787111600115',
    title: '数据结构与算法分析',
    author: '马克·艾伦·韦斯',
    publisher: '机械工业出版社',
    edition: '第3版',
    price: 69.0,
    status: 'active',
    createdAt: iso(-30 * DAY),
  },
  {
    id: 2,
    isbn: '9787111639245',
    title: '计算机组成原理',
    author: '唐朔飞',
    publisher: '机械工业出版社',
    edition: '第2版',
    price: 55.5,
    status: 'active',
    createdAt: iso(-30 * DAY),
  },
  {
    id: 3,
    isbn: '9787302513786',
    title: '操作系统导论',
    author: 'Remzi H. Arpaci-Dusseau',
    publisher: '清华大学出版社',
    edition: '第1版',
    price: 89.0,
    status: 'active',
    createdAt: iso(-30 * DAY),
  },
  {
    id: 4,
    isbn: '9787115546081',
    title: '数据库系统概论',
    author: '王珊',
    publisher: '人民邮电出版社',
    edition: '第5版',
    price: 59.9,
    status: 'active',
    createdAt: iso(-30 * DAY),
  },
  {
    id: 5,
    isbn: '9787040498712',
    title: '高等数学（上册）',
    author: '同济大学数学系',
    publisher: '高等教育出版社',
    edition: '第7版',
    price: 46.8,
    status: 'active',
    createdAt: iso(-60 * DAY),
  },
  {
    id: 6,
    isbn: '9787040501238',
    title: '线性代数',
    author: '同济大学数学系',
    publisher: '高等教育出版社',
    edition: '第6版',
    price: 28.5,
    status: 'active',
    createdAt: iso(-60 * DAY),
  },
  {
    id: 7,
    isbn: '9787544618372',
    title: '新视野大学英语读写教程',
    author: '郑树棠',
    publisher: '上海外语教育出版社',
    edition: '第3版',
    price: 49.9,
    status: 'active',
    createdAt: iso(-60 * DAY),
  },
  {
    id: 8,
    isbn: '9787509547455',
    title: '基础会计学（旧版）',
    author: '陈国辉',
    publisher: '中国财政经济出版社',
    edition: '第2版',
    price: 36.0,
    status: 'disabled',
    createdAt: iso(-400 * DAY),
  },
]

export const courses: Course[] = [
  { id: 1, code: 'CS2301', name: '数据结构', collegeId: 1, credit: 4 },
  { id: 2, code: 'CS2302', name: '计算机组成原理', collegeId: 1, credit: 4 },
  { id: 3, code: 'CS2303', name: '操作系统', collegeId: 1, credit: 3.5 },
  { id: 4, code: 'MA2301', name: '高等数学', collegeId: 1, credit: 5 },
  { id: 5, code: 'EM2301', name: '基础会计学', collegeId: 2, credit: 3 },
]

export const assignments: (Omit<import('@/types').TeachingAssignment, 'id'> & { id: number })[] = [
  {
    id: 1,
    courseId: 1,
    courseName: '数据结构',
    teacherId: 4,
    teacherName: '王老师',
    classId: 101,
    className: '计算机 2301',
    collegeId: 1,
    semesterId: 1,
  },
  {
    id: 2,
    courseId: 1,
    courseName: '数据结构',
    teacherId: 4,
    teacherName: '王老师',
    classId: 102,
    className: '计算机 2302',
    collegeId: 1,
    semesterId: 1,
  },
  {
    id: 3,
    courseId: 2,
    courseName: '计算机组成原理',
    teacherId: 4,
    teacherName: '王老师',
    classId: 101,
    className: '计算机 2301',
    collegeId: 1,
    semesterId: 1,
  },
  {
    id: 4,
    courseId: 3,
    courseName: '操作系统',
    teacherId: 4,
    teacherName: '王老师',
    classId: 103,
    className: '软工 2301',
    collegeId: 1,
    semesterId: 1,
  },
  {
    id: 5,
    courseId: 5,
    courseName: '基础会计学',
    teacherId: 8,
    teacherName: '赵会计',
    classId: 201,
    className: '会计 2301',
    collegeId: 2,
    semesterId: 1,
  },
  {
    id: 6,
    courseId: 4,
    courseName: '高等数学',
    teacherId: 9,
    teacherName: '孙数学',
    classId: 101,
    className: '计算机 2301',
    collegeId: 1,
    semesterId: 1,
  },
]

/** 学期：2026-2027-1 为当前 active 学期，窗口开放中（用于三态演示） */
export const semesters: Semester[] = [
  {
    id: 1,
    name: '2026-2027 学年第一学期',
    startDate: '2026-09-01',
    endDate: '2027-01-20',
    status: 'active',
    windowStart: iso(-3 * DAY),
    windowEnd: iso(11 * DAY),
    autoOpen: true,
    autoClose: true,
    createdAt: iso(-60 * DAY),
  },
  {
    id: 2,
    name: '2026-2027 学年第二学期（预备）',
    startDate: '2027-02-20',
    endDate: '2027-07-10',
    status: 'draft',
    windowStart: '',
    windowEnd: '',
    autoOpen: true,
    autoClose: true,
    createdAt: iso(-5 * DAY),
  },
  {
    id: 3,
    name: '2025-2026 学年第二学期',
    startDate: '2026-02-23',
    endDate: '2026-07-05',
    status: 'archived',
    windowStart: iso(-210 * DAY),
    windowEnd: iso(-190 * DAY),
    autoOpen: true,
    autoClose: true,
    createdAt: iso(-300 * DAY),
  },
]

export const windowChanges: WindowChangeRecord[] = [
  {
    id: 1,
    semesterId: 1,
    action: 'activate',
    operatorName: '张教材',
    createdAt: iso(-60 * DAY),
    fromValue: 'draft',
    toValue: 'active',
  },
  {
    id: 2,
    semesterId: 1,
    action: 'open',
    operatorName: '系统（自动）',
    createdAt: iso(-3 * DAY),
    fromValue: 'not_open',
    toValue: 'open',
  },
  {
    id: 3,
    semesterId: 1,
    action: 'extend',
    operatorName: '张教材',
    createdAt: iso(-1 * DAY),
    fromValue: iso(8 * DAY),
    toValue: iso(11 * DAY),
  },
]

export const users: MockUser[] = [
  {
    id: 1,
    userNo: '900001',
    name: '张教材',
    password: initialPassword('900001'),
    roles: ['admin'],
    collegeIds: [],
    mustChangePassword: false,
    status: 'active',
  },
  {
    id: 2,
    userNo: '800001',
    name: '李秘书',
    password: initialPassword('800001'),
    roles: ['secretary'],
    collegeIds: [1],
    mustChangePassword: false,
    status: 'active',
  },
  {
    id: 3,
    userNo: '800002',
    name: '王双任',
    password: initialPassword('800002'),
    roles: ['secretary', 'teacher'],
    collegeIds: [2],
    mustChangePassword: false,
    status: 'active',
  },
  {
    id: 4,
    userNo: '700001',
    name: '王老师',
    password: initialPassword('700001'),
    roles: ['teacher'],
    collegeIds: [1],
    mustChangePassword: true,
    status: 'active',
  },
  {
    id: 5,
    userNo: '20230101',
    name: '李四',
    password: initialPassword('20230101'),
    roles: ['student'],
    collegeIds: [1],
    mustChangePassword: true,
    status: 'active',
  },
  {
    id: 6,
    userNo: '20230102',
    name: '王五',
    password: initialPassword('20230102'),
    roles: ['student'],
    collegeIds: [1],
    mustChangePassword: false,
    status: 'active',
  },
  {
    id: 7,
    userNo: '600001',
    name: '供货商A',
    password: initialPassword('600001'),
    roles: ['supplier'],
    collegeIds: [],
    mustChangePassword: false,
    status: 'active',
  },
  {
    id: 8,
    userNo: '700002',
    name: '赵会计',
    password: initialPassword('700002'),
    roles: ['teacher'],
    collegeIds: [2],
    mustChangePassword: false,
    status: 'active',
  },
  {
    id: 9,
    userNo: '700003',
    name: '孙数学',
    password: initialPassword('700003'),
    roles: ['teacher'],
    collegeIds: [1],
    mustChangePassword: false,
    status: 'active',
  },
  {
    id: 10,
    userNo: '900002',
    name: '刘教材',
    password: initialPassword('900002'),
    roles: ['admin'],
    collegeIds: [],
    mustChangePassword: false,
    status: 'disabled',
  },
]

export const accounts: MockAccount[] = users.map((user) => ({
  ...user,
  collegeName: user.collegeIds.length
    ? colleges.find((c) => c.id === user.collegeIds[0])?.name || '—'
    : '—',
  createdAt: iso(-30 * DAY),
}))

/** 师生名册（导入 + 检索演示数据） */
export const people: Person[] = [
  {
    id: 1,
    userNo: '20230101',
    name: '李四',
    type: 'student',
    gender: 'M',
    collegeId: 1,
    collegeName: '计算机学院',
    majorId: 11,
    majorName: '计算机科学与技术',
    classId: 101,
    className: '计算机 2301',
    phone: '13800000001',
    status: 'active',
  },
  {
    id: 2,
    userNo: '20230102',
    name: '王五',
    type: 'student',
    gender: 'F',
    collegeId: 1,
    collegeName: '计算机学院',
    majorId: 11,
    majorName: '计算机科学与技术',
    classId: 101,
    className: '计算机 2301',
    phone: '13800000002',
    status: 'active',
  },
  {
    id: 3,
    userNo: '20230103',
    name: '赵六',
    type: 'student',
    gender: 'M',
    collegeId: 1,
    collegeName: '计算机学院',
    majorId: 11,
    majorName: '计算机科学与技术',
    classId: 102,
    className: '计算机 2302',
    phone: '13800000003',
    status: 'active',
  },
  {
    id: 4,
    userNo: '20230201',
    name: '钱七',
    type: 'student',
    gender: 'F',
    collegeId: 1,
    collegeName: '计算机学院',
    majorId: 12,
    majorName: '软件工程',
    classId: 103,
    className: '软工 2301',
    phone: '13800000004',
    status: 'active',
  },
  {
    id: 5,
    userNo: '20230301',
    name: '孙八',
    type: 'student',
    gender: 'M',
    collegeId: 2,
    collegeName: '经济管理学院',
    majorId: 21,
    majorName: '会计学',
    classId: 201,
    className: '会计 2301',
    phone: '13800000005',
    status: 'active',
  },
  {
    id: 6,
    userNo: '700001',
    name: '王老师',
    type: 'teacher',
    gender: 'M',
    collegeId: 1,
    collegeName: '计算机学院',
    majorId: null,
    majorName: '',
    classId: null,
    className: '',
    phone: '13900000001',
    status: 'active',
  },
  {
    id: 7,
    userNo: '700002',
    name: '赵会计',
    type: 'teacher',
    gender: 'F',
    collegeId: 2,
    collegeName: '经济管理学院',
    majorId: null,
    majorName: '',
    classId: null,
    className: '',
    phone: '13900000002',
    status: 'active',
  },
  {
    id: 8,
    userNo: '700003',
    name: '孙数学',
    type: 'teacher',
    gender: 'M',
    collegeId: 1,
    collegeName: '计算机学院',
    majorId: null,
    majorName: '',
    classId: null,
    className: '',
    phone: '13900000003',
    status: 'active',
  },
]

/** 教师征订单（两级审查各状态样本） */
export const orderForms: MockOrderForm[] = [
  {
    id: 1001,
    semesterId: 1,
    teacherId: 4,
    teacherName: '王老师',
    collegeId: 1,
    collegeName: '计算机学院',
    status: 'pending_review',
    items: [
      {
        id: 1,
        courseId: 1,
        courseName: '数据结构',
        classId: 101,
        className: '计算机 2301',
        textbookId: 1,
        textbookTitle: '数据结构与算法分析',
        isbn: '9787111600115',
        price: 69.0,
        quantity: 42,
      },
      {
        id: 2,
        courseId: 1,
        courseName: '数据结构',
        classId: 101,
        className: '计算机 2301',
        textbookId: 4,
        textbookTitle: '数据库系统概论',
        isbn: '9787115546081',
        price: 59.9,
        quantity: 42,
      },
    ],
    fieldCheck: [
      { field: '教材', rule: 'textbook_in_stock', passed: true, message: '教材在库' },
      { field: '数量', rule: 'quantity_gt_zero', passed: true, message: '数量大于 0' },
      {
        field: '数量',
        rule: 'quantity_lte_class_size',
        passed: true,
        message: '数量未超过班级人数 42',
      },
      { field: '课程归属', rule: 'course_ownership', passed: true, message: '课程属于本教师' },
      {
        field: '任课关联',
        rule: 'teaching_exists',
        passed: true,
        message: '课程 × 班级任课关系存在',
      },
      { field: 'ISBN', rule: 'isbn_format', passed: true, message: 'ISBN 格式正确' },
    ],
    reviewComment: null,
    reviewedBy: null,
    createdAt: iso(-2 * DAY),
    updatedAt: iso(-2 * DAY),
  },
  {
    id: 1002,
    semesterId: 1,
    teacherId: 4,
    teacherName: '王老师',
    collegeId: 1,
    collegeName: '计算机学院',
    status: 'reviewed',
    items: [
      {
        id: 3,
        courseId: 2,
        courseName: '计算机组成原理',
        classId: 101,
        className: '计算机 2301',
        textbookId: 2,
        textbookTitle: '计算机组成原理',
        isbn: '9787111639245',
        price: 55.5,
        quantity: 40,
      },
    ],
    fieldCheck: [
      { field: '教材', rule: 'textbook_in_stock', passed: true, message: '教材在库' },
      { field: '数量', rule: 'quantity_gt_zero', passed: true, message: '数量大于 0' },
    ],
    reviewComment: '同意',
    reviewedBy: '张教材',
    createdAt: iso(-6 * DAY),
    updatedAt: iso(-5 * DAY),
  },
  {
    id: 1003,
    semesterId: 1,
    teacherId: 4,
    teacherName: '王老师',
    collegeId: 1,
    collegeName: '计算机学院',
    status: 'rejected',
    items: [
      {
        id: 4,
        courseId: 3,
        courseName: '操作系统',
        classId: 103,
        className: '软工 2301',
        textbookId: 3,
        textbookTitle: '操作系统导论',
        isbn: '9787302513786',
        price: 89.0,
        quantity: 60,
      },
    ],
    fieldCheck: [
      { field: '教材', rule: 'textbook_in_stock', passed: true, message: '教材在库' },
      {
        field: '数量',
        rule: 'quantity_lte_class_size',
        passed: false,
        message: '数量 60 超过班级人数上限 38，请核对',
      },
    ],
    reviewComment: '数量与班级人数不符，请核对',
    reviewedBy: '张教材',
    createdAt: iso(-4 * DAY),
    updatedAt: iso(-1 * DAY),
  },
  {
    id: 1004,
    semesterId: 1,
    teacherId: 8,
    teacherName: '赵会计',
    collegeId: 2,
    collegeName: '经济管理学院',
    status: 'pending_review',
    items: [
      {
        id: 5,
        courseId: 5,
        courseName: '基础会计学',
        classId: 201,
        className: '会计 2301',
        textbookId: 8,
        textbookTitle: '基础会计学（旧版）',
        isbn: '9787509547455',
        price: 36.0,
        quantity: 45,
      },
    ],
    fieldCheck: [
      {
        field: '教材',
        rule: 'textbook_in_stock',
        passed: false,
        message: '教材已停用，请改用新版教材',
      },
      { field: '数量', rule: 'quantity_gt_zero', passed: true, message: '数量大于 0' },
    ],
    reviewComment: null,
    reviewedBy: null,
    createdAt: iso(-1 * DAY),
    updatedAt: iso(-1 * DAY),
  },
  {
    id: 1005,
    semesterId: 3,
    teacherId: 9,
    teacherName: '孙数学',
    collegeId: 1,
    collegeName: '计算机学院',
    status: 'reviewed',
    items: [
      {
        id: 6,
        courseId: 4,
        courseName: '高等数学',
        classId: 101,
        className: '计算机 2301',
        textbookId: 5,
        textbookTitle: '高等数学（上册）',
        isbn: '9787040498712',
        price: 46.8,
        quantity: 42,
      },
    ],
    fieldCheck: [{ field: '教材', rule: 'textbook_in_stock', passed: true, message: '教材在库' }],
    reviewComment: '同意',
    reviewedBy: '张教材',
    createdAt: iso(-200 * DAY),
    updatedAt: iso(-199 * DAY),
  },
]

/** 按班级带出的教材清单（学生选书页） */
export function classBooks(classId: number): MockStudentOrder['items'] {
  if (classId === 101) {
    return [
      {
        textbookId: 1,
        textbookTitle: '数据结构与算法分析',
        isbn: '9787111600115',
        price: 69.0,
        edition: '第3版',
        publisher: '机械工业出版社',
        author: '马克·艾伦·韦斯',
        required: true,
        quantity: 1,
        checked: true,
      },
      {
        textbookId: 4,
        textbookTitle: '数据库系统概论',
        isbn: '9787115546081',
        price: 59.9,
        edition: '第5版',
        publisher: '人民邮电出版社',
        author: '王珊',
        required: false,
        quantity: 1,
        checked: false,
      },
      {
        textbookId: 5,
        textbookTitle: '高等数学（上册）',
        isbn: '9787040498712',
        price: 46.8,
        edition: '第7版',
        publisher: '高等教育出版社',
        author: '同济大学数学系',
        required: true,
        quantity: 1,
        checked: true,
      },
    ]
  }
  return [
    {
      textbookId: 3,
      textbookTitle: '操作系统导论',
      isbn: '9787302513786',
      price: 89.0,
      edition: '第1版',
      publisher: '清华大学出版社',
      author: 'Remzi H. Arpaci-Dusseau',
      required: false,
      quantity: 1,
      checked: false,
    },
    {
      textbookId: 6,
      textbookTitle: '线性代数',
      isbn: '9787040501238',
      price: 28.5,
      edition: '第6版',
      publisher: '高等教育出版社',
      author: '同济大学数学系',
      required: false,
      quantity: 1,
      checked: false,
    },
  ]
}

export const studentOrders: MockStudentOrder[] = [
  {
    id: 2001,
    semesterId: 1,
    semesterName: '2026-2027 学年第一学期',
    studentId: 6,
    classId: 101,
    className: '计算机 2301',
    items: classBooks(101),
    totalAmount: 115.8,
    totalQuantity: 2,
    submittedAt: iso(-2 * DAY),
  },
  {
    id: 2002,
    semesterId: 3,
    semesterName: '2025-2026 学年第二学期',
    studentId: 6,
    classId: 101,
    className: '计算机 2301',
    items: classBooks(101),
    totalAmount: 69.0,
    totalQuantity: 1,
    submittedAt: iso(-195 * DAY),
  },
]

export const changeRequests: MockChangeRequest[] = [
  {
    id: 3001,
    batchId: null,
    semesterId: 1,
    studentNo: '20230101',
    studentName: '李四',
    type: 'transfer_in',
    reason: '由机械学院转入',
    submitterName: '李秘书',
    status: 'pending',
    fieldCheck: [
      { field: '学号', rule: 'student_exists', passed: true, message: '学生存在' },
      { field: '异动类型', rule: 'type_valid', passed: true, message: '类型合法' },
      { field: '原因', rule: 'reason_required', passed: true, message: '原因已填写' },
    ],
    reviewComment: null,
    reviewedBy: null,
    createdAt: iso(-1 * DAY),
  },
  {
    id: 3002,
    batchId: null,
    semesterId: 1,
    studentNo: '20230103',
    studentName: '赵六',
    type: 'suspend',
    reason: '因病休学一年',
    submitterName: '李秘书',
    status: 'approved',
    fieldCheck: [
      { field: '学号', rule: 'student_exists', passed: true, message: '学生存在' },
      { field: '原因', rule: 'reason_required', passed: true, message: '原因已填写' },
    ],
    reviewComment: '情况属实，同意',
    reviewedBy: '张教材',
    createdAt: iso(-5 * DAY),
  },
  {
    id: 3003,
    batchId: 'CRB-20260920-001',
    semesterId: 1,
    studentNo: '20230201',
    studentName: '钱七',
    type: 'info_fix',
    reason: '姓名变更：钱七 → 钱小七',
    submitterName: '李秘书',
    status: 'pending',
    fieldCheck: [
      { field: '学号', rule: 'student_exists', passed: true, message: '学生存在' },
      { field: '原因', rule: 'reason_required', passed: true, message: '原因已填写' },
    ],
    reviewComment: null,
    reviewedBy: null,
    createdAt: iso(-2 * DAY),
  },
  {
    id: 3004,
    batchId: 'CRB-20260920-001',
    semesterId: 1,
    studentNo: '20230301',
    studentName: '孙八',
    type: 'resume',
    reason: '休学期满复学',
    submitterName: '李秘书',
    status: 'rejected',
    fieldCheck: [
      {
        field: '学号',
        rule: 'student_exists',
        passed: false,
        message: '学号 20230301 不在本院名册，请核对',
      },
      { field: '原因', rule: 'reason_required', passed: true, message: '原因已填写' },
    ],
    reviewComment: '该生不在本院名册，请与教务处核对后再提交',
    reviewedBy: '张教材',
    createdAt: iso(-2 * DAY),
  },
]

export const noticeTasks: NoticeTask[] = [
  {
    id: 4001,
    title: '教材征订窗口已开启',
    content:
      '本学期教材征订窗口已开启，请在截止时间前完成教材需求填报/选购。窗口截止时间如有变更将另行通知。',
    source: 'system',
    scope: '全员（秘书+教师+学生）',
    status: 'sending',
    totalCount: 3,
    sentCount: 3,
    confirmedCount: 1,
    failedCount: 0,
    createdAt: iso(-3 * DAY),
  },
  {
    id: 4002,
    title: '征订窗口已延长',
    content: '应教师反馈，本期征订窗口延长至新的截止时间，请尽快提交。',
    source: 'system',
    scope: '全员（秘书+教师+学生）',
    status: 'sending',
    totalCount: 3,
    sentCount: 3,
    confirmedCount: 0,
    failedCount: 1,
    createdAt: iso(-1 * DAY),
  },
  {
    id: 4003,
    title: '请尽快完成教材填报',
    content: '尚未提交教材需求的老师请尽快在窗口期内完成填报，逾期窗口关闭后将无法提交。',
    source: 'manual',
    scope: '仅任课教师',
    status: 'finished',
    totalCount: 3,
    sentCount: 3,
    confirmedCount: 2,
    failedCount: 0,
    createdAt: iso(-2 * DAY),
  },
]

/** 未确认通知（按用户维度：教师/学生样本） */
export const unconfirmedByUser: Record<string, number[]> = {
  '700001': [4002],
  '20230102': [4001, 4002],
  '800001': [4001],
}

export const importBatches: ImportBatch[] = [
  {
    batchId: 'IMB-20260918-001',
    bizType: 'student',
    fileName: '学生全量表.xlsx',
    status: 'partial',
    progressPct: 100,
    totalRows: 3,
    successRows: 2,
    errorRows: 1,
    message: '1 行学号格式错误',
    createdAt: iso(-3 * DAY),
    errorPreview: [{ row: 12, reason: '学号格式不正确（应为 8 位数字）' }],
  },
  {
    batchId: 'IMB-20260918-002',
    bizType: 'textbook',
    fileName: '教材库.xlsx',
    status: 'success',
    progressPct: 100,
    totalRows: 8,
    successRows: 8,
    errorRows: 0,
    message: '',
    createdAt: iso(-4 * DAY),
    errorPreview: [],
  },
]

/** 会话 token 表：token → 用户工号 */
export const tokens = new Map<string, string>()

export const db = {
  colleges,
  majors,
  classes,
  textbooks,
  courses,
  assignments,
  semesters,
  windowChanges,
  users,
  accounts,
  people,
  orderForms,
  studentOrders,
  changeRequests,
  noticeTasks,
  unconfirmedByUser,
  importBatches,
  tokens,
}

export { iso, DAY, HOUR }
export type { SemesterStatus, OrderFormStatus, ChangeStatus, ImportBatch }
