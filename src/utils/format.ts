/** 通用格式化工具（无第三方依赖，便于单测） */

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDateTime(input: string | number | Date | null | undefined): string {
  if (!input) return '—'
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`
}

export function formatDate(input: string | number | Date | null | undefined): string {
  if (!input) return '—'
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `¥${value.toFixed(2)}`
}

/** 倒计时文案：X 天 X 时 X 分（PRD 功能 2） */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return '0 天 0 时 0 分'
  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  return `${days} 天 ${hours} 时 ${minutes} 分`
}

/** 窗口三态文案（PRD 功能 2） */
export function windowStatusText(status: string, remainMs: number, startRemainMs: number): string {
  if (status === 'not_open') return `距离开始还有 ${formatCountdown(startRemainMs)}`
  if (status === 'open') return `本期征订将于 ${formatCountdown(remainMs)}后截止`
  return '本期征订已截止，可查看历史记录'
}

/** datetime-local 输入框值 */
export function toLocalInputValue(input: string | null | undefined): string {
  if (!input) return ''
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`
}

/**
 * 日期时间入参的**格式不对称**（实测 2026-09-22，联调发现）：
 *
 * - **JSON body** 里的 `LocalDateTime` 走 Jackson 的 JSR-310 默认解析，只认 ISO-8601
 *   （`yyyy-MM-ddTHH:mm:ss`）；传 `yyyy-MM-dd HH:mm:ss`（空格）会 **400 PARAM_INVALID**。
 *   注意 API.md §1.1 写的「入参（body/query）一律 yyyy-MM-dd HH:mm:ss」对 body 并不成立。
 * - **query 参数** 里的 `LocalDateTime`（如 `/api/admin/audit` 的 `startAt/endAt`）反而要求
 *   空格格式 `yyyy-MM-dd HH:mm:ss`，传 ISO 的 `T` 会 400。
 *
 * 因此：el-date-picker 的 `value-format` 统一保持空格格式（便于展示与比较），
 * **只在进出接口层时转换**（见 `toWireDateTime` / `toPickerDateTime`）。
 */
export const WIRE_DATETIME_SEPARATOR = 'T'

/** el-date-picker 值（`yyyy-MM-dd HH:mm:ss`）→ JSON body 期望的 ISO-8601（`yyyy-MM-ddTHH:mm:ss`） */
export function toWireDateTime(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  // 已是 ISO（含 T）或只有日期：原样透传
  if (trimmed.includes(WIRE_DATETIME_SEPARATOR)) return trimmed
  return trimmed.replace(' ', WIRE_DATETIME_SEPARATOR)
}

/** 后端下发的 ISO-8601（可能带微秒）→ el-date-picker 的 `yyyy-MM-dd HH:mm:ss` */
export function toPickerDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  // 截掉小数秒与时区后缀，再把 T 换成空格：'2026-09-14T00:00:00.123' → '2026-09-14 00:00:00'
  const base = trimmed.split('.')[0].replace(WIRE_DATETIME_SEPARATOR, ' ')
  return base.slice(0, 19)
}

export function fileSizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
