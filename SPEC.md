# 教材征订系统 · Web 端前端技术规格（SPEC）

> 版本 **V1.1.0** · 2026-09-21 · 依据：本仓库 `PRD.md`（V1.1.0）、`02-前端开发计划与决策.md`（v3 复审修订版）、`03-后端开发计划与决策.md`（接口契约基线）
> 定位：PRD 说「做什么/为什么」，本文说「怎么实现」；里程碑、分工与验收标准见 02 号文档 §9。本文与 02 v3 冲突时，以 02 v3 已锁定决策为准。
> 范围：仅 Web 端。小程序端见 `textbook-order-mp` 仓库（任课老师 + 学生，无 admin）。
>
> **V1.1.0 说明**：本版按 2026-09-21 企业级评审结论对全文做了与代码对齐的修订——删除 mock 章节、
> 修正权限码表（改为指向 `src/utils/constants.ts` 的真源）、修正超时值/类型描述/工程结构，
> 并补入按需引入、E2E、覆盖率门禁、浏览器矩阵与部署手册的落地说明。
> **以本文与代码不一致时，以代码为准**；发现不一致请直接修本文，不要让它再次分叉。

---

## 1. 技术栈与锁定版本（02 §1.1）

| 项         | 锁定值                                               | 说明                                                              |
| ---------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| 框架       | Vue ^3.5（Composition API + `<script setup>` + TS）  | 不使用 Options API 混写                                           |
| 构建       | Vite ^6                                              | base 走环境变量，见 §3                                            |
| UI 库      | Element Plus ^2.9                                    | **按需引入**（见 §3.3），主题令牌沿用 MVP 色板（靛蓝 #4F46E5 系） |
| 状态       | Pinia ^2.3                                           | store 清单见 §7                                                   |
| 路由       | Vue Router ^4.5                                      | `createWebHistory(import.meta.env.BASE_URL)`（见 §3.2）           |
| HTTP       | axios ^1.7                                           | 单例 + 拦截器，见 §6                                              |
| 单测       | Vitest ^4 + @vue/test-utils ^2                       | 见 §10                                                            |
| E2E        | Playwright ^1.63（chromium）                         | 见 §10                                                            |
| 覆盖率     | @vitest/coverage-v8（v8 provider）                   | 门禁阈值见 §10                                                    |
| 包管理     | npm（`package-lock.json` 入库）                      | 不引入 pnpm                                                       |
| 规范       | ESLint ^9（flat config）+ Prettier ^3                | 均纳入 CI 门禁，见 §10                                            |
| 浏览器目标 | Chrome ≥ 87 / Edge ≥ 88 / Firefox ≥ 78 / Safari ≥ 14 | `package.json` browserslist 与 `build.target` 同源，见 §3.4       |

> **无 mock 层**：MVP 阶段的 `vite-plugin-mock` 与 `mock/` 目录已整体删除，接口一律对接真实后端。
> 本地开发用 `dev` / `dev:proxy` 直连 `VITE_PROXY_TARGET`；E2E 用 Playwright 路由拦截做接口桩
> （`e2e/fixtures/api.ts`），两者都不在前端引入 mock 运行时依赖。

## 2. 工程结构

