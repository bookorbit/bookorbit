<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SlidersHorizontal } from '@lucide/vue'
import type { Permission } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { formatNumber } from '@/i18n/formatters'
import { grantingPermissions, presetPermissions, toggledPermissions, type PermissionPreset } from '../lib/permission-presets'
import { permissionLabel } from '../lib/permission-labels'
import UserPermissionsSection from './UserPermissionsSection.vue'

const props = defineProps<{
  saved: Permission[] | null
  busy: boolean
  error: 'load' | 'save' | null
  save: (names: Permission[]) => Promise<boolean>
}>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
const open = ref(false)
const draft = ref(new Set<string>())
const all = grantingPermissions()
const changed = computed(() => props.saved && (props.saved.length !== draft.value.size || props.saved.some((name) => !draft.value.has(name))))

function setOpen(next: boolean) {
  if (props.busy) return
  if (next) draft.value = new Set(props.saved ?? [])
  open.value = next
}
function toggle(name: string) {
  draft.value = toggledPermissions(draft.value, name)
}
function preset(value: PermissionPreset) {
  draft.value = new Set(presetPermissions(value))
}
function cancel() {
  setOpen(false)
}
function retry() {
  emit('retry')
}
async function submit() {
  if (await props.save(all.filter((name) => draft.value.has(name)))) open.value = false
}
</script>

<template>
  <section class="space-y-3 rounded-lg border border-border bg-card p-4 shadow-xs">
    <div>
      <h4 class="settings-label">{{ t('adminFeature.usersPage.defaults.permissions') }}</h4>
      <p class="settings-hint">{{ t('adminFeature.usersPage.defaults.permissionsHint') }}</p>
    </div>
    <div v-if="saved?.length" class="flex flex-wrap gap-1.5">
      <span
        v-for="name in saved.slice(0, 3)"
        :key="name"
        class="rounded-md border border-border bg-secondary px-2 py-1 text-xs text-secondary-foreground"
        >{{ permissionLabel(name, t) }}</span
      >
      <span v-if="saved.length > 3" class="self-center text-xs text-muted-foreground">{{
        t('adminFeature.usersPage.defaults.more', { count: formatNumber(saved.length - 3) })
      }}</span>
    </div>
    <p v-else-if="saved" class="text-xs text-muted-foreground">{{ t('adminFeature.usersPage.permissionCount', 0) }}</p>
    <template v-if="error === 'load'">
      <p role="alert" class="text-sm text-destructive">{{ t('adminFeature.usersPage.defaults.permissionsLoadError') }}</p>
      <Button type="button" size="sm" variant="outline" @click="retry">{{ t('common.retry') }}</Button>
    </template>
    <Sheet :open="open" @update:open="setOpen">
      <SheetTrigger as-child>
        <Button type="button" variant="outline" size="sm" :disabled="!saved || busy"
          ><SlidersHorizontal aria-hidden="true" :size="14" />{{ t('adminFeature.usersPage.defaults.editPermissions') }}</Button
        >
      </SheetTrigger>
      <SheetContent v-if="open" hide-close class="w-full gap-0 p-0 sm:max-w-2xl">
        <header class="border-b border-border p-4">
          <SheetTitle>{{ t('adminFeature.usersPage.defaults.permissions') }}</SheetTitle>
          <SheetDescription>{{ t('adminFeature.usersPage.defaults.permissionsHint') }}</SheetDescription>
        </header>
        <div class="@container min-h-0 flex-1 overflow-y-auto p-4">
          <UserPermissionsSection :selected="draft" :total="all.length" :granted="draft.size" @toggle="toggle" @preset="preset" />
        </div>
        <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-border p-4">
          <p v-if="error === 'save'" role="alert" class="me-auto text-sm text-destructive">
            {{ t('adminFeature.usersPage.defaults.permissionsSaveError') }}
          </p>
          <Button type="button" variant="outline" size="sm" :disabled="busy" @click="cancel">{{ t('common.cancel') }}</Button>
          <Button type="button" size="sm" :disabled="busy || !changed" @click="submit">{{
            t('adminFeature.usersPage.defaults.savePermissions')
          }}</Button>
        </footer>
      </SheetContent>
    </Sheet>
  </section>
</template>
