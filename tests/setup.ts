import { beforeEach } from 'vitest'
import { config } from '@vue/test-utils'

// 组件测试统一装配 Element Plus 图标（与 main.ts 的全局注册保持一致）
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  config.global.components[name] = component
}

beforeEach(() => {
  document.body.innerHTML = ''
})
