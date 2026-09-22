# 教材征订系统 · Web 端部署手册

> 版本 V1.0.0 · 2026-09-21
> 适用对象：运维 / 校方信息化人员 / 接手本项目的开发者
> 配套文档：`docs/HANDOVER-CHECKLIST.md`（移交检查单）、`SPEC.md`（技术规格）、`README.md`（开发上手）

本手册是评审 P0-4 的交付物：**从零把前端部署到学校环境**的完整步骤，含 Nginx 完整配置、
安全响应头、缓存分层策略与常见故障排查。

---

## 0. 交付物与前置条件

### 0.1 需要准备的东西

| 项         | 要求                                                   | 说明                                           |
| ---------- | ------------------------------------------------------ | ---------------------------------------------- |
| Node.js    | ≥ 20.19（建议 22 LTS）                                 | 仅构建期需要；产物是纯静态文件                 |
| npm        | ≥ 10                                                   | 仓库内 `package-lock.json` 已入库，用 `npm ci` |
| Nginx      | ≥ 1.20（需支持 `add_header ... always`）               | 静态托管 + `/api` 反代                         |
| 后端服务   | 教材征订系统后端（Spring Boot），默认 `127.0.0.1:8080` | 前端不直连数据库                               |
| 服务器磁盘 | 约 200MB（含 `node_modules` 与产物）                   | `dist/` 产物本身约 1MB                         |

### 0.2 部署产物构成

前端产物是**纯静态文件**，无服务端运行时：

```
dist/
├─ index.html                     # 入口，引用 /textbook/assets/*
└─ assets/
   ├─ index-<hash>.js             # 入口 chunk（约 205KB / gzip 72KB）
   ├─ vendor-vue-<hash>.js        # Vue 运行时（约 111KB）
   ├─ vendor-axios-<hash>.js      # axios（约 51KB）
   ├─ el-*.js                     # Element Plus 按需分包（随页面懒加载）
   ├─ <ViewName>-<hash>.js        # 路由级懒加载 chunk（每个页面一个）
   └─ *.css                       # 按需引入的 Element Plus 样式 + 页面样式
```

文件名带内容哈希，可安全设置长期强缓存（见 §2.3）。

---

## 1. 构建

### 1.1 拉取与安装

```bash
git clone <仓库地址> textbook-order-web
cd textbook-order-web
git checkout <发布 tag>        # 例：v0.1.0
npm ci                         # 严格按 lockfile 安装，不要用 npm install
```

### 1.2 配置环境变量

前端只有两个环境变量，**均不含密钥**，且已入库（`.env.trial` / `.env.school`）：

| 变量                | 含义                          | trial / school 取值     |
| ------------------- | ----------------------------- | ----------------------- |
| `VITE_BASE`         | 部署子路径（必须以 `/` 收尾） | `/textbook/`            |
| `VITE_PROXY_TARGET` | dev/preview 的代理目标        | `http://127.0.0.1:8080` |
| `VITE_SOURCEMAP`    | 置 `1` 时产出 sourcemap       | 默认不设（关闭）        |

> **重要**：`VITE_BASE` 与 Nginx 的 `location` 路径必须一致。若校方要求部署在 `/jiaocai/`，
> 则改 `.env.school` 的 `VITE_BASE=/jiaocai/` 并同步修改 Nginx 配置，**代码无需改动**。
>
> 路由 base 取自 Vite 注入的 `import.meta.env.BASE_URL`（与 `vite.config.ts` 的 `base` 同源），
> 因此不会出现「资源路径与路由 base 不一致」的错配。

### 1.3 构建

```bash
npm run build:school     # 或 build:trial；等价于 vue-tsc --noEmit && vite build --mode school
```

构建内含类型门禁（`vue-tsc --noEmit`），类型不通过即失败，不会产出半成品。
成功后产物在 `dist/`。

**校验产物**（建议每次发布都做）：

