/**
 * el-table / el-table-column 的类型边界工具。
 *
 * Element Plus 把表格行的类型固定声明为 `DefaultRow = Record<PropertyKey, any>`
 * （`el-table-column` 的默认插槽 props 即 `{ row: DefaultRow; column; $index }`），
 * 因此插槽里的 `row` 传给业务函数时无法直接匹配具体行类型。
 *
 * 用法（模板内，仅出现在把 row 交给业务函数的位置）：
 * ```vue
 * <template #default="{ row }">
 *   <el-button @click="toggleStatus(asRow<Account>(row))">停用</el-button>
 * </template>
 * ```
 *
 * 说明：这是本仓库唯一的第三方类型断言点；列内普通字段读取（`row.name`）无需包一层。
 */
export function asRow<T>(row: unknown): T {
  return row as T
}

export default asRow
