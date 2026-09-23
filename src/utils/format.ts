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
 * 日期时间入参的格式口径（**2026-09-23 更正**）：
 *
 * - 后端自 V1.0.5 起由 `TimeFormatConfig`/`TimeFormats` 统一解析，**body 与 query 都接受**
 *   `yyyy-MM-ddTHH:mm:ss`（ISO-8601）与 `yyyy-MM-dd HH:mm:ss`（空格，含缺秒 `HH:mm`）；
 *   日期字段（`LocalDate`）接受 `yyyy-MM-dd`，带时间也按日期取值。出参恒为 ISO-8601。
 * - 此前注释记录的「body 只认 ISO、query 只认空格」是 `TimeFormatConfig` 上线前的旧行为，
 *   已被生产实测推翻（`PUT /api/admin/semester/{id}` 传空格格式返回 200 并真实写库）。
 *
 * 因此 `toWireDateTime` 不是"必须的转换"，而是**保持调用形态稳定**的归一化：继续传 ISO 没问题，
 * 新接口也不必再为 body/query 分别做格式转换；格式确实非法时后端返回 400 + 逐字段提示。
 * el-date-picker 的 `value-format` 仍统一保持空格格式（便于展示与比较），只在进出接口层转换。
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