```
textbook-order-web/
├─ PRD.md / SPEC.md / 02-前端开发计划与决策.md   # 需求 / 规格 / 计划三件套
├─ README.md                                     # 开发上手（环境矩阵、测试说明、联调账号）
├─ index.html
├─ vite.config.ts                                # base、proxy、按需引入、分包、define
├─ vitest.config.ts / playwright.config.ts        # 单测 / E2E 配置
├─ eslint.config.js / .prettierrc.json / .prettierignore
├─ postcss.config.mjs                            # autoprefixer（让 browserslist 生效）
├─ tsconfig.json
├─ .env.example / .env.trial / .env.school        # VITE_BASE / VITE_PROXY_TARGET（无密钥）
├─ .github/workflows/ci.yml                      # CI 质量门禁
├─ docs/
│  ├─ DEPLOYMENT.md                              # 部署手册（Nginx/安全头/缓存/回滚）
│  └─ HANDOVER-CHECKLIST.md                      # 移交检查单
├─ e2e/                                          # Playwright：五角色走查 + 越权矩阵
│  ├─ fixtures/api.ts                            # 接口桩（按角色返回固定响应）
│  ├─ landing.spec.ts / auth.spec.ts
│  ├─ permission.spec.ts / smoke.spec.ts
├─ src/
│  ├─ main.ts / App.vue
│  ├─ router/
│  │  ├─ index.ts                                # createWebHistory(BASE_URL)
│  │  ├─ routes.ts                               # 静态路由表 + meta.permission
│  │  └─ guards.ts                               # 守卫 + resolveLandingPath()
│  ├─ stores/                                    # §7 五个 store
│  │  ├─ auth.ts / window.ts / notice.ts / task.ts / config.ts
│  ├─ api/                                       # §6 接口模块（12 个业务模块 + http.ts）
│  │  ├─ http.ts                                 # axios 单例 + 拦截器 + refresh single-flight
│  │  ├─ auth.ts / semester.ts / people.ts / textbook.ts / course.ts
│  │  ├─ orderForm.ts / studentOrder.ts / change.ts / notice.ts
│  │  └─ exportTask.ts / dashboard.ts / supplier.ts
│  ├─ components/                                # §8 组件（页面内显式 import，不全局注册）
│  │  ├─ PermButton.vue / ServerTable.vue / ImportWizard.vue / ExportButton.vue
│  │  ├─ WindowBanner.vue / GlobalBlockingNotice.vue / ForceChangePasswordModal.vue
│  │  ├─ SemesterLifecyclePanel.vue / FieldCheckResult.vue / RoleSwitcher.vue
│  ├─ composables/useCountdown.ts                # §8（自带卸载清理）
│  ├─ layouts/DefaultLayout.vue                  # 侧边栏 + 顶栏 + 内容区
│  ├─ views/                                     # 26 个页面
│  │  ├─ login/ profile/ error/                  # 1 + 1 + 2
│  │  ├─ admin/                                  # 11：dashboard, accounts, org, semester-window,
│  │  │                                          #     textbooks, courses, people, review,
│  │  │                                          #     order-data, export-center, notices
│  │  ├─ secretary/                              # 4：college-records, college-export,
│  │  │                                          #    change-requests, window-status
│  │  ├─ teacher/                                # 3：my-courses, order-form, my-submissions
│  │  ├─ student/                                # 2：book-select, my-orders
│  │  └─ supplier/                               # 2：purchase-list, supplier-export
│  ├─ styles/index.css                           # 全局样式与 Element Plus 令牌覆盖
│  ├─ types/                                     # index.ts + 自动生成的 d.ts
│  │  ├─ index.ts                                # 领域类型
│  │  ├─ auto-imports.d.ts / components.d.ts     # 由 unplugin 生成（入库，勿手改）
│  └─ utils/                                     # constants / format / validate / session
│     ├─ constants.ts                            # 文案令牌、错误码、权限码、状态字典（真源）
│     ├─ session.ts                              # refresh token 持久层（多标签页同步）
│     ├─ monitor.ts                              # 错误监控接入点
│     ├─ icons.ts                                # 图标按需注册表
│     ├─ table.ts                                # el-table 行类型收窄（asRow）
│     ├─ format.ts / validate.ts
└─ tests/                                        # unit/ + components/
```

## 3. 构建与环境（02 §2 · Q13）

### 3.1 环境变量

前端只有两项常规配置 + 一项开关，**均不含密钥**：

| 变量                | 含义                           | 默认值                                     |
| ------------------- | ------------------------------ | ------------------------------------------ |
| `VITE_BASE`         | 部署子路径（以 `/` 收尾）      | development → `/`；其余模式 → `/textbook/` |
| `VITE_PROXY_TARGET` | dev/preview 的 `/api` 代理目标 | `http://127.0.0.1:8080`                    |
| `VITE_SOURCEMAP`    | 置 `1` 时产出 sourcemap        | 未设置（关闭）                             |

**代码零域名/IP 硬编码**；接口一律相对路径 `/api`（硬约束）。

仓库不落 `.env` / `.env.development`（安全扫描敏感文件清单；本地开发无需 env 即可开箱运行），
trial / school 配置入库（无密钥），样例见 `.env.example`。

