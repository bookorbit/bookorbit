<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookMergeUserData } from '@bookorbit/types'

const props = defineProps<{ userData: BookMergeUserData }>()

const { t } = useI18n()

const ownLines = computed(() =>
  props.userData.own
    .filter((entry) => entry.rows > 0)
    .map((entry) => ({ category: entry.category, text: t(`book.merge.readingData.own.${entry.category}`, { count: entry.rows }) })),
)

/** Present only for user managers; everyone else gets the line without numbers (D22). */
const otherLines = computed(() =>
  (props.userData.others ?? [])
    .filter((entry) => entry.users > 0)
    .map((entry) => ({ category: entry.category, text: t(`book.merge.readingData.others.${entry.category}`, { count: entry.users }) })),
)

const showGenericOthers = computed(() => props.userData.others === null && props.userData.otherReadersAffected)
const showNoOthers = computed(() => props.userData.others !== null && otherLines.value.length === 0)
</script>

<template>
  <div class="space-y-3">
    <div>
      <p class="text-xs font-medium text-muted-foreground">{{ t('book.merge.readingData.ownHeading') }}</p>
      <ul v-if="ownLines.length > 0" class="mt-1 list-disc space-y-0.5 ps-5 text-sm text-foreground" data-testid="merge-own-data">
        <li v-for="line in ownLines" :key="line.category">{{ line.text }}</li>
      </ul>
      <p v-else class="mt-1 text-sm text-muted-foreground">{{ t('book.merge.readingData.ownNone') }}</p>
    </div>

    <div v-if="otherLines.length > 0 || showGenericOthers || showNoOthers">
      <p class="text-xs font-medium text-muted-foreground">{{ t('book.merge.readingData.othersHeading') }}</p>
      <ul v-if="otherLines.length > 0" class="mt-1 list-disc space-y-0.5 ps-5 text-sm text-foreground" data-testid="merge-others-data">
        <li v-for="line in otherLines" :key="line.category">{{ line.text }}</li>
      </ul>
      <p v-else-if="showGenericOthers" class="mt-1 text-sm text-foreground" data-testid="merge-others-generic">
        {{ t('book.merge.readingData.othersGeneric') }}
      </p>
      <p v-else class="mt-1 text-sm text-muted-foreground">{{ t('book.merge.readingData.othersNone') }}</p>
    </div>
  </div>
</template>
