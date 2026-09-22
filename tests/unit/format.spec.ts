import { describe, expect, it } from 'vitest'
import { toPickerDateTime, toWireDateTime } from '@/utils/format'

/**
 * 日期时间入参的**格式不对称**（2026-09-22 联调实测）：
 * - JSON body 的 LocalDateTime 只认 ISO-8601（`yyyy-MM-ddTHH:mm:ss`），空格格式 → 400 PARAM_INVALID；
 * - query 参数的 LocalDateTime（如 /api/admin/audit 的 startAt/endAt）相反，要求空格格式。
 *
 * el-date-picker 的 value-format 是空格格式，故进出接口层要转换。
 * 这两个函数是唯一转换点，回归时先看这里。
 */
describe('toWireDateTime（picker → JSON body）', () => {
  it('空格格式转 ISO 的 T 分隔（body 唯一被接受的形态）', () => {
    expect(toWireDateTime('2027-09-10 00:00:00')).toBe('2027-09-10T00:00:00')
    expect(toWireDateTime('2026-10-31 23:59:59')).toBe('2026-10-31T23:59:59')
  })

  it('已是 ISO 则原样透传（幂等）', () => {
    expect(toWireDateTime('2027-09-10T00:00:00')).toBe('2027-09-10T00:00:00')
  })

  it('带小数秒/时区的 ISO 不被破坏', () => {
    expect(toWireDateTime('2026-09-21T09:30:00.123456')).toBe('2026-09-21T09:30:00.123456')
  })

  it('空值与纯日期', () => {
    expect(toWireDateTime('')).toBeUndefined()
    expect(toWireDateTime(null)).toBeUndefined()
    expect(toWireDateTime(undefined)).toBeUndefined()
    expect(toWireDateTime('   ')).toBeUndefined()
    expect(toWireDateTime('2027-09-10')).toBe('2027-09-10')
  })
})

describe('toPickerDateTime（ISO → picker 回填）', () => {
  it('ISO 转空格格式并截到秒', () => {
    expect(toPickerDateTime('2026-09-14T00:00:00')).toBe('2026-09-14 00:00:00')
    expect(toPickerDateTime('2026-09-21T09:30:00.123456')).toBe('2026-09-21 09:30:00')
  })

  it('已是空格格式则原样（幂等）', () => {
    expect(toPickerDateTime('2026-09-14 00:00:00')).toBe('2026-09-14 00:00:00')
  })

  it('空值返回空串（el-date-picker 期望的空值）', () => {
    expect(toPickerDateTime(null)).toBe('')
    expect(toPickerDateTime(undefined)).toBe('')
    expect(toPickerDateTime('')).toBe('')
  })

  it('与 toWireDateTime 互逆（提交-回填往返不丢信息）', () => {
    const picker = '2027-09-10 00:00:00'
    expect(toPickerDateTime(toWireDateTime(picker))).toBe(picker)
  })
})
