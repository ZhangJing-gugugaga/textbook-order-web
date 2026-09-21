import type { Directive } from 'vue'
import { useAuthStore } from '@/stores/auth'

/**
 * v-perm 按钮级权限（SPEC §4）：无权限码移除 DOM（非置灰）。
 */
export const perm: Directive<HTMLElement, string | string[] | undefined> = {
  mounted(el, binding) {
    const codes = Array.isArray(binding.value)
      ? binding.value
      : binding.value
        ? [binding.value]
        : []
    if (codes.length === 0) return
    const auth = useAuthStore()
    const allowed = codes.some((code) => auth.has(code))
    if (!allowed) {
      el.parentNode?.removeChild(el)
    }
  },
}

export default perm
