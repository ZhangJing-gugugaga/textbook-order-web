<script setup lang="ts">
import type { OrderFormItem } from '@/types'

/**
 * 教师征订单明细表（课程 × 班级 × 教材 × 数量）。
 *
 * 复核工作台、本院征订记录、我的提交记录三处展示的是同一份明细结构，
 * 原先各自抄了一遍 5 列定义（宽度还出现了 160/170 的漂移）。
 * 抽成组件后列定义只有一份，改一处三处生效（评审 A6）。
 */
withDefaults(
  defineProps<{
    items: OrderFormItem[] | null | undefined
    size?: 'large' | 'default' | 'small'
    textbookMinWidth?: number
  }>(),
  { size: 'small', textbookMinWidth: 160 },
)
</script>

<template>
  <el-table :data="items ?? []" :size="size" border stripe>
    <el-table-column prop="courseName" label="课程" min-width="140" />
    <el-table-column prop="className" label="班级" width="140" />
    <el-table-column
      prop="textbookTitle"
      label="教材"
      :min-width="textbookMinWidth"
      show-overflow-tooltip
    />
    <el-table-column prop="isbn" label="ISBN" width="150" />
    <el-table-column prop="quantity" label="数量" width="90" />
  </el-table>
</template>
