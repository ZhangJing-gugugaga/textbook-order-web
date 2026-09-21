import type { FormInstance } from 'element-plus'

/**
 * 触发表单校验。
 *
 * Element Plus 的 `validate()` 在校验不通过时会 **reject**；直接写
 * `await formRef.value?.validate()` 会让 rejection 逃出函数：
 * 模板事件触发时被 Vue 记为控制台错误，脚本内部调用时成为未处理 rejection（评审 Q7）。
 * 统一走本函数：未通过即返回 false，调用方写 `if (!(await validateForm(ref))) return`。
 */
export async function validateForm(form: FormInstance | undefined): Promise<boolean> {
  if (!form) return true
  try {
    return (await form.validate()) !== false
  } catch {
    return false
  }
}

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
