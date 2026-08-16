<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'
import { Sheet, SheetContent } from '@/components/ui/sheet'

const { t } = useI18n()

defineProps<{ open: boolean }>()

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

function onOpenChange(open: boolean) {
  emit('update:open', open)
}

function closeSheet() {
  emit('update:open', false)
}
</script>

<template>
  <Sheet :open="open" @update:open="onOpenChange">
    <!--
      dvh, not vh: `vh` resolves against the large viewport (browser UI retracted), so with a
      phone browser's toolbars on screen the sheet grew to cover the whole visible area and left
      no overlay to tap. The close button below is the affordance that must not depend on that
      gap existing at all.
    -->
    <SheetContent
      side="bottom"
      hide-close
      class="max-h-[85dvh] gap-0 rounded-t-2xl border-border bg-card p-0"
      :aria-label="t('reader.settings.ariaLabel')"
    >
      <div class="relative flex h-11 shrink-0 items-center justify-center">
        <div aria-hidden="true" class="h-1 w-9 rounded-full bg-border" />
        <button
          type="button"
          class="absolute end-0.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
          :aria-label="t('reader.settings.close')"
          @click="closeSheet"
        >
          <X :size="18" />
        </button>
      </div>
      <slot />
    </SheetContent>
  </Sheet>
</template>
