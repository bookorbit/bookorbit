<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Tablet } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

const props = defineProps<{ userId?: number; canSend: boolean; invalid: boolean }>()
const email = defineModel<string>({ required: true })
const { t } = useI18n()
const adding = ref(!!email.value)
const recent = ref<string[]>([])
const loadFailed = ref(false)
const field = ref<HTMLInputElement>()
const addButton = ref<HTMLButtonElement>()
watch(
  () => props.userId,
  async (id, _, onCleanup) => {
    let current = true
    onCleanup(() => {
      current = false
    })
    recent.value = []
    loadFailed.value = false
    adding.value = !!email.value
    if (!id) return
    try {
      const res = await api(`/api/v1/users/${id}/kindle-recipients`)
      if (!res.ok) throw new Error()
      const addresses: string[] = await res.json()
      if (current) recent.value = addresses
    } catch {
      if (current) loadFailed.value = true
    }
  },
  { immediate: true },
)

async function add() {
  adding.value = true
  await nextTick()
  field.value?.focus()
}
async function discard() {
  email.value = ''
  adding.value = false
  await nextTick()
  addButton.value?.focus()
}
</script>

<template>
  <section class="space-y-2.5 rounded-lg border border-border bg-card p-3.5" aria-labelledby="user-kindle-heading">
    <div>
      <h3 id="user-kindle-heading" class="settings-label flex items-center gap-2">
        <Tablet :size="15" aria-hidden="true" />{{ t('adminFeature.userForm.kindle.title') }}
      </h3>
      <p class="settings-hint">{{ t('adminFeature.userForm.kindle.hint') }}</p>
    </div>
    <p v-if="loadFailed" role="alert" class="settings-hint">{{ t('adminFeature.userForm.kindle.loadError') }}</p>
    <div v-if="recent.length" class="space-y-1">
      <p class="settings-hint">{{ t('adminFeature.userForm.kindle.recent') }}</p>
      <ul class="space-y-1 text-sm text-foreground">
        <li v-for="address in recent" :key="address" class="break-all">{{ address }}</li>
      </ul>
    </div>
    <template v-if="adding">
      <div class="space-y-1.5">
        <label for="user-kindle-email" class="settings-label">{{ t('adminFeature.userForm.kindle.address') }}</label>
        <input
          id="user-kindle-email"
          ref="field"
          v-model="email"
          type="email"
          autocomplete="off"
          maxlength="255"
          class="input-field w-full"
          :aria-invalid="invalid || undefined"
          :aria-describedby="invalid ? 'user-form-error' : undefined"
        />
      </div>
      <Button size="sm" variant="ghost" type="button" @click="discard">{{ t('adminFeature.userForm.kindle.discard') }}</Button>
    </template>
    <button
      v-else
      ref="addButton"
      type="button"
      class="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-input px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      @click="add"
    >
      <Plus :size="14" aria-hidden="true" />{{ t('adminFeature.userForm.kindle.add') }}
    </button>
    <p v-if="!canSend && (adding || recent.length)" class="settings-hint">{{ t('adminFeature.userForm.kindle.permissionHint') }}</p>
  </section>
</template>
