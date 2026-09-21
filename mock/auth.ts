import type { MockMethod } from 'vite-plugin-mock'
import { CODE } from '../src/utils/constants'
import { db, iso, DAY } from './db'
import type { MockUser } from './db'

/**
 * 公共响应构造：统一 { code, message, data } 包络。
 * 错误码与 src/utils/constants.ts 的 CODE 保持一致（401 三类细分 / 403 / 409 / 422）。
 */
export function ok<T>(data: T, message = 'ok') {
  return { code: CODE.OK, message, data }
}

export function fail(message: string, code = 40000, data?: unknown) {
  return { code, message, data }
}

/** 从路径/查询参数对象取值 */
export function param(params: Record<string, unknown>, name: string): string {
  return String(params?.[name] ?? '')
}

export function num(params: Record<string, unknown>, name: string, fallback = 0): number {
  const value = Number(params?.[name])
  return Number.isFinite(value) && value !== 0 ? value : fallback
}

/** 分页参数（服务端分页强制，page/size） */
export function pageParams(
  body: Record<string, unknown>,
  params: Record<string, unknown>,
): { page: number; size: number; source: Record<string, unknown> } {
  const source = { ...params, ...body }
  return {
    page: Math.max(1, Number(source.page) || 1),
    size: Math.min(100, Math.max(1, Number(source.size) || 10)),
    source,
  }
}

/** 服务端分页切片 */
export function paginate<T>(list: T[], page: number, size: number) {
  const start = (page - 1) * size
  return { list: list.slice(start, start + size), total: list.length }
}

/** 当前登录用户（解析 Authorization: Bearer <token>） */
export function currentUser(headers: Record<string, unknown>): MockUser | null {
  const auth = String(headers?.authorization ?? '')
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const userNo = db.tokens.get(token)
  if (!userNo) return null
  return db.users.find((user) => user.userNo === userNo) ?? null
}

export interface MockCtx {
  body: Record<string, unknown>
  /** 路径参数与查询参数（vite-plugin-mock 合并后置于 query） */
  params: Record<string, unknown>
  headers: Record<string, unknown>
}

/** 包装需要登录的响应函数：未登录统一返回 40101 */
export function withAuth(handler: (ctx: MockCtx) => unknown) {
  return (ctx: {
    body: Record<string, unknown>
    query: Record<string, unknown>
    headers: Record<string, unknown>
  }) => {
    if (!currentUser(ctx.headers)) {
      return fail('登录已过期，请重新登录', CODE.ACCESS_EXPIRED)
    }
    return handler({ body: ctx.body, params: ctx.query, headers: ctx.headers })
  }
}

/** 生成 access token */
export function makeToken(userNo: string): string {
  const token = `mock.${Buffer.from(`${userNo}.${Date.now()}.${Math.random()}`).toString('base64url')}`
  db.tokens.set(token, userNo)
  return token
}

export function rolePermissions(user: MockUser): string[] {
  // 与 src/utils/constants.ts 的 ROLE_PERMISSIONS 保持一致
  const map: Record<string, string[]> = {
    admin: [
      'dashboard:view',
      'sys:user:manage',
      'org:manage',
      'semester:manage',
      'textbook:manage',
      'course:manage',
      'people:manage',
      'change:approve',
      'review:form',
      'data:order:view',
      'export:center',
      'notice:task:manage',
    ],
    secretary: ['data:college:view', 'export:college', 'window:view', 'change:submit'],
    teacher: ['order:form:view', 'order:form:fill', 'change:submit'],
    student: ['student:order:fill', 'student:order:view'],
    supplier: ['supplier:list:view', 'supplier:export'],
  }
  const perms = new Set<string>()
  for (const role of user.roles) for (const perm of map[role] ?? []) perms.add(perm)
  return [...perms]
}

