import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import RoleView from '@/views/admin/RoleView.vue'
import { useAuthStore } from '@/stores/auth'
import { PERMISSIONS } from '@/utils/constants'
import type { PermissionGroup, RoleListItem } from '@/types'

/**
 * 角色管理页（决策 FE-W2 / BE-2）。
 *
 * 重点覆盖决策文档 §7 要求的两处载荷正确性：
 *   1. 权限树勾选 → `assignPermissions` 只提交**叶子**权限码（父节点是模块分组，不是权限码）；
 *   2. 新建/编辑角色 → 提交 `{roleCode, roleName, sort}`，编辑时不带 roleCode（编码不可改）。
 * 以及内置角色的保护：ADMIN 不可配权限、内置角色不可删。
 */
vi.mock('@/api/role', () => ({
  roleApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    assignPermissions: vi.fn(),
  },
  permissionApi: { catalog: vi.fn() },
}))

import { permissionApi, roleApi } from '@/api/role'

const list = vi.mocked(roleApi.list)
const assignPermissions = vi.mocked(roleApi.assignPermissions)
const create = vi.mocked(roleApi.create)
const update = vi.mocked(roleApi.update)
const remove = vi.mocked(roleApi.remove)
const catalog = vi.mocked(permissionApi.catalog)

/** 与后端 /api/admin/permission 同形状：模块为父节点，权限码为叶子 */
const CATALOG: PermissionGroup[] = [
  {
    module: 'audit',
    perms: [{ permCode: 'audit:log:view', permName: '审计日志查询' }],
  },
  {
    module: 'notice',
    perms: [
      { permCode: 'notice:task:manage', permName: '通知任务管理' },
      { permCode: 'notice:task:view', permName: '通知任务查看' },
    ],
  },
]

function role(
  partial: Partial<RoleListItem> & Pick<RoleListItem, 'id' | 'roleCode'>,
): RoleListItem {
  return {
    roleName: partial.roleCode,
    builtIn: false,
    userCount: 0,
    permCodes: [],
    ...partial,
  }
}

const ROLES: RoleListItem[] = [
  role({
    id: 1,
    roleCode: 'ADMIN',
    roleName: '教材室（超级管理员）',
    builtIn: true,
    permCodes: [],
  }),
  role({ id: 2, roleCode: 'TEACHER', roleName: '任课教师', builtIn: true, permCodes: [] }),
  role({ id: 9, roleCode: 'CUSTOM_ROLE', roleName: '自定义角色', permCodes: ['notice:task:view'] }),
]

