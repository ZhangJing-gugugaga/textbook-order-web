import { defineStore } from 'pinia'
import { configApi } from '@/api/auth'

/** system_config 缓存（SPEC §7：数量上限等，教师填报表单预校验读取） */
export const useConfigStore = defineStore('config', {
  state: () => ({
    loaded: false,
    /** 单行教材数量上限 */
    quantityMax: 100,
    /** 学生选书单品种数量步进上限 */
    stepMax: 9,
    /** 导入文件大小上限（MB） */
    importMaxSizeMb: 10,
    /** 导出同步下载行数阈值（Q16） */
    exportSyncMaxRows: 5000,
    config: {} as Record<string, unknown>,
  }),
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return
      try {
        const data = await configApi.systemConfig()
        this.config = data
        if (typeof data.quantityMax === 'number') this.quantityMax = data.quantityMax
        if (typeof data.stepMax === 'number') this.stepMax = data.stepMax
        if (typeof data.importMaxSizeMb === 'number') this.importMaxSizeMb = data.importMaxSizeMb
        if (typeof data.exportSyncMaxRows === 'number')
          this.exportSyncMaxRows = data.exportSyncMaxRows
        this.loaded = true
      } catch {
        // 读取失败使用内置默认值
      }
    },
  },
})
