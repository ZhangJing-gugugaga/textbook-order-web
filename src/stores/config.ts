import { defineStore } from 'pinia'
import { configApi } from '@/api/auth'
import { noticeApi } from '@/api/notice'
import { useAuthStore } from '@/stores/auth'
import { CONFIG_KEYS, EXPORT_SYNC_MAX_ROWS, PERMISSIONS } from '@/utils/constants'

/** 内置默认值（与后端 system_config 种子一致；读取失败时兜底） */
const DEFAULTS = {
  [CONFIG_KEYS.NOTICE_ROUND_LIMIT]: 5,
  [CONFIG_KEYS.NOTICE_INTERVAL_HOURS]: 24,
  [CONFIG_KEYS.NOTICE_POPUP_QUEUE_MAX]: 5,
  [CONFIG_KEYS.ORDER_QUANTITY_MAX_DEFAULT]: 999,
  [CONFIG_KEYS.ORDER_CORRECT_WINDOW_DAYS]: 7,
  [CONFIG_KEYS.EXPORT_SYNC_ROW_THRESHOLD]: EXPORT_SYNC_MAX_ROWS,
  [CONFIG_KEYS.EXPORT_DOWNLOAD_TOKEN_MINUTES]: 10,
  [CONFIG_KEYS.IMPORT_MAX_FILE_MB]: 10,
} as const

/**
 * system_config 缓存（SPEC §7）：8 键的键→值映射，供表单预校验与展示读取。
 * 键名真源为后端 system_config.config_key（CONFIG_KEYS 常量）。
 */
export const useConfigStore = defineStore('config', {
  state: () => ({
    loaded: false,
    /** 键 → 值（后端 configValue 为字符串） */
    config: { ...DEFAULTS } as Record<string, string | number>,
  }),
  getters: {
    /** 班级人数缺失时的单行数量上限回退值 */
    quantityMax: (state) => Number(state.config[CONFIG_KEYS.ORDER_QUANTITY_MAX_DEFAULT]) || 999,
    /** 学生选书单品种数量上限（后端校验 1-9） */
    studentQuantityMax: () => 9,
    /** 导入文件大小上限（MB） */
    importMaxSizeMb: (state) => Number(state.config[CONFIG_KEYS.IMPORT_MAX_FILE_MB]) || 10,
    /** 导出同步/异步阈值（仅用于展示提示，实际分流以后端为准） */
    exportSyncMaxRows: (state) =>
      Number(state.config[CONFIG_KEYS.EXPORT_SYNC_ROW_THRESHOLD]) || EXPORT_SYNC_MAX_ROWS,
    /** 弹窗队列上限 */
    popupQueueMax: (state) => Number(state.config[CONFIG_KEYS.NOTICE_POPUP_QUEUE_MAX]) || 5,
    /** 补正窗口天数 */
    correctWindowDays: (state) => Number(state.config[CONFIG_KEYS.ORDER_CORRECT_WINDOW_DAYS]) || 7,
  },
  actions: {
    /**
     * 读取配置。
     *
     * 后端 `GET /api/admin/config` 仅超管可用（config:config:manage），其他角色调用会 403，
     * 而全局 403 处理会跳 /403 页 —— 因此按角色分流：
     *  · 超管：读全量 8 键；
     *  · 非超管：只读 `GET /api/notice/subscribe-config`（登录即可）取 `popupQueueMax`，
     *    其余键沿用与后端种子一致的内置默认值。
     * 两者失败都静默兜底，不阻塞页面（非超管的弹窗队列上限默认 5）。
     */
    async load(force = false) {
      if (this.loaded && !force) return
      const auth = useAuthStore()
      if (!auth.has(PERMISSIONS.CONFIG_MANAGE)) {
        try {
          const config = await noticeApi.subscribeConfig()
          if (config?.popupQueueMax != null) {
            this.config[CONFIG_KEYS.NOTICE_POPUP_QUEUE_MAX] = config.popupQueueMax
          }
        } catch {
          // 接口失败保留内置默认值（5），不弹错、不跳 403
        }
        this.loaded = true
        return
      }
      try {
        const list = await configApi.list()
        for (const item of list) {
          if (item?.configKey) this.config[item.configKey] = item.configValue
        }
        this.loaded = true
      } catch {
        // 读取失败使用内置默认值
      }
    },
    /** 超管：批量更新（键白名单 + 值域由后端校验，越界/未知键 → 400） */
    async save(items: Record<string, string>) {
      await configApi.update(items)
      await this.load(true)
    },
  },
})
