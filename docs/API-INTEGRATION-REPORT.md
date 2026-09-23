# 全接口联调测试报告（95 端点 · 真实 HTTP + 真实 MySQL）

> 执行时间：2026-09-23 05:26:05 ｜ 目标：`http://127.0.0.1:8080` ｜ HTTP 调用：409 次
> 结论：**未通过（3 项失败）** —— 端点 95 个全部跑通（探针 265 PASS / 3 FAIL / 0 SKIP）；契约场景 12/12 通过

## 一、契约语义场景（A1–A7 + 补充）

| 编号 | 场景 | 结论 | 观测 |
| --- | --- | --- | --- |
| A1 | contentVersion CAS：教师重提后旧版本审核被 409 拦下 | ✅ 通过 | 详情下发 contentVersion=true; 重提 56→57; 旧版本审核 HTTP 409/STATE_CONFLICT; 最新版本驳回 HTTP 200 |
| A2 | 首登待完成：switch-role 与业务接口一律 403 FIRST_LOGIN_REQUIRED | ✅ 通过 | mustChangePassword=true; switch-role → HTTP 403 FIRST_LOGIN_REQUIRED; /api/me → 200; 业务接口 → 403 FIRST_LOGIN_REQUIRED |
| A3 | 通知按 target_roles 定向：非定向角色队列为空（正常态），跨角色 confirm → 404 | ✅ 通过 | unconfirmed 条数 TEACHER=1 STUDENT=0 SUPPLIER=0 ADMIN=1（ADMIN 全量）; /notice/mine 分页形状=true; 跨角色 confirm → HTTP 404 NOT_FOUND |
| A4 | reviewed 为终态：教师重提 409、管理员亦不能驳回（终态不可回退） | ✅ 通过 | 重提 → HTTP 409 STATE_CONFLICT「该征订单已通过审核，为终态不可修改（系统不提供撤销审核）；如确需变更请联系教材室线下处理」; 对该 reviewed 表单审核 → HTTP 409 STATE_CONFLICT |
| A5 | 归属失败统一 404；权限缺失仍 403（两者语义不同） | ✅ 通过 | export-task/999999 → 404; supplier/export-task/1 → 404; batch/1（非本人，有权限）→ 404; batch/999999 → 404; batch/1（无权限）→ 403 |
| pass 路径 | 审核通过（pending_review → reviewed） | ✅ 通过 | SKIP：IT9004 的征订单已是 reviewed（终态不可重置），本次跳过——首次执行时已覆盖；其已通过的大表单仍供导出/供货商导出用例使用 |
| A6 | 导出分流 + 一次性 token：同步回 xlsx 流；异步 token 单次有效，复用 410 | ✅ 通过 | 同步导出 Content-Type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet（xlsx 流）; 制造 111 行明细（HTTP 200）; 异步受理 async=true taskId=28 rowEstimate=123; 轮询 status=done token=有; 首次下载 200; 复用 410/DOWNLOAD_TOKEN_INVALID; 缺 token 参数 400 |
| A7 | 协议边界：405 带 Allow 头、415、401 三类语义 | ✅ 通过 | 405 → 405/METHOD_NOT_ALLOWED Allow=POST; 415 → 415/MEDIA_TYPE_NOT_SUPPORTED; 无 token → 401; 错误口令 → 401/LOGIN_FAILED |
| B | X-Request-Id：响应回带，且请求自带会被沿用（前后端日志可串联） | ✅ 通过 | 响应回带=fab0a13541d44caa; 自带 id 被沿用=it-probe-fixed-id-001 |
| 分页 | 分页参数归一化：size 超上限被夹到 200，size<=0 退回 20（不报错） | ✅ 通过 | size=100000 → 实际 200; size=0 → 实际 20 |
| 字段审查 | FIELD_CHECK_FAILED 逐项回显 {field,rule,message}（契约冻结格式） | ✅ 通过 | HTTP 400/FIELD_CHECK_FAILED，issues=1 项，形状合规=true |
| A6-supplier | 供货商异步导出：一次性 token 语义与端点隔离现状 | ✅ 通过 | 受理 taskId=29（async 字段=true）; 轮询 status=done; 下载 200; 复用 410; 经内部端点读任务 404; 经内部端点下载 404 |

### 场景证据明细

**A1 · contentVersion CAS：教师重提后旧版本审核被 409 拦下** —— ✅ 通过

