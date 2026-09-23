import { describe, expect, it } from 'vitest'
import { CHANGE_REASON_LABELS, CHANGE_REASON_TYPES, CHANGE_TARGET_LABELS } from '@/utils/constants'

/**
 * 异动类型字典（决策 FE-W5 / BE-7a）。
 *
 * 两件事必须锁死：
 *   1. **「异动对象」与「异动类型」是两个不同维度**——前者是 student/teacher（给谁异动），
 *      后者是转专业/留级/专升本/其他（因何异动）。历史代码把 `CHANGE_TYPE_LABELS`
 *      当「异动类型」用，正是这次要修掉的语义混淆。
 *   2. **兜底必须存在**——历史数据 `change_type` 为 NULL，展示层不得出现 `undefined`。
 */
describe('异动类型字典（FE-W5）', () => {
  it('异动类型取值为决策文档冻结的 4 个枚举 + 中文标签', () => {
    expect(CHANGE_REASON_TYPES).toEqual({
      MAJOR_TRANSFER: '转专业',
      GRADE_REPEAT: '留级',
      UPGRADE: '专升本',
      OTHER: '其他',
    })
  })

  it('异动对象与异动类型是两套字典，语义不重叠', () => {
    // 对象：给谁异动
    expect(CHANGE_TARGET_LABELS).toEqual({ student: '学生异动', teacher: '教师异动' })
    // 类型：因何异动——不应出现 student/teacher 这类「对象」取值
    expect(Object.keys(CHANGE_REASON_LABELS)).not.toContain('student')
    expect(Object.keys(CHANGE_REASON_LABELS)).not.toContain('teacher')
  })

  it('历史数据（change_type 为 null）兜底为「未分类」而不是 undefined', () => {
    // 与展示层同一写法：CHANGE_REASON_LABELS[row.changeType ?? 'UNCLASSIFIED'] ?? '未分类'
    const labelOf = (code?: string | null) =>
      CHANGE_REASON_LABELS[code ?? 'UNCLASSIFIED'] ?? '未分类'

    expect(CHANGE_REASON_LABELS.UNCLASSIFIED).toBe('未分类')
    expect(labelOf(null)).toBe('未分类')
    expect(labelOf(undefined)).toBe('未分类')
    // 未知枚举值同样不该直接落到 undefined 展示
    expect(labelOf('SOMETHING_ELSE')).toBe('未分类')
    // 正常枚举值照常命中
    expect(labelOf('MAJOR_TRANSFER')).toBe('转专业')
  })

  it('四个枚举都能取到中文标签', () => {
    for (const code of Object.keys(CHANGE_REASON_TYPES)) {
      expect(CHANGE_REASON_LABELS[code]).toBeTruthy()
    }
  })
})
