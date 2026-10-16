<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowBigUp, Eye, EyeOff } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    id: string
    label: string
    autocomplete: string
    type?: 'text' | 'email' | 'password'
    required?: boolean
    minlength?: number
    maxlength?: number
    hint?: string
    invalid?: boolean
    disabled?: boolean
    describedby?: string
  }>(),
  {
    type: 'text',
    required: false,
    minlength: undefined,
    maxlength: undefined,
    hint: undefined,
    invalid: false,
    disabled: false,
    describedby: undefined,
  },
)

const model = defineModel<string>({ required: true })

const { t } = useI18n()
const input = ref<HTMLInputElement | null>(null)
const revealed = ref(false)
const capsLock = ref(false)

const isPassword = computed(() => props.type === 'password')
const inputType = computed(() => (isPassword.value && revealed.value ? 'text' : props.type))
const revealLabel = computed(() => (revealed.value ? t('auth.fields.hidePassword') : t('auth.fields.showPassword')))
const capsId = computed(() => `${props.id}-caps`)
const hintId = computed(() => `${props.id}-hint`)
const describedBy = computed(() => {
  const ids = [props.describedby, props.hint ? hintId.value : undefined, isPassword.value && capsLock.value ? capsId.value : undefined]
  return ids.filter(Boolean).join(' ') || undefined
})

function handleKey(event: KeyboardEvent) {
  if (!isPassword.value || typeof event.getModifierState !== 'function') return
  capsLock.value = event.getModifierState('CapsLock')
}

function handleBlur() {
  capsLock.value = false
}

function toggleReveal() {
  revealed.value = !revealed.value
}

function focusAndSelect() {
  input.value?.focus()
  input.value?.select()
}

defineExpose({ focusAndSelect })
</script>

<template>
  <div class="flex flex-col gap-[0.3125rem]">
    <div class="relative">
      <input
        :id="id"
        ref="input"
        v-model="model"
        :type="inputType"
        :autocomplete="autocomplete"
        :required="required"
        :minlength="minlength"
        :maxlength="maxlength"
        :disabled="disabled"
        :aria-invalid="invalid || undefined"
        :aria-describedby="describedBy"
        spellcheck="false"
        autocapitalize="none"
        @keydown="handleKey"
        @keyup="handleKey"
        @blur="handleBlur"
        class="auth-line h-[2.375rem] w-full border-0 border-b border-(--plate-rule) bg-transparent px-0.5 font-serif text-lg text-foreground italic outline-none transition-[border-color,box-shadow] duration-150 disabled:opacity-60"
        :class="{ 'pe-10': isPassword, 'is-secret': isPassword && !revealed }"
      />
      <button
        v-if="isPassword"
        type="button"
        class="absolute end-0 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:text-primary"
        :aria-label="revealLabel"
        :aria-pressed="revealed"
        :aria-controls="id"
        :disabled="disabled"
        @click="toggleReveal"
      >
        <EyeOff v-if="revealed" :size="16" aria-hidden="true" />
        <Eye v-else :size="16" aria-hidden="true" />
      </button>
    </div>
    <div class="flex items-baseline justify-between gap-3">
      <label :for="id" class="text-[0.65625rem] leading-[0.875rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">{{
        label
      }}</label>
      <slot name="aside" />
    </div>
    <p v-if="isPassword" :id="capsId" class="text-xs leading-4 text-muted-foreground empty:-mt-[0.3125rem]" aria-live="polite">
      <span v-if="capsLock" class="inline-flex items-center gap-1.5">
        <ArrowBigUp :size="14" class="shrink-0 text-(--score-orange)" aria-hidden="true" />
        {{ t('auth.fields.capsLockOn') }}
      </span>
    </p>
    <p v-if="hint" :id="hintId" class="text-xs leading-4 text-muted-foreground">{{ hint }}</p>
  </div>
</template>

<style scoped>
.auth-line {
  letter-spacing: 0.01em;
}

.auth-line.is-secret {
  font-style: normal;
  letter-spacing: 0.14em;
}

.auth-line:hover:not(:disabled) {
  border-bottom-color: color-mix(in oklch, var(--foreground) 55%, transparent);
}

.auth-line:focus {
  border-bottom-color: var(--primary);
  box-shadow: 0 1px 0 var(--primary);
}

.auth-line[aria-invalid='true'] {
  border-bottom-color: var(--destructive);
  box-shadow: 0 1px 0 var(--destructive);
}
</style>