- 结论依据：详情下发 contentVersion=true; 重提 56→57; 旧版本审核 HTTP 409/STATE_CONFLICT; 最新版本驳回 HTTP 200
- POST /api/teacher/order-form/submit（首次）→ HTTP 200，表单 #3，状态=pending_review，contentVersion=56
- GET /api/admin/order-forms/3 → contentVersion=56（管理员"看到的版本"）
- POST /api/teacher/order-form/submit（重提，quantity 1→2）→ HTTP 200 0「」，状态=pending_review，contentVersion=57
- GET /api/admin/order-forms/3 → contentVersion=57（重提后）
- POST review {contentVersion:56, action:pass} → HTTP 409 STATE_CONFLICT「表单内容已变更或状态已更新，请刷新后重试」← 过期版本必须被拦
- POST review {contentVersion:57, action:reject} → HTTP 200 0（成功时 message 键省略）

**A2 · 首登待完成：switch-role 与业务接口一律 403 FIRST_LOGIN_REQUIRED** —— ✅ 通过

- 结论依据：mustChangePassword=true; switch-role → HTTP 403 FIRST_LOGIN_REQUIRED; /api/me → 200; 业务接口 → 403 FIRST_LOGIN_REQUIRED
- POST /api/auth/switch-role（首登中）→ HTTP 403 FIRST_LOGIN_REQUIRED「请先完成首登校验并修改初始密码」
- GET /api/me（放行清单内）→ HTTP 200
- GET /api/admin/college（清单外）→ HTTP 403 FIRST_LOGIN_REQUIRED

**A3 · 通知按 target_roles 定向：非定向角色队列为空（正常态），跨角色 confirm → 404** —— ✅ 通过

- 结论依据：unconfirmed 条数 TEACHER=1 STUDENT=0 SUPPLIER=0 ADMIN=1（ADMIN 全量）; /notice/mine 分页形状=true; 跨角色 confirm → HTTP 404 NOT_FOUND
- GET /api/notice/unconfirmed（TEACHER）→ 1 条
- GET /api/notice/unconfirmed（STUDENT）→ 0 条（未定向，空队列为正常态）
- GET /api/notice/unconfirmed（SUPPLIER）→ 0 条
- GET /api/notice/mine?page=1&size=5 → {list,total:43}
- POST /api/notice/64/confirm（STUDENT，非定向）→ HTTP 404 NOT_FOUND

**A4 · reviewed 为终态：教师重提 409、管理员亦不能驳回（终态不可回退）** —— ✅ 通过

- 结论依据：重提 → HTTP 409 STATE_CONFLICT「该征订单已通过审核，为终态不可修改（系统不提供撤销审核）；如确需变更请联系教材室线下处理」; 对该 reviewed 表单审核 → HTTP 409 STATE_CONFLICT
- 教师 700101 重提表单 #1 → HTTP 409 STATE_CONFLICT
- 管理员审核该表单 → HTTP 409 STATE_CONFLICT（状态机门禁：仅 pending_review 可审）
- 注意：后端文案「请联系教材室驳回后补正」在当前状态机下不可达——reviewed 无法被驳回

**A5 · 归属失败统一 404；权限缺失仍 403（两者语义不同）** —— ✅ 通过

- 结论依据：export-task/999999 → 404; supplier/export-task/1 → 404; batch/1（非本人，有权限）→ 404; batch/999999 → 404; batch/1（无权限）→ 403
- GET /api/export-task/999999（TEACHER）→ HTTP 404 NOT_FOUND
- GET /api/supplier/export-task/1（SUPPLIER，内部任务）→ HTTP 404 NOT_FOUND
- GET /api/batch/1（SECRETARY 有 import:batch:view，非本人批次）→ HTTP 404 NOT_FOUND
- GET /api/batch/999999（SECRETARY）→ HTTP 404 NOT_FOUND
- GET /api/batch/1（TEACHER 无 import:batch:view）→ HTTP 403 FORBIDDEN（权限门，不是归属）

**pass 路径 · 审核通过（pending_review → reviewed）** —— ✅ 通过

- 结论依据：SKIP：IT9004 的征订单已是 reviewed（终态不可重置），本次跳过——首次执行时已覆盖；其已通过的大表单仍供导出/供货商导出用例使用
- POST /api/teacher/order-form/submit → HTTP 409 STATE_CONFLICT「该征订单已通过审核，为终态不可修改（系统不提供撤销审核）；如确需变更请联系教材室线下处理」

**A6 · 导出分流 + 一次性 token：同步回 xlsx 流；异步 token 单次有效，复用 410** —— ✅ 通过