export function userPayload(user: MockUser) {
  return {
    id: user.id,
    userNo: user.userNo,
    name: user.name,
    roles: user.roles,
    currentRole: user.roles[0],
    collegeIds: user.collegeIds,
    mustChangePassword: user.mustChangePassword,
  }
}

export { iso, DAY }

/* ---------------- 会话与个人信息 ---------------- */
const authMocks: MockMethod[] = [
  {
    url: '/api/auth/login',
    method: 'post',
    response: ({ body }: { body: Record<string, unknown> }) => {
      const userNo = String(body?.userNo ?? '').trim()
      const password = String(body?.password ?? '')
      const user = db.users.find((item) => item.userNo === userNo)
      if (!user || user.password !== password) {
        return fail('账号或密码不正确', 40001)
      }
      if (user.status === 'disabled') {
        return fail('账号已停用，请联系教材室', CODE.ACCOUNT_DISABLED)
      }
      const token = makeToken(user.userNo)
      return ok({
        accessToken: token,
        user: userPayload(user),
        permissions: rolePermissions(user),
        roleVersion: 1,
      })
    },
  },
  {
    url: '/api/auth/refresh',
    method: 'post',
    response: ({ headers }: { headers: Record<string, unknown> }) => {
      const auth = String(headers?.authorization ?? '')
      const old = auth.replace(/^Bearer\s+/i, '')
      const userNo = db.tokens.get(old)
      if (!userNo) {
        return fail('登录已过期，请重新登录', CODE.REFRESH_INVALID)
      }
      const user = db.users.find((item) => item.userNo === userNo)
      if (!user) return fail('登录已过期，请重新登录', CODE.REFRESH_INVALID)
      if (user.status === 'disabled') return fail('账号已停用，请联系教材室', CODE.ACCOUNT_DISABLED)
      db.tokens.delete(old)
      return ok({ accessToken: makeToken(user.userNo) })
    },
  },
  {
    url: '/api/auth/logout',
    method: 'post',
    response: ({ headers }: { headers: Record<string, unknown> }) => {
      const auth = String(headers?.authorization ?? '')
      db.tokens.delete(auth.replace(/^Bearer\s+/i, ''))
      return ok(null)
    },
  },
  {
    url: '/api/me',
    method: 'get',
    response: withAuth(({ headers }) => {
      const user = currentUser(headers)!
      return ok(userPayload(user))
    }),
  },
  {
    url: '/api/me/permissions',
    method: 'get',
    response: withAuth(({ headers }) => {
      const user = currentUser(headers)!
      return ok({
        roles: user.roles,
        permissions: rolePermissions(user),
        currentRole: user.roles[0],
        roleVersion: 1,
      })
    }),
  },
  {
    url: '/api/me/password',
    method: 'put',
    response: withAuth(({ headers, body }) => {
      const user = currentUser(headers)!
      if (body?.oldPassword !== user.password) {
        return fail('原密码不正确', 40002)
      }
      const next = String(body?.newPassword ?? '')
      if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(next)) {
        return fail('新密码需 8 位以上且含字母和数字', 40003)
      }
      user.password = next
      user.mustChangePassword = false
      return ok(null, '密码修改成功')
    }),
  },
  {
    url: '/api/me/switch-role',
    method: 'post',
    response: withAuth(({ headers, body }) => {
      const user = currentUser(headers)!
      const role = String(body?.role ?? '')
      if (!user.roles.includes(role as MockUser['roles'][number])) {
        return fail('无权切换到该身份', CODE.FORBIDDEN)
      }
      // 切换身份：角色版本号 +1（演示「账号信息已变更」时可由后端返回 40103）
      return ok({
        roles: user.roles,
        permissions: rolePermissions(user),
        currentRole: role,
        roleVersion: 1,
      })
    }),
  },
  {
    url: '/api/system-config',
    method: 'get',
    response: () =>
      ok({
        quantityMax: 100,
        stepMax: 9,
        importMaxSizeMb: 10,
        exportSyncMaxRows: 5000,
      }),
  },
]

export default authMocks
