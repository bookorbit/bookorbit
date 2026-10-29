<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { BadgeQuestionMark, ExternalLink, Info, KeyRound, LogOut, Settings, Sparkles, User } from '@lucide/vue'
import { Permission } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import UserAvatar from '@/components/UserAvatar.vue'
import SidebarAppearanceMenu from '@/components/sidebar/SidebarAppearanceMenu.vue'
import SidebarLanguageMenu from '@/components/sidebar/SidebarLanguageMenu.vue'
import { useLegalNotices } from '@/components/legal/useLegalNotices'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { useAuth } from '@/features/auth/composables/useAuth'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import NotificationSheet from '@/features/notifications/components/NotificationSheet.vue'
import { useWhatsNew } from '@/features/whats-new/composables/useWhatsNew'
import { useThemeStore } from '@/stores/theme'

const props = defineProps<{ isRail: boolean; isMobile: boolean }>()

const emit = defineEmits<{ navigate: [] }>()

const DOCUMENTATION_URL = 'https://bookorbit.app/what-is-bookorbit'

const { t } = useI18n()
const router = useRouter()
const { user, logout } = useAuth()
const { hasPermission, isDemoRestrictedAccount } = usePermissions()
const { open: openChangePassword } = useChangePasswordDialog()
const { openLegalNotices } = useLegalNotices()
const { hasUnseen: hasUnseenWhatsNew } = useWhatsNew()
const themeStore = useThemeStore()

const iconRadiusClass = computed(() => (themeStore.radius === 'sharp' ? 'rounded-none' : 'rounded-full'))
const controlClass = computed(() => [
  'size-(--dock-control) border border-(--shell-accent-line) text-foreground transition-colors duration-150 hover:bg-(--shell-accent-wash)',
  iconRadiusClass.value,
])
/** The full set of controls needs 13.25rem, and the sidebar can be dragged narrower than that, so the dock tightens its buttons instead of spilling out. */
const rowClass = computed(() => [
  'flex items-center gap-(--dock-gap) [--dock-control:2rem] [--dock-gap:0.25rem] group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5',
  !props.isRail && '@max-[13.25rem]:[--dock-control:1.75rem] @max-[13.25rem]:[--dock-gap:0.125rem]',
])
const avatarClass = computed(() => [
  'flex size-(--dock-control) shrink-0 items-center justify-center overflow-hidden border border-(--shell-accent-line) bg-(--shell-accent-tint) transition-colors duration-150 hover:bg-(--shell-accent-wash) focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  iconRadiusClass.value,
])

/** Menus open beside the sidebar on desktop; inside the phone sheet there is only room above. */
const menuSide = computed(() => (props.isMobile ? 'top' : 'right'))
/** Menus measure from the whole dock row, so on desktop they open past the sidebar's edge rather than over it. */
const dockRef = ref<HTMLElement | null>(null)
const menuReference = computed(() => dockRef.value ?? undefined)
const tooltipSide = computed(() => (props.isRail ? 'right' : 'top'))

const canChangePassword = computed(
  () => !isDemoRestrictedAccount.value && user.value?.provisioningMethod !== 'oidc' && user.value?.provisioningMethod !== 'shared',
)
const canAccessNotifications = computed(() => hasPermission(Permission.NotificationAccess) && !isDemoRestrictedAccount.value)

function goTo(name: string) {
  emit('navigate')
  void router.push({ name })
}

function navigateToAccount() {
  goTo('settings-account')
}

function navigateToSettings() {
  goTo('settings-libraries')
}

function navigateToWhatsNew() {
  goTo('whats-new')
}

function handleChangePassword() {
  openChangePassword()
}

function handleAbout() {
  openLegalNotices()
}

function handleLogout() {
  void logout()
}
</script>

<template>
  <div
    class="@container shrink-0 border-t border-sidebar-border px-2 py-[7px] group-data-[collapsible=icon]:py-2"
    ref="dockRef"
    data-testid="sidebar-dock"
  >
    <div :class="rowClass">
      <DropdownMenu v-if="user">
        <DropdownMenuTrigger as-child>
          <button type="button" :class="avatarClass" :aria-label="t('components.appHeader.account')">
            <UserAvatar :name="user.name" :avatar-url="user.avatarUrl ?? null" size-class="h-full w-full" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent :side="menuSide" align="end" :side-offset="12" :reference="menuReference" class="w-52">
          <DropdownMenuLabel class="font-normal">
            <div class="flex flex-col gap-0.5">
              <span class="text-[13px] font-medium text-foreground">{{ user.name }}</span>
              <span class="text-[11px] text-muted-foreground">{{ user.username }}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="navigateToAccount">
            <User :size="13" class="mr-2 text-muted-foreground" />
            {{ t('components.appHeader.account') }}
          </DropdownMenuItem>
          <DropdownMenuItem v-if="canChangePassword" @click="handleChangePassword">
            <KeyRound :size="13" class="mr-2 text-muted-foreground" />
            {{ t('components.appHeader.changePassword') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem class="text-destructive focus:text-destructive" @click="handleLogout">
            <LogOut :size="13" class="mr-2" />
            {{ t('components.appHeader.signOut') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div class="ms-auto flex items-center gap-(--dock-gap) group-data-[collapsible=icon]:contents">
        <NotificationSheet v-if="canAccessNotifications" :icon-radius-class="iconRadiusClass" />

        <Tooltip>
          <DropdownMenu>
            <TooltipTrigger as-child>
              <DropdownMenuTrigger as-child>
                <Button
                  data-tour="documentation-link"
                  variant="ghost"
                  size="icon"
                  :class="['relative', controlClass]"
                  :aria-label="t('components.appHeader.help')"
                >
                  <BadgeQuestionMark :size="15" aria-hidden="true" />
                  <span
                    v-if="hasUnseenWhatsNew"
                    class="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-sidebar"
                    :aria-label="t('components.appHeader.newReleaseNotes')"
                  />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <DropdownMenuContent :side="menuSide" align="end" :side-offset="12" :reference="menuReference" class="w-48">
              <DropdownMenuItem as-child>
                <a :href="DOCUMENTATION_URL" target="_blank" rel="noopener noreferrer">
                  <BadgeQuestionMark :size="14" class="mr-2 text-muted-foreground" />
                  {{ t('components.appHeader.documentation') }}
                  <ExternalLink :size="12" class="ml-auto text-muted-foreground" />
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem @click="navigateToWhatsNew">
                <Sparkles :size="14" class="mr-2 text-muted-foreground" />
                {{ t('components.appHeader.whatsNew') }}
                <span v-if="hasUnseenWhatsNew" class="ml-auto h-1.5 w-1.5 rounded-full bg-primary" :aria-label="t('components.appHeader.new')" />
              </DropdownMenuItem>
              <DropdownMenuItem @click="handleAbout">
                <Info :size="14" class="mr-2 text-muted-foreground" />
                {{ t('components.legalNotices.about') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <TooltipContent :side="tooltipSide">{{ t('components.appHeader.help') }}</TooltipContent>
        </Tooltip>

        <SidebarAppearanceMenu :control-class="controlClass" :is-mobile="isMobile" :is-rail="isRail" :anchor="dockRef" />
        <SidebarLanguageMenu :control-class="controlClass" :is-mobile="isMobile" :is-rail="isRail" :anchor="dockRef" />

        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" :class="controlClass" :aria-label="t('components.appHeader.settings')" @click="navigateToSettings">
              <Settings :size="15" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent :side="tooltipSide">{{ t('components.appHeader.settings') }}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  </div>
</template>