| 环境   | mode                  | VITE_BASE                                | 说明                                                                         |
| ------ | --------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| local  | `development`（默认） | `/`                                      | `npm run dev` 开箱可用，**无需 env 文件**；`npm run dev:proxy` 走 trial 配置 |
| trial  | `trial`               | `/textbook/`                             | moonzj.com 子路径，根域已有服务零冲突（`.env.trial`）                        |
| school | `school`              | `/textbook/`（按校方路径可调，仅改 env） | 移交重部署（`.env.school`）                                                  |

### 3.2 部署子路径的单一真源

`vite.config.ts` 的 `base` 与路由的 history base **必须一致**，否则会出现
「资源从 `/textbook/` 加载、路由却按 `/` 解析」的错配（子路径部署时刷新页面即 404）。

因此路由一律使用 Vite 注入的 `import.meta.env.BASE_URL`（由 `base` 派生），
**不再读取自定义的 `VITE_BASE`**——后者只在 `.env.trial` / `.env.school` 中定义，
默认 `npm run build`（production 模式）下为 `undefined`，会与 `base` 的默认值分叉。

### 3.3 Element Plus 按需引入（包体积治理）

| 措施                                            | 位置                                  | 效果                                                                               |
| ----------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| `unplugin-vue-components` + ElementPlusResolver | `vite.config.ts` / `vitest.config.ts` | 模板中的 `<el-*>` 与 `v-loading` 按需解析并注入对应样式                            |
| `unplugin-auto-import` + ElementPlusResolver    | 同上                                  | 程序式 API（`ElMessage` / `ElMessageBox` / `ElLoading`）自动注入                   |
| 图标按需注册                                    | `src/utils/icons.ts`                  | 只注册 22 个实际使用的图标（原先全量约 2000 个）                                   |
| 移除全量样式                                    | `main.ts`                             | 不再引入 `element-plus/dist/index.css`（约 356KB）                                 |
| 移除全局安装                                    | `main.ts`                             | 不再 `app.use(ElementPlus)`；中文语料改由 `App.vue` 的 `<el-config-provider>` 提供 |
| 分包                                            | `vite.config.ts` 的 `manualChunks`    | 只对 `vue`/`vue-router`/`pinia`/`axios` 做对象式分包                               |

> **分包必须用对象形式**。实测（rollup 4.63）：函数形式
> `manualChunks(id) => 'vendor-element-plus'` 会把命中该规则的模块标记为「显式纳入」，
> **绕过 tree-shaking**，Element Plus 中未被使用的 800+ 个模块会整体进包
> （入口体积从 205KB 反弹到 951KB）。Element Plus 交由路由级动态 `import` 自然切分。

体积基线（2026-09-21 实测，`npm run build`）：

| 项                      | 治理前                | 治理后                          |
| ----------------------- | --------------------- | ------------------------------- |
| 入口 chunk              | 1311 KB / 425 KB gzip | **205.7 KB / 72.1 KB gzip**     |
| CSS 合计                | 356.6 KB              | 236 KB                          |
| `chunkSizeWarningLimit` | 1600（把告警压掉）    | **500**（默认值，告警重新生效） |

### 3.4 浏览器兼容矩阵（Q14 已关闭）

- `package.json` 的 `browserslist` 与 `vite.config.ts` 的 `build.target` **同源声明**，
  并由 `postcss.config.mjs` 的 autoprefixer 让 browserslist 真正作用于 CSS 前缀。
- 声明范围：**Chrome ≥ 87 / Edge ≥ 88 / Firefox ≥ 78 / Safari ≥ 14**。
- 不提供 ES5 降级与 polyfill。若校方机房存在 IE11 或国产双核浏览器兼容内核，
  需作为**变更项**评估 `@vitejs/plugin-legacy`（预计入口体积增加 30%~50%）。
- 详见 `docs/DEPLOYMENT.md` §6。

### 3.5 部署

Nginx 完整配置（含**安全响应头**、缓存分层、history 回退、`/api` 反代）、回滚流程与故障排查
见 **`docs/DEPLOYMENT.md`**；移交逐项核对见 **`docs/HANDOVER-CHECKLIST.md`**。本文不再内联 Nginx 片段。

## 4. 路由与权限（02 §3）

### 4.1 权限码真源

