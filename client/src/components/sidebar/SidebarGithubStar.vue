<script setup lang="ts">
import { ref } from 'vue'
import { ExternalLink, Star, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

defineProps<{ isRail: boolean }>()

const { t } = useI18n()
const githubStarPopoverOpen = ref(false)
const GITHUB_REPOSITORY_URL = 'https://github.com/bookorbit/bookorbit'

function handlePopoverOpenChange(open: boolean) {
  githubStarPopoverOpen.value = open
}

function togglePopover() {
  githubStarPopoverOpen.value = !githubStarPopoverOpen.value
}

function closePopover() {
  githubStarPopoverOpen.value = false
}
</script>

<template>
  <Popover :open="githubStarPopoverOpen" @update:open="handlePopoverOpenChange">
    <PopoverAnchor as-child>
      <span class="inline-flex justify-self-start group-data-[collapsible=icon]:justify-self-center">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              data-tour="github-star-cta"
              variant="ghost"
              size="icon"
              class="h-7 w-7 rounded-md text-sidebar-foreground hover:bg-(--shell-accent-wash)"
              :aria-label="t('components.appHeader.starOnGithub')"
              @click="togglePopover"
            >
              <Star :size="16" class="fill-current text-star-highlight" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent :side="isRail ? 'right' : 'top'">{{ t('components.appHeader.starOnGithub') }}</TooltipContent>
        </Tooltip>
      </span>
    </PopoverAnchor>
    <PopoverContent :side="isRail ? 'right' : 'top'" align="start" class="relative w-80 p-4">
      <Button
        variant="ghost"
        size="icon"
        class="absolute end-2 top-2 h-6 w-6 text-muted-foreground hover:text-foreground"
        :aria-label="t('common.close')"
        @click="closePopover"
      >
        <X :size="13" />
      </Button>
      <div class="space-y-3 pe-5">
        <p class="text-[14px] font-medium text-foreground">{{ t('components.appHeader.githubStar.title') }}</p>
        <p class="text-[13px] leading-relaxed text-muted-foreground">
          {{ t('components.appHeader.githubStar.body') }}
        </p>
        <Button as-child class="w-full">
          <a :href="GITHUB_REPOSITORY_URL" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center gap-1.5">
            <span>{{ t('components.appHeader.githubStar.cta') }}</span>
            <ExternalLink :size="14" />
          </a>
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
