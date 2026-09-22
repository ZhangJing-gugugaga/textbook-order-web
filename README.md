# 教材征订系统 · Web 端（MVP）

高校教材征订系统的 Web 前端：Vue 3 + Vite 6 + Element Plus + Pinia + Vue Router + TypeScript。
面向教材室（超级管理员）、学院秘书、任课老师、学生、教材供货商五类角色，覆盖
「教师填报 → 系统字段审查 → 超管内容复核 → 学生选购 → 多维度导出 → 通知确认闭环」主链路。

需求与规格基线：`PRD.md`（V1.1.0）、`SPEC.md`（V1.1.0）、`02-前端开发计划与决策.md`（v3）。
**接口契约基线**：后端 `textbook-order-server/API.md`（V1.0.2 · 94 端点）+ `GET /v3/api-docs`。
**部署与移交**：`docs/DEPLOYMENT.md`（部署手册）、`docs/HANDOVER-CHECKLIST.md`（移交检查单）。

## 快速开始

```bash
npm ci               # 安装依赖（严格按 package-lock.json）
npm run dev          # 本地开发：http://127.0.0.1:5173（/api 代理到 VITE_PROXY_TARGET）
npm run build        # 生产构建（默认 base=/textbook/，含 vue-tsc 类型门禁）
npm run build:trial  # moonzj.com 试运行构建
npm run build:school # 移交学校重部署构建
npm run verify       # 一键跑全部质量门禁（typecheck → lint → format:check → test → build）
```

单测 / E2E / 格式：

```bash
npm run test           # Vitest 单元测试 + 组件测试（76 例）
npm run test:coverage  # 带覆盖率与阈值门禁
npm run test:e2e:install  # 首次运行需装 Chromium（约 115MB）
npm run test:e2e       # Playwright 端到端（29 例，自动构建并起 preview，无需后端）
npm run typecheck      # vue-tsc 类型检查
npm run lint           # ESLint（零告警）
npm run format:check   # Prettier 格式检查
```

启动前端前需先起后端（默认 `http://127.0.0.1:8080`）；接口一律相对路径 `/api`，
dev/preview 由 Vite proxy 转发，试运行/移交由 Nginx 反代。

## 环境与部署

| 环境     | 模式          | VITE_BASE    | VITE_PROXY_TARGET       | 说明                                                          |
| -------- | ------------- | ------------ | ----------------------- | ------------------------------------------------------------- |
| 本地开发 | `development` | `/`          | `http://127.0.0.1:8080` | `npm run dev`，`/api` 代理到本机后端                          |
| 试运行   | `trial`       | `/`          | 后端地址                | 独立子域名根目录，`/api` 由 Nginx 反代                        |
| 移交学校 | `school`      | 按校方路径   | 后端地址                | 仅改 env 与 Nginx 配置（子域名用 `/`，子路径用 `/textbook/`） |
| 生产构建 | `production`  | `/textbook/` | —（构建期不参与）       | `npm run build`（默认子路径，子域名部署请用 `build:trial`）   |

- 代码零域名/IP 硬编码：API 一律相对路径 `/api`，base 走 `VITE_BASE`。
- **`VITE_BASE` 必须与部署路径一致**，否则静态资源 404：
  - 独立子域名（当前线上 `textbooksorder.moonzj.com`）→ `VITE_BASE=/`；
  - 主域子路径（如 `moonzj.com/textbook/`）→ `VITE_BASE=/textbook/`。
  - 构建后自检：`grep -o 'src="[^"]*"' dist/index.html`，路径前缀应与部署路径相同。
- **本地开发无需任何 env 文件**：`npm run dev` 默认 `base=/` + 代理到 `127.0.0.1:8080`
  （`vite.config.ts` 按模式取默认值，显式配置优先）。
- trial / school 的差异见 `.env.trial` / `.env.school`（无密钥）；样例见 `.env.example`。
- **Nginx 完整配置（含安全响应头与缓存分层）、回滚流程与故障排查见 `docs/DEPLOYMENT.md`。**
- 浏览器兼容矩阵：Chrome ≥ 87 / Edge ≥ 88 / Firefox ≥ 78 / Safari ≥ 14
  （`package.json` browserslist 与 `build.target` 同源声明）。