```bash
# 1) 入口脚本路径必须与部署路径一致（子域名根目录 → /assets/；子路径 → /textbook/assets/）
grep -o 'src="[^"]*"' dist/index.html
# 期望：src="<部署路径>assets/index-<hash>.js"
#   子域名部署（如 textbooksorder.moonzj.com）→ src="/assets/index-<hash>.js"
#   主域子路径部署                            → src="/textbook/assets/index-<hash>.js"
# 与 `.env.<mode>` 的 VITE_BASE 不一致时，页面会白屏并报 404 加载 .js（见 §5 排查表）

# 2) 不应有超过 500KB 的 chunk（构建会直接告警）
ls -l dist/assets/*.js | sort -k5 -n | tail -3
```

### 1.4 上传

```bash
rsync -avz --delete dist/ deploy@<服务器>:/var/www/textbook-order-web/
```

`--delete` 会清掉上一版残留的带哈希文件，避免磁盘无限增长。

---

## 2. Nginx 配置

### 2.1 完整配置（可直接使用）

```nginx
# /etc/nginx/conf.d/textbook-order-web.conf

# ---- 压缩：文本类资源统一开启（Element Plus 的 CSS 压缩后收益明显）----
gzip on;
gzip_vary on;
gzip_comp_level 6;
gzip_min_length 1024;
gzip_proxied any;
gzip_types
    text/plain
    text/css
    text/javascript
    application/javascript
    application/json
    application/xml
    image/svg+xml;

server {
    listen 80;
    server_name <校方域名>;
    # 若启用 HTTPS，把 80 端口改为 301 跳转到 443，并另开 443 server 块

    # 隐藏 Nginx 版本号
    server_tokens off;

    # ============ 全局安全响应头（评审 S1：此前全仓缺失）============
    # 说明：这些头对静态站点同样有效，且是 refresh token 落 localStorage 的纵深防御。
    # CSP 采用「同源 + 不内联」策略：本应用无内联脚本、无外链资源、无 eval。

    # 禁止被 iframe 嵌套（防点击劫持）
    add_header X-Frame-Options "DENY" always;
    # 禁止浏览器根据内容嗅探 MIME 类型
    add_header X-Content-Type-Options "nosniff" always;
    # 跨站跳转时不泄漏完整 URL（含 query 中的一次性下载 token）
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    # 浏览器特性最小化
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

    # CSP：与后端联调前先用 Report-Only 观察一周，确认无拦截后再切换为强制模式。
    # 若后端返回的文件流下载（xlsx）需要 blob:，保留下方 blob: 白名单。
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
    # 观察期用法（把上面一行注释掉，改用下面一行）：
    # add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;

    # ============ 前端静态资源（子路径部署）============
    location /textbook/ {
        alias /var/www/textbook-order-web/;
        index index.html;

        # history 模式回退：任何未命中的路径都交给 index.html，由前端路由接管
        try_files $uri $uri/ /textbook/index.html;

        # 带内容哈希的产物：强缓存一年（文件名变化即天然失效）
        location ~* ^/textbook/assets/.*-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|svg|jpg)$ {
            alias /var/www/textbook-order-web/assets/;
            expires 1y;
            add_header Cache-Control "public, max-age=31536000, immutable" always;
            access_log off;
        }

        # index.html 绝不缓存：否则发版后用户仍加载旧版入口，引到已删除的旧 chunk
        location = /textbook/index.html {
            alias /var/www/textbook-order-web/index.html;
            add_header Cache-Control "no-cache, must-revalidate" always;
            expires -1;
        }
    }

    # 子路径根重定向（访问 /textbook 时补斜杠）
    location = /textbook {
        return 301 /textbook/;
    }

    # ============ 后端接口反代 ============
    location /api {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;

        # 导入/导出可能较慢，放宽超时（前端 axios 超时为 20s，此处给足余量）
        proxy_connect_timeout 10s;
        proxy_send_timeout    300s;
        proxy_read_timeout    300s;

        # 名单/教材 Excel 导入需要较大 body（默认 1m 会 413）
        client_max_body_size 32m;
        proxy_request_buffering off;

        # 导出文件流：关闭缓冲，避免大文件先落磁盘再吐给客户端
        proxy_buffering off;
    }

    # 健康检查（可选）
    location = /healthz {
        access_log off;
        return 200 "ok\n";
    }
}
```

