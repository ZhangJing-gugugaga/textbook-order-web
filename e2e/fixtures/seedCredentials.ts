import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 试运行种子账号口令（仅本地 / 试运行环境；账号清单见 README「联调测试账号」）。
 *
 * 仓库内**不落明文口令**——安全扫描门禁把 `password: '…'`（≥8 位字面量）判为
 * Hardcoded password 并 exit 2 硬阻断 push，故口令一律运行时注入。解析顺序：
 *
 *   1. 环境变量 `E2E_SEED_PASSWORDS`（JSON，形如 `{"900001":"…"}`）；
 *   2. 本地文件 `e2e/.seed-credentials.local.json`（已 gitignore，不入库）。
 *
 * 两者都缺失时**抛错而非静默兜底**：口令错误会表现为「登录失败」，与「后端没起」
 * 「权限不对」的现象混淆，排查成本远高于直接报错。
 */
const LOCAL_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.seed-credentials.local.json',
)

function load(): Record<string, string> {
  const fromEnv = process.env.E2E_SEED_PASSWORDS
  if (fromEnv && fromEnv.trim()) {
    try {
      return JSON.parse(fromEnv) as Record<string, string>
    } catch {
      throw new Error('E2E_SEED_PASSWORDS 不是合法 JSON，期望形如 {"900001":"…"}')
    }
  }

  try {
    return JSON.parse(readFileSync(LOCAL_FILE, 'utf8')) as Record<string, string>
  } catch {
    throw new Error(
      '缺少种子账号口令：请设置环境变量 E2E_SEED_PASSWORDS（JSON），' +
        `或创建 ${LOCAL_FILE}（该文件已 gitignore）。账号清单见 README「联调测试账号」。`,
    )
  }
}

let cache: Record<string, string> | null = null

/** 取某学号/工号的种子口令；未配置该账号时抛错并列出已配置的账号，便于定位拼写错误 */
export function seedPassword(userNo: string): string {
  cache ??= load()
  const password = cache[userNo]
  if (!password) {
    throw new Error(
      `种子口令未配置账号 ${userNo}（已配置：${Object.keys(cache).sort().join(', ') || '无'}）`,
    )
  }
  return password
}
