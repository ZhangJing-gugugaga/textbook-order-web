import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth'
import { CODE, COPY } from '@/utils/constants'

/**
 * 首登阶段不得切换身份（交接文档 A2）：
 * 后端首登放行清单是**显式枚举**，`POST /api/auth/switch-role` 不在其中
 * （它会重发 access/refresh，等于让未完成首登的会话拿到新的长效令牌），
 * 调用只会拿到 403 FIRST_LOGIN_REQUIRED。store 做前置拦截，不发这个必然失败的请求。
 */
const switchRole = vi.fn()
const profile = vi.fn()
vi.mock('@/api/auth', () => ({
  authApi: {
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    firstLoginVerify: vi.fn(),
    switchRole: (...args: unknown[]) => switchRole(...args),
  },
  meApi: {
    profile: () => profile(),
    permissions: vi.fn(),
    changePassword: vi.fn(),
  },
}))

/** GET /me 的真实形状（切换身份后重拉，权限码按新身份下发） */
const PROFILE = {
  userId: 9,
  userNo: '700103',
  name: '教师戊',
  openidBound: false,
  roles: ['TEACHER', 'SECRETARY'] as const,
  currentRole: 'SECRETARY' as const,
  permissions: ['semester:window:view', 'order:form:view:college'],
  mustChangePassword: 0,
  firstLoginVerified: 1,
}

describe('auth store · 首登与切换身份', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    switchRole.mockReset()
    profile.mockReset()
    profile.mockResolvedValue({ ...PROFILE, roles: [...PROFILE.roles] })
    switchRole.mockResolvedValue({
      accessToken: 'a2',
      refreshToken: 'r2',
      roles: ['TEACHER', 'SECRETARY'],
      currentRole: 'SECRETARY',
      mustChangePassword: false,
      firstLoginVerified: true,
      expiresIn: 900,
      userNo: '700103',
      name: '教师戊',
    })
  })

  it('首登待改密时 switchRole 直接拒绝，且不发请求', async () => {
    const auth = useAuthStore()
    auth.mustChangePassword = true
    auth.roles = ['TEACHER', 'SECRETARY']

    await expect(auth.switchRole('SECRETARY')).rejects.toMatchObject({
      code: CODE.FIRST_LOGIN_REQUIRED,
      message: COPY.FIRST_LOGIN_REQUIRED,
    })
    expect(switchRole).not.toHaveBeenCalled()
  })

  it('首登完成后可正常切换身份', async () => {
    const auth = useAuthStore()
    auth.mustChangePassword = false
    auth.roles = ['TEACHER', 'SECRETARY']

    await auth.switchRole('SECRETARY')

    expect(switchRole).toHaveBeenCalledWith('SECRETARY')
    expect(auth.currentRole).toBe('SECRETARY')
    expect(auth.accessToken).toBe('a2')
  })

  it('applyProfile 把 mustChangePassword=1 归一为 true（首登拦截的唯一依据）', () => {
    const auth = useAuthStore()
    auth.applyProfile({
      userId: 8,
      userNo: '700102',
      name: '教师乙',
      openidBound: false,
      roles: ['TEACHER'],
      currentRole: 'TEACHER',
      permissions: [],
      mustChangePassword: 1,
      firstLoginVerified: 0,
    })

    expect(auth.mustChangePassword).toBe(true)
    expect(auth.mustVerifyFirstLogin).toBe(true)
  })
})
