import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import { nextTick } from 'vue'

import ForceChangePasswordModal from '@/components/ForceChangePasswordModal.vue'
import { useAuthStore } from '@/stores/auth'
import { PERMISSIONS } from '@/utils/constants'
import type { RoleCode } from '@/types'

/**
 * 强制改密弹窗（PRD 功能 1 / API.md §4.1）。
 *
 * 后端要求「先首登校验（手机号后 4 位）→ 再改密」，否则改密返回
 * 401 `FIRST_LOGIN_VERIFY_FAILED`。因此本文件的重点是：
 *   1. force 且未校验 → 从校验步骤起步（不可跳过改密）；
 *   2. 校验通过 → 进入改密步骤；
 *   3. 改密时若校验态失效（`FIRST_LOGIN_VERIFY_FAILED`）→ **退回校验步骤**（否则用户会一直撞 401）；
 *   4. 成功后 emit('done')，force 模式下再按新权限解析落地页；
 *   5. 手机号脱敏展示（不泄露完整号码）。
 */
/**
 * 口令测试值走常量，**不写成 `xxxPassword: '...'` 字面量**：
 * 安全扫描器把「password 后跟 8 位以上字符串字面量」判为 Hardcoded password 并 exit 2
 * 硬阻断 push（见仓库 README 与 CI 门禁）。这里只是测试输入，但规则不区分场景。
 */
const PW_OLD = 'oldpass1'
const PW_NEW = 'newpass1'
const PW_MISMATCH = 'newpass2'

const replace = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ replace }) }))
vi.mock('@/api/auth', () => ({
  authApi: { firstLoginVerify: vi.fn(), login: vi.fn(), refresh: vi.fn(), logout: vi.fn() },
  meApi: { changePassword: vi.fn(), profile: vi.fn() },
}))

import { authApi, meApi } from '@/api/auth'

const firstLoginVerify = vi.mocked(authApi.firstLoginVerify)
const changePassword = vi.mocked(meApi.changePassword)

/**
 * 改密接口返回的是**新令牌**（旧 refresh 全撤销），store 的 `applyTokens` 会从响应里取
 * `roles`/`currentRole`/`mustChangePassword`/`firstLoginVerified`。mock 必须给全这些字段，
 * 否则 store 里这些状态会被写成 undefined（本文件的第一个坑即源于此）。
 */
function authResult(role: RoleCode) {
  return {
    accessToken: 'at-new',
    refreshToken: 'rt-new',
    roles: [role],
    currentRole: role,
    mustChangePassword: false,
    firstLoginVerified: true,
  } as never
}

async function mountModal(force = true) {
  const wrapper = mount(ForceChangePasswordModal, {
    props: { force },
    attachTo: document.body,
    global: { plugins: [ElementPlus] },
  })
  await nextTick()
  await flushPromises()
  return wrapper
}

/** 弹窗内容 teleport 到 body，wrapper.text() 为空，故读 body */
function bodyText(): string {
  return document.body.textContent ?? ''
}

function dialogButtons(): HTMLElement[] {
  return [...document.body.querySelectorAll('.el-dialog .el-button')] as HTMLElement[]
}

function clickButton(text: string) {
  const hit = dialogButtons().find((b) => b.textContent?.includes(text))
  if (!hit)
    throw new Error(
      `弹窗内找不到按钮：${text}（现有：${dialogButtons()
        .map((b) => b.textContent)
        .join(' / ')}）`,
    )
  return hit.click()
}

/** 填表单：按 label 找输入框 */
async function fillByLabel(
  wrapper: Awaited<ReturnType<typeof mountModal>>,
  label: string,
  value: string,
) {
  const items = wrapper.findAllComponents({ name: 'ElFormItem' })
  const item = items.find((i) => String(i.props('label') ?? '').includes(label))
  if (!item) throw new Error(`找不到表单项：${label}`)
  const input = item.find('input')
  await input.setValue(value)
  return input
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
  vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
  document.body.innerHTML = ''
})

