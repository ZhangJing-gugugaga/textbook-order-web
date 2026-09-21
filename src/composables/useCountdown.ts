import { onUnmounted, shallowRef } from 'vue'

/**
 * 每秒重算的取值器（SPEC §7 / §8）。
 *
 * 用途：把「依赖本地时钟的派生值」（如窗口倒计时）做成响应式，并在组件卸载时
 * **自动清理计时器**——此前 `WindowBanner` 直接 `setInterval` 且未清理，
 * 每次登出/登录循环都会新增一个永不销毁的计时器（评审 Q8）。
 *
 * @param getValue 每次 tick 后重新求值（内部可读 store getter，时钟偏移已由 store 修正）
 * @param tickMs   刷新间隔，默认 1000ms
 */
export function useCountdown<T>(getValue: () => T, tickMs = 1000) {
  const value = shallowRef<T>(getValue())
  const timer = setInterval(() => {
    value.value = getValue()
  }, tickMs)
  onUnmounted(() => clearInterval(timer))
  return value
}

export default useCountdown
