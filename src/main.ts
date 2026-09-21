import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import perm from './directives/perm'
import { configureHttp } from './api/http'
import { useAuthStore } from './stores/auth'
import { useNoticeStore } from './stores/notice'
import { useTaskStore } from './stores/task'
import { useWindowStore } from './stores/window'
import { ElMessage } from 'element-plus'
import ForceChangePasswordModal from './components/ForceChangePasswordModal.vue'
import GlobalBlockingNotice from './components/GlobalBlockingNotice.vue'
import WindowBanner from './components/WindowBanner.vue'
import PermButton from './components/PermButton.vue'
import ServerTable from './components/ServerTable.vue'
import ImportWizard from './components/ImportWizard.vue'
import ExportButton from './components/ExportButton.vue'
import FieldCheckResult from './components/FieldCheckResult.vue'
import BatchProgressDrawer from './components/BatchProgressDrawer.vue'
import RoleSwitcher from './components/RoleSwitcher.vue'
import './styles/index.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })
app.directive('perm', perm)

// Element Plus 图标全局注册：同时注册裸名（<Bell />）与 ElIcon 前缀两种用法
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component)
  app.component(`ElIcon${name}`, component)
}

app.component('ForceChangePasswordModal', ForceChangePasswordModal)
app.component('GlobalBlockingNotice', GlobalBlockingNotice)
app.component('WindowBanner', WindowBanner)
app.component('PermButton', PermButton)
app.component('ServerTable', ServerTable)
app.component('ImportWizard', ImportWizard)
app.component('ExportButton', ExportButton)
app.component('FieldCheckResult', FieldCheckResult)
app.component('BatchProgressDrawer', BatchProgressDrawer)
app.component('RoleSwitcher', RoleSwitcher)

/* ---------------- 接口消费层钩子装配（SPEC §5 / §6） ---------------- */
const auth = useAuthStore()
const notice = useNoticeStore()
const task = useTaskStore()
const windowStore = useWindowStore()

configureHttp({
  getAccessToken: () => auth.accessToken,
  onAccessToken: (token) => {
    auth.accessToken = token
  },
  onForceLogout: (message) => {
    notice.reset()
    task.stopAll()
    windowStore.stopPolling()
    auth.resetSession()
    ElMessage.error(message)
    void router.replace({ path: '/login' })
  },
  onForbidden: () => {
    if (router.currentRoute.value.path !== '/403') void router.replace('/403')
  },
  notify: (message, type) => {
    if (type === 'warning') ElMessage.warning(message)
    else ElMessage.error(message)
  },
})

app.mount('#app')