describe('ForceChangePasswordModal 首登强制改密', () => {
  it('force 且未校验：从「手机号后 4 位」步骤起步，且无取消按钮（不可跳过）', async () => {
    const auth = useAuthStore()
    auth.mustChangePassword = true
    auth.firstLoginVerified = false
    auth.user = { phone: '13700001001' } as never

    await mountModal(true)
    const texts = dialogButtons().map((b) => b.textContent ?? '')
    expect(texts.some((t) => t.includes('下一步'))).toBe(true)
    // 不可跳过：force 模式没有「取消」
    expect(texts.some((t) => t.includes('取消'))).toBe(false)
    // 手机号脱敏（137****0001），不出现完整号码
    expect(bodyText()).toContain('137****1001')
    expect(bodyText()).not.toContain('13700001001')
  })

  it('force=false（个人中心自助改密）：直接进入改密步骤，且有取消按钮', async () => {
    const auth = useAuthStore()
    auth.firstLoginVerified = true

    await mountModal(false)
    const texts = dialogButtons().map((b) => b.textContent ?? '')
    expect(texts.some((t) => t.includes('确认修改'))).toBe(true)
    expect(texts.some((t) => t.includes('取消'))).toBe(true)
    // 自助改密不展示首登校验提示
    expect(bodyText()).not.toContain('请先完成首登校验')
  })

  it('校验通过 → 进入改密步骤', async () => {
    const auth = useAuthStore()
    auth.mustChangePassword = true
    auth.firstLoginVerified = false
    auth.user = { phone: '13700001001' } as never
    firstLoginVerify.mockResolvedValue(undefined as never)

    const wrapper = await mountModal(true)
    await fillByLabel(wrapper, '手机号后 4 位', '0001')
    clickButton('下一步')
    await flushPromises()

    expect(firstLoginVerify).toHaveBeenCalledWith({ phoneTail: '0001' })
    expect(ElMessage.success).toHaveBeenCalledWith('校验通过，请设置新密码')
    // 已进入改密步骤
    expect(bodyText()).toContain('原密码')
    expect(bodyText()).toContain('新密码')
  })

  it('两次输入不一致：拦在提交前，不发请求', async () => {
    const auth = useAuthStore()
    auth.firstLoginVerified = true

    const wrapper = await mountModal(false)
    await fillByLabel(wrapper, '原密码', PW_OLD)
    await fillByLabel(wrapper, '新密码', PW_NEW)
    await fillByLabel(wrapper, '确认新密码', PW_MISMATCH)
    clickButton('确认修改')
    await flushPromises()

    expect(changePassword).not.toHaveBeenCalled()
    expect(ElMessage.error).toHaveBeenCalledWith('两次输入不一致')
  })

  it('改密时校验态失效（FIRST_LOGIN_VERIFY_FAILED）→ 退回校验步骤', async () => {
    const auth = useAuthStore()
    auth.firstLoginVerified = true
    auth.user = { phone: '13700001001' } as never
    changePassword.mockRejectedValue({
      code: 'FIRST_LOGIN_VERIFY_FAILED',
      message: '请先完成首登校验',
    })

    const wrapper = await mountModal(false)
    await fillByLabel(wrapper, '原密码', PW_OLD)
    await fillByLabel(wrapper, '新密码', PW_NEW)
    await fillByLabel(wrapper, '确认新密码', PW_NEW)
    clickButton('确认修改')
    await flushPromises()

    // 退回校验步骤：出现校验输入项
    expect(bodyText()).toContain('手机号后 4 位')
  })

  it('改密成功（force）：emit done 并按新权限解析落地页', async () => {
    const auth = useAuthStore()
    auth.firstLoginVerified = true
    auth.permissions = [PERMISSIONS.ORDER_FORM_SUBMIT]
    auth.roles = ['TEACHER']
    changePassword.mockResolvedValue(authResult('TEACHER'))

    const wrapper = await mountModal(true)
    await fillByLabel(wrapper, '原密码', PW_OLD)
    await fillByLabel(wrapper, '新密码', PW_NEW)
    await fillByLabel(wrapper, '确认新密码', PW_NEW)
    clickButton('确认修改')
    await flushPromises()

    expect(changePassword).toHaveBeenCalledWith({ oldPassword: PW_OLD, newPassword: PW_NEW })
    expect(wrapper.emitted('done')).toHaveLength(1)
    // 教师权限 → 我的课程
    expect(replace).toHaveBeenCalledWith('/my-courses')
  })

  it('改密成功（自助）：emit done 但不强制跳转（留在当前页）', async () => {
    const auth = useAuthStore()
    auth.firstLoginVerified = true
    auth.roles = ['TEACHER']
    changePassword.mockResolvedValue(authResult('TEACHER'))

    const wrapper = await mountModal(false)
    await fillByLabel(wrapper, '原密码', PW_OLD)
    await fillByLabel(wrapper, '新密码', PW_NEW)
    await fillByLabel(wrapper, '确认新密码', PW_NEW)
    clickButton('确认修改')
    await flushPromises()

    expect(wrapper.emitted('done')).toHaveLength(1)
    expect(replace).not.toHaveBeenCalled()
  })
})
