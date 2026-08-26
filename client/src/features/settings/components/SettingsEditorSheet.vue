<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { Loader2, MoreHorizontal, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import type { EditorMenuAction } from '../lib/editor-actions'

/**
 * One editor for every list on the Requests page. It exists so the list stops moving: the row
 * being edited stays where it was instead of the form opening a full page below it, and Save stays
 * on screen instead of sitting at the bottom of a form the reader has to scroll to reach.
 *
 * Every control except the close button lives in the footer. Actions spread across a header, a
 * form and a footer left no rule about where to look for one, and put two red buttons that removed
 * different things in two different places.
 */
const props = defineProps<{
  open: boolean
  title: string
  /** Read to assistive technology in place of the visible body, which is a form. */
  description: string
  /** Blocks a close that would throw typed changes away. */
  dirty?: boolean
  busy?: boolean
  /** Hidden while creating, because there is nothing yet to remove. */
  removable?: boolean
  removeLabel?: string
  /** The question the footer asks before removing, and what the removal costs. */
  removeConfirm?: string
  removeConsequence?: string
  /** Anything acting on what the record is built on rather than on the record itself. */
  menuActions?: EditorMenuAction[]
}>()

const emit = defineEmits<{ save: []; cancel: []; remove: []; action: [id: string] }>()

const { t } = useI18n()

/** Tailwind's `sm`. Below it a side sheet is a slot, so it takes the height of the screen instead. */
const isNarrowViewport = useMediaQuery('(max-width: 639px)')
const side = computed(() => (isNarrowViewport.value ? ('bottom' as const) : ('right' as const)))
const sizeClass = computed(() => (isNarrowViewport.value ? 'h-[92svh] rounded-t-xl' : 'w-full sm:max-w-[40rem]'))

const confirmingDiscard = ref(false)

const REMOVE_ACTION = 'remove'

const menu = computed<EditorMenuAction[]>(() => {
  const entries: EditorMenuAction[] = []
  if (props.removable) {
    entries.push({
      id: REMOVE_ACTION,
      label: props.removeLabel ?? t('common.delete'),
      danger: true,
      confirm: props.removeConfirm ?? t('settings.editor.removeQuestion'),
      consequence: props.removeConsequence,
    })
  }
  return [...entries, ...(props.menuActions ?? [])]
})

/**
 * The armed action, confirmed in the footer rather than in a dialog. A dialog over the sheet is a
 * dialog over a dialog: reka hides and slides the sheet away to open it, so the record being
 * removed leaves the screen at the moment the question about it is asked.
 */
const pendingId = ref<string | null>(null)
const pending = computed(() => menu.value.find((entry) => entry.id === pendingId.value) ?? null)

const confirmBar = ref<HTMLElement | null>(null)

watch(
  () => props.open,
  () => {
    pendingId.value = null
  },
)

/** The menu closes as it arms, so the answer to its question has to take the focus it left behind. */
watch(pending, async (entry) => {
  if (entry === null) return
  await nextTick()
  confirmBar.value?.querySelector('button')?.focus()
})

/** Every path out of the sheet lands here, so the guard cannot be walked around by one of them. */
function requestClose() {
  if (props.busy) return
  pendingId.value = null
  if (props.dirty) {
    confirmingDiscard.value = true
    return
  }
  emit('cancel')
}

function handleOpenChange(open: boolean) {
  if (!open) requestClose()
}

function handleDiscard() {
  confirmingDiscard.value = false
  emit('cancel')
}

function cancelDiscard() {
  confirmingDiscard.value = false
}

function handleSave() {
  emit('save')
}

function handleMenuSelect(entry: EditorMenuAction) {
  if (entry.confirm) pendingId.value = entry.id
  else runAction(entry.id)
}

function runAction(id: string) {
  if (id === REMOVE_ACTION) emit('remove')
  else emit('action', id)
}

function confirmPending() {
  const entry = pending.value
  if (entry === null) return
  pendingId.value = null
  runAction(entry.id)
}

function cancelPending() {
  pendingId.value = null
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent :side="side" hide-close class="gap-0 p-0" :class="sizeClass">
      <div class="flex min-h-0 flex-1 flex-col">
        <header class="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5 md:px-5">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <SheetTitle class="settings-label truncate">{{ title }}</SheetTitle>
              <slot name="badge" />
            </div>
            <SheetDescription class="sr-only">{{ description }}</SheetDescription>
            <div class="mt-1.5 empty:mt-0"><slot name="status" /></div>
          </div>

          <Button size="sm" variant="outline" class="shrink-0" :disabled="busy" @click="requestClose">
            <X :size="15" aria-hidden="true" />
            <span class="sr-only">{{ t('common.close') }}</span>
          </Button>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4 md:px-5">
          <slot />
        </div>

        <footer class="border-t border-border bg-card px-4 py-3 md:px-5">
          <!-- Overridable, so a step that is a choice rather than a form can name its own action. -->
          <slot name="footer" :request-close="requestClose">
            <!-- The answer keeps to the right whether or not the question fits beside it. -->
            <div v-if="pending" ref="confirmBar" class="flex flex-wrap items-center gap-3">
              <p role="alert" class="min-w-0 flex-1 text-xs">
                <span class="text-foreground">{{ pending.confirm }}</span>
                <span v-if="pending.consequence" class="ms-1 text-muted-foreground">{{ pending.consequence }}</span>
              </p>
              <div class="ml-auto flex shrink-0 items-center gap-2">
                <Button size="sm" variant="destructive" :disabled="busy" @click="confirmPending">
                  <Loader2 v-if="busy" class="animate-spin" aria-hidden="true" />
                  {{ pending.label }}
                </Button>
                <Button size="sm" variant="outline" :disabled="busy" @click="cancelPending">{{ t('common.cancel') }}</Button>
              </div>
            </div>

            <!-- Wraps rather than crushes: a narrow sheet cannot hold four controls on one line. -->
            <div v-else class="flex flex-wrap items-center gap-3">
              <div class="flex items-center gap-2">
                <Button size="sm" :disabled="busy" @click="handleSave">
                  <Loader2 v-if="busy" class="animate-spin" aria-hidden="true" />
                  {{ t('common.save') }}
                </Button>
                <Button size="sm" variant="outline" :disabled="busy" @click="requestClose">{{ t('common.cancel') }}</Button>
              </div>

              <div class="ms-auto flex shrink-0 items-center gap-1.5">
                <slot name="actions" />
                <DropdownMenu v-if="menu.length > 0">
                  <DropdownMenuTrigger as-child>
                    <Button size="icon-sm" variant="outline" :disabled="busy" :aria-label="t('settings.editor.moreActions')">
                      <MoreHorizontal :size="16" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" class="w-56">
                    <template v-for="entry in menu" :key="entry.id">
                      <DropdownMenuSeparator v-if="entry.separated" />
                      <DropdownMenuItem
                        :variant="entry.danger ? 'destructive' : 'default'"
                        :disabled="entry.disabled"
                        @click="handleMenuSelect(entry)"
                      >
                        {{ entry.label }}
                      </DropdownMenuItem>
                    </template>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </slot>
        </footer>
      </div>
    </SheetContent>
  </Sheet>

  <ConfirmDialog
    :open="confirmingDiscard"
    :title="t('settings.editor.discardTitle')"
    :description="t('settings.editor.discardDescription')"
    :confirm-label="t('settings.editor.discardConfirm')"
    @confirm="handleDiscard"
    @cancel="cancelDiscard"
  />
</template>
