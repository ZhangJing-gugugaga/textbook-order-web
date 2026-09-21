/**
 * CSS 兼容性处理：让 `package.json` 的 browserslist 真正生效（SPEC §3 浏览器兼容矩阵）。
 * 不引入 postcss-preset-env —— 仅需厂商前缀补齐，避免语法降级带来的额外体积。
 */
export default {
  plugins: {
    autoprefixer: {},
  },
}
