<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Plus } from '@lucide/vue'
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
import { MODIFIER_DESCRIPTION_KEYS, MODIFIER_NAMES, TOKEN_DESCRIPTION_KEYS, TOKEN_NAMES } from '../lib/pattern-tokens'
import type { NamingTarget } from '../lib/naming-rules'

const props = defineProps<{
  target: NamingTarget
  /** Values for the preview book, so each token is recognised by what it produces. */
  sampleValues: Record<string, string>
}>()

const emit = defineEmits<{ insert: [text: string, caretOffset?: number] }>()

const { t } = useI18n()

const tokens = computed(() =>
  TOKEN_NAMES.map((token) => ({ text: `{${token}}`, description: t(TOKEN_DESCRIPTION_KEYS[token]), sample: props.sampleValues[token] ?? '' })),
)
const modifiers = computed(() => MODIFIER_NAMES.map((modifier) => ({ text: `:${modifier}`, description: t(MODIFIER_DESCRIPTION_KEYS[modifier]) })))
const canAddFolder = computed(() => props.target === 'upload')

function insertText(text: string) {
  emit('insert', text)
}

function insertOptional() {
  // Caret lands inside the brackets, which is where the next keystroke belongs.
  emit('insert', '<>', 1)
}

function insertFallback() {
  emit('insert', '|')
}

function insertFolder() {
  emit('insert', '/')
}

/** Focus stays in the pattern field the insert just went into, rather than returning to the trigger. */
function keepFieldFocus(event: Event) {
  event.preventDefault()
}
</script>

<template>
  <div class="flex items-center" role="toolbar" :aria-label="t('settings.reader.fileNaming.insertToolbar')">
    <!-- Wide editors get one control per kind of thing to insert. -->
    <div class="hidden flex-wrap items-center gap-0.5 @xl:flex">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" type="button" class="h-7 gap-1.5 px-2 text-xs">
            <span class="font-mono font-bold text-pattern-token" aria-hidden="true">{ }</span>
            {{ t('settings.reader.fileNaming.tokens') }}
            <ChevronDown :size="12" class="text-muted-foreground" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-[28rem] max-w-[calc(100vw-2rem)]" @close-auto-focus="keepFieldFocus">
          <DropdownMenuItem
            v-for="token in tokens"
            :key="token.text"
            class="grid grid-cols-[8.5rem_minmax(0,1fr)_auto] gap-3 text-xs"
            @select="insertText(token.text)"
          >
            <span class="font-mono font-semibold text-pattern-token">{{ token.text }}</span>
            <span class="truncate">{{ token.description }}</span>
            <span class="max-w-36 truncate text-muted-foreground">{{ token.sample }}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" type="button" class="h-7 gap-1.5 px-2 text-xs">
            <span class="font-mono font-bold text-pattern-modifier" aria-hidden="true">:</span>
            {{ t('settings.reader.fileNaming.modifiers') }}
            <ChevronDown :size="12" class="text-muted-foreground" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-80 max-w-[calc(100vw-2rem)]" @close-auto-focus="keepFieldFocus">
          <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">{{
            t('settings.reader.fileNaming.modifiersExplain')
          }}</DropdownMenuLabel>
          <DropdownMenuItem
            v-for="modifier in modifiers"
            :key="modifier.text"
            class="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 text-xs"
            @select="insertText(modifier.text)"
          >
            <span class="font-mono font-semibold text-pattern-modifier">{{ modifier.text }}</span>
            <span class="truncate">{{ modifier.description }}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" type="button" class="h-7 gap-1.5 px-2 text-xs" @click="insertOptional">
            <span class="font-mono font-bold text-pattern-optional" aria-hidden="true">&lt; &gt;</span>
            {{ t('settings.reader.fileNaming.insertOptional') }}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ t('settings.reader.fileNaming.paletteOptionalHint') }}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" type="button" class="h-7 gap-1.5 px-2 text-xs" @click="insertFallback">
            <span class="font-mono font-bold text-pattern-fallback" aria-hidden="true">|</span>
            {{ t('settings.reader.fileNaming.insertFallback') }}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ t('settings.reader.fileNaming.paletteFallbackHint') }}</TooltipContent>
      </Tooltip>

      <Tooltip v-if="canAddFolder">
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" type="button" class="h-7 gap-1.5 px-2 text-xs" @click="insertFolder">
            <span class="font-mono font-bold text-muted-foreground" aria-hidden="true">/</span>
            {{ t('settings.reader.fileNaming.insertFolder') }}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ t('settings.reader.fileNaming.paletteSeparatorHint') }}</TooltipContent>
      </Tooltip>
    </div>

    <!-- Narrow editors fold the same choices into one menu. -->
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="outline" size="sm" type="button" class="h-7 gap-1 px-2 text-xs @xl:hidden">
          <Plus :size="13" aria-hidden="true" />
          {{ t('settings.reader.fileNaming.insert') }}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-[min(22rem,calc(100vw-2rem))]" @close-auto-focus="keepFieldFocus">
        <DropdownMenuLabel class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{{
          t('settings.reader.fileNaming.structure')
        }}</DropdownMenuLabel>
        <DropdownMenuItem class="gap-3 text-xs" @select="insertOptional">
          <span class="w-8 font-mono font-bold text-pattern-optional">&lt; &gt;</span>{{ t('settings.reader.fileNaming.insertOptional') }}
        </DropdownMenuItem>
        <DropdownMenuItem class="gap-3 text-xs" @select="insertFallback">
          <span class="w-8 font-mono font-bold text-pattern-fallback">|</span>{{ t('settings.reader.fileNaming.insertFallback') }}
        </DropdownMenuItem>
        <DropdownMenuItem v-if="canAddFolder" class="gap-3 text-xs" @select="insertFolder">
          <span class="w-8 font-mono font-bold text-muted-foreground">/</span>{{ t('settings.reader.fileNaming.insertFolder') }}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{{
          t('settings.reader.fileNaming.tokens')
        }}</DropdownMenuLabel>
        <DropdownMenuItem
          v-for="token in tokens"
          :key="token.text"
          class="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 text-xs"
          @select="insertText(token.text)"
        >
          <span class="font-mono font-semibold text-pattern-token">{{ token.text }}</span>
          <span class="truncate">{{ token.description }}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{{
          t('settings.reader.fileNaming.modifiers')
        }}</DropdownMenuLabel>
        <DropdownMenuItem
          v-for="modifier in modifiers"
          :key="modifier.text"
          class="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 text-xs"
          @select="insertText(modifier.text)"
        >
          <span class="font-mono font-semibold text-pattern-modifier">{{ modifier.text }}</span>
          <span class="truncate">{{ modifier.description }}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
