<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleArrowUp, Heart } from '@lucide/vue'
import { SidebarFooter } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import SidebarGithubStar from '@/components/sidebar/SidebarGithubStar.vue'
import SidebarAppLinks from '@/components/sidebar/SidebarAppLinks.vue'
import { buildSidebarVersionUi } from '@/components/sidebar/versionUi'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import { useWhatsNew } from '@/features/whats-new/composables/useWhatsNew'

defineProps<{ isRail: boolean }>()

const emit = defineEmits<{ navigate: [] }>()

const { t } = useI18n()
const { version, updateAvailable, latestVersion } = useAppInfo()
const { hasUnseen: hasUnseenWhatsNew } = useWhatsNew()

const SUPPORT_URL = 'https://ko-fi.com/neonbookorbit'

const versionUi = computed(() => buildSidebarVersionUi(version.value, updateAvailable.value, latestVersion.value))

function handleNavigate() {
  emit('navigate')
}
</script>

<template>
  <SidebarFooter class="border-t border-sidebar-border px-4 py-1 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-2">
    <div
      class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 group-data-[collapsible=icon]:grid-cols-1 group-data-[collapsible=icon]:justify-items-center group-data-[collapsible=icon]:gap-1"
    >
      <div
        class="flex items-center justify-self-start group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:justify-self-center"
      >
        <SidebarGithubStar :is-rail="isRail" />

        <Tooltip>
          <TooltipTrigger as-child>
            <a
              :href="SUPPORT_URL"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="t('components.sidebar.supportAria')"
              class="inline-flex size-[26px] shrink-0 items-center justify-center rounded-md text-destructive outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <Heart :size="15" class="fill-current" aria-hidden="true" />
            </a>
          </TooltipTrigger>
          <TooltipContent :side="isRail ? 'right' : 'top'">{{ t('components.sidebar.support') }}</TooltipContent>
        </Tooltip>
      </div>

      <div class="flex min-w-0 items-center justify-center gap-1 group-data-[collapsible=icon]:hidden">
        <RouterLink
          v-if="versionUi.currentLabel"
          to="/whats-new"
          class="inline-flex min-w-0 items-center gap-1.5 rounded-md text-[12.5px] font-medium text-muted-foreground outline-hidden transition-colors duration-150 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          @click="handleNavigate"
        >
          <span class="truncate">{{ versionUi.currentLabel }}</span>
          <span
            v-if="hasUnseenWhatsNew"
            class="h-1.5 w-1.5 flex-none rounded-full bg-primary"
            :aria-label="t('components.sidebar.newReleaseNotes')"
          />
        </RouterLink>

        <Tooltip v-if="versionUi.showUpdate">
          <TooltipTrigger as-child>
            <a
              :href="versionUi.updateHref"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="t('components.sidebar.openUpdateRelease', { version: versionUi.updateVersionLabel })"
              class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-success outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <CircleArrowUp :size="18" aria-hidden="true" />
            </a>
          </TooltipTrigger>
          <TooltipContent side="top">{{ t('components.sidebar.updateTooltip', { version: versionUi.updateVersionLabel }) }}</TooltipContent>
        </Tooltip>
      </div>

      <div class="justify-self-end group-data-[collapsible=icon]:justify-self-center">
        <SidebarAppLinks :is-rail="isRail" />
      </div>
    </div>
  </SidebarFooter>
</template>