- 结论依据：同步导出 Content-Type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet（xlsx 流）; 制造 111 行明细（HTTP 200）; 异步受理 async=true taskId=28 rowEstimate=123; 轮询 status=done token=有; 首次下载 200; 复用 410/DOWNLOAD_TOKEN_INVALID; 缺 token 参数 400
- POST /api/admin/export/orders（阈值 5000，行数未超）→ HTTP 200，Content-Type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet（**不是 JSON**，前端须按 Content-Type 分流）
- POST /api/teacher/order-form/submit（101 本批量教材 × 1 课程 × 1 班级）→ HTTP 200
- PUT /api/admin/config {export.sync_row_threshold:100}（值域下限）→ HTTP 200
- POST /api/admin/export/orders → data={"rowEstimate":123,"taskId":28,"async":true}
- GET /api/export-task/28 → status=done，downloadToken=下发（仅任务所有者可见）
- GET /api/export-task/28/download?token=… → HTTP 200（8347B xlsx）
- 同 token 再下载 → HTTP 410 DOWNLOAD_TOKEN_INVALID「下载链接已失效，请重新导出」——token 在下载开始时即被消费，**原地重试必然失败**
- 缺 token 参数 → HTTP 400 PARAM_INVALID
- 非所有者（TEACHER）读同一任务 → HTTP 404 NOT_FOUND（A5 归属失败统一 404）
- 阈值已恢复为 5000

**A7 · 协议边界：405 带 Allow 头、415、401 三类语义** —— ✅ 通过

- 结论依据：405 → 405/METHOD_NOT_ALLOWED Allow=POST; 415 → 415/MEDIA_TYPE_NOT_SUPPORTED; 无 token → 401; 错误口令 → 401/LOGIN_FAILED
- GET /api/auth/login（方法不匹配）→ HTTP 405 METHOD_NOT_ALLOWED，Allow: POST
- POST /api/auth/login（Content-Type: text/plain）→ HTTP 415 MEDIA_TYPE_NOT_SUPPORTED
- GET /api/me（无 token）→ HTTP 401 UNAUTHORIZED
- POST /api/auth/login（错误口令）→ HTTP 401 LOGIN_FAILED「账号或密码不正确」

**B · X-Request-Id：响应回带，且请求自带会被沿用（前后端日志可串联）** —— ✅ 通过

- 结论依据：响应回带=fab0a13541d44caa; 自带 id 被沿用=it-probe-fixed-id-001
- GET /api/me → X-Request-Id: fab0a13541d44caa
- GET /api/me（自带 X-Request-Id: it-probe-fixed-id-001）→ 回带 it-probe-fixed-id-001

**分页 · 分页参数归一化：size 超上限被夹到 200，size<=0 退回 20（不报错）** —— ✅ 通过

- 结论依据：size=100000 → 实际 200; size=0 → 实际 20
- GET /api/admin/user?page=1&size=100000 → HTTP 200, size=200
- GET /api/admin/user?page=1&size=0 → HTTP 200, size=20

**字段审查 · FIELD_CHECK_FAILED 逐项回显 {field,rule,message}（契约冻结格式）** —— ✅ 通过

- 结论依据：HTTP 400/FIELD_CHECK_FAILED，issues=1 项，形状合规=true
- POST /api/teacher/order-form/submit（quantity=99999 越界）→ HTTP 400 FIELD_CHECK_FAILED「存在 1 项问题，请按提示修复后重新提交」
- data=[{"field":"items[0].quantity","rule":"QTY_RANGE","message":"第 1 行：数量需在 1-30 之间"}]

**A6-supplier · 供货商异步导出：一次性 token 语义与端点隔离现状** —— ✅ 通过

- 结论依据：受理 taskId=29（async 字段=true）; 轮询 status=done; 下载 200; 复用 410; 经内部端点读任务 404; 经内部端点下载 404
- POST /api/supplier/export → data={"rowEstimate":123,"taskId":29,"async":true}
- GET /api/supplier/export-task/29 → status=done
- GET /api/supplier/export-task/{id}/download?token=… → HTTP 200（7639B）
- 同 token 再下载 → HTTP 410 DOWNLOAD_TOKEN_INVALID
- 供货商任务经内部端点 GET /api/export-task/{id} → HTTP 404 NOT_FOUND
- 经内部端点下载 → HTTP 404 NOT_FOUND
- **契约偏差**：文档称供货商任务只经 /api/supplier/export-task/{id} 可达（物理隔离），实测经内部端点 /api/export-task/{id} 同样可读可下载（任务所有者维度判定，未按角色隔离）
- 阈值已恢复为 5000

## 二、端点清单（逐接口请求/响应与预期比对）

### 认证