- **移动端浏览器不在支持范围内**（明确非目标，非缺陷）：全仓无响应式断点，侧边栏固定 232px，
  手机浏览器可打开但布局不可用。移动端业务由独立小程序仓库 `textbook-order-mp` 承载
  （任课老师填报 + 学生选购）。Web 端面向桌面浏览器（矩阵如上）。

## 联调测试账号

账号由教材室分发制；初始口令 = 学号/工号后 6 位，首次登录须校验手机号后 4 位并强制改密。
种子账号清单与口令见后端 `README.md`（`db/data-seed.sql` 同源），常用正常态账号：

| 账号       | 口令        | 角色           | 说明                              |
| ---------- | ----------- | -------------- | --------------------------------- |
| `900001`   | `Admin@123` | 教材室（超管） | 全部管理功能（供货商模块除外）    |
| `800101`   | `Sec@12345` | 学院秘书       | 计算机学院，本院只读 + 签字版导出 |
| `700101`   | `Tea@12345` | 任课老师       | 数据结构 / 软工2023-1             |
| `700103`   | `Tea@12345` | 教师 + 秘书    | 多角色，可切换身份                |
| `20230101` | `Stu@12345` | 学生           | 软工2023-1                        |
| `600001`   | `Sup@12345` | 教材供货商     | 仅四类字段的只读清单              |

另有「首登待改密」「停用」账号各角色各一，用于验证首登拦截与停用即时踢下线（见后端 README）。

> ⚠️ **上表仅用于本地与试运行环境。生产环境严禁灌入同源演示种子数据**——
> 这些口令按「学号/工号后 6 位」派生，可被轻易猜解。
> 移交时请按 `docs/HANDOVER-CHECKLIST.md` 的 D 组逐项确认。

## 目录结构

```
src/
├─ api/            # 接口模块（http 单例 + 12 个业务模块，路径对齐后端 API.md）
├─ components/     # 页面内显式 import 的组件（10 个：改密弹窗/阻塞通知/窗口横幅/
│                  #   ImportWizard/ExportButton/PermButton/ServerTable/…）
├─ composables/    # useCountdown（自带卸载清理）
├─ layouts/        # DefaultLayout（侧边栏按权限码动态生成）
├─ router/         # 路由表 + 守卫（会话恢复/鉴权/强制改密/落地页解析/权限码）
├─ stores/         # auth / window / notice / task / config
├─ styles/         # Element Plus 主题令牌（靛蓝 #4F46E5 系）
├─ types/          # 领域模型 + 自动生成的 d.ts（unplugin，入库勿手改）
├─ utils/          # constants（文案令牌/错误码/权限码/状态字典）、format、validate、
│                  #   session（refresh token 持久层）、monitor（错误监控接入点）、icons
└─ views/          # 26 个页面（login/profile/error + admin×11 + secretary×4 + teacher×3 + student×2 + supplier×2）
tests/             # Vitest 单测 + 组件测试（12 文件 / 76 例）
e2e/               # Playwright 端到端（4 文件 / 29 例，接口层用路由拦截打桩）
docs/              # 部署手册 + 移交检查单
```

## 关键实现约定

- **权限码**：`模块:业务:操作`，取后端 `sys_permission`（M1 冻结 37 条，真源为
  `src/utils/constants.ts` 的 `PERMISSIONS`）。三道显示层控制：路由守卫 + 动态菜单 +
  **`PermButton` 组件**（无权限码移除 DOM）。数据隔离完全由后端执行，前端不冒充安全边界。
- **落地页**：根路径 `/` **不做静态 redirect**，由守卫调用 `resolveLandingPath(permissions)`
  按权限码解析（超管→看板、教师→我的课程、学生→选书、秘书→本院征订记录、供货商→订购清单）。
  登录、访问根路径、切换身份三处共用同一实现。
- **会话**：access token 存 Pinia 内存；refresh token 落 localStorage（后端契约 refreshToken 走请求体、
  不用 Set-Cookie，故采用 `SPEC.md` §5 记载的降级方案）。首屏用 refresh 静默恢复会话。
  401 三类细分：`TOKEN_EXPIRED` 静默 refresh 重放 / `REFRESH_INVALID`、`ACCOUNT_DISABLED` 强制登出；
  并发 401 single-flight。
  **多标签页**：refresh token 轮换后，读取一律以持久层为准并监听 `storage` 事件同步，
  避免 A 页刷新导致 B 页被强制登出（`src/utils/session.ts`）。
