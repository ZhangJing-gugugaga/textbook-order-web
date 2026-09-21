/**
 * refresh token 持久层（SPEC §5 降级方案 + 评审 S2 修复）：
 *
 * 后端契约中 refreshToken 走请求体、不使用 Set-Cookie，且每次 refresh 都会轮换
 * （旧 token 立即失效）。因此：
 * - 写：登录 / refresh / 切换身份 / 改密后落 localStorage，供刷新页面静默恢复会话；
 * - 读：刷新令牌时**始终读持久层**而非内存副本——多标签页场景下 A 页轮换后，
 *   B 页若仍用内存里的旧 token 会拿到 REFRESH_INVALID 被强制登出；
 * - 同步：监听 `storage` 事件，把其他标签页的轮换结果同步进内存态。
 *
 * 唯一键名在此收敛（此前 `stores/auth.ts` 与 `main.ts` 各硬编码一份）。
 */

const REFRESH_KEY = 'textbook.refreshToken'

/** 隐私模式等不可写场景的内存兜底 */
let memoryFallback = ''

export function readRefreshToken(): string {
  try {
    return localStorage.getItem(REFRESH_KEY) ?? memoryFallback
  } catch {
    return memoryFallback
  }
}

export function writeRefreshToken(token: string) {
  memoryFallback = token
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token)
    else localStorage.removeItem(REFRESH_KEY)
  } catch {
    // 不可写场景仅内存态可用
  }
}

/** 读取「当前最新」的 refresh token（跨标签页可见） */
export function getRefreshToken(): string | null {
  return readRefreshToken() || null
}

/** 写入并广播（`storage` 事件由浏览器在同源其他标签页触发） */
export function setRefreshToken(token: string) {
  writeRefreshToken(token)
}

export function clearRefreshToken() {
  writeRefreshToken('')
}

/**
 * 订阅其他标签页的 refresh token 变更。
 * @returns 取消订阅函数
 */
export function onRefreshTokenChange(listener: (token: string) => void): () => void {
  const handler = (event: StorageEvent) => {
    if (event.key !== null && event.key !== REFRESH_KEY) return
    listener(event.newValue ?? '')
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
