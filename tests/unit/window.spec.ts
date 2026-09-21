import { describe, expect, it } from 'vitest'
import { formatCountdown, formatDateTime, windowStatusText } from '@/utils/format'

/**
 * 窗口三态流转与倒计时（SPEC §10）：
 * 文案按 PRD 功能 2；倒计时文案随剩余时间变化。
 */
describe('窗口三态与倒计时', () => {
  it('not_open：显示距开始倒计时', () => {
    const text = windowStatusText('not_open', 0, 2 * 86400000 + 3 * 3600000 + 25 * 60000)
    expect(text).toBe('距离开始还有 2 天 3 时 25 分')
  })

  it('open：显示截止倒计时', () => {
    const text = windowStatusText('open', 5 * 86400000 + 3600000, 0)
    expect(text).toBe('本期征订将于 5 天 1 时 0 分后截止')
  })

  it('closed：提示可查看历史记录', () => {
    expect(windowStatusText('closed', 0, 0)).toBe('本期征订已截止，可查看历史记录')
  })

  it('倒计时归零后不再出现负数', () => {
    expect(formatCountdown(0)).toBe('0 天 0 时 0 分')
    expect(formatCountdown(-5000)).toBe('0 天 0 时 0 分')
    expect(formatCountdown(90000)).toBe('0 天 0 时 1 分')
  })

  it('格式化日期时间', () => {
    expect(formatDateTime('2026-09-21T08:05:00')).toBe('2026-09-21 08:05')
    expect(formatDateTime(null)).toBe('—')
  })
})
