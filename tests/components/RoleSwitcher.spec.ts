import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ElementPlus, { ElMessage } from 'element-plus'

import RoleSwitcher from '@/components/RoleSwitcher.vue'
import { useAuthStore } from '@/stores/auth'
import { useNoticeStore } from '@/stores/notice'
import { useWindowStore } from '@/stores/window'
import { PERMISSIONS } from '@/utils/constants'
import type { RoleCode } from '@/types'

/**
 * 切换身份（SPEC §8 / A4-A）。
 *
 * 关键约束（评审 A4-A 的验收点）：
 *   1. 切换成功后必须走**清理序列**：清通知队列 → 停窗口轮询 → 按新身份重算落地页；
 *   2. 选中项与当前身份相同时**不发请求**（避免无谓的令牌轮换）；
 *   3. 失败要弹错且不跳转（否则用户会停在半截状态）。
 */
const replace = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ replace }) }))
vi.mock('@/api/auth', () => ({
  authApi: { switchRole: vi.fn(), login: vi.fn(), refresh: vi.fn(), logout: vi.fn() },
  meApi: { changePassword: vi.fn(), profile: vi.fn() },
}))

import { authApi, meApi } from '@/api/auth'

const switchRole = vi.mocked(authApi.switchRole)
const profile = vi.mocked(meApi.profile)

/** switchRole 成功后 store 会再拉一次 /me 覆盖权限（applyProfile 的形状） */
function profileOf(role: RoleCode, permissions: string[]) {
  return {
    id: 1,
    userNo: '700103',
    userName: '多角色账号',
    roles: [role],
    currentRole: role,
    permissions,
    mustChangePassword: 0,
    firstLoginVerified: 1,
  } as never
}

/** 后端 switch-role 的最小响应形状 */
function switchResult(role: RoleCode, permissions: string[]) {
  return {
    accessToken: `at-${role}`,
    refreshToken: `rt-${role}`,
    expiresIn: 1800,
    userNo: '700103',
    name: '多角色账号',
    currentRole: role,
    roles: [role],
    mustChangePassword: false,
    firstLoginVerified: true,
    permissions,
  }
}

async function mountSwitcher() {
  // el-dialog 用 append-to-body（teleport 到 body）且内容是懒渲染，
  // 故挂到 body 后等一拍，再从 document 查询
  const wrapper = mount(RoleSwitcher, {
    props: { modelValue: true },
    attachTo: document.body,
    global: { plugins: [ElementPlus] },
  })
  await nextTick()
  await flushPromises()
  return wrapper
}

/** 弹窗内的按钮（teleport 后在 document 里，不在 wrapper.vm.$el 内） */
function dialogButton(text: string): HTMLElement {
  const buttons = [...document.body.querySelectorAll('.el-dialog .el-button')] as HTMLElement[]
  const hit = buttons.find((b) => b.textContent?.includes(text))
  if (!hit) throw new Error(`弹窗内找不到按钮：${text}`)
  return hit
}

/** 弹窗内的角色单选项 */
function roleRadios(): HTMLElement[] {
  return [...document.body.querySelectorAll('.el-dialog .el-radio')] as HTMLElement[]
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
  vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
})

describe('RoleSwitcher 切换身份', () => {
  it('切换成功后走清理序列：清通知 → 停轮询 → 跳新身份落地页', async () => {
    const auth = useAuthStore()
    auth.roles = ['SECRETARY', 'TEACHER']
    auth.currentRole = 'SECRETARY'
    auth.permissions = [PERMISSIONS.ORDER_FORM_VIEW_COLLEGE]
    switchRole.mockResolvedValue(switchResult('TEACHER', [PERMISSIONS.ORDER_FORM_SUBMIT]))
    profile.mockResolvedValue(profileOf('TEACHER', [PERMISSIONS.ORDER_FORM_SUBMIT]))

    const notice = useNoticeStore()
    const win = useWindowStore()
    const resetSpy = vi.spyOn(notice, 'reset')
    const stopSpy = vi.spyOn(win, 'stopPolling')

    const wrapper = await mountSwitcher()
    // 选中教师（第二个单选项）
    await roleRadios()[1].click()
    await dialogButton('确认切换').click()
    await flushPromises()

    expect(switchRole).toHaveBeenCalledWith('TEACHER')
    expect(resetSpy).toHaveBeenCalled()
    expect(stopSpy).toHaveBeenCalled()
    // 新身份持 order:form:submit → 落地「我的课程」
    expect(replace).toHaveBeenCalledWith('/my-courses')
    expect(ElMessage.success).toHaveBeenCalledWith('已切换身份')
    wrapper.unmount()
  })

  it('选中项与当前身份相同：不发请求、不跳转（避免无谓的令牌轮换）', async () => {
    const auth = useAuthStore()
    auth.roles = ['SECRETARY', 'TEACHER']
    auth.currentRole = 'SECRETARY'

    const wrapper = await mountSwitcher()
    // 默认选中当前身份（SECRETARY），直接确认
    await dialogButton('确认切换').click()
    await flushPromises()

    expect(switchRole).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('切换失败：弹错、不跳转、弹窗保持打开', async () => {
    const auth = useAuthStore()
    auth.roles = ['SECRETARY', 'TEACHER']
    auth.currentRole = 'SECRETARY'
    switchRole.mockRejectedValue(new Error('首登阶段不允许切换身份'))

    const wrapper = await mountSwitcher()
    await roleRadios()[1].click()
    await dialogButton('确认切换').click()
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith('首登阶段不允许切换身份')
    expect(replace).not.toHaveBeenCalled()
    // 弹窗未关闭（v-model 未回写 false）
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })
})