**权限码的唯一真源是 `src/utils/constants.ts` 的 `PERMISSIONS`**（后端 `sys_permission` 37 条，
M1 契约冻结值）。路由 `meta.permission`、侧边栏过滤、`PermButton`、`ExportButton` 全部引用该常量，
**不再有字面量散落**。下表列出各页面实际使用的权限码：

| 路径             | 页面                            | 角色        | 权限码（真源：constants.ts） |
| ---------------- | ------------------------------- | ----------- | ---------------------------- |
| /login           | 登录                            | 公共        | —                            |
| /profile         | 个人中心（改密/切换身份）       | 全部        | —                            |
| /403, /404       | 兜底                            | —           | —                            |
| /dashboard       | 数据看板                        | 超管        | `dashboard:stat:view`        |
| /accounts        | 账号管理                        | 超管        | `user:account:manage`        |
| /org             | 组织管理                        | 超管        | `org:college:manage`         |
| /semester-window | 学期与窗口引擎                  | 超管        | `semester:semester:manage`   |
| /textbooks       | 教材库                          | 超管        | `textbook:book:manage`       |
| /courses         | 课程与任课管理                  | 超管        | `course:course:manage`       |
| /people          | 学生/教师管理（含异动审批页签） | 超管        | `people:student:import`      |
| /review          | 复核工作台                      | 超管        | `order:form:review`          |
| /order-data      | 征订数据                        | 超管        | `order:form:view:all`        |
| /export-center   | 导出中心                        | 超管        | `export:order:create`        |
| /notices         | 通知管理                        | 超管        | `notice:task:manage`         |
| /college-records | 本院征订记录                    | 秘书        | `order:form:view:college`    |
| /college-export  | 本院导出（签字版式）            | 秘书        | `export:signature:create`    |
| /window-status   | 窗口状态（只读）                | 秘书        | `semester:window:view`       |
| /change-requests | 异动申请                        | 秘书 + 教师 | `change:request:submit`      |
| /my-courses      | 我的课程                        | 教师        | `order:form:view:self`       |
| /order-form      | 填报教材                        | 教师        | `order:form:submit`          |
| /my-submissions  | 我的提交记录                    | 教师        | `order:form:view:self`       |
| /book-select     | 选书                            | 学生        | `student:order:submit`       |
| /my-orders       | 我的选购记录                    | 学生        | `student:order:view:self`    |
| /purchase-list   | 订购清单                        | 供货商      | `supplier:order:view`        |
| /supplier-export | 清单导出                        | 供货商      | `supplier:order:export`      |

### 4.2 守卫流程

`router.beforeEach`：

1. `!auth.ready` → `auth.bootstrap()`（用 refresh token 静默恢复会话），登录后拉 `system_config`；
2. `to.path === '/login'` 且已登录且未待改密 → `resolveLandingPath(permissions)`；
3. 未登录 → `/login?redirect=<fullPath>`；
4. `mustChangePassword` 且非 `/profile` → `/profile?forceChange=1`（不可跳过）；
5. **`to.path === '/'` → `resolveLandingPath(permissions)`**（见下）；
6. `meta.permission` 不在 `auth.permissions` 内 → `/403`；
7. 放行前拉取窗口状态与未确认通知。

`router.afterEach` 写入 `document.title`（`<页面标题> · 教材征订系统`）。

### 4.3 落地页解析（`resolveLandingPath`）

**根路径 `/` 不做静态 redirect**。静态 `redirect: '/dashboard'` 会让教师/学生/秘书/供货商
被权限守卫拦到 `/403`（已修复的用户可见缺陷）。落地页由 `resolveLandingPath(permissions)`
按以下顺序解析，登录、访问根路径、切换身份三处共用同一实现：

| 优先级 | 命中权限                     | 落地页             |
| ------ | ---------------------------- | ------------------ |
| 1      | `dashboard:stat:view`        | `/dashboard`       |
| 2      | `order:form:submit`          | `/my-courses`      |
| 3      | `student:order:submit`       | `/book-select`     |
| 4      | `order:form:view:college`    | `/college-records` |
| 5      | `supplier:order:view`        | `/purchase-list`   |
| 6      | 兜底：第一个可访问的可见路由 | 该路由             |
| 7      | 无任何可访问路由             | `/403`             |

### 4.4 显示层权限的三种控制