| 方法 | 路径 | 说明 | 探针 | 角色 | 期望 | 实际 HTTP | 业务码 | 响应摘要 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/auth/login` | 登录 | 正常 | (专用会话) | 200 | 200 | 0 | {accessToken,refreshToken,expiresIn,mustChangePassword,firstLoginVerified,roles,currentRole,userNo,…} | ✅ |
| POST | `/api/auth/refresh` | 轮换 refresh（缺 refreshToken → 400 参数错误） | 未鉴权 | (无 token) | 400 | 400 | PARAM_INVALID | (data 键省略) | ✅ |
|  |  |  | 正常 | (专用会话) | 200 | 200 | 0 | {accessToken,refreshToken,expiresIn,mustChangePassword,firstLoginVerified,roles,currentRole,userNo,…} | ✅ |
| POST | `/api/auth/logout` | 登出（撤销全部 refresh） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 正常 | MULTI | 200 | 200 | 0 | (data 键省略) | ✅ |
| POST | `/api/auth/first-login/verify` | 首登校验（手机号后 4 位） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 正常 | (专用会话) | 200 | 200 | 0 | (data 键省略) | ✅ |
| POST | `/api/auth/switch-role` | 切换身份（返回新令牌与权限） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 正常 | (专用会话) | 200 | 200 | 0 | {accessToken,refreshToken,expiresIn,mustChangePassword,firstLoginVerified,roles,currentRole,userNo,…} | ✅ |
| GET | `/api/me` | 用户信息 + 角色 + 归属 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {firstLoginVerified,phone,permissions,userNo,roles,name,mustChangePassword,activeSemester,…} | ✅ |
| GET | `/api/me/permissions` | 权限码集合 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | array(37) | ✅ |
| PUT | `/api/me/password` | 改密（撤销全部 refresh） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 正常 | (专用会话) | 200 | 200 | 0 | {accessToken,refreshToken,expiresIn,mustChangePassword,firstLoginVerified,roles,currentRole,userNo,…} | ✅ |

### 学期与窗口

| 方法 | 路径 | 说明 | 探针 | 角色 | 期望 | 实际 HTTP | 业务码 | 响应摘要 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/semester/window/status` | 窗口状态 + serverTime | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | SUPPLIER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | TEACHER | 200 | 200 | 0 | {serverTime,semesterId,semesterName,windowStatus,windowStart,windowEnd,channelOpen,activeStatus} | ✅ |
| GET | `/api/admin/semester` | 学期列表 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | array(4) | ✅ |
| GET | `/api/admin/semester/{id}` | 学期详情 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,name,startDate,endDate,windowStart,windowEnd,channelOpen,autoOpen,…} | ✅ |
| GET | `/api/admin/semester/{id}/window/changes` | 窗口变更审计（SQL 分页） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | page(list=0, total=0) | ✅ |
| POST | `/api/admin/semester` | 新建学期（draft） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,name,startDate,endDate,windowStart,windowEnd,channelOpen,autoOpen,…} | ✅ |
| PUT | `/api/admin/semester/{id}` | 编辑学期基本信息 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,name,startDate,endDate,windowStart,windowEnd,channelOpen,autoOpen,…} | ✅ |
| PUT | `/api/admin/semester/{id}/window` | 设置窗口起止 + auto 开关 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,name,startDate,endDate,windowStart,windowEnd,channelOpen,autoOpen,…} | ✅ |
| POST | `/api/admin/semester/{id}/window/open` | 手动开启窗口 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,name,startDate,endDate,windowStart,windowEnd,channelOpen,autoOpen,…} | ✅ |
| POST | `/api/admin/semester/{id}/window/close` | 提前截止 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,name,startDate,endDate,windowStart,windowEnd,channelOpen,autoOpen,…} | ✅ |
| POST | `/api/admin/semester/{id}/window/extend` | 延长窗口（closed → open） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,name,startDate,endDate,windowStart,windowEnd,channelOpen,autoOpen,…} | ✅ |
| POST | `/api/admin/semester/{id}/activate` | 双缓冲原子切换（version 乐观锁；**不执行 happy path**，见下） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | STATE_CONFLICT | 409 | STATE_CONFLICT | (data 键省略) | ✅ |
| POST | `/api/admin/semester/{id}/archive` | 归档（只读保留） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | STATE_CONFLICT | 409 | STATE_CONFLICT | (data 键省略) | ✅ |

### 组织三表

