# 教材征订系统 · Web 端前端技术规格（SPEC）

> 版本 V1.0.0 · 2026-09-21 · 依据：本仓库 `PRD.md`（V1.1.0）、`02-前端开发计划与决策.md`（v3 复审修订版）、`03-后端开发计划与决策.md`（接口契约基线）
> 定位：PRD 说「做什么/为什么」，本文说「怎么实现」；里程碑、分工与验收标准见 02 号文档 §9。本文与 02 v3 冲突时，以 02 v3 已锁定决策为准。
> 范围：仅 Web 端。小程序端见 `textbook-order-mp` 仓库（任课老师 + 学生，无 admin）。

---

## 1. 技术栈与锁定版本（02 §1.1）

| 项 | 锁定值 | 说明 |
|----|--------|------|
| 框架 | Vue ^3.5（Composition API + `<script setup>` + TS） | 不使用 Options API 混写 |
| 构建 | Vite ^6 | base 走环境变量，见 §3 |
| UI 库 | Element Plus ^2.9 | 主题令牌沿用 MVP 色板（靛蓝 #4F46E5 系） |
| 状态 | Pinia ^2.3 | store 清单见 §7 |
| 路由 | Vue Router ^4.5 | `createWebHistory(import.meta.env.VITE_BASE)` |
| HTTP | axios ^1.7 | 单例 + 拦截器，见 §6 |
| 测试 | Vitest + @vue/test-utils | 见 §11 |
| 包管理 | npm（`package-lock.json` 入库） | 不引入 pnpm |
| 规范 | ESLint + Prettier | M1 day1 随脚手架落盘 |
| mock | vite-plugin-mock | 仅 local 环境，见 §3 |

## 2. 工程结构

```
textbook-order-web/
├─ PRD.md / SPEC.md / 02-前端开发计划与决策.md   # 需求 / 规格 / 计划三件套
├─ index.html
├─ vite.config.ts                                # base、proxy、build
├─ .env.local / .env.trial / .env.school         # VITE_BASE / VITE_PROXY_TARGET（无密钥）
├─ src/
│  ├─ main.ts / App.vue
│  ├─ router/
│  │  ├─ routes.ts                               # 静态路由表 + meta.permission
│  │  └─ guards.ts                               # 守卫：鉴权/改密/权限码
│  ├─ stores/                                    # §7 五个 store
│  │  ├─ auth.ts / window.ts / notice.ts / task.ts / config.ts
│  ├─ api/                                       # §6 接口模块
│  │  ├─ http.ts                                 # axios 单例 + 拦截器 + refresh 队列
│  │  └─ auth.ts / me.ts / semester.ts / org.ts / textbook.ts / course.ts
│  │     / people.ts / orderForm.ts / studentOrder.ts / change.ts / notice.ts
│  │     / batch.ts / dashboard.ts / supplier.ts
│  ├─ directives/perm.ts                         # v-perm
│  ├─ components/                                # §8 全局组件
│  ├─ composables/                               # useCountdown / usePolling
│  ├─ views/
│  │  ├─ login/ profile/ error/
│  │  ├─ admin/    # dashboard, accounts, org, semester-window, textbooks,
│  │  │            # courses, people, review, order-data, export-center, notices
│  │  ├─ secretary/  # college-records, college-export, change-requests, window-status
│  │  ├─ teacher/    # my-courses, order-form, my-submissions
│  │  ├─ student/    # book-select, my-orders
│  │  └─ supplier/   # purchase-list, supplier-export
│  ├─ styles/      # Element Plus 主题令牌覆盖
│  └─ utils/
└─ tests/          # unit/ + components/
```

## 3. 构建与环境（02 §2 · Q13）

- 环境变量仅两项前端配置：`VITE_BASE`（部署子路径）、`VITE_PROXY_TARGET`（仅 dev 用代理目标）。**代码零域名/IP 硬编码**。
- vite.config.ts：`base: process.env.VITE_BASE || '/'`；dev proxy `'/api' → VITE_PROXY_TARGET`；构建产物 `dist/`。