1. **路由级**：`meta.permission` + 守卫（§4.2 步骤 6）；
2. **菜单级**：侧边栏 = 全量路由表按 `permissions` 过滤生成（`DefaultLayout.vue`）；
3. **按钮级**：**`PermButton` 组件**（`src/components/PermButton.vue`）——无权限码**移除 DOM**（非置灰）。

> **按钮级权限只有一种实现**：`PermButton`。原先并存的 `v-perm` 指令已删除（零引用、属死代码），
> `ExportButton` 的内联 `computed` 判断改为组件内置的 `code` 属性（其本身就是按钮组件，不算第三种机制）。
> 需要包住非按钮 DOM 的场景目前不存在；若将来出现，再评估引入指令。

**前端三道控制只做显示层，数据隔离完全由后端执行**——前端不冒充安全边界。

## 5. 会话与令牌（02 §3.1 · Q6）

- **access token 仅存内存**（Pinia，不落 storage）。
- **refresh token 落 localStorage**：这是 SPEC §5 预先记载的**降级方案**（后端契约中 refreshToken
  走请求体、不使用 `Set-Cookie`），风险「XSS 面增大」已记入 §11。键名与读写统一收敛在
  `src/utils/session.ts`（此前 `stores/auth.ts` 与 `main.ts` 各硬编码一份）。
- **多标签页同步**：refresh token 每次刷新都会轮换（旧 token 立即失效）。因此
  ①`getRefreshToken` 钩子**始终读持久层**而非内存副本；②监听 `storage` 事件同步内存态；
  ③`bootstrap()` 也以持久层为准。否则 A 页刷新后 B 页会拿陈旧 token 被强制登出。
- **401 三类处理**：

| 401 语义                                           | 处理                                                           |
| -------------------------------------------------- | -------------------------------------------------------------- |
| access 过期（`TOKEN_EXPIRED`）                     | 静默 refresh（`POST /api/auth/refresh`），成功后重放原请求     |
| refresh 失效（`REFRESH_INVALID`）/ `TOKEN_INVALID` | 清空会话态 → 跳 `/login`，提示「登录已过期，请重新登录」       |
| 账号被停用（`ACCOUNT_DISABLED`）                   | 同上强制登出，提示「账号已停用，请联系教材室」——下一次请求即踢 |

- **并发 401 single-flight**：首个 401 触发 refresh，其余请求共享同一个 refresh Promise；
  `_isRefresh` / `_retried` 标志防止拦截器递归。
- 登出 / 切换身份清理序列：清 Pinia 全部 store（含停止窗口轮询与任务轮询）→ 跳转目标页
  （切换身份回到新角色的工作台首页并重拉菜单与数据）。

## 6. 接口消费层（02 §3.2 · O3）

- axios 单例：`baseURL: '/api'`（相对路径，硬约束）、**`timeout: 20000`（20s）**；
  请求拦截器注入 `Authorization: Bearer <access>` 与 `X-Device-Id`（refresh 轮换的会话标识，
  存 sessionStorage）。
- 响应拦截器解包 `{code, message, data}` 包络；`code` 为**字符串令牌**（与后端 `ErrorCode` 同源，
  见 `src/utils/constants.ts` 的 `CODE`）。
- 错误码 → 处理矩阵：401 按 §5、403 `FORBIDDEN`/`RESOURCE_FORBIDDEN` 跳 `/403`、
  403 `FIRST_LOGIN_REQUIRED` 跳首登引导（不跳 403）、409 提示「本期征订已截止」、
  5xx「服务开小差了，请稍后重试」、网络失败「网络异常，请稍后重试」——文案令牌统一取 PRD 功能 7。
- **文件流接口不走包络解包**：`downloadBlob`（模板/错误明细）、`postForExport`
  （以响应 `Content-Type` 判定同步 xlsx 流还是异步 `{taskId}` 受理体，前端不预估行数，
  避免与后端 `export.sync_row_threshold` 漂移）、`parseFileName`（兼容 `filename*=UTF-8''x`）。