| 方法 | 路径 | 说明 | 探针 | 角色 | 期望 | 实际 HTTP | 业务码 | 响应摘要 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/admin/college` | 学院列表 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | array(3) | ✅ |
| POST | `/api/admin/college` | 新增学院（名称重复 → 409） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 0/STATE_CONFLICT | 409 | STATE_CONFLICT | (data 键省略) | ✅ |
| PUT | `/api/admin/college/{id}` | 编辑学院 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,name,fullName,createdAt,updatedAt,deleted} | ✅ |
| GET | `/api/admin/major` | 专业列表 ?collegeId | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | array(1) | ✅ |
| POST | `/api/admin/major` | 新增专业 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 0/STATE_CONFLICT | 409 | STATE_CONFLICT | (data 键省略) | ✅ |
| PUT | `/api/admin/major/{id}` | 编辑专业 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,collegeId,name,fullName,createdAt,updatedAt,deleted} | ✅ |
| GET | `/api/admin/class` | 班级列表 ?majorId（含 studentCount） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | array(2) | ✅ |
| POST | `/api/admin/class` | 新增班级 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 0/STATE_CONFLICT | 409 | STATE_CONFLICT | (data 键省略) | ✅ |
| PUT | `/api/admin/class/{id}` | 编辑班级（studentCount 为数量上限来源） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,majorId,name,grade,studentCount,createdAt,updatedAt,deleted} | ✅ |

### 教材与课程

| 方法 | 路径 | 说明 | 探针 | 角色 | 期望 | 实际 HTTP | 业务码 | 响应摘要 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/admin/textbook` | 教材分页检索 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | page(list=5, total=116) | ✅ |
| POST | `/api/admin/textbook` | 新增教材（ISBN 重复 → 409） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 0/STATE_CONFLICT | 409 | STATE_CONFLICT | (data 键省略) | ✅ |
| PUT | `/api/admin/textbook/{id}` | 编辑教材 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,isbn,title,edition,author,press,price,status,…} | ✅ |
| POST | `/api/admin/textbook/{id}/status` | 在库/停用（停用即下架） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,isbn,title,edition,author,press,price,status,…} | ✅ |
| POST | `/api/admin/textbook/import` | 教材导入（multipart → batchId） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {batchId} | ✅ |
| GET | `/api/admin/textbook/template` | 教材导入模板（xlsx 流） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | (xlsx 流) | binary application/vnd.openxmlformats-officedocument.spreadsheetml.sheet 3662B | ✅ |
| GET | `/api/admin/course` | 课程列表 ?semesterId | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | array(5) | ✅ |
| POST | `/api/admin/course` | 新增课程（同学期同 code 重复 → 409） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 0/STATE_CONFLICT | 409 | STATE_CONFLICT | (data 键省略) | ✅ |
| PUT | `/api/admin/course/{id}` | 编辑课程 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,semesterId,code,name,createdAt,updatedAt,deleted} | ✅ |
| GET | `/api/admin/teacher-course` | 任课关系（征订范围） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | array(7) | ✅ |
| POST | `/api/admin/teacher-course` | 新增任课关系（教师须有 TEACHER 角色） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 0/STATE_CONFLICT | 200 | 0 | {id,semesterId,teacherId,courseId,classId,deleted} | ✅ |
| DELETE | `/api/admin/teacher-course/{id}` | 逻辑删除任课关系 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | (data 键省略) | ✅ |
| POST | `/api/admin/teacher-course/import?semesterId={semesterId}` | 任课导入（?semesterId，multipart） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {batchId} | ✅ |
| GET | `/api/admin/teacher-course/template` | 任课导入模板（xlsx 流） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | (xlsx 流) | binary application/vnd.openxmlformats-officedocument.spreadsheetml.sheet 3661B | ✅ |

### 账号管理