async function mountPage() {
  list.mockResolvedValue(ROLES)
  catalog.mockResolvedValue(CATALOG)
  // 「新建角色」走 PermButton（无权限码即移除 DOM），故需先给到权限
  useAuthStore().permissions = [PERMISSIONS.ROLE_MANAGE, PERMISSIONS.ROLE_PERMISSION_ASSIGN]
  const wrapper = mount(RoleView, { global: { plugins: [ElementPlus] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
  vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
})

describe('角色管理页', () => {
  it('渲染真实角色表，并标出内置 / 自定义', async () => {
    const wrapper = await mountPage()
    const text = wrapper.text()

    expect(text).toContain('教材室（超级管理员）')
    expect(text).toContain('CUSTOM_ROLE')
    expect(text).toContain('内置')
    expect(text).toContain('自定义')
  })

  it('ADMIN 行：配置权限与删除都不可点（超管权限由系统内置）', async () => {
    const wrapper = await mountPage()
    const adminRow = wrapper.findAll('.el-table__row').find((row) => row.text().includes('ADMIN'))!

    const buttons = adminRow.findAll('button')
    const permBtn = buttons.find((b) => b.text().includes('配置权限'))!
    const delBtn = buttons.find((b) => b.text().includes('删除'))!

    expect(permBtn.attributes('disabled')).toBeDefined()
    expect(delBtn.attributes('disabled')).toBeDefined()
  })

  it('内置角色（非 ADMIN）同样不可删除', async () => {
    const wrapper = await mountPage()
    const teacherRow = wrapper
      .findAll('.el-table__row')
      .find((row) => row.text().includes('TEACHER'))!
    const delBtn = teacherRow.findAll('button').find((b) => b.text().includes('删除'))!

    expect(delBtn.attributes('disabled')).toBeDefined()
  })

  it('权限树勾选 → 提交载荷只含叶子权限码（父节点模块不进载荷）', async () => {
    const wrapper = await mountPage()

    const customRow = wrapper
      .findAll('.el-table__row')
      .find((row) => row.text().includes('CUSTOM_ROLE'))!
    await customRow
      .findAll('button')
      .find((b) => b.text().includes('配置权限'))!
      .trigger('click')
    await flushPromises()

    // 目录按模块分组渲染
    expect(document.body.textContent).toContain('审计日志查询')
    expect(document.body.textContent).toContain('notice:task:view')

    // 勾选「审计日志查询」这一叶子
    const checkboxes = document.querySelectorAll('.el-drawer .el-checkbox__original')
    const target = Array.from(checkboxes).find((box) => {
      const label = box.closest('.el-tree-node__content')?.textContent ?? ''
      return label.includes('审计日志查询')
    }) as HTMLInputElement
    expect(target).toBeTruthy()
    target.click()
    await flushPromises()

    // 保存
    const saveBtn = Array.from(document.querySelectorAll('.el-drawer button')).find((b) =>
      b.textContent?.includes('保存'),
    ) as HTMLButtonElement
    saveBtn.click()
    await flushPromises()

    expect(assignPermissions).toHaveBeenCalledTimes(1)
    const [id, codes] = assignPermissions.mock.calls[0]
    expect(id).toBe(9)
    // 含新勾选的叶子 + 原有叶子；**不得**出现 'audit' / 'notice' 这类模块名
    expect(codes).toContain('audit:log:view')
    expect(codes).toContain('notice:task:view')
    expect(codes).not.toContain('audit')
    expect(codes).not.toContain('notice')
  })

  it('新建角色 → 提交 {roleCode, roleName, sort}', async () => {
    create.mockResolvedValue(role({ id: 10, roleCode: 'NEW_ROLE' }))
    const wrapper = await mountPage()

    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('新建角色'))!
      .trigger('click')
    await flushPromises()

    const dialog = document.querySelector('.el-dialog')!
    const inputs = dialog.querySelectorAll('input')
    const setValue = (el: HTMLInputElement, value: string) => {
      el.value = value
      el.dispatchEvent(new Event('input'))
    }
    setValue(inputs[0], 'NEW_ROLE')
    setValue(inputs[1], '新角色')
    await flushPromises()

    const saveBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('保存'),
    ) as HTMLButtonElement
    saveBtn.click()
    await flushPromises()

    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toMatchObject({ roleCode: 'NEW_ROLE', roleName: '新角色' })
  })

  it('编辑角色 → 不带 roleCode（编码不可改），仅提交名称与排序', async () => {
    update.mockResolvedValue(role({ id: 9, roleCode: 'CUSTOM_ROLE' }))
    const wrapper = await mountPage()

    const customRow = wrapper
      .findAll('.el-table__row')
      .find((row) => row.text().includes('CUSTOM_ROLE'))!
    await customRow
      .findAll('button')
      .find((b) => b.text().includes('编辑'))!
      .trigger('click')
    await flushPromises()

    // 编码输入框应为禁用态
    const dialog = document.querySelector('.el-dialog')!
    const codeInput = dialog.querySelectorAll('input')[0] as HTMLInputElement
    expect(codeInput.disabled).toBe(true)

    const saveBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('保存'),
    ) as HTMLButtonElement
    saveBtn.click()
    await flushPromises()

    expect(update).toHaveBeenCalledTimes(1)
    const [id, payload] = update.mock.calls[0]
    expect(id).toBe(9)
    expect(payload).not.toHaveProperty('roleCode')
  })

  it('删除被拒（409 仍有账号）→ 原样展示后端 message，不静默吞错', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    remove.mockRejectedValue(new Error('该角色仍有 1 个账号，请先调整账号角色'))

    const wrapper = await mountPage()
    const customRow = wrapper
      .findAll('.el-table__row')
      .find((row) => row.text().includes('CUSTOM_ROLE'))!
    await customRow
      .findAll('button')
      .find((b) => b.text().includes('删除'))!
      .trigger('click')
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith('该角色仍有 1 个账号，请先调整账号角色')
  })
})