- **错误码**：后端 `ErrorCode` 字符串令牌（如 `FIELD_CHECK_FAILED`、`WINDOW_CLOSED`），
  字段审查类错误的逐项明细在 `error.data`（`[{field, rule, message}]`）。
- **403 分流**：`FIRST_LOGIN_REQUIRED` 跳首登引导页（不跳登录页）；其余 `FORBIDDEN` 跳 403 页。
  因此**权限受限的全局数据必须前置判断**（见 `stores/config.ts`、`stores/window.ts`），
  避免公共/受限请求 403 把用户弹出当前页。
- **窗口引擎**：倒计时 = `windowEnd - (clientNow + serverTimeOffset)`，不信任本地时钟；
  学生选购额外受 `channelOpen` 约束。
- **通知**：登录后拉取未确认通知，自绘居中 Modal 逐条阻塞弹出；拉取失败 fail-open；confirm 幂等（204）。
- **导出**：同步/异步由后端 `export.sync_row_threshold` 裁决，前端以响应 Content-Type 分流
  （xlsx 流直接下载 / JSON 建任务轮询后经一次性 token 下载）；轮询失败展示错误与重试入口。
- **导入**：.xlsx ≤ `import.max_file_mb` 前置校验，服务端异步解析，批次进度轮询（2s 起步退避至 10s）
  - 错误明细下载；模板下载带鉴权头，走 blob 而非 `<a href>`；轮询失败展示错误与重试入口。
- **列表页**：统一使用 `ServerTable` 基座（泛型 `T`，页面提供 `fetcher({page,size})` 与列定义），
  由基座兜住分页、空/载/错三态与**请求序号**（并发响应只采纳最后一次）。
  筛选条件变化后由页面显式调 `reload()`，不做深度 watch。
- **包体积**：Element Plus 全量按需引入（`unplugin-vue-components` + `unplugin-auto-import`），
  图标按需注册（`src/utils/icons.ts`）。分包**只能用对象形式**的 `manualChunks`——
  函数形式会绕过 tree-shaking 让入口体积从 205KB 反弹到 951KB（详见 `SPEC.md` §3.3）。
- **错误监控**：`src/utils/monitor.ts` 装配全局 `error` / `unhandledrejection` 钩子，
  默认输出 console；接入监控平台只需调用 `setErrorReporter()`（上报内容不含令牌与个人信息）。
- **空态**：后端 Jackson `NON_NULL` 策略下 `data=null` 时整个 `data` 键被省略，
  空态判断统一用 `== null` 或可选链。

## 测试

```bash
npm run test           # 76 例：401 三类语义与 single-flight、403 分流（首登拦截/越权）、
                       # 窗口三态与时钟偏移、路由落地页解析（含根路径回归）、
                       # ServerTable 请求序号/分页/三态、task 轮询失败与重试、
                       # refresh token 持久层与多标签页同步、错误上报、
                       # Content-Disposition 文件名解析、字段校验规则、
                       # 阻塞通知队列与 fail-open、ImportWizard 轮询与错误回显、
                       # 学期生命周期激活/回退、PermButton 移除 DOM
npm run test:e2e       # 29 例：五角色落地页解析（根路径回归）、认证与越权矩阵、
                       # 侧边栏菜单过滤、按钮级权限、主链路走查、窗口三态、
                       # 阻塞通知、列表错误态与重试；接口层由 Playwright 路由拦截打桩
npm run verify         # 本地跑 CI 的全部门禁
```

- **单测覆盖率门禁**统计 `api/http.ts`、`stores`、`utils`、`composables`、`router`、`components`；
  26 个页面视图由 E2E 覆盖，不纳入单测覆盖率（详见 `SPEC.md` §10.3）。
- **CI**：`.github/workflows/ci.yml`，两个并行 job（quality + e2e），任一失败阻断合并。

跨仓库端到端联调（需后端在跑，覆盖真实数据库语义）：脚手架
`E:\Desktop\work\TIAN\.it-harness`（H2 MySQL 模式起后端 + `integration.mjs` 约 117 项断言，
覆盖 5 角色全流程与错误语义矩阵）。