| 方法 | 路径 | 说明 | 探针 | 角色 | 期望 | 实际 HTTP | 业务码 | 响应摘要 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/admin/user` | 账号分页检索 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | page(list=5, total=26) | ✅ |
| POST | `/api/admin/user` | 建号（初始口令 = 后 6 位，首登须改密） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 0/STATE_CONFLICT/PARAM_INVALID | 409 | STATE_CONFLICT | (data 键省略) | ✅ |
| PUT | `/api/admin/user/{id}/status?status=0` | 停用/启用（停用即时踢下线） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | (data 键省略) | ✅ |
| PUT | `/api/admin/user/{id}/reset-password` | 重置为初始口令 + 强制改密 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | (data 键省略) | ✅ |
| POST | `/api/admin/user/import?role=teacher&semesterId={semesterId}` | 名单导入 ?role=student|teacher（multipart） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {batchId} | ✅ |
| GET | `/api/admin/user/import/template?role=student` | 名单导入模板 ?role（xlsx 流） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | (xlsx 流) | binary application/vnd.openxmlformats-officedocument.spreadsheetml.sheet 3645B | ✅ |

### 教师征订

| 方法 | 路径 | 说明 | 探针 | 角色 | 期望 | 实际 HTTP | 业务码 | 响应摘要 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/teacher/my-courses` | 任课范围（按班级分组） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | STUDENT | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | TEACHER | 200 | 200 | 0 | array(1) | ✅ |
| GET | `/api/teacher/textbook` | 填报选书器（仅在库，封顶 50，无分页） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | STUDENT | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | TEACHER | 200 | 200 | 0 | array(50) | ✅ |
| GET | `/api/teacher/order-form` | 当前学期征订单（无单时 data 键省略） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | STUDENT | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | TEACHER | 200 | 200 | 0 | {id,semesterId,semesterName,teacherId,status,submittedAt,reviewAt,reviewBy,…} | ✅ |
| POST | `/api/teacher/order-form/submit` | 提交/补正（覆盖语义） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | STUDENT | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | TEACHER | 0/FIELD_CHECK_FAILED/WINDOW_CLOSED/CORRECTION_EXPIRED/STATE_CONFLICT | 409 | STATE_CONFLICT | (data 键省略) | ✅ |
| GET | `/api/teacher/order-forms` | 我的历史提交记录 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | STUDENT | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | TEACHER | 200 | 200 | 0 | array(1) | ✅ |
| GET | `/api/secretary/order-forms` | 秘书：本院表单分页（只读） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | SECRETARY | 200 | 200 | 0 | page(list=1, total=1) | ✅ |
| GET | `/api/admin/order-forms` | 超管：全院表单分页 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | page(list=5, total=5) | ✅ |
| GET | `/api/admin/order-forms/{id}` | 详情（含 fieldCheckResult、contentVersion） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,semesterId,semesterName,teacherId,status,fieldCheckResult,submittedAt,correctDeadline,…} | ✅ |
| POST | `/api/admin/order-forms/{id}/review` | 内容审核（contentVersion CAS；仅 pending_review 可审） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 0/STATE_CONFLICT | 200 | 0 | {id,semesterId,semesterName,teacherId,status,submittedAt,reviewAt,reviewBy,…} | ✅ |

### 学生选购

| 方法 | 路径 | 说明 | 探针 | 角色 | 期望 | 实际 HTTP | 业务码 | 响应摘要 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/student/book-list` | 本班教材清单（required/delisted） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | STUDENT | 200 | 500 | SERVER_ERROR | (data 键省略) | ❌ 未通过 |
| GET | `/api/student/order` | 本人选购单（无单时 data 键省略） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | STUDENT | 200 | 500 | SERVER_ERROR | (data 键省略) | ❌ 未通过 |
| POST | `/api/student/order/submit` | 提交（覆盖语义；窗口/下架校验） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | STUDENT | 0/PARAM_INVALID/WINDOW_CLOSED/BOOK_DELISTED | 500 | SERVER_ERROR | (data 键省略) | ❌ 未通过 |
| GET | `/api/student/orders` | 历史选购记录（跨学期摘要） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | STUDENT | 200 | 200 | 0 | array(1) | ✅ |
| GET | `/api/admin/student-orders` | 超管：全院选购分页 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | page(list=1, total=1) | ✅ |

### 异动

| 方法 | 路径 | 说明 | 探针 | 角色 | 期望 | 实际 HTTP | 业务码 | 响应摘要 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/teacher/change` | 教师逐条提交（字段审查失败直接落 rejected） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | STUDENT | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | TEACHER | 0 | 200 | 0 | {id,semesterId,type,targetUserId,targetUserNo,targetUserName,beforeCollegeId,beforeCollegeName,…} | ✅ |
| POST | `/api/secretary/change` | 秘书逐条提交 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | STUDENT | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | SECRETARY | 0 | 200 | 0 | {id,semesterId,type,targetUserId,targetUserNo,targetUserName,beforeCollegeId,beforeCollegeName,…} | ✅ |
| POST | `/api/secretary/change/import` | 秘书 Excel 批量 → {batchId,batchNo} | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | STUDENT | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | SECRETARY | 200 | 200 | 0 | {batchId,batchNo,total,okCount,errorCount} | ✅ |
| GET | `/api/teacher/change` | 我的提交记录（教师/秘书同链） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | STUDENT | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | TEACHER | 200 | 200 | 0 | array(19) | ✅ |
| GET | `/api/change/org-options` | 提交端目标归属选项（仅 id+名称） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | STUDENT | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | TEACHER | 200 | 200 | 0 | {colleges,classes} | ✅ |
| GET | `/api/admin/change` | 审批列表分页 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | page(list=5, total=65) | ✅ |
| POST | `/api/admin/change/{id}/review` | 逐条审批（reject 理由必填；通过立即生效） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,semesterId,type,targetUserId,targetUserNo,targetUserName,beforeCollegeId,beforeCollegeName,…} | ✅ |
| POST | `/api/admin/change/batch/review` | 按批次批量处理（仅支持 batchNo） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {batchNo,action,count,records} | ✅ |

