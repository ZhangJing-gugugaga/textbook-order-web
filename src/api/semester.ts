import { http } from './http'
import type {
  Klass,
  Major,
  OrgTree,
  PageQuery,
  PageResult,
  Semester,
  WindowChangeRecord,
  WindowState,
} from '@/types'

/** 学期与窗口引擎（SPEC §6：CRUD + activate/archive + window open/close/extend） */
export const semesterApi = {
  list: () => http.get<Semester[]>('/semesters'),
  create: (data: Partial<Semester>) => http.post<Semester>('/semesters', data),
  update: (id: number, data: Partial<Semester>) => http.put<Semester>(`/semesters/${id}`, data),
  activate: (id: number) => http.post<Semester>(`/semesters/${id}/activate`),
  archive: (id: number) => http.post<Semester>(`/semesters/${id}/archive`),
  openWindow: (id: number) => http.post<Semester>(`/semesters/${id}/window/open`),
  closeWindow: (id: number) => http.post<Semester>(`/semesters/${id}/window/close`),
  extendWindow: (id: number, windowEnd: string) =>
    http.post<Semester>(`/semesters/${id}/window/extend`, { windowEnd }),
  changes: (id: number) => http.get<WindowChangeRecord[]>(`/semesters/${id}/changes`),
  currentWindow: () => http.get<WindowState>('/window/current'),
}

export const orgApi = {
  tree: () => http.get<OrgTree[]>('/org/tree'),
  createCollege: (data: Partial<OrgTree>) => http.post<OrgTree>('/org/colleges', data),
  updateCollege: (id: number, data: Partial<OrgTree>) =>
    http.put<OrgTree>(`/org/colleges/${id}`, data),
  removeCollege: (id: number) => http.delete<void>(`/org/colleges/${id}`),
  createMajor: (data: Partial<Major>) => http.post<Major>('/org/majors', data),
  updateMajor: (id: number, data: Partial<Major>) => http.put<Major>(`/org/majors/${id}`, data),
  removeMajor: (id: number) => http.delete<void>(`/org/majors/${id}`),
  createClass: (data: Partial<Klass>) => http.post<Klass>('/org/classes', data),
  updateClass: (id: number, data: Partial<Klass>) => http.put<Klass>(`/org/classes/${id}`, data),
  removeClass: (id: number) => http.delete<void>(`/org/classes/${id}`),
  colleges: () => http.get<{ id: number; name: string }[]>('/org/colleges'),
}

export type { PageQuery, PageResult }
