/** 窗口期校验规则（PRD 征订窗口管理页字段规范） */

/** 窗口开始必须早于结束 */
export function validateWindowRange(start: string, end: string): string | null {
  if (!start || !end) return '请选择窗口开始与截止时间'
  if (new Date(start) >= new Date(end)) return '窗口开始时间必须早于结束时间'
  return null
}

/** 延长后的截止时间必须晚于当前时间（提前截止后可再延长） */
export function validateExtendEnd(next: string, now: number = Date.now()): string | null {
  if (!next) return '请选择新的截止时间'
  if (new Date(next).getTime() <= now) return '延长后的截止时间必须晚于当前时间'
  return null
}

/** 驳回理由：1-200 字必填（复核工作台 / 异动审批） */
export function validateRejectComment(comment: string): string | null {
  const value = comment.trim()
  if (!value) return '驳回理由必填'
  if (value.length > 200) return '驳回理由不超过 200 字'
  return null
}

/** 新密码：8-64 位，含字母和数字（PRD 功能 1 字段规范） */
export function validateNewPassword(password: string): string | null {
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(password)) {
    return '新密码需 8 位以上且含字母和数字'
  }
  return null
}