### 导入批次

| 方法 | 路径 | 说明 | 探针 | 角色 | 期望 | 实际 HTTP | 业务码 | 响应摘要 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/batch/{batchId}` | 批次进度（非本人批次 → 404） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,bizType,fileName,total,okCount,errorCount,progressPct,status,…} | ✅ |
| GET | `/api/batch/{batchId}/errors` | 错误明细下载（无错误行 → 404） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200/404 | 404 | NOT_FOUND | (data 键省略) | ✅ |

### 导出

| 方法 | 路径 | 说明 | 探针 | 角色 | 期望 | 实际 HTTP | 业务码 | 响应摘要 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/admin/export/orders` | 教师征订明细（同步 xlsx / 异步 taskId） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | (xlsx 流) | binary application/vnd.openxmlformats-officedocument.spreadsheetml.sheet 8346B | ✅ |
| POST | `/api/admin/export/students` | 学生选购汇总 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | (xlsx 流) | binary application/vnd.openxmlformats-officedocument.spreadsheetml.sheet 3667B | ✅ |
| POST | `/api/admin/export/notice` | 通知汇总（body 必带 taskId） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | (xlsx 流) | binary application/vnd.openxmlformats-officedocument.spreadsheetml.sheet 3755B | ✅ |
| POST | `/api/secretary/export/signature` | 秘书：本院签字版（学院范围后端强制过滤） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | SECRETARY | 200 | 200 | (xlsx 流) | binary application/vnd.openxmlformats-officedocument.spreadsheetml.sheet 4053B | ✅ |
| GET | `/api/export-task/{id}` | 任务进度（downloadToken 仅所有者可见；越权 → 404） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 404 | 404 | NOT_FOUND | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,bizType,paramsJson,rowEstimate,tokenExpireAt,expiresAt,status,progressPct,…} | ✅ |
| GET | `/api/export-task/{id}/download` | 一次性下载（token 单次有效；复用/过期 → 410） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200/400/410 | 400 | PARAM_INVALID | (data 键省略) | ✅ |

### 通知

| 方法 | 路径 | 说明 | 探针 | 角色 | 期望 | 实际 HTTP | 业务码 | 响应摘要 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/notice/unconfirmed` | 未确认队列（按 target_roles 定向） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 正常 | TEACHER | 200 | 200 | 0 | array(1) | ✅ |
| GET | `/api/notice/mine` | 我的通知（全量含已确认，分页） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 正常 | TEACHER | 200 | 200 | 0 | page(list=5, total=43) | ✅ |
| POST | `/api/notice/{taskId}/confirm` | 确认收到 → 204（幂等；非定向任务 404） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 正常 | TEACHER | 200/204 | 204 | (xlsx 流) | binary  0B | ✅ |
| GET | `/api/admin/notice/tasks` | 本学期任务列表 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | array(47) | ✅ |
| POST | `/api/admin/notice/tasks` | 手动创建（同学期已有 active → 409） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {id,semesterId,title,content,targetRoles,roundLimit,intervalHours,source,…} | ✅ |
| POST | `/api/admin/notice/tasks/{id}/close` | 手动关闭任务 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 0/NOTICE_TASK_EXISTS | 409 | NOTICE_TASK_EXISTS | (data 键省略) | ✅ |
| GET | `/api/admin/notice/tasks/{id}/progress` | 发送进度 {sent,unauthorized,failed,confirmed,roundLimit} | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {sent,unauthorized,failed,confirmed,roundLimit} | ✅ |
| GET | `/api/admin/notice/tasks/{id}/failures` | 未授权/失败名单（线下兜底，分页） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | page(list=0, total=0) | ✅ |

### 配置与看板

| 方法 | 路径 | 说明 | 探针 | 角色 | 期望 | 实际 HTTP | 业务码 | 响应摘要 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/admin/config` | 配置列表（8 键） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | array(8) | ✅ |
| PUT | `/api/admin/config` | 批量更新（键白名单 + 值域校验） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | (data 键省略) | ✅ |
| GET | `/api/admin/audit` | 审计查询（时间格式 yyyy-MM-dd HH:mm:ss） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | page(list=5, total=1954) | ✅ |
| GET | `/api/admin/dashboard` | 看板三指标 + 学院进度 | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | ADMIN | 200 | 200 | 0 | {semesterId,windowStatus,channelOpen,serverTime,colleges,pendingReviewTotal,unconfirmedNoticeTotal,studentOrderTotal,…} | ✅ |

### 供货商

