<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { orderFormApi } from '@/api/orderForm'
import { useWindowStore } from '@/stores/window'
import { COPY } from '@/utils/constants'
import type { TeacherCourseGroup } from '@/types'

/** 我的课程（PRD 任课老师-我的课程）：按导入的任课关系带出本人课程，按班级分组 */
const router = useRouter()
const windowStore = useWindowStore()
const groups = ref<TeacherCourseGroup[]>([])
const loading = ref(false)
/** 取数失败原因：空 catch 会让用户看到「暂无任课关系」而误以为真没课（评审 Q5） */
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    groups.value = await orderFormApi.myCourses()
  } catch (error) {
    groups.value = []
    loadError.value = (error as Error)?.message || COPY.FAILED
  } finally {
    loading.value = false
  }
}

const canFill = computed(() => windowStore.status === 'open')

function goFill() {
  void router.push('/order-form')
}

onMounted(() => {
  void windowStore.fetch()
  void load()
})
</script>

<template>
  <div class="app-page">
    <div class="flex-between mb-16">
      <span class="text-muted">
        课程由教材室导入的任课关系带出（征订范围 = 任课关系表），按班级分组。
      </span>
      <el-button type="primary" :disabled="!canFill" @click="goFill">填报教材</el-button>
    </div>

    <el-alert
      v-if="loadError"
      class="mb-16"
      :title="loadError"
      type="error"
      :closable="false"
      show-icon
      data-testid="my-courses-error"
    >
      <el-button class="mt-8" size="small" @click="load">重试</el-button>
    </el-alert>

    <div v-loading="loading">
      <el-card v-for="group in groups" :key="group.classId" class="mb-16" shadow="never">
        <template #header>
          <div class="flex-between">
            <strong>{{ group.className }}</strong>
            <span class="text-muted">{{ group.courses.length }} 门课程</span>
          </div>
        </template>
        <el-table :data="group.courses" size="small" border>
          <el-table-column prop="courseName" label="课程" min-width="200" />
          <el-table-column prop="courseId" label="课程编号" width="120" />
          <el-table-column label="操作" width="160">
            <template #default>
              <el-button size="small" type="primary" text :disabled="!canFill" @click="goFill">
                填报教材
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-empty
        v-if="!loading && !loadError && groups.length === 0"
        description="暂无任课关系，请联系教材室导入"
      >
        <el-button type="primary" text @click="goFill">仍要进入填报页</el-button>
      </el-empty>
    </div>
  </div>
</template>
