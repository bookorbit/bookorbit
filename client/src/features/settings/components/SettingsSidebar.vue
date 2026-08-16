<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ArrowLeft } from '@lucide/vue'
import SidebarSectionPopover from '@/components/sidebar/SidebarSectionPopover.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { visibleSettingsNav, type SettingsNavItem } from '../lib/settings-nav'
import SettingsNav from './SettingsNav.vue'

withDefaults(defineProps<{ isRail?: boolean }>(), { isRail: false })

const { t } = useI18n()
const route = useRoute()
const { isSuperuser, userPermissions, isDemoRestrictedAccount } = usePermissions()

const groups = computed(() =>
  visibleSettingsNav({
    isSuperuser: isSuperuser.value,
    permissions: userPermissions.value,
    isDemoRestricted: isDemoRestrictedAccount.value,
  }),
)

/** The rail is too narrow for the full tree, so each group opens as a popover instead. */
function leafItems(items: readonly SettingsNavItem[]): SettingsNavItem[] {
  return items.flatMap((item) => (item.children?.length ? item.children : [item]))
}

function isActive(item: SettingsNavItem): boolean {
  return item.routeName === route.name
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <RouterLink
      v-if="isRail"
      to="/"
      class="mx-2 mb-1 flex h-8 items-center justify-center rounded-md text-muted-foreground outline-hidden transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      :title="t('settings.nav.backToApp')"
      :aria-label="t('settings.nav.backToApp')"
      data-testid="settings-sidebar-back"
    >
      <ArrowLeft :size="16" aria-hidden="true" />
    </RouterLink>

    <div v-if="isRail" class="flex flex-col items-center gap-1 px-2">
      <SidebarSectionPopover v-for="group in groups" :key="group.id" :label="t(group.labelKey)" :icon="group.icon" :count="0">
        <div class="px-1.5 py-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{{ t(group.labelKey) }}</div>
        <RouterLink
          v-for="item in leafItems(group.items)"
          :key="item.id"
          :to="{ name: item.routeName }"
          class="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden transition-colors duration-150 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          :class="isActive(item) ? 'bg-sidebar-accent font-medium' : 'font-normal'"
          :aria-current="isActive(item) ? 'page' : undefined"
          data-testid="settings-sidebar-rail-item"
        >
          <component
            :is="item.icon"
            :size="15"
            class="shrink-0 transition-colors"
            :class="isActive(item) ? 'text-sidebar-accent-foreground' : 'text-muted-foreground group-hover:text-sidebar-accent-foreground'"
            aria-hidden="true"
          />
          <span
            class="truncate transition-colors group-hover:text-sidebar-accent-foreground"
            :class="isActive(item) ? 'text-sidebar-accent-foreground' : 'text-sidebar-foreground'"
          >
            {{ t(item.labelKey) }}
          </span>
        </RouterLink>
      </SidebarSectionPopover>
    </div>

    <SettingsNav v-else class="min-h-0 flex-1" />
  </div>
</template>
