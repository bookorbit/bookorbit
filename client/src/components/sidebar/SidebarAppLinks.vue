<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

defineProps<{ isRail: boolean }>()

const { t } = useI18n()

const IOS_APP_STORE_URL = 'https://apps.apple.com/app/id6811807346'

const APPLE_LOGO_PATH =
  'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701'

const ANDROID_LOGO_PATH =
  'M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993.0001.5511-.4482.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4483.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.2439 13.8533 7.8508 12 7.8508s-3.5902.3931-5.1367 1.1069L4.841 5.4548a.4157.4157 0 00-.5677-.1521.4157.4157 0 00-.1521.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3435-4.1021-2.6892-7.5743-6.1185-9.4396'
</script>

<template>
  <div class="flex items-center group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button as-child variant="ghost" size="icon" class="h-7 w-7 rounded-md text-sidebar-foreground hover:bg-(--shell-accent-wash)">
          <a :href="IOS_APP_STORE_URL" target="_blank" rel="noopener noreferrer" :aria-label="t('components.sidebar.appLinks.ios')">
            <svg viewBox="0 0 24 24" class="size-[15.5px] fill-current" aria-hidden="true">
              <path :d="APPLE_LOGO_PATH" />
            </svg>
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent :side="isRail ? 'right' : 'top'">{{ t('components.sidebar.appLinks.ios') }}</TooltipContent>
    </Tooltip>

    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          variant="ghost"
          size="icon"
          aria-disabled="true"
          class="h-7 w-7 rounded-md text-android-highlight hover:bg-transparent aria-disabled:pointer-events-auto aria-disabled:cursor-default"
          :aria-label="t('components.sidebar.appLinks.android')"
        >
          <svg viewBox="0 0 24 24" class="size-[18px] fill-current" aria-hidden="true">
            <path :d="ANDROID_LOGO_PATH" />
          </svg>
        </Button>
      </TooltipTrigger>
      <TooltipContent :side="isRail ? 'right' : 'top'">{{ t('components.sidebar.appLinks.android') }}</TooltipContent>
    </Tooltip>
  </div>
</template>
