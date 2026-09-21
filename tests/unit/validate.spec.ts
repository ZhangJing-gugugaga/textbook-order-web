import { describe, expect, it } from 'vitest'
import {
  validateExtendEnd,
  validateNewPassword,
  validateRejectComment,
  validateWindowRange,
} from '@/utils/validate'

/** 字段校验规则（PRD 征订窗口管理 / 功能 1 / 复核工作台字段规范） */
describe('窗口期校验', () => {
  it('窗口开始必须早于结束', () => {
    expect(validateWindowRange('2026-09-20T08:00:00', '2026-10-10T18:00:00')).toBeNull()
    expect(validateWindowRange('2026-10-10T18:00:00', '2026-09-20T08:00:00')).toBe(
      '窗口开始时间必须早于结束时间',
    )
    expect(validateWindowRange('', '2026-10-10T18:00:00')).toBe('请选择窗口开始与截止时间')
  })

  it('延长后的截止时间必须晚于当前时间', () => {
    const now = Date.parse('2026-09-21T10:00:00')
    expect(validateExtendEnd('2026-09-21T11:00:00', now)).toBeNull()
    expect(validateExtendEnd('2026-09-21T10:00:00', now)).toBe('延长后的截止时间必须晚于当前时间')
    expect(validateExtendEnd('2020-01-01T00:00:00', now)).toBe('延长后的截止时间必须晚于当前时间')
    expect(validateExtendEnd('', now)).toBe('请选择新的截止时间')
  })
})

describe('驳回理由校验（1-200 字必填）', () => {
  it('空理由被拦截', () => {
    expect(validateRejectComment('')).toBe('驳回理由必填')
    expect(validateRejectComment('   ')).toBe('驳回理由必填')
  })
  it('超长理由被拦截', () => {
    expect(validateRejectComment('x'.repeat(201))).toBe('驳回理由不超过 200 字')
  })
  it('合法理由通过', () => {
    expect(validateRejectComment('数量与班级人数不符，请核对')).toBeNull()
    expect(validateRejectComment('x'.repeat(200))).toBeNull()
  })
})

describe('新密码校验（8-64 位含字母和数字）', () => {
  it('过短或纯数字/纯字母被拦截', () => {
    expect(validateNewPassword('abc123')).toBe('新密码需 8 位以上且含字母和数字')
    expect(validateNewPassword('12345678')).toBe('新密码需 8 位以上且含字母和数字')
    expect(validateNewPassword('abcdefgh')).toBe('新密码需 8 位以上且含字母和数字')
  })
  it('合法密码通过', () => {
    expect(validateNewPassword('abc12345')).toBeNull()
    expect(validateNewPassword('Aa1234567890')).toBeNull()
  })
})
