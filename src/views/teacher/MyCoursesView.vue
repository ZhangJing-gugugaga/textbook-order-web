<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { orderFormApi } from '@/api/orderForm'
import { useWindowStore } from '@/stores/window'
import type { TeachingAssignment } from '@/types'

/** 我的课程（PRD 任课老师-我的课程）：按导入的任课关系带出本人课程，按班级分组 */
const router = useRouter()
const windowStore = useWindowStore()
const courses = ref<TeachingAssignment[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    courses.value = await orderFormApi.myCourses()
  } catch {
    courses.value = []
  } finally {
    loading.value = false
  }
}

/** 按课程分组，再按班级展开 */
const grouped = computed(() => {
  const map = new Map<
    number,
    { courseId: number; courseName: string; classes: TeachingAssignment[] }
  >()
  for (const item of courses.value) {
    if (!map.has(item.courseId)) {
      map.set(item.courseId, { courseId: item.courseId, courseName: item.courseName, classes: [] })
    }
    map.get(item.courseId)!.classes.push(item)
  }
  return [...map.values()]
})

const canFill = computed(() => windowStore.status === 'open')

function goFill(courseId: number, classId: number) {
  void router.push({ path: '/order-form', query: { courseId, classId } })
}

onMounted(load)
</script>

<template>
  <div class="app-page">
    <div class="flex-between mb-16">
      <span class="text-muted">课程由教材室导入的任课关系带出，按班级分组。</span>
      <el-button type="primary" :disabled="!canFill" @click="router.push('/order-form')">
        填报教材
      </el-button>
    </div>

    <div v-loading="loading">
      <el-card v-for="group in grouped" :key="group.courseId" class="mb-16" shadow="never">
        <template #header>
          <div class="flex-between">
            <strong>{{ group.courseName }}</strong>
            <span class="text-muted">{{ group.classes.length }} 个班级</span>
          </div>
        </template>
        <el-table :data="group.classes" size="small" border>
          <el-table-column prop="className" label="班级" min-width="160" />
          <el-table-column prop="collegeId" label="学院编号" width="110" />
          <el-table-column label="操作" width="160">
            <template #default="{ row }">
              <el-button
                size="small"
                type="primary"
                text
                :disabled="!canFill"
                @click="goFill(group.courseId, row.classId)"
              >
                填报教材
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-empty
        v-if="!loading && grouped.length === 0"
        description="暂无任课关系，请联系教材室导入"
      >
        <el-button type="primary" text @click="router.push('/order-form')">
          仍要进入填报页
        </el-button>
      </el-empty>
    </div>
  </div>
</template>
