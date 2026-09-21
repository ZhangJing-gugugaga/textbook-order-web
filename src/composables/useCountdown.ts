import { onUnmounted, ref, type Ref } from 'vue'

/**
 * 倒计时（SPEC §7 窗口 store 配合使用）：
 * 目标时间戳由调用方给出（已含服务端时钟偏移修正），本地每秒刷新。
 */
export function useCountdown(getTargetMs: () => number, tickMs = 1000) {
  const now = ref(Date.now())
  const timer = setInterval(() => {
    now.value = Date.now()
  }, tickMs)

  onUnmounted(() => clearInterval(timer))

  const remainMs: Ref<number> = ref(getTargetMs())
  const refresh = () => {
    remainMs.value = Math.max(0, getTargetMs())
  }
  refresh()
  const watcher = setInterval(refresh, tickMs)
  onUnmounted(() => clearInterval(watcher))

  return { now, remainMs, refresh }
}

/** 通用轮询：页面离开即停 */
export function usePolling(fn: () => void | Promise<void>, intervalMs: number) {
  let timer: ReturnType<typeof setInterval> | null = null
  const running = ref(false)

  const start = () => {
    if (timer) return
    running.value = true
    timer = setInterval(() => void fn(), intervalMs)
  }
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
    running.value = false
  }

  onUnmounted(stop)

  return { start, stop, running }
}