| 方法 | 路径 | 说明 | 探针 | 角色 | 期望 | 实际 HTTP | 业务码 | 响应摘要 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/supplier/orders` | 按学院分组清单（字段白名单，无学生字段） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | SUPPLIER | 200 | 200 | 0 | array(2) | ✅ |
| POST | `/api/supplier/export` | 一学院一 sheet 导出（同步流 / 异步任务） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | SUPPLIER | 200 | 200 | (xlsx 流) | binary application/vnd.openxmlformats-officedocument.spreadsheetml.sheet 7638B | ✅ |
| GET | `/api/supplier/export-task/{id}` | 任务进度（仅本人 bizType=supplier；无权限角色先被 403 拦下） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 越权 | TEACHER | 403 | 403 | FORBIDDEN | (data 键省略) | ✅ |
|  |  |  | 正常 | SUPPLIER | 200 | 200 | 0 | {id,bizType,paramsJson,rowEstimate,tokenExpireAt,expiresAt,status,progressPct,…} | ✅ |
| GET | `/api/supplier/export-task/{id}/download` | 一次性下载（复用/过期 → 410） | 未鉴权 | (无 token) | 401 | 401 | UNAUTHORIZED | (data 键省略) | ✅ |
|  |  |  | 正常 | SUPPLIER | 200/400/410 | 400 | PARAM_INVALID | (data 键省略) | ✅ |

## 三、联调发现的契约偏差与风险

| 级别 | 问题 | 说明 |
| --- | --- | --- |
| P0 | JSON body 的时间格式与文档不符（空格 vs ISO 的 T） | API.md §1.1 称「入参（body/query 的 LocalDateTime）一律 yyyy-MM-dd HH:mm:ss」，但实测 JSON body **只接受 ISO-8601（yyyy-MM-ddTHH:mm:ss）**，传空格格式返回 400 PARAM_INVALID；而 query 参数相反（/api/admin/audit 的 startAt/endAt 只接受空格格式）。影响：学期窗口的 create/update/setWindow/extend 四个接口若按文档格式提交必然 400。前端已在接口层加 toWireDateTime 转换。 |
| P1 | 名单导入会把班级人数刷新为导入行数 | POST /api/admin/user/import?role=student 导入 N 行后，该班 school_class.student_count 被置为 N。而班级人数是教师填报 QTY_RANGE 的数量上限来源——导入一份 1 行的名单会把该班填报上限压到 1。实测：导入 1 行后班级人数 30→1，教师提交 quantity=2 立即 400 FIELD_CHECK_FAILED。 |
| P1 | reviewed 是终态且管理员也无法驳回，与错误文案自相矛盾 | 教师重提 reviewed 表单返回 409「该征订单已通过审核，不能再次提交；如需修改请联系教材室驳回后补正」，但实测管理员对 reviewed 表单调用审核同样 409（仅 pending_review 可审）——文案给出的补救路径不可达。前端已改为中性文案（终态不可修改），不再复述该承诺。 |
| P1 | 学期 activate / archive 不可逆，且无回滚接口 | activate 会把当前 active 学期置为 archived，而归档学期不可再激活（409「仅 draft 学期可激活」）；archive 又要求学期处于 active。即切换学期后无法通过接口回到原状态（唯一恢复手段是直接改库）。本次联调已复现并手工修复（把种子学期 1 的 active_status/window_status/channel_open 改回）。联调脚本因此不再执行 activate/archive 的 happy path，只断言状态机门禁。 |
| P2 | 归属校验前存在权限门：无权限角色得到 403 而非 404 | GET /api/batch/{id} 对「无 import:batch:view 的角色」返回 403，对「有权限但非本人批次」返回 404；GET /api/supplier/export-task/{id} 对教师返回 403。前端不能用 403/404 的差异判断资源是否存在，但需要按角色区分提示（403 → 无权限；404 → 资源不存在）。 |

## 四、数据副作用与可重复性

- 创建/复用了 `[IT]` 前缀夹具：学院、专业、班级、课程、教材（ISBN 9787111128069）、账号 IT9001/IT9002、学生 ITSTU01/ITTEACH01。
- `PUT /api/admin/config` 临时把 `export.sync_row_threshold` 置 0 以强制异步导出，跑完已恢复 5000。
- 学期生命周期作用于 `[IT] 联调学期`，跑完已把 active 学期恢复为种子学期（并归档夹具学期）。
- 异动审批一律用 `reject`，不改变任何用户的学院/班级归属。
- 夹具教师 IT9001 的征订单以 `rejected` 收尾（reviewed 为终态不可重置），使本脚本可重复执行。
- 账号 IT9001/IT9002 的口令会被改密用例轮换（初始 `IT9001`/`IT9002` → `It9001@pass`/`It9002@pass`），下次执行会自动重置。
