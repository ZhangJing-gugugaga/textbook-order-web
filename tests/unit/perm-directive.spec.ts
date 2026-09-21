import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, withDirectives } from 'vue'
import { mount } from '@vue/test-utils'
import perm from '@/directives/perm'
import { useAuthStore } from '@/stores/auth'

setActivePinia(createPinia())

/** v-perm 指令：无权限码移除 DOM（非置灰）（SPEC §4 / §10） */
describe('v-perm 按钮级权限', () => {
  it('有权限码：保留 DOM', () => {
    const auth = useAuthStore()
    auth.permissions = ['order:form:fill']
    const Comp = defineComponent({
      setup() {
        return () => h('div', [withDirectives(h('button', 'ok'), [[perm, 'order:form:fill']])])
      },
    })
    const wrapper = mount(Comp, { attachTo: document.body })
    expect(wrapper.find('button').exists()).toBe(true)
    wrapper.unmount()
  })

  it('无权限码：从 DOM 中移除', () => {
    const auth = useAuthStore()
    auth.permissions = ['order:form:view']
    const Comp = defineComponent({
      setup() {
        return () =>
          h('div', { id: 'host' }, [withDirectives(h('button', 'no'), [[perm, 'order:form:fill']])])
      },
    })
    const wrapper = mount(Comp, { attachTo: document.body })
    expect(wrapper.find('button').exists()).toBe(false)
    expect(document.body.querySelector('button')).toBeNull()
    wrapper.unmount()
  })

  it('数组权限码：命中其一即保留', () => {
    const auth = useAuthStore()
    auth.permissions = ['export:college']
    const Comp = defineComponent({
      setup() {
        return () =>
          h('div', [
            withDirectives(h('button', 'either'), [[perm, ['export:center', 'export:college']]]),
          ])
      },
    })
    const wrapper = mount(Comp, { attachTo: document.body })
    expect(wrapper.find('button').exists()).toBe(true)
    wrapper.unmount()
  })

  it('未传权限码：不处理', () => {
    const auth = useAuthStore()
    auth.permissions = []
    const Comp = defineComponent({
      setup() {
        return () => h('div', [withDirectives(h('button', 'plain'), [[perm, undefined]])])
      },
    })
    const wrapper = mount(Comp, { attachTo: document.body })
    expect(wrapper.find('button').exists()).toBe(true)
    wrapper.unmount()
  })
})