- 接口模块（12 个业务模块 + `http.ts`，实际路径以后端 `API.md` V1.0.2 与 `/v3/api-docs` 为准）：
  `auth`（login/refresh/logout/switch-role/first-login-verify + me + config）、`semester`（学期 CRUD +
  activate/archive + window open/close/extend + 组织三表）、`people`（账号 + 导入批次）、`textbook`、
  `course`、`orderForm`（教师填报 + 复核）、`studentOrder`、`change`、`notice`、`exportTask`、
  `dashboard`（看板 + 审计）、`supplier`（物理隔离 `/api/supplier/**`）。
- 接口文档策略：**不自建副本**，直接指向后端 `API.md` 与 `/v3/api-docs`。

## 7. 状态管理（Pinia）

| store  | state                                                                                                                | 关键 actions / getters                                                                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| auth   | access token（内存）、refreshToken、user、roles、**permissions: `string[]`**、currentRole、mustChangePassword、ready | login / logout / switchRole（切换后重拉权限与菜单）/ refreshPermissions / bootstrap（刷新页面静默恢复）                                                                                     |
| window | status、windowStart/End、serverTime/Offset、semesterId/Name、channelOpen                                             | fetch（进入页面 + 60s 轮询，失败保持上次已知状态静默重试）；getter `canView/canFill/canOrder`、`remainMs/startRemainMs`（= `windowEnd - (clientNow + offset)`，PRD 功能 2：不信任本地时钟） |
| notice | unconfirmed 队列、confirming、loaded                                                                                 | fetchUnconfirmed（失败 = fail-open 放行，下次进入重查）/ confirm(taskId)（失败弹窗保留可重试，不放行）；队列逐条弹出直至清空（Q7：含已停止重发但未确认任务）                                |
| task   | imports/exports：`{data, polling, timer, interval, error}`                                                           | pollImport / pollExport（2s 起步、退避 1.5× 至上限 10s、终态自动停止）；**失败写入 `error` 并停止，再次调用即为重试**（消费方必须渲染 `error` 并提供重试入口）                              |
| config | system_config 缓存（8 键）                                                                                           | load()（非超管不发请求，直接用与后端种子一致的内置默认值，避免 403 跳转）/ save()（仅超管）                                                                                                 |

交互竞态（02 §3.3）：强制改密弹窗优先于通知弹窗，未改密不发业务请求；`/notice/unconfirmed` 失败 fail-open。

**并发请求竞态**：列表与详情取数一律带**请求序号**（`requestId`），并发响应只采纳最后一次，
避免「先发的慢响应覆盖后发的快响应」。列表侧由 `ServerTable` 统一兜住；详情侧在各页
（复核工作台 / 本院征订记录 / 通知进度 / 我的选购记录 / 我的提交记录）各自维护。

## 8. 全局组件与组合式函数规格

| 组件 / 组合式函数        | 职责                       | 要点                                                                                                                                                                                                                                                              |
| ------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ForceChangePasswordModal | 首登强制改密               | 不可关闭/跳过，优先级最高；手机号脱敏展示（仅校验后 4 位）                                                                                                                                                                                                        |
| GlobalBlockingNotice     | 未确认通知逐条阻塞弹出     | 自绘 Modal（非原生弹窗、不依赖 el-dialog 离场过渡）；「收到」→ confirm → 下一条                                                                                                                                                                                   |
| WindowBanner             | 全局窗口三态横幅 + 倒计时  | not_open/open/closed 文案按 PRD 功能 2；倒计时走 `useCountdown`（卸载自动清理）                                                                                                                                                                                   |
| **PermButton**           | 按钮级权限（**唯一机制**） | 无权限码移除 DOM；支持 `code`/`type`/`size`/`icon`/`loading`/`disabled`/`text`                                                                                                                                                                                    |
| **ServerTable**          | 列表页基座                 | 泛型组件 `generic="T extends Record<PropertyKey, any>"`；页面提供 `fetcher({page,size})` 与列定义；统一空/载/错三态、分页条、**请求序号**；`reload(resetPage=true)` 由页面显式调用（不做深度 watch，避免每敲一个字打一次接口）；筛选条件变化后由页面调 `reload()` |
| ImportWizard             | Excel 异步导入             | 上传（.xlsx ≤ `import.max_file_mb`）→ 批次轮询进度 → 结果摘要 + 错误明细下载 + 前 N 行预览（F-R1）；**轮询失败展示错误与重试**；卸载停止轮询                                                                                                                      |
| ExportButton             | 导出按钮                   | 以响应 Content-Type 分流：xlsx 流直接下载；JSON 则建任务 → 轮询 → 一次性 token 下载（Q16）；**轮询失败展示错误与重试**；卸载停止轮询；`code` 属性承担按钮级权限                                                                                                   |
| SemesterLifecyclePanel   | 学期生命周期（Q1）         | draft→active 激活二次确认（失败回退提示）、归档；写操作按钮走 `PermButton`（`semester:*` / `window:*`）                                                                                                                                                           |
| FieldCheckResult         | 字段审查回显（O14）        | 按 `field`/`rule`/`message` 逐字段标红 + 修复提示                                                                                                                                                                                                                 |
| RoleSwitcher             | 切换身份（A4-A）           | 顶栏入口；切换后全量重载并回新角色首页                                                                                                                                                                                                                            |
| `useCountdown(getValue)` | 每秒重算的响应式取值器     | **自带 `onUnmounted` 清理计时器**（此前 WindowBanner 直接 setInterval 且未清理，导致计时器泄漏）                                                                                                                                                                  |

