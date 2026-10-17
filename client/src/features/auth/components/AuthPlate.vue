<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PublicLegalNotices from '@/components/legal/PublicLegalNotices.vue'
import { useEndpaper } from '../composables/useEndpaper'
import AuthAppearanceToolbar from './AuthAppearanceToolbar.vue'
import AuthEndpaper from './AuthEndpaper.vue'

withDefaults(defineProps<{ heading: string; description?: string; wide?: boolean }>(), { description: undefined, wide: false })

const { t } = useI18n()
const { endpaper } = useEndpaper()
</script>

<template>
  <AuthEndpaper :pattern="endpaper" class="flex min-h-svh flex-col items-center px-3 pt-[4.25rem] pb-6 sm:justify-center sm:px-4 sm:pt-20">
    <AuthAppearanceToolbar />

    <section
      class="auth-plate relative w-full rounded-[3px] bg-(--plate) p-2 sm:p-3"
      :class="wide ? 'max-w-[32.5rem]' : 'max-w-[28rem]'"
      aria-labelledby="auth-plate-heading"
    >
      <div class="auth-frame relative px-5 pt-6 pb-5 sm:px-10 sm:pt-[2.125rem] sm:pb-[1.875rem]">
        <header class="mb-[1.625rem] text-center">
          <p class="auth-ex flex items-center justify-center gap-3.5 font-serif text-xs font-semibold uppercase text-primary">
            <span>{{ t('auth.plate.exLibris') }}</span>
          </p>
          <p
            class="mt-3.5 font-serif text-[2.125rem] leading-10 font-medium italic tracking-[-0.01em] text-foreground sm:text-[2.5rem] sm:leading-[2.875rem]"
          >
            Book<span class="text-primary"> Orbit</span>
          </p>
          <p class="mt-3.5 mb-3 flex items-center justify-center gap-2" aria-hidden="true">
            <span class="h-px w-[3.375rem] bg-(--plate-rule)" />
            <span class="size-1.5 rotate-45 bg-primary" />
            <span class="h-px w-[3.375rem] bg-(--plate-rule)" />
          </p>
          <h1 id="auth-plate-heading" class="font-serif text-base leading-[1.375rem] font-normal italic text-muted-foreground">{{ heading }}</h1>
          <p v-if="description" class="mt-1 text-[0.8125rem] leading-[1.125rem] text-muted-foreground">{{ description }}</p>
        </header>

        <slot />
      </div>
    </section>

    <PublicLegalNotices class="mt-5 rounded-full bg-background/85 px-3 py-1" />
  </AuthEndpaper>
</template>

<style scoped>
.auth-plate {
  box-shadow:
    0 0 0 1px color-mix(in oklch, var(--foreground) 8%, transparent),
    0 1px 1px color-mix(in oklch, black 14%, transparent),
    0 26px 50px -24px color-mix(in oklch, black 45%, transparent);
}

/* A thick-and-thin rule with a square at each inner corner, as on a printed bookplate. */
.auth-frame {
  --sq: linear-gradient(var(--plate-rule), var(--plate-rule));
  border: 2.5px solid var(--plate-rule);
  outline: 1px solid var(--plate-rule);
  outline-offset: -7px;
  background:
    var(--sq) 3px 3px / 6px 6px no-repeat,
    var(--sq) calc(100% - 3px) 3px / 6px 6px no-repeat,
    var(--sq) 3px calc(100% - 3px) / 6px 6px no-repeat,
    var(--sq) calc(100% - 3px) calc(100% - 3px) / 6px 6px no-repeat;
}

.auth-ex {
  letter-spacing: 0.34em;
}

.auth-ex span {
  margin-inline-end: -0.34em;
}

.auth-ex::before,
.auth-ex::after {
  content: '';
  width: 2.25rem;
  height: 1px;
  background: currentColor;
}

@media (min-width: 40rem) {
  .auth-frame {
    outline-offset: -8px;
  }
}
</style>
