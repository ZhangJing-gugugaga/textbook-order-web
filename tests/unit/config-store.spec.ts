import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConfigStore } from '@/stores/config'
import { useAuthStore } from '@/stores/auth'
import { CONFIG_KEYS, PERMISSIONS } from '@/utils/constants'

/**
 * 配置读取分流（决策 FE-W6 / BE-5e）。
 *
 * 背景：`GET /api/admin/config` 只有超管能读（`config:config:manage`），非超管调用会 403，
 * 而全局 403 处理会跳 /403 页。因此非超管必须改走登录即可读的
 * `GET /api/notice/subscribe-config` 取弹窗队列上限，其余键沿用内置默认值。
 * 该接口失败时**静默兜底为 5**，不得阻塞页面、不得弹错。
 */
vi.mock('@/api/auth', () => ({ configApi: { list: vi.fn(), update: vi.fn() } }))
vi.mock('@/api/notice', () => ({ noticeApi: { subscribeConfig: vi.fn() } }))

import { configApi } from '@/api/auth'
import { noticeApi } from '@/api/notice'

const list = vi.mocked(configApi.list)
const subscribeConfig = vi.mocked(noticeApi.subscribeConfig)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('配置 store 的读取分流（FE-W6）', () => {
  it('超管：读 /admin/config 全量键，不调 subscribe-config', async () => {
    useAuthStore().permissions = [PERMISSIONS.CONFIG_MANAGE]
    list.mockResolvedValue([
      { configKey: CONFIG_KEYS.NOTICE_POPUP_QUEUE_MAX, configValue: '9' },
      { configKey: CONFIG_KEYS.IMPORT_MAX_FILE_MB, configValue: '20' },
    ] as never)

    const store = useConfigStore()
    await store.load()

    expect(list).toHaveBeenCalled()
    expect(subscribeConfig).not.toHaveBeenCalled()
    expect(store.popupQueueMax).toBe(9)
    expect(store.importMaxSizeMb).toBe(20)
  })

  it('非超管：改走 subscribe-config 取 popupQueueMax，不触碰超管端点', async () => {
    useAuthStore().permissions = []
    subscribeConfig.mockResolvedValue({ subscribeTemplateId: null, popupQueueMax: 8 })

    const store = useConfigStore()
    await store.load()

    // 关键：非超管**不得**调 /admin/config（会 403 → 跳 /403 页）
    expect(list).not.toHaveBeenCalled()
    expect(subscribeConfig).toHaveBeenCalled()
    expect(store.popupQueueMax).toBe(8)
  })

  it('非超管 + 接口失败：静默兜底为默认值 5，不抛错', async () => {
    useAuthStore().permissions = []
    subscribeConfig.mockRejectedValue(new Error('网络异常'))

    const store = useConfigStore()
    await expect(store.load()).resolves.toBeUndefined()
    expect(store.popupQueueMax).toBe(5)
    expect(store.loaded).toBe(true)
  })

  it('subscribe-config 未返回 popupQueueMax 时同样保留默认值 5', async () => {
    useAuthStore().permissions = []
    subscribeConfig.mockResolvedValue({ subscribeTemplateId: null } as never)

    const store = useConfigStore()
    await store.load()
    expect(store.popupQueueMax).toBe(5)
  })
})