> `BatchProgressDrawer` 已删除（全仓零引用的死代码）。
> `usePolling` 已删除（窗口轮询与任务轮询各由自身 store 的 start/stop 承担，无使用场景）。

**错误监控接入点**：`src/utils/monitor.ts` 的 `installGlobalErrorHandlers()` 在 `main.ts` 装配，
捕获 `window.error` 与 `unhandledrejection` 并汇总为结构化记录（错误消息、堆栈、**不含 query 的路由路径**、
应用版本、UA、时间）。默认输出到 console；接入监控平台时调用 `setErrorReporter()` **只改一处**。

## 9. 页面实现边界

- 页面交互、状态机、字段校验、文案以本仓库 **PRD.md** 为准（四、功能说明 + 功能 7 令牌），SPEC 不重复；
  页面-里程碑归属以 **02 v3 §6** 六表为准（无孤儿页面）。
- 关键补充规则：
  - 教师异动申请与秘书**同链两级审查**（D9），页面不出现"直接生效"路径；
  - 秘书导出为**签字版式 Excel**（Q4：样张由田老师提供，逾期降级标准表格 + 签字栏占位）；
  - 通知管理页仅超管可见；系统自动任务（窗口变更）只读展示（02 §6.2）；
  - 供货商页面无任何学生字段渲染路径，导出后端审计留痕（PRD 功能 6）；
  - 学生提交确认弹窗底部固定小字「价格和版本以最终出版单位供应为准」（最新决策 2）。

## 10. 测试与质量门禁（02 §10 · O7）

### 10.1 分层

| 层          | 内容                                                                                                                                                                                    | 现状            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Vitest 单测 | 401 三类语义与 single-flight、403 分流、窗口三态与时钟偏移、路由落地页解析、ServerTable 请求序号与三态、task 轮询失败与重试、refresh token 持久层与多标签页同步、错误上报、表单校验工具 | 12 文件 / 76 例 |
| 组件测试    | GlobalBlockingNotice 逐条确认队列与 fail-open、ImportWizard 轮询与错误回显、SemesterLifecyclePanel 激活/回退、PermButton 移除 DOM、ServerTable 分页与错误态                             | 含在上行        |
| E2E         | Playwright：五角色落地页解析（含根路径回归）、认证与越权矩阵、侧边栏菜单过滤、按钮级权限、主链路走查、窗口三态、阻塞通知、错误态与重试                                                  | 4 文件 / 29 例  |
| 跨仓库联调  | `integration.mjs`（仓库外脚手架，H2 起后端 + 端到端断言），见 README                                                                                                                    | 保留            |
| 小程序专项  | `weixin-devtools-mcp`（跨仓库：textbook-order-mp）教师填报/选购/弹窗通知走查                                                                                                            | M3 / M5         |

### 10.2 CI 门禁（`.github/workflows/ci.yml`）

`push`（任意分支）/ `pull_request`（main）/ 手动触发，两个并行 job：

| job     | 步骤                                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| quality | `npm ci` → 构建并校验 `src/types/*.d.ts` 无漂移 → `typecheck` → `format:check` → `lint --max-warnings 0` → `test:coverage`（含阈值）→ 归档覆盖率与 `dist` |
| e2e     | `npm ci` → 安装 chromium → `playwright test` → 失败时归档 trace/截图/报告                                                                                 |

