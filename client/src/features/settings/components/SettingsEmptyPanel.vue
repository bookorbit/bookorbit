<script setup lang="ts">
import { useId } from 'vue'
import { Info } from '@lucide/vue'

/**
 * A settings group with nothing in it at all, given enough room to say what that costs.
 *
 * A group with no rows has a heading with nothing to head, so this takes the heading's place rather
 * than sitting under it. It leads with the consequence instead of with instructions, because "none
 * yet" never said the part that matters, and the actions it is given belong beside that sentence
 * rather than in the far corner of the page.
 *
 * Deliberately narrow and kept to a single column. A settings panel runs the full width of a very
 * wide display, and a few sentences and a button stretched across all of it read as a page that
 * failed to load rather than as a message.
 *
 * Only for a group that is genuinely empty. One that still has rows says so on a single line.
 */
defineProps<{
  title: string
  body: string
  /** A qualifying fact set apart from the actions, for what the leading sentence would overstate. */
  note?: string
}>()

const headingId = `settings-empty-${useId()}`
</script>

<template>
  <section :aria-labelledby="headingId" class="settings-empty-state max-w-3xl p-5 text-start md:p-6">
    <div class="flex gap-3.5">
      <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
        <slot name="icon" />
      </span>

      <!-- One column for everything the icon does not sit in, so the panel has a single left edge. -->
      <div class="min-w-0 flex-1">
        <h2 :id="headingId" class="font-serif text-base font-semibold tracking-tight text-foreground">{{ title }}</h2>
        <p role="status" class="mt-1 text-sm text-muted-foreground">{{ body }}</p>

        <div v-if="$slots.default" class="mt-4"><slot /></div>

        <div v-if="note" class="mt-4 flex items-start gap-2 border-t border-border pt-3.5">
          <Info :size="13" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p class="settings-hint">{{ note }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
