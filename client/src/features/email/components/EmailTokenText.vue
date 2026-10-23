<script setup lang="ts">
import { computed } from 'vue'

/** Template text with each {{variable}} drawn as a token, so a subject reads as what it will become. */
const props = defineProps<{ text: string }>()

const parts = computed(() => props.text.split(/(\{\{\w+\}\})/g).filter(Boolean))
</script>

<template>
  <span class="font-mono"
    ><template v-for="(part, index) in parts" :key="index"
      ><span v-if="/^\{\{\w+\}\}$/.test(part)" class="rounded-[4px] bg-primary/12 px-[3px] text-[0.96em] text-primary">{{ part }}</span
      ><template v-else>{{ part }}</template></template
    ></span
  >
</template>
