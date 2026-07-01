<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Moon, Sun, Wallpaper } from '@lucide/vue'
import { ACCENT_VIVID, ACCENT_PASTEL, ACCENT_OPTIONS, RADIUS_OPTIONS, BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'
import { api } from '@/lib/api'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const { t } = useI18n()
const themeStore = useThemeStore()
const accentOpen = ref(false)
const radiusOpen = ref(false)
const backgroundOpen = ref(false)
const currentAccent = computed(() => ACCENT_OPTIONS.find((o) => o.id === themeStore.accent))

function radiusPreview(id: string): string {
  const map: Record<string, string> = {
    sharp: '0px',
    default: '4px',
    rounded: '8px',
    pill: '999px',
  }
  return map[id] ?? '4px'
}

function openRadius() {
  radiusOpen.value = !radiusOpen.value
  accentOpen.value = false
  backgroundOpen.value = false
}

function openBackground() {
  backgroundOpen.value = !backgroundOpen.value
  accentOpen.value = false
  radiusOpen.value = false
}

function openAccent() {
  accentOpen.value = !accentOpen.value
  radiusOpen.value = false
  backgroundOpen.value = false
}

function closeAll() {
  accentOpen.value = false
  radiusOpen.value = false
  backgroundOpen.value = false
}

const email = ref('')
const submitted = ref(false)
const error = ref<string | null>(null)
const loading = ref(false)

async function handleSubmit() {
  error.value = null
  loading.value = true
  try {
    const res = await api('/api/v1/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value }),
    })
    if (res.status === 503) {
      error.value = t('auth.forgotPassword.errors.emailUnavailable')
      return
    }
    submitted.value = true
  } catch {
    error.value = t('auth.errors.generic')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-bg min-h-screen flex items-center justify-center px-4 overflow-hidden">
    <!-- Compact theme picker -->
    <div class="fixed bottom-5 right-5 z-20 flex items-center gap-1.5">
      <!-- Dark / light toggle -->
      <Tooltip>
        <TooltipTrigger as-child>
          <button class="theme-btn" @click="themeStore.toggleTheme()">
            <Sun v-if="themeStore.theme === 'dark'" :size="14" />
            <Moon v-else :size="14" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ themeStore.theme === 'dark' ? t('auth.themePicker.switchToLight') : t('auth.themePicker.switchToDark') }}</TooltipContent>
      </Tooltip>

      <!-- Radius picker -->
      <div class="relative">
        <Transition name="popover">
          <div v-if="radiusOpen" class="accent-popover absolute bottom-full right-0 mb-2 p-2.5 rounded-lg">
            <div class="flex items-center gap-1.5">
              <Tooltip v-for="opt in RADIUS_OPTIONS" :key="opt.id">
                <TooltipTrigger as-child>
                  <button
                    class="flex items-center justify-center w-8 h-8 rounded-lg transition-all focus:outline-none"
                    :class="
                      themeStore.radius === opt.id
                        ? 'text-primary bg-primary/10'
                        : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
                    "
                    @click="themeStore.setRadius(opt.id)"
                  >
                    <span class="w-4 h-4 border-2 border-current block" :style="{ borderRadius: radiusPreview(opt.id) }" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{{ opt.label }}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </Transition>
        <Tooltip>
          <TooltipTrigger as-child>
            <button class="theme-btn" @click="openRadius()">
              <span class="w-3.5 h-3.5 border-2 border-current block" :style="{ borderRadius: radiusPreview(themeStore.radius) }" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('auth.themePicker.changeRadius') }}</TooltipContent>
        </Tooltip>
      </div>

      <!-- Background picker -->
      <div class="relative">
        <Transition name="popover">
          <div v-if="backgroundOpen" class="accent-popover absolute bottom-full right-0 mb-2 p-2.5 rounded-lg w-64 max-h-72 overflow-y-auto">
            <div class="grid grid-cols-5 gap-1.5">
              <Tooltip v-for="opt in BACKGROUND_OPTIONS" :key="opt.id">
                <TooltipTrigger as-child>
                  <button
                    class="w-full h-9 rounded overflow-hidden ring-2 transition-all focus:outline-none shrink-0"
                    :class="
                      themeStore.background === opt.id ? 'ring-primary shadow-sm shadow-primary/20' : 'ring-border hover:ring-muted-foreground/40'
                    "
                    @click="themeStore.setBackground(opt.id)"
                  >
                    <div class="w-full h-full bg-background pattern-preview" :class="opt.cssClass" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{{ opt.label }}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </Transition>
        <Tooltip>
          <TooltipTrigger as-child>
            <button class="theme-btn" @click="openBackground()">
              <Wallpaper :size="14" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('auth.themePicker.changeBackground') }}</TooltipContent>
        </Tooltip>
      </div>

      <!-- Accent picker -->
      <div class="relative">
        <Transition name="popover">
          <div v-if="accentOpen" class="accent-popover absolute bottom-full right-0 mb-2 p-3 rounded-lg space-y-2">
            <div class="flex items-center gap-1.5">
              <Tooltip v-for="opt in ACCENT_VIVID" :key="opt.id">
                <TooltipTrigger as-child>
                  <button
                    class="w-4 h-4 rounded-full transition-all hover:scale-125 focus:outline-none shrink-0"
                    :style="{
                      backgroundColor: opt.color,
                      outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
                      outlineOffset: '2px',
                      transform: themeStore.accent === opt.id ? 'scale(1.2)' : '',
                    }"
                    @click="themeStore.setAccent(opt.id)"
                  />
                </TooltipTrigger>
                <TooltipContent>{{ opt.label }}</TooltipContent>
              </Tooltip>
            </div>
            <div class="flex items-center gap-1.5">
              <Tooltip v-for="opt in ACCENT_PASTEL" :key="opt.id">
                <TooltipTrigger as-child>
                  <button
                    class="w-4 h-4 rounded-full transition-all hover:scale-125 focus:outline-none shrink-0"
                    :style="{
                      backgroundColor: opt.color,
                      outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
                      outlineOffset: '2px',
                      transform: themeStore.accent === opt.id ? 'scale(1.2)' : '',
                    }"
                    @click="themeStore.setAccent(opt.id)"
                  />
                </TooltipTrigger>
                <TooltipContent>{{ opt.label }}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </Transition>
        <Tooltip>
          <TooltipTrigger as-child>
            <button class="theme-btn" @click="openAccent()">
              <span class="w-3.5 h-3.5 rounded-full block" :style="{ backgroundColor: currentAccent?.color }" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('auth.themePicker.changeAccent') }}</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <!-- Click-outside backdrop -->
    <div v-if="accentOpen || radiusOpen || backgroundOpen" class="fixed inset-0 z-10" @click="closeAll()" />

    <div class="login-card relative z-10 w-full max-w-sm rounded-2xl p-8">
      <div class="text-center mb-8">
        <h1 class="text-2xl font-serif font-semibold text-foreground">Book<span class="text-primary"> Orbit</span></h1>
        <p class="text-sm text-muted-foreground mt-1">{{ t('auth.forgotPassword.subtitle') }}</p>
      </div>

      <div v-if="submitted" class="rounded-md border border-border bg-card/60 backdrop-blur-sm p-4 text-sm text-foreground">
        {{ t('auth.forgotPassword.submitted') }}
      </div>

      <form v-else @submit.prevent="handleSubmit" class="space-y-4">
        <div class="space-y-1.5">
          <label for="email" class="text-sm font-medium text-foreground">{{ t('auth.fields.emailAddress') }}</label>
          <input
            id="email"
            v-model="email"
            type="email"
            autocomplete="email"
            required
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {{ loading ? t('auth.forgotPassword.sending') : t('auth.forgotPassword.sendResetLink') }}
        </button>
      </form>

      <p class="mt-4 text-center text-sm text-muted-foreground">
        <RouterLink to="/login" class="text-primary hover:underline">{{ t('auth.backToSignIn') }}</RouterLink>
      </p>
    </div>
  </div>
</template>

<style scoped>
.login-bg {
  position: relative;
}

.theme-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 9999px;
  background: color-mix(in oklch, var(--card) 72%, transparent);
  border: 1px solid color-mix(in oklch, var(--border) 55%, transparent);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: var(--elevation-md);
  color: var(--muted-foreground);
  transition: color 0.15s ease;
}

.theme-btn:hover {
  color: var(--foreground);
}

.accent-popover {
  background: color-mix(in oklch, var(--card) 80%, transparent);
  border: 1px solid color-mix(in oklch, var(--border) 55%, transparent);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow: var(--elevation-lg);
}

.popover-enter-active,
.popover-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.popover-enter-from,
.popover-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.97);
}

.login-card {
  background: color-mix(in oklch, var(--card) 72%, transparent);
  border: 1px solid color-mix(in oklch, var(--border) 55%, transparent);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow: var(--elevation-xl);
}
</style>
