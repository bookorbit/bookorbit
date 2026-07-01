<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useCollections } from '../composables/useCollections'
import IconPicker from '@/components/IconPicker.vue'
import type { Collection } from '@bookorbit/types'

const props = defineProps<{ open: boolean; collection: Collection }>()
const emit = defineEmits<{ close: []; deleted: [id: number, name: string] }>()

const router = useRouter()
const { updateCollection, deleteCollection } = useCollections()
const { t } = useI18n()

const name = ref('')
const icon = ref('')
const syncToKobo = ref(false)
const saving = ref(false)
const deleting = ref(false)
const confirmingDelete = ref(false)
const error = ref<string | null>(null)
const trimmedName = computed(() => name.value.trim())
const trimmedIcon = computed(() => icon.value.trim())

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      name.value = props.collection.name
      icon.value = props.collection.icon ?? ''
      syncToKobo.value = props.collection.syncToKobo
      error.value = null
      confirmingDelete.value = false
    }
  },
)

async function submit() {
  if (!trimmedName.value) {
    error.value = t('collection.dialog.nameRequired')
    return
  }
  if (!trimmedIcon.value) {
    error.value = t('collection.dialog.iconRequired')
    return
  }
  saving.value = true
  error.value = null
  try {
    await updateCollection(props.collection.id, trimmedName.value, trimmedIcon.value, syncToKobo.value)
    emit('close')
  } catch {
    error.value = t('collection.editDialog.updateFailed')
  } finally {
    saving.value = false
  }
}

function handleDeleteClick() {
  if (confirmingDelete.value) confirmDelete()
  else promptDelete()
}

function handleCancelClick() {
  if (confirmingDelete.value) cancelDelete()
  else emit('close')
}

function promptDelete() {
  confirmingDelete.value = true
  error.value = null
}

function cancelDelete() {
  confirmingDelete.value = false
}

async function confirmDelete() {
  const id = props.collection.id
  const name = props.collection.name
  deleting.value = true
  error.value = null
  try {
    await deleteCollection(id)
    toast.success(t('collection.editDialog.deleted', { name }))
    router.replace({ name: 'dashboard' })
    emit('deleted', id, name)
    emit('close')
  } catch {
    error.value = t('collection.editDialog.deleteFailed')
    confirmingDelete.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('close')" />
      <div class="relative z-10 w-full max-w-md mx-4 bg-card border border-border rounded-lg shadow-2xl p-6">
        <div class="flex items-center justify-between mb-5">
          <h2 class="text-base font-semibold text-foreground">{{ t('collection.editDialog.title') }}</h2>
          <button @click="emit('close')" class="text-muted-foreground hover:text-foreground transition-colors">
            <X :size="18" />
          </button>
        </div>

        <form @submit.prevent="submit" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-foreground">{{ t('collection.dialog.name') }}</label>
            <input
              v-model="name"
              type="text"
              autofocus
              class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-3 focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-foreground">{{ t('collection.dialog.icon') }}</label>
            <IconPicker v-model="icon" :placeholder="t('collection.dialog.iconPlaceholder')" />
          </div>

          <div class="flex items-center justify-between py-1">
            <div>
              <p class="text-sm font-medium text-foreground">{{ t('collection.editDialog.syncToKobo') }}</p>
              <p class="text-xs text-muted-foreground mt-0.5">{{ t('collection.editDialog.syncToKoboHint') }}</p>
            </div>
            <button
              type="button"
              class="w-11 h-6 rounded-full transition-colors relative shrink-0"
              :class="syncToKobo ? 'bg-primary' : 'bg-muted'"
              @click="syncToKobo = !syncToKobo"
            >
              <div
                class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
                :class="syncToKobo ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>

          <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

          <div class="flex items-center justify-between gap-2 mt-1">
            <button
              type="button"
              :disabled="saving || deleting"
              class="h-9 px-4 rounded-md border text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              :class="
                confirmingDelete
                  ? 'border-destructive text-destructive bg-destructive/10 hover:bg-destructive/20'
                  : 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15'
              "
              @click="handleDeleteClick"
            >
              {{
                deleting
                  ? t('collection.editDialog.deleting')
                  : confirmingDelete
                    ? t('collection.editDialog.confirmDelete')
                    : t('collection.editDialog.deleteCollection')
              }}
            </button>

            <div class="flex items-center gap-2">
              <button
                type="button"
                :disabled="saving || deleting"
                class="h-9 px-4 rounded-md border border-input bg-background text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                @click="handleCancelClick"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                type="submit"
                :disabled="!trimmedName || !trimmedIcon || saving || deleting"
                class="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {{ saving ? t('collection.editDialog.saving') : t('common.save') }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
