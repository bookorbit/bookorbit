<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { BookOpen, Check, Headphones, Library, Loader2, Users, WandSparkles } from '@lucide/vue'
import { Permission, type BookDetail } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookRequestVisibility } from '../composables/useBookRequestVisibility'
import { useMissingFormatRequest } from '../composables/useMissingFormatRequest'
import { submitFailureText } from '../composables/useRequestSubmission'

/**
 * The format a book does not have yet, offered where the book's formats are listed: an ebook's
 * missing audiobook, or an audiobook's missing ebook. Requesting it here names this book, so when
 * the new format arrives it joins the book rather than becoming a second one beside it.
 */
const props = defineProps<{ book: BookDetail }>()

const { t } = useI18n()
const { hasPermission } = usePermissions()
const { showBookRequests } = useBookRequestVisibility()

const enabled = computed(() => hasPermission(Permission.BookRequestAccess) && showBookRequests.value)
const { missing, state, requestId, ownedBookId, submitting, request } = useMissingFormatRequest(toRef(props, 'book'), enabled)

const visible = computed(() => enabled.value && missing.value !== null)
const icon = computed(() => (missing.value === 'audiobook' ? Headphones : BookOpen))
const groupLabel = computed(() =>
  missing.value === 'audiobook' ? t('bookRequests.missingFormat.labelAudiobook') : t('bookRequests.missingFormat.labelEbook'),
)

const statusText = computed(() => {
  if (state.value === 'owned') return t('bookRequests.missingFormat.ownedElsewhere')
  if (state.value === 'following') return t('bookRequests.missingFormat.requested')
  if (state.value === 'joinable') return t('bookRequests.missingFormat.requestedBySomeone')
  return missing.value === 'audiobook' ? t('bookRequests.missingFormat.noAudiobook') : t('bookRequests.missingFormat.noEbook')
})

/**
 * The card is a narrow rail column, so the button says only the verb and the line beside it names
 * the format. A screen reader hears both together in the accessible name.
 */
const actionLabel = computed(() => (state.value === 'joinable' ? t('bookRequests.search.joinRequest') : t('bookRequests.search.request')))
const actionAriaLabel = computed(() => {
  if (state.value === 'joinable') return t('bookRequests.search.joinRequest')
  return missing.value === 'audiobook' ? t('bookRequests.missingFormat.requestAudiobook') : t('bookRequests.missingFormat.requestEbook')
})

const canAct = computed(() => state.value === 'new' || state.value === 'joinable')

async function handleRequest() {
  const { result, failure } = await request()
  if (!result) {
    toast.error(t('bookRequests.search.submitFailed'), { description: submitFailureText(failure, t) ?? undefined })
    return
  }
  if (result.subscribed) toast.success(t('bookRequests.search.joinedExisting'))
  else
    toast.success(missing.value === 'audiobook' ? t('bookRequests.missingFormat.submittedAudiobook') : t('bookRequests.missingFormat.submittedEbook'))
}
</script>

<template>
  <!--
    A dashed placeholder where the missing format's chip would sit, so the row reads as "this one
    is not here yet" in the same vocabulary as the editions above it.
  -->
  <div v-if="visible" class="mt-2 flex min-h-7 items-center gap-2.5" role="group" :aria-label="groupLabel">
    <span
      class="inline-flex h-5 min-w-9 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground"
      aria-hidden="true"
    >
      <component :is="icon" :size="12" />
    </span>

    <span class="min-w-0 flex-1 text-[11px] text-muted-foreground" role="status">
      <Loader2 v-if="state === 'checking'" :size="11" class="me-1 inline animate-spin align-[-1px]" aria-hidden="true" />
      <span v-else-if="state === 'owned'" class="inline-flex items-center gap-1"><Library :size="11" aria-hidden="true" />{{ statusText }}</span>
      <span v-else-if="state === 'following'" class="inline-flex items-center gap-1"><Check :size="11" aria-hidden="true" />{{ statusText }}</span>
      <span v-else-if="state === 'joinable'" class="inline-flex items-center gap-1"><Users :size="11" aria-hidden="true" />{{ statusText }}</span>
      <template v-else>{{ statusText }}</template>
    </span>

    <RouterLink
      v-if="state === 'owned' && ownedBookId !== null"
      :to="{ name: 'book-detail', params: { bookId: ownedBookId } }"
      class="shrink-0 rounded-xs text-[11px] font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {{ t('bookRequests.missingFormat.open') }}
    </RouterLink>
    <RouterLink
      v-else-if="state === 'following' && requestId !== null"
      :to="{ name: 'book-request-detail', params: { id: requestId }, query: { tab: 'mine' } }"
      class="shrink-0 rounded-xs text-[11px] font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {{ t('bookRequests.missingFormat.viewRequest') }}
    </RouterLink>
    <button
      v-else-if="canAct"
      type="button"
      class="group/request relative isolate inline-flex h-7 shrink-0 items-center gap-1 overflow-hidden rounded-md border border-primary/45 bg-linear-to-br from-primary/12 to-card px-2 text-[11px] font-medium text-foreground shadow-[0_0_12px_color-mix(in_oklch,var(--primary)_22%,transparent)] transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none disabled:shadow-none disabled:opacity-60 after:pointer-events-none after:absolute after:-inset-y-2 after:-start-[70%] after:z-0 after:w-2/5 after:rotate-24 after:bg-linear-to-r after:from-transparent after:via-primary/22 after:to-transparent after:content-[''] motion-safe:enabled:hover:after:animate-[request-shimmer_700ms_ease-out] motion-safe:enabled:focus-visible:after:animate-[request-shimmer_700ms_ease-out] disabled:after:hidden motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11"
      :disabled="submitting"
      :aria-label="actionAriaLabel"
      @click="handleRequest"
    >
      <Loader2 v-if="submitting" :size="13" class="relative z-10 motion-safe:animate-spin" aria-hidden="true" />
      <WandSparkles
        v-else
        :size="13"
        class="relative z-10 text-primary motion-safe:group-hover/request:animate-[request-wand_650ms_ease-in-out] motion-safe:group-focus-visible/request:animate-[request-wand_650ms_ease-in-out]"
        aria-hidden="true"
      />
      <span class="relative z-10">{{ actionLabel }}</span>
    </button>
  </div>
</template>
