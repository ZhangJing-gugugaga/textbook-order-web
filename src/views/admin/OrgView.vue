<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, FormInstance } from 'element-plus'
import { orgApi } from '@/api/semester'
import { COPY } from '@/utils/constants'
import type { Klass, Major, OrgTree } from '@/types'

/** 组织管理（PRD 教材室-组织管理）：学院/专业/班级三级组织树维护 */
const tree = ref<OrgTree[]>([])
const loading = ref(false)
const activeColleges = ref<number[]>([])

async function load() {
  loading.value = true
  try {
    tree.value = await orgApi.tree()
  } catch {
    tree.value = []
  } finally {
    loading.value = false
  }
}

/* ---------------- 学院 ---------------- */
const collegeDialog = ref(false)
const collegeSaving = ref(false)
const collegeFormRef = ref<FormInstance>()
const collegeForm = reactive({ id: 0, name: '', code: '' })
const collegeRules = {
  name: [{ required: true, message: '请输入学院名称', trigger: 'blur' }],
  code: [{ required: true, message: '请输入学院编码', trigger: 'blur' }],
}

function openCollege(college?: OrgTree) {
  collegeForm.id = college?.id ?? 0
  collegeForm.name = college?.name ?? ''
  collegeForm.code = college?.code ?? ''
  collegeDialog.value = true
}

async function submitCollege() {
  await collegeFormRef.value?.validate()
  collegeSaving.value = true
  try {
    if (collegeForm.id) await orgApi.updateCollege(collegeForm.id, collegeForm)
    else await orgApi.createCollege(collegeForm)
    ElMessage.success(COPY.SUCCESS)
    collegeDialog.value = false
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    collegeSaving.value = false
  }
}