### 2.2 HTTPS

若校方提供证书：

```nginx
server {
    listen 443 ssl http2;
    server_name <校方域名>;

    ssl_certificate     /etc/nginx/ssl/<域名>.crt;
    ssl_certificate_key /etc/nginx/ssl/<域名>.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # HSTS：确认全站已可 HTTPS 访问后再启用，且从较短 max-age 起步
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # …其余配置同 §2.1…
}
```

> HSTS 一旦下发，浏览器会在 `max-age` 内强制 HTTPS。**首次启用建议先用 `max-age=300` 验证一周**，
> 确认无混合内容问题后再改为一年。

### 2.3 缓存策略一览

| 资源                   | 文件名特征 | Cache-Control                         | 理由                           |
| ---------------------- | ---------- | ------------------------------------- | ------------------------------ |
| `index.html`           | 无哈希     | `no-cache, must-revalidate`           | 发版后必须立即拿到新入口       |
| `assets/*.js`、`*.css` | 带内容哈希 | `public, max-age=31536000, immutable` | 内容变则文件名变，可放心长缓存 |
| 字体 / 图片            | 带内容哈希 | 同上                                  | 同上                           |
| `/api/**`              | —          | 不缓存（反代直通）                    | 业务数据必须实时               |

### 2.4 应用与重载

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 3. 验证清单（部署后立即执行）

| #   | 检查项       | 命令 / 操作                                                                                                | 期望                                               |
| --- | ------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | 静态资源可达 | `curl -I http://<域名>/textbook/`                                                                          | `200`，且含 §2.1 的全部安全响应头                  |
| 2   | 安全头齐全   | `curl -sI http://<域名>/textbook/ \| grep -Ei 'frame-options\|content-security\|nosniff\|referrer'`        | 四条全部出现                                       |
| 3   | 缓存头正确   | `curl -sI http://<域名>/textbook/index.html` 与某个 `assets/*.js`                                          | 前者 `no-cache`；后者 `max-age=31536000`           |
| 4   | history 回退 | 浏览器直接打开 `http://<域名>/textbook/accounts`                                                           | 正常渲染（未登录则跳登录页），**不是 404**         |
| 5   | 接口连通     | 打开登录页，输入任意账号密码                                                                               | 返回业务错误（如「账号或密码不正确」）而非网络错误 |
| 6   | 五角色落地页 | 分别用超管/秘书/教师/学生/供货商登录                                                                       | 进入各自工作台，**不是 403 页**                    |
| 7   | 越权拦截     | 学生身份在地址栏输入 `/textbook/accounts`                                                                  | 跳 `/textbook/403`                                 |
| 8   | 浏览器控制台 | 打开开发者工具 Console                                                                                     | 无红色报错、无 CSP 拦截报告                        |
| 9   | gzip 生效    | `curl -H 'Accept-Encoding: gzip' -sI http://<域名>/textbook/assets/index-*.js \| grep -i content-encoding` | 含 `gzip`                                          |
| 10  | 导入大文件   | 上传一份 >1MB 的 `.xlsx`                                                                                   | 正常受理，不返回 413                               |

---

## 4. 回滚

前端产物是纯静态文件，回滚 = 换回上一版目录：

```bash
# 发版前先留档
mv /var/www/textbook-order-web /var/www/textbook-order-web.bak-$(date +%Y%m%d%H%M)

# 回滚
rsync -avz --delete /var/www/textbook-order-web.bak-<时间戳>/ /var/www/textbook-order-web/
```

> **注意**：前端与后端接口契约必须匹配。若本次发版伴随后端变更，前端回滚需后端同步回滚，
> 否则可能出现字段不匹配。发布记录中请写明「前端 tag ↔ 后端 tag」的对应关系。

---

## 5. 故障排查

