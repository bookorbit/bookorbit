<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { X } from '@lucide/vue'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import IconPicker from '@/components/IconPicker.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const { createSmartScope } = useSmartScopes()
const { t } = useI18n()

const name = ref('')
const icon = ref('')
const isPublic = ref(false)
const syncToKobo = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const trimmedName = computed(() => name.value.trim())
const trimmedIcon = computed(() => icon.value.trim())

async function submit() {
  if (!trimmedName.value) {
    error.value = t('smartScope.dialog.nameRequired')
    return
  }
  if (!trimmedIcon.value) {
    error.value = t('smartScope.dialog.iconRequired')
    return
  }
  saving.value = true
  error.value = null
  try {
    const smartScope = await createSmartScope({
      name: trimmedName.value,
      icon: trimmedIcon.value,
      defaultSort: [],
      isPublic: isPublic.value,
      syncToKobo: syncToKobo.value,
    })
    name.value = ''
    icon.value = ''
    isPublic.value = false
    syncToKobo.value = false
    emit('close')
    router.push({ name: 'smartScope', params: { id: smartScope.id } })
  } catch {
    error.value = t('smartScope.createDialog.createFailed')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('close')" />
      <div class="relative z-10 w-full max-w-md mx-4 bg-card border border-border rounded-lg shadow-2xl p-6">
        <div class="flex items-center justify-between mb-5">
          <h2 class="text-base font-semibold text-foreground">{{ t('smartScope.createDialog.title') }}</h2>
          <button @click="emit('close')" class="text-muted-foreground hover:text-foreground transition-colors">
            <X :size="18" />
          </button>
        </div>

        <form @submit.prevent="submit" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-foreground">{{ t('smartScope.dialog.name') }}</label>
            <input
              v-model="name"
              type="text"
              :placeholder="t('smartScope.dialog.namePlaceholder')"
              autofocus
              class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-3 focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-foreground">{{ t('smartScope.dialog.icon') }}</label>
            <IconPicker v-model="icon" :placeholder="t('smartScope.dialog.iconPlaceholder')" />
          </div>

          <label class="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" v-model="isPublic" class="h-4 w-4 rounded border border-input accent-primary" />
            <span class="text-sm text-foreground">{{ t('smartScope.createDialog.visibleToAll') }}</span>
          </label>

          <label class="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" v-model="syncToKobo" class="h-4 w-4 rounded border border-input accent-primary" />
            <span class="text-sm text-foreground">{{ t('smartScope.syncToKobo') }}</span>
          </label>

          <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

          <div class="flex justify-end gap-2 mt-1">
            <button
              type="button"
              @click="emit('close')"
              class="h-9 px-4 rounded-md border border-input bg-background text-sm text-foreground hover:bg-muted transition-colors"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              type="submit"
              :disabled="!trimmedName || !trimmedIcon || saving"
              class="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ saving ? t('smartScope.dialog.creating') : t('smartScope.dialog.create') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
