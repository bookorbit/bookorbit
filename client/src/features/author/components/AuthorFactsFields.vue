<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import ChipInput from '@/components/ui/ChipInput.vue'
import type { AuthorFactsDraft, AuthorFactsField } from '../lib/author-facts'

const props = defineProps<{ invalid: AuthorFactsField[] }>()
const draft = defineModel<AuthorFactsDraft>({ required: true })

const { t } = useI18n()
const id = useId()

function isInvalid(field: AuthorFactsField): boolean {
  return props.invalid.includes(field)
}

function field<K extends keyof AuthorFactsDraft>(key: K) {
  return computed<AuthorFactsDraft[K]>({
    get: () => draft.value[key],
    set: (value) => {
      draft.value = { ...draft.value, [key]: value }
    },
  })
}

const website = field('website')
const born = field('born')
const died = field('died')
const genres = field('genres')
const influences = field('influences')
</script>

<template>
  <div class="space-y-2">
    <label class="block text-xs text-muted-foreground">
      {{ t('author.detail.edit.website') }}
      <input
        v-model="website"
        type="url"
        inputmode="url"
        autocomplete="off"
        class="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
        :class="isInvalid('website') ? 'border-destructive' : ''"
        :placeholder="t('author.detail.edit.websitePlaceholder')"
        :aria-invalid="isInvalid('website') || undefined"
        :aria-describedby="isInvalid('website') ? `${id}-website-error` : undefined"
      />
      <span v-if="isInvalid('website')" :id="`${id}-website-error`" class="mt-1 block text-destructive">
        {{ t('author.detail.edit.websiteInvalid') }}
      </span>
    </label>

    <div class="grid gap-2 md:grid-cols-2">
      <label class="text-xs text-muted-foreground">
        {{ t('author.detail.edit.born') }}
        <input
          v-model="born"
          autocomplete="off"
          class="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
          :class="isInvalid('born') ? 'border-destructive' : ''"
          :placeholder="t('author.detail.edit.lifeDatePlaceholder')"
          :aria-invalid="isInvalid('born') || undefined"
          :aria-describedby="isInvalid('born') ? `${id}-born-error` : `${id}-life-date-hint`"
        />
        <span v-if="isInvalid('born')" :id="`${id}-born-error`" class="mt-1 block text-destructive">
          {{ t('author.detail.edit.lifeDateInvalid') }}
        </span>
      </label>
      <label class="text-xs text-muted-foreground">
        {{ t('author.detail.edit.died') }}
        <input
          v-model="died"
          autocomplete="off"
          class="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
          :class="isInvalid('died') ? 'border-destructive' : ''"
          :placeholder="t('author.detail.edit.lifeDatePlaceholder')"
          :aria-invalid="isInvalid('died') || undefined"
          :aria-describedby="isInvalid('died') ? `${id}-died-error` : `${id}-life-date-hint`"
        />
        <span v-if="isInvalid('died')" :id="`${id}-died-error`" class="mt-1 block text-destructive">
          {{ t('author.detail.edit.lifeDateInvalid') }}
        </span>
      </label>
    </div>
    <p :id="`${id}-life-date-hint`" class="text-[11px] text-muted-foreground">{{ t('author.detail.edit.lifeDateHint') }}</p>

    <div class="grid gap-2 md:grid-cols-2">
      <div class="text-xs text-muted-foreground">
        <label :for="`${id}-genres`">{{ t('author.detail.edit.genres') }}</label>
        <ChipInput v-model="genres" :input-id="`${id}-genres`" class="mt-1" />
      </div>
      <div class="text-xs text-muted-foreground">
        <label :for="`${id}-influences`">{{ t('author.detail.edit.influences') }}</label>
        <ChipInput v-model="influences" :input-id="`${id}-influences`" class="mt-1" />
      </div>
    </div>
  </div>
</template>