| 现象                                  | 常见原因                                                           | 处理                                                                     |
| ------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 打开页面白屏，控制台报 404 加载 `.js` | `VITE_BASE` 与 Nginx `location` 不一致；或 Nginx 指向了旧的 `dist` | 核对 §1.2 与 §2.1 的路径；确认 `/var/www/textbook-order-web/` 是最新产物 |
| 刷新子页面 404                        | 缺少 `try_files … /textbook/index.html` 回退                       | 补 §2.1 的 `try_files`                                                   |
| 发版后用户仍看到旧版                  | `index.html` 被缓存了                                              | 确认 `index.html` 返回 `no-cache`（§2.3）                                |
| 接口 502                              | 后端未启动 / 端口不符                                              | `curl http://127.0.0.1:8080/actuator/health`；核对 `proxy_pass`          |
| 接口 504                              | 导出/导入超时                                                      | 放宽 §2.1 的 `proxy_read_timeout`                                        |
| 导入 Excel 返回 413                   | `client_max_body_size` 太小                                        | 调到 32m（§2.1）                                                         |
| 页面样式错乱 / 组件无样式             | 静态资源被中间层改写或 gzip 配置错误                               | 核对 `gzip_types` 是否含 `text/css`；确认 `assets/` 直出未加工           |
| CSP 报错拦截了请求                    | CSP 策略过严                                                       | 先用 `Content-Security-Policy-Report-Only` 观察（§2.1），据报告放宽      |
| 浏览器兼容性告警                      | 机房浏览器低于兼容矩阵                                             | 见 §6                                                                    |

---

## 6. 浏览器兼容矩阵

**声明范围**（`package.json` 的 `browserslist` 与 `vite.config.ts` 的 `build.target` 同源）：

| 浏览器  | 最低版本 |
| ------- | -------- |
| Chrome  | 87       |
| Edge    | 88       |
| Firefox | 78       |
| Safari  | 14       |

低于上述版本不保证可用（产物不包含 ES5 降级与 polyfill）。
若校方机房存在 IE11 或国产双核浏览器的兼容内核，**必须在移交前提出**——这需要额外引入
`@vitejs/plugin-legacy` 并重新评估包体积（预计入口体积增加 30%~50%），属变更项而非配置项。

### 移动端浏览器：**不在支持范围内（明确非目标）**

Web 端面向桌面浏览器：全仓无响应式断点（0 个 `@media`），侧边栏固定 232px，
表格按 `min-width` 撑开。手机浏览器**可以打开、不会崩溃**（viewport 正确、表格可横向滚动），
但布局不可用。

移动端业务由**独立小程序仓库 `textbook-order-mp`** 承载（任课老师填报 + 学生选购），
因此 Web 端不做响应式是**有意的范围划分，不是缺陷**。

若校方提出「用手机浏览器走 Web 端」的需求，属**新增需求**：需要补响应式布局与触摸优化，
工作量约 1~2 人周（含 5 角色页面走查），不能靠改配置解决。

**移交话术建议**：向校方明确「PC 端用 Web，手机端用小程序」，避免被当作故障报修。

---

## 7. 生产环境数据红线

> **生产环境严禁灌入演示 / 联调种子数据。** 这是评审 S4 明确要求的强制检查项。

- `README.md` 中的联调账号（`admin001` / `sec001` / `t1001` 等）及其口令**只用于本地与试运行环境**。
- 这些账号的初始口令按「学号/工号后 6 位」派生，**可被轻易猜解**。
- 生产环境必须由教材室通过「账号管理 → 新建账号」逐个建号，或使用真实名单 Excel 导入
  （导入的账号同样会被强制首登改密）。
- 移交时请在 `docs/HANDOVER-CHECKLIST.md` 的对应检查项上签字确认。

---

## 8. 变更记录

| 版本   | 日期       | 说明                                                            |
| ------ | ---------- | --------------------------------------------------------------- |
| V1.0.0 | 2026-09-21 | 首版：补齐全套安全响应头、缓存分层、回滚与排查流程（评审 P0-4） |
