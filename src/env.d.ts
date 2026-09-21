/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

interface ImportMetaEnv {
  /** 部署子路径（未配置时按模式取默认：development=/，其余=/textbook/） */
  readonly VITE_BASE: string
  /** dev/preview 的 /api 代理目标（真实后端地址） */
  readonly VITE_PROXY_TARGET?: string
  /** 置为 '1' 时构建产出 sourcemap（预发/生产排障用，默认关闭） */
  readonly VITE_SOURCEMAP?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** 构建时注入的应用版本（见 vite.config.ts 的 define） */
declare const __APP_VERSION__: string