async function removeCollege(college: OrgTree) {
  try {
    await ElMessageBox.confirm(
      `确认删除学院「${college.name}」？其下专业与班级将一并删除。`,
      '删除',
      {
        type: 'warning',
      },
    )
  } catch {
    return
  }
  try {
    await orgApi.removeCollege(college.id)
    ElMessage.success('已删除')
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}

/* ---------------- 专业 ---------------- */
const majorDialog = ref(false)
const majorSaving = ref(false)
const majorFormRef = ref<FormInstance>()
const majorForm = reactive({ id: 0, collegeId: 0, name: '' })
const majorRules = { name: [{ required: true, message: '请输入专业名称', trigger: 'blur' }] }

function openMajor(collegeId: number, major?: Major) {
  majorForm.id = major?.id ?? 0
  majorForm.collegeId = collegeId
  majorForm.name = major?.name ?? ''
  majorDialog.value = true
}

async function submitMajor() {
  await majorFormRef.value?.validate()
  majorSaving.value = true
  try {
    if (majorForm.id) await orgApi.updateMajor(majorForm.id, majorForm)
    else await orgApi.createMajor(majorForm)
    ElMessage.success(COPY.SUCCESS)
    majorDialog.value = false
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    majorSaving.value = false
  }
}

async function removeMajor(major: Major) {
  try {
    await ElMessageBox.confirm(`确认删除专业「${major.name}」？`, '删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await orgApi.removeMajor(major.id)
    ElMessage.success('已删除')
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}

/* ---------------- 班级 ---------------- */
const classDialog = ref(false)
const classSaving = ref(false)
const classFormRef = ref<FormInstance>()
const classForm = reactive({ id: 0, majorId: 0, collegeId: 0, name: '', studentCount: 40 })
const classRules = {
  name: [{ required: true, message: '请输入班级名称', trigger: 'blur' }],
  studentCount: [{ required: true, message: '请输入班级人数', trigger: 'blur' }],
}

function openClass(majorId: number, collegeId: number, klass?: Klass) {
  classForm.id = klass?.id ?? 0
  classForm.majorId = majorId
  classForm.collegeId = collegeId
  classForm.name = klass?.name ?? ''
  classForm.studentCount = klass?.studentCount ?? 40
  classDialog.value = true
}

async function submitClass() {
  await classFormRef.value?.validate()
  classSaving.value = true
  try {
    if (classForm.id) await orgApi.updateClass(classForm.id, classForm)
    else await orgApi.createClass(classForm)
    ElMessage.success(COPY.SUCCESS)
    classDialog.value = false
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  } finally {
    classSaving.value = false
  }
}

async function removeClass(klass: Klass) {
  try {
    await ElMessageBox.confirm(`确认删除班级「${klass.name}」？`, '删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await orgApi.removeClass(klass.id)
    ElMessage.success('已删除')
    await load()
  } catch (error) {
    ElMessage.error((error as Error)?.message || COPY.FAILED)
  }
}

load()
</script>

<template>
  <div class="app-page" v-loading="loading">
    <div class="flex-between mb-16">
      <span class="text-muted">
        学院 / 专业 / 班级三级组织树；删除学院将级联删除其下专业与班级。
      </span>
      <el-button type="primary" @click="openCollege()">新增学院</el-button>
    </div>

    <el-collapse v-model="activeColleges">
      <el-collapse-item v-for="college in tree" :key="college.id" :name="college.id">
        <template #title>
          <div class="flex-between" style="width: 100%; padding-right: 12px" @click.stop>
            <span>
              <strong>{{ college.name }}</strong>
              <span class="text-muted">
                （{{ college.code }} · {{ college.majors.length }} 个专业）
              </span>
            </span>
            <div class="app-table-actions" @click.stop>
              <el-button size="small" text @click="openMajor(college.id)">新增专业</el-button>
              <el-button size="small" text @click="openCollege(college)">编辑</el-button>
              <el-button size="small" type="danger" text @click="removeCollege(college)">
                删除
              </el-button>
            </div>
          </div>
        </template>

        <div v-for="major in college.majors" :key="major.id" class="major-block">
          <div class="flex-between">
            <span>
              <strong>{{ major.name }}</strong>
              <span class="text-muted">（{{ major.classes.length }} 个班级）</span>
            </span>
            <div class="app-table-actions">
              <el-button size="small" text @click="openClass(major.id, college.id)">
                新增班级
              </el-button>
              <el-button size="small" text @click="openMajor(college.id, major)">编辑</el-button>
              <el-button size="small" type="danger" text @click="removeMajor(major)">
                删除
              </el-button>
            </div>
          </div>
          <el-table :data="major.classes" size="small" border class="mt-8">
            <el-table-column prop="name" label="班级" min-width="140" />
            <el-table-column prop="studentCount" label="班级人数" width="110" />
            <el-table-column label="操作" width="160">
              <template #default="{ row }">
                <div class="app-table-actions">
                  <el-button size="small" text @click="openClass(major.id, college.id, row)">
                    编辑
                  </el-button>
                  <el-button size="small" type="danger" text @click="removeClass(row)">
                    删除
                  </el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <el-empty v-if="college.majors.length === 0" :image-size="60" description="暂无专业" />
      </el-collapse-item>
    </el-collapse>

    <el-empty v-if="!loading && tree.length === 0" :description="COPY.EMPTY" />

    <!-- 学院弹窗 -->
    <el-dialog
      v-model="collegeDialog"
      :title="collegeForm.id ? '编辑学院' : '新增学院'"
      width="420px"
      append-to-body
    >
      <el-form ref="collegeFormRef" :model="collegeForm" :rules="collegeRules" label-width="88px">
        <el-form-item label="学院名称" prop="name">
          <el-input v-model="collegeForm.name" maxlength="32" />
        </el-form-item>
        <el-form-item label="学院编码" prop="code">
          <el-input v-model="collegeForm.code" maxlength="16" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="collegeDialog = false">取消</el-button>
        <el-button type="primary" :loading="collegeSaving" @click="submitCollege">保存</el-button>
      </template>
    </el-dialog>

    <!-- 专业弹窗 -->
    <el-dialog
      v-model="majorDialog"
      :title="majorForm.id ? '编辑专业' : '新增专业'"
      width="420px"
      append-to-body
    >
      <el-form ref="majorFormRef" :model="majorForm" :rules="majorRules" label-width="88px">
        <el-form-item label="所属学院">
          <el-select v-model="majorForm.collegeId" style="width: 100%">
            <el-option
              v-for="college in tree"
              :key="college.id"
              :label="college.name"
              :value="college.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="专业名称" prop="name">
          <el-input v-model="majorForm.name" maxlength="32" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="majorDialog = false">取消</el-button>
        <el-button type="primary" :loading="majorSaving" @click="submitMajor">保存</el-button>
      </template>
    </el-dialog>

    <!-- 班级弹窗 -->
    <el-dialog
      v-model="classDialog"
      :title="classForm.id ? '编辑班级' : '新增班级'"
      width="420px"
      append-to-body
    >
      <el-form ref="classFormRef" :model="classForm" :rules="classRules" label-width="88px">
        <el-form-item label="班级名称" prop="name">
          <el-input v-model="classForm.name" maxlength="32" placeholder="如 计算机 2301" />
        </el-form-item>
        <el-form-item label="班级人数" prop="studentCount">
          <el-input-number v-model="classForm.studentCount" :min="1" :max="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="classDialog = false">取消</el-button>
        <el-button type="primary" :loading="classSaving" @click="submitClass">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.major-block {
  padding: 12px 0;
  border-bottom: 1px dashed #e6e8f0;
}

.major-block:last-child {
  border-bottom: none;
}
</style>