本地等价命令：**`npm run verify`**（typecheck → lint → format:check → test → build）。

### 10.3 覆盖率门禁

- 统计范围：`src/api/http.ts`、`src/stores/**`、`src/utils/**`、`src/composables/**`、
  `src/router/**`、`src/components/**`。
- **26 个页面视图不纳入单测覆盖率**，由 E2E 覆盖（否则数字只反映「视图有没有被 import 过」）。
- 阈值锁定实测基线（2026-09-21：statements 47.4% / branches 44.4% / functions 43.1% / lines 47.9%），
  各留约 2 个百分点余量。**每次补测后应上调，不得下调。**
- 已知待补单测：`ExportButton`、`RoleSwitcher`、`WindowBanner`、`ForceChangePasswordModal`、`useCountdown`。

## 11. 风险与开放决策

- 风险登记 F-R1~F-R6 见 02 v3 §9.3（万行渲染 / 订阅授权率 / 体验版条件 / moonzj 共存 / base 影响面 / 浏览器兼容）。
- 已知残余风险：
  - **refresh token 落 localStorage**：XSS 面增大。缓解措施：全仓无 `v-html`/`innerHTML`/`eval` 注入面、
    无第三方脚本；部署侧补齐全套安全响应头与 CSP（`docs/DEPLOYMENT.md` §2.1）。
  - **一次性下载 token 置于 URL query**：会进入服务端与代理访问日志。虽为单次有效 + 10 分钟过期，
    仍属反模式；如需消除需后端改为请求头传递（记入后端待办）。
  - **错误上报未接入平台**：默认仅 console；接入点已就绪（`setErrorReporter`），
    且上报内容不含令牌与个人信息。
- 开放决策状态：

| #   | 事项                   | 状态                                                                             |
| --- | ---------------------- | -------------------------------------------------------------------------------- |
| 1   | refresh token 存储方案 | ✅ **已关闭**：采用 localStorage 降级方案（见 §5），配套多标签页同步与部署侧 CSP |
| 2   | 权限码终值             | ✅ **已关闭**：以 M1 冻结的 37 条为准，真源 `src/utils/constants.ts`             |
| 3   | 分页参数命名           | ✅ **已关闭**：`page`/`size`                                                     |
| 4   | 机房浏览器（Q14）      | ✅ **已关闭**：声明 Chrome ≥ 87 / Edge ≥ 88 / Firefox ≥ 78 / Safari ≥ 14（§3.4） |
| 5   | 签字版式样张（Q4）     | ⏳ 未关闭：一周内提供，逾期标准表格 + 占位                                       |

## 12. 变更记录

| 版本   | 日期       | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1.0.0 | 2026-09-21 | 首版：基于 02 号文档 v3（16 问复审拍板）与本仓库 PRD V1.1.0 撰写                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| V1.0.1 | 2026-09-21 | §3 与环境对齐 MVP 实现：mode 取默认 base/mock（本地开发零 env 文件）、`.env` 不入库、`VITE_MOCK` 开关；落地说明与偏离记录见 02 号文档 §9.4                                                                                                                                                                                                                                                                                                                                                                                                                             |
| V1.1.0 | 2026-09-21 | 按企业级评审结论全文回写：① 删除 mock 章节与 `VITE_MOCK`（mock 已整体移除）；② §2 工程结构按实际文件重写（api 模块清单、`types/`、`e2e/`、`docs/`、删除 `directives/perm.ts`）；③ §4 权限码表改为指向 `constants.ts` 真源并补落地页解析规则；④ §6 超时 15s→20s；⑤ §7 `permissions` 由 `Set` 改为 `string[]`；⑥ §8 删除 `BatchProgressDrawer`/`v-perm`/`usePolling`，补 `ServerTable` 泛型契约与 `useCountdown` 清理；⑦ 新增 §3.3 按需引入与体积基线、§3.4 浏览器矩阵、§3.5 指向部署手册；⑧ §10 重写测试与 CI 门禁（含覆盖率阈值）；⑨ §11 关闭 4 项开放决策、补残余风险 |