| 环境 | VITE_BASE | 说明 |
|------|-----------|------|
| local | `/` | vite dev + vite-plugin-mock（mock 挂 `/api` 前缀；契约冻结后 proxy 切 `VITE_PROXY_TARGET`，页面代码零改动，Q5） |
| trial | `/textbook/` | moonzj.com 子路径，根域已有服务零冲突 |
| school | `/textbook/`（按校方路径可调，仅改 env） | 移交重部署 |

- 生产 Nginx（部署手册交付物，02 §2 / §9 M5）：

```nginx
location /textbook/ {
    alias /var/www/textbook-order-web/;
    index index.html;
    try_files $uri $uri/ /textbook/index.html;   # history 模式回退
}
location /api {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

## 4. 路由与权限（02 §3）

- 权限码命名 `模块:业务:操作`，**下表为前端提议值，以后端 `sys_permission` 为准，M1 契约冻结日终定**。
- 守卫流程：`beforeEach` → 未登录跳 `/login` → `must_change_password=true` 强制跳改密（不可跳过）→ 校验 `route.meta.permission`（不在 `auth.permissions` 内）→ 重定向 `/403`。
- 侧边栏菜单 = 全量路由表按 permissions 过滤生成；`v-perm` 指令对无码按钮**移除 DOM**（非置灰）。

| 路径 | 页面 | 角色 | 权限码（提议） | 里程碑 |
|------|------|------|----------------|--------|
| /login | 登录 | 公共 | — | M1 |
| /profile | 个人中心（改密/切换身份） | 全部 | — | M1 |
| /403, /404 | 兜底 | — | — | M1 |
| /dashboard | 数据看板 | 超管 | dashboard:view | M4 |
| /accounts | 账号管理 | 超管 | sys:user:manage | M2 |
| /org | 组织管理 | 超管 | org:manage | M2 |
| /semester-window | 学期与窗口引擎 | 超管 | semester:manage | M2 |
| /textbooks | 教材库 | 超管 | textbook:manage | M2 |
| /courses | 课程与任课管理 | 超管 | course:manage | M2 |
| /people | 学生/教师管理（含异动审批工作台页签） | 超管 | people:manage · change:approve | M2 + M4 |
| /review | 复核工作台 | 超管 | review:form | M3 |
| /order-data | 征订数据 | 超管 | data:order:view | M3 |
| /export-center | 导出中心 | 超管 | export:center | M3 |
| /notices | 通知管理 | 超管 | notice:task:manage | M4 |
| /college-records | 本院征订记录 | 秘书 | data:college:view | M3 |
| /college-export | 本院导出（签字版式） | 秘书 | export:college | M3 |
| /window-status | 窗口状态（只读） | 秘书 | window:view | M2 |
| /change-requests | 异动申请 | 秘书 + 教师 | change:submit | M4 |
| /my-courses | 我的课程 | 教师 | order:form:view | M3 |
| /order-form | 填报教材 | 教师 | order:form:fill | M3 |
| /my-submissions | 我的提交记录 | 教师 | order:form:view | M3 |
| /book-select | 选书 | 学生 | student:order:fill | M3 |
| /my-orders | 我的选购记录 | 学生 | student:order:view | M3 |
| /purchase-list | 订购清单 | 供货商 | supplier:list:view | M3 |
| /supplier-export | 清单导出 | 供货商 | supplier:export | M3 |

## 5. 会话与令牌（02 §3.1 · Q6）

- **双令牌默认方案**：access token 存内存（Pinia，不落 storage）；refresh token 由后端 `Set-Cookie`（HttpOnly + SameSite=Strict + Path=/api/auth）。**降级方案**：若 M1 契约不支持 Set-Cookie，则双令牌落 localStorage（XSS 面增大，记入风险表）——二选一为 M1 契约冻结清单条目。
- **401 三类处理**（全局异常表见 PRD 功能 7）：

| 401 语义 | 处理 |
|---------|------|
| access 过期 | 静默 refresh（`POST /api/auth/refresh`），成功后重放原请求 |
| refresh 失效 / 角色版本失效 | 清空会话态 → 跳 `/login`，提示「登录已过期，请重新登录」/「账号信息已变更，请重新登录」 |
| 账号被停用 | 同上强制登出，提示「账号已停用，请联系教材室」——下一次请求即踢 |

- **并发 401 single-flight**：首个 401 触发 refresh 并挂起后续请求队列；refresh 完成后统一重放或登出；refresh 期间新请求直接入队，不重复发起。
- 登出 / 切换身份清理序列：清 Pinia 全部 store → 清路由动态注册 → 跳转目标页（切换身份回到工作台首页并重拉菜单与数据，A4-A）。

## 6. 接口消费层（02 §3.2 · O3）

- axios 单例：`baseURL: '/api'`（相对路径，硬约束）、`timeout: 15s`；请求拦截器注入 `Authorization: Bearer <access>`；响应拦截器解包 `{code, message, data}` 包络（**以 03 M1 契约 rest-api-conventions 为准**）。
- 分页参数 `page`/`size`（服务端分页强制，F-R1）；错误码→处理矩阵：401 按 §5、403 守卫重定向、409 提示「本期征订已截止，提交未生效」（S5/R8）、5xx「服务开小差了，请重试」、网络失败「网络异常，请稍后重试」——文案令牌统一取 PRD 功能 7。
- 接口模块（路径为提议值，M1 契约冻结为准）：`auth`（login/refresh/logout）、`me`（permissions/password/switch-role）、`semester`（CRUD + activate/archive + window open/close/extend）、`org`、`textbook`、`course`、`people`、`orderForm`（submit/resubmit/review）、`studentOrder`、`change`（单条/批量提交、批次进度、审批）、`notice`（unconfirmed/confirm/task/progress/failures）、`batch`（导入批次进度）、`exportTask`（创建/进度/一次性授权下载）、`dashboard`（统计）、`supplier`（03 §3.2 物理隔离 `/api/supplier/**`）。
- **M1 契约冻结清单新增条目**（02 §3.2）：① refresh 流程与 401 错误码细分；② 字段审查回显格式 `field`/`rule`/`message`；③ `system_config` 数量上限读取接口。

## 7. 状态管理（Pinia）

| store | state | 关键 actions / getters |
|-------|-------|------------------------|
| auth | access token（内存）、user、roles、permissions Set、currentRole、mustChangePassword | login / logout / switchRole（切换后重拉权限与菜单）/ refreshPermissions |
| window | windowStatus、windowStart/End、serverTimeOffset | fetch（进入页面 + 轮询）；getter `canFill/canOrder`；倒计时 = `window_end - (clientNow + offset)`（PRD 功能 2：不信任本地时钟） |
| notice | unconfirmed 队列、confirming 状态 | fetchUnconfirmed（失败 = fail-open 放行，下次进入重查）/ confirm(taskId)（失败弹窗保留可重试，不放行）；队列逐条弹出直至清空（Q7：含已停止重发但未确认任务） |
| task | import/export 批次 {batchId, progress, status, errorSummary} | poll(batchId)（2s 起步、退避至上限 10s、页面离开即停）|
| config | system_config 缓存（数量上限等） | load()（填报表单预校验读取，O14） |

交互竞态（02 §3.3）：强制改密弹窗优先于通知弹窗，未改密不发业务请求；`/notice/unconfirmed` 失败 fail-open。

## 8. 全局组件规格

| 组件 | 职责 | 要点 |
|------|------|------|
| ForceChangePasswordModal | 首登强制改密 | 不可关闭/跳过，优先级最高 |
| GlobalBlockingNotice | 未确认通知逐条阻塞弹出 | 自绘 el-dialog 居中；「收到」→ confirm → 下一条；全部确认才放行 |
| WindowBanner | 全局窗口三态横幅 + 倒计时 | not_open/open/closed 文案按 PRD 功能 2；closed 锁定填报/选购入口 |
| PermButton + v-perm | 按钮级权限 | 无权限码移除 DOM |
| ServerTable | 列表页基座 | 筛选区 + el-table + 服务端分页（page/size）；空/载/错三态统一 |
| ImportWizard | Excel 异步导入 | 上传（.xlsx ≤10MB）→ 批次轮询进度 → 结果摘要 + 错误明细下载 + 前 N 行预览（F-R1）|
| ExportButton | 导出按钮 | 预估 ≤5000 行同步下载；>5000 行建 export_task + 轮询 + 一次性授权链接下载（Q16）|
| SemesterLifecyclePanel | 学期生命周期（Q1） | draft→active 激活二次确认（失败回退提示）、归档；同一时刻仅一个 active 的前端校验 |
| FieldCheckResult | 字段审查回显（O14） | 按 `field`/`rule`/`message` 逐字段标红 + 修复提示 |
| BatchProgressDrawer | 异动批量 change_request 进度（Q10） | 复用 task 轮询；展示逐行审查结果 |
| RoleSwitcher | 切换身份（A4-A） | 个人中心内；切换后全量重载 |

## 9. 页面实现边界

- 页面交互、状态机、字段校验、文案以本仓库 **PRD.md** 为准（四、功能说明 + 功能 7 令牌），SPEC 不重复；页面-里程碑归属以 **02 v3 §6** 六表为准（无孤儿页面）。
- 关键补充规则：
  - 教师异动申请与秘书**同链两级审查**（D9），页面不出现"直接生效"路径；
  - 秘书导出为**签字版式 Excel**（Q4：样张由田老师提供，逾期降级标准表格 + 签字栏占位；后端 M3、验收 M5）；
  - 通知管理页仅超管可见；系统自动任务（窗口变更）只读展示（02 §6.2）；
  - 供货商页面无任何学生字段渲染路径，导出后端审计留痕（PRD 功能 6）；
  - 学生提交确认弹窗底部固定小字「价格和版本以最终出版单位供应为准」（最新决策 2）。

## 10. 测试规格（02 §10 · O7）

| 层 | 内容 | 里程碑 |
|----|------|--------|
| Vitest 单测 | 窗口三态流转与倒计时（含时钟偏移）、v-perm 指令移除 DOM、401 single-flight 队列、导出 5000 行阈值分流 | M1 起贯穿 |
| 组件测试 | GlobalBlockingNotice 逐条确认队列与 fail-open、ImportWizard 轮询与错误回显、SemesterLifecyclePanel 激活/回退 | M2-M4 |
| E2E 联调 | `webapp-testing`（Playwright）：5 角色走查 + 越权矩阵 + console 日志留档 | M5 |
| 小程序专项 | `weixin-devtools-mcp`（跨仓库：textbook-order-mp）教师填报/选购/弹窗通知走查 | M3 / M5 |

## 11. 风险与开放决策

- 风险登记 F-R1~F-R6 见 02 v3 §9.3（万行渲染 / 订阅授权率 / 体验版条件 / moonzj 共存 / base 影响面 / 浏览器兼容）。
- 开放决策（均有默认值，随 M1 契约冻结或外部输入关闭）：

| # | 事项 | 默认 |
|---|------|------|
| 1 | refresh token 存储方案 | httpOnly Cookie，契约不支持则降级 localStorage |
| 2 | 权限码终值 | 以 M1 冻结的 sys_permission 为准 |
| 3 | 分页参数命名 | page/size，契约终定 |
| 4 | 机房浏览器（Q14） | 仅现代浏览器，逾期按默认 |
| 5 | 签字版式样张（Q4） | 一周内提供，逾期标准表格 + 占位 |

## 12. 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| V1.0.0 | 2026-09-21 | 首版：基于 02 号文档 v3（16 问复审拍板）与本仓库 PRD V1.1.0 撰写 |
