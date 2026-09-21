# 教材征订系统 · Web 端（MVP）

高校教材征订系统的 Web 前端：Vue 3 + Vite 6 + Element Plus + Pinia + Vue Router + TypeScript。
面向教材室（超级管理员）、学院秘书、任课老师、学生、教材供货商五类角色，覆盖
「教师填报 → 系统字段审查 → 超管内容复核 → 学生选购 → 多维度导出 → 通知确认闭环」主链路。

需求与规格基线：`PRD.md`（V1.1.0）、`SPEC.md`（V1.0.0）、`02-前端开发计划与决策.md`（v3）。

## 快速开始

```bash
npm install          # 安装依赖（package-lock.json 已入库）
npm run dev          # 本地开发：http://127.0.0.1:5173 （挂 mock，VITE_BASE=/）
npm run build        # 生产构建（默认 .env：VITE_BASE=/textbook/）
npm run build:trial  # moonzj.com 试运行构建
npm run build:school # 移交学校重部署构建
npm run test         # Vitest 单元测试 + 组件测试
npm run typecheck    # vue-tsc 类型检查
npm run lint         # ESLint（零告警）
```

## 环境与部署

| 环境     | 模式          | VITE_BASE    | VITE_MOCK | 说明                                        |
| -------- | ------------- | ------------ | --------- | ------------------------------------------- |
| 本地开发 | `development` | `/`          | `true`    | `npm run dev`，接口走 vite-plugin-mock      |
| 试运行   | `trial`       | `/textbook/` | `false`   | moonzj.com 子路径，`/api` 由 Nginx 反代     |
| 移交学校 | `school`      | `/textbook/` | `false`   | 仅改 env 与 Nginx 配置                      |
| 生产构建 | `production`  | `/textbook/` | `false`   | `npm run build`（默认值，等价移交学校路径） |

- 代码零域名/IP 硬编码：API 一律相对路径 `/api`，base 走 `VITE_BASE`。
- **本地开发无需任何 env 文件**：`npm run dev` 默认 `base=/` + 挂 mock（`vite.config.ts` 按模式取默认值）；
  `VITE_BASE` / `VITE_MOCK` 未配置时才回落到模式默认，显式配置优先。
- trial / school 的差异见 `.env.trial` / `.env.school`（无密钥）；样例见 `.env.example`。
- mock 与真实后端可无缝切换：契约冻结后 `VITE_MOCK=false` 并配置 `VITE_PROXY_TARGET`，页面代码零改动（Q5）。
- Nginx 片段见 `SPEC.md` §3。

## mock 演示账号

仅在本地开发环境（mock 启用时）生效，账号由教材室分发制模拟。
**口令一律按 PRD 规则「学号/工号后 6 位」派生**（种子数据不落任何明文口令，与真实后端口径一致）：

| 账号       | 口令（后 6 位） | 角色           | 说明                              |
| ---------- | --------------- | -------------- | --------------------------------- |
| `900001`   | `900001`        | 教材室（超管） | 全部管理功能                      |
| `800001`   | `800001`        | 学院秘书       | 计算机学院，只读 + 本院导出       |
| `800002`   | `800002`        | 秘书 + 教师    | 多角色，可切换身份                |
| `700001`   | `700001`        | 任课老师       | 首登强制改密演示                  |
| `20230101` | `230101`        | 学生           | 首登强制改密演示                  |
| `20230102` | `230102`        | 学生           | 有 2 条未确认通知（阻塞弹窗演示） |
| `600001`   | `600001`        | 教材供货商     | 仅四类字段的只读清单              |

> 首次登录后须按强制改密流程设置新口令（8 位以上含字母和数字），新口令在内存 mock 中生效直到重启 dev server。

## 目录结构

```
src/
├─ api/            # 接口模块（http 单例 + 15 个业务模块）
├─ components/     # 全局组件（改密弹窗/阻塞通知/窗口横幅/ImportWizard/ExportButton 等 11 个）
├─ composables/    # useCountdown / usePolling
├─ directives/     # v-perm 按钮级权限（无码移除 DOM）
├─ layouts/        # DefaultLayout（侧边栏按权限码动态生成）
├─ router/         # 静态路由表 + 守卫（鉴权/强制改密/权限码）
├─ stores/         # auth / window / notice / task / config
├─ styles/         # Element Plus 主题令牌（靛蓝 #4F46E5 系）
├─ types/          # 领域模型
├─ utils/          # 常量（文案令牌/错误码/权限码）、格式化、校验
└─ views/          # 23 个页面（login/profile/error + admin×11 + secretary×4 + teacher×3 + student×2 + supplier×2）
mock/              # vite-plugin-mock 内存数据库与全量接口（仅本地开发）
tests/             # Vitest 单测 + 组件测试
```

## 关键实现约定

- **权限码**：`模块:业务:操作`（提议值见 `src/utils/constants.ts`），以后端 `sys_permission` 为准；
  路由守卫 + 动态菜单 + `v-perm` 三道显示层控制，数据隔离完全由后端执行。
- **会话**：access token 存 Pinia 内存（不落 storage）；401 三类细分（access 过期静默 refresh 重放 /
  refresh 失效 / 角色版本失效 / 账号停用强制登出），并发 401 single-flight。
- **窗口引擎**：倒计时 = `window_end - (clientNow + serverTimeOffset)`，不信任本地时钟。
- **通知**：打开 Web 拉取未确认通知，自绘居中 Modal 逐条阻塞弹出；拉取失败 fail-open。
- **导出**：≤5000 行同步下载，>5000 行建 export_task 轮询后经一次性授权链接下载（Q16）。
- **导入**：.xlsx ≤10MB 前置校验，服务端异步解析，批次进度轮询（2s 起步退避至 10s）+ 错误明细下载。

## 测试

```bash
npm run test        # 42 个用例：窗口三态/时钟偏移、v-perm、401 single-flight、导出阈值、
                    # 字段校验规则、阻塞通知队列与 fail-open、ImportWizard 轮询与错误回显、
                    # 学期生命周期激活/回退
```
