import { computed, ref } from 'vue'
import { themes } from '../constants/themes'
import type { ThemeMode } from '../constants/themes'
import type { FoliateRenderer } from './useFoliate'

export interface ReaderState {
  fontSize: number
  lineHeight: number
  fontFamily: string | null
  maxColumnCount: number
  gap: number
  maxInlineSize: number
  maxBlockSize: number
  justify: boolean
  hyphenate: boolean
  isDark: boolean
  themeName: string
  flow: 'paginated' | 'scrolled'
}

const defaults: ReaderState = {
  fontSize: 16,
  lineHeight: 1.5,
  fontFamily: null,
  maxColumnCount: 2,
  gap: 0.05,
  maxInlineSize: 720,
  maxBlockSize: 1440,
  justify: true,
  hyphenate: true,
  isDark: false,
  themeName: 'default',
  flow: 'paginated',
}

export function useReaderState() {
  const fontSize = ref(defaults.fontSize)
  const lineHeight = ref(defaults.lineHeight)
  const fontFamily = ref<string | null>(defaults.fontFamily)
  const maxColumnCount = ref(defaults.maxColumnCount)
  const gap = ref(defaults.gap)
  const maxInlineSize = ref(defaults.maxInlineSize)
  const maxBlockSize = ref(defaults.maxBlockSize)
  const justify = ref(defaults.justify)
  const hyphenate = ref(defaults.hyphenate)
  const isDark = ref(defaults.isDark)
  const themeName = ref(defaults.themeName)
  const flow = ref<'paginated' | 'scrolled'>(defaults.flow)

  const state = computed<ReaderState>(() => ({
    fontSize: fontSize.value,
    lineHeight: lineHeight.value,
    fontFamily: fontFamily.value,
    maxColumnCount: maxColumnCount.value,
    gap: gap.value,
    maxInlineSize: maxInlineSize.value,
    maxBlockSize: maxBlockSize.value,
    justify: justify.value,
    hyphenate: hyphenate.value,
    isDark: isDark.value,
    themeName: themeName.value,
    flow: flow.value,
  }))

  const currentTheme = computed(() => themes.find((t) => t.name === themeName.value) ?? themes[0])

  const activeMode = computed<ThemeMode>(() => {
    const theme = currentTheme.value
    return isDark.value ? theme.dark : theme.light
  })

  function generateCSS(): string {
    const { lineHeight: lh, justify: j, hyphenate: h, fontSize: fs, fontFamily: ff } = state.value
    const mode = activeMode.value
    const theme = currentTheme.value
    const lightMode = theme.light
    const darkMode = theme.dark
    const mediaActiveClass = 'media-active'

    const fontFamilyRule = ff
      ? `
        body {
            font-family: ${ff} !important;
        }
        body * {
            font-family: inherit !important;
        }`
      : ''

    return `
      @namespace epub "http://www.idpf.org/2007/ops";
      @media print {
          html {
              column-width: auto !important;
              height: auto !important;
              width: auto !important;
          }
      }
      @media screen {
          html {
              color-scheme: light dark;
              color: ${mode.fg};
              font-size: ${fs}px;
          }${fontFamilyRule}
          a:any-link {
              color: ${mode.link};
              text-decoration-color: light-dark(
                  color-mix(in srgb, currentColor 20%, transparent),
                  color-mix(in srgb, currentColor 40%, transparent));
              text-underline-offset: .1em;
          }
          a:any-link:hover {
              text-decoration-color: unset;
          }
          @media (prefers-color-scheme: dark) {
              html {
                  color: ${darkMode.fg};
              }
              a:any-link {
                  color: ${darkMode.link};
              }
          }
          aside[epub|type~="footnote"] {
              display: none;
          }
      }
      html {
          line-height: ${lh};
          hanging-punctuation: allow-end last;
          orphans: 2;
          widows: 2;
      }
      [align="left"] { text-align: left; }
      [align="right"] { text-align: right; }
      [align="center"] { text-align: center; }
      [align="justify"] { text-align: justify; }
      :is(hgroup, header) p {
          text-align: unset;
          hyphens: unset;
      }
      h1, h2, h3, h4, h5, h6, hgroup, th {
          text-wrap: balance;
      }
      pre {
          white-space: pre-wrap !important;
          tab-size: 2;
      }
      @media screen and (prefers-color-scheme: light) {
          ${
            lightMode.bg !== '#ffffff'
              ? `
          html, body {
              color: ${lightMode.fg} !important;
              background: none !important;
          }
          body * {
              color: inherit !important;
              border-color: currentColor !important;
              background-color: ${lightMode.bg} !important;
          }
          a:any-link {
              color: ${lightMode.link} !important;
          }
          svg, img {
              background-color: transparent !important;
              mix-blend-mode: multiply;
          }
          .${mediaActiveClass}, .${mediaActiveClass} * {
              color: ${lightMode.fg} !important;
              background: color-mix(in hsl, ${lightMode.fg}, #fff 50%) !important;
              background: color-mix(in hsl, ${lightMode.fg}, ${lightMode.bg} 85%) !important;
          }`
              : ''
          }
      }
      @media screen and (prefers-color-scheme: dark) {
          html, body {
              color: ${darkMode.fg} !important;
              background: none !important;
          }
          body * {
              color: inherit !important;
              border-color: currentColor !important;
              background-color: ${darkMode.bg} !important;
          }
          a:any-link {
              color: ${darkMode.link} !important;
          }
          .${mediaActiveClass}, .${mediaActiveClass} * {
              color: ${darkMode.fg} !important;
              background: color-mix(in hsl, ${darkMode.fg}, #000 50%) !important;
              background: color-mix(in hsl, ${darkMode.fg}, ${darkMode.bg} 75%) !important;
          }
      }
      p, li, blockquote, dd {
          line-height: ${lh};
          text-align: ${j ? 'justify' : 'start'} !important;
          hyphens: ${h ? 'auto' : 'none'};
      }
      ::selection {
          background-color: rgba(128, 128, 128, 0.3);
      }
      ::-moz-selection {
          background-color: rgba(128, 128, 128, 0.3);
      }
    `
  }

  function applyToRenderer(renderer: FoliateRenderer): void {
    if (!renderer) return
    const s = state.value
    renderer.setAttribute('max-column-count', s.maxColumnCount)
    renderer.setAttribute('gap', `${s.gap * 100}%`)
    renderer.setAttribute('max-inline-size', `${s.maxInlineSize}px`)
    renderer.setAttribute('max-block-size', `${s.maxBlockSize}px`)
    if (s.flow === 'paginated') {
      renderer.setAttribute('margin', '40px')
    } else {
      renderer.removeAttribute('margin')
    }
    renderer.setAttribute('flow', s.flow)
    if (typeof renderer.setStyles === 'function') {
      renderer.setStyles(generateCSS())
    }
  }

  function setFontSize(v: number) {
    fontSize.value = Math.max(10, Math.min(32, v))
  }
  function setLineHeight(v: number) {
    lineHeight.value = Math.max(0.8, Math.min(3, Math.round(v * 10) / 10))
  }
  function setFontFamily(v: string | null) {
    fontFamily.value = v
  }
  function setMaxColumnCount(v: number) {
    maxColumnCount.value = Math.max(1, Math.min(10, v))
  }
  function setGap(v: number) {
    gap.value = Math.max(0, Math.min(0.5, v))
  }
  function setMaxInlineSize(v: number) {
    maxInlineSize.value = Math.max(400, Math.min(1600, v))
  }
  function setMaxBlockSize(v: number) {
    maxBlockSize.value = Math.max(600, Math.min(2400, v))
  }
  function setJustify(v: boolean) {
    justify.value = v
  }
  function setHyphenate(v: boolean) {
    hyphenate.value = v
  }
  function setIsDark(v: boolean) {
    isDark.value = v
  }
  function setThemeName(v: string) {
    themeName.value = v
  }
  function setFlow(v: 'paginated' | 'scrolled') {
    flow.value = v
  }

  return {
    state,
    fontSize,
    lineHeight,
    fontFamily,
    maxColumnCount,
    gap,
    maxInlineSize,
    maxBlockSize,
    justify,
    hyphenate,
    isDark,
    themeName,
    flow,
    currentTheme,
    activeMode,
    themes,
    generateCSS,
    applyToRenderer,
    setFontSize,
    setLineHeight,
    setFontFamily,
    setMaxColumnCount,
    setGap,
    setMaxInlineSize,
    setMaxBlockSize,
    setJustify,
    setHyphenate,
    setIsDark,
    setThemeName,
    setFlow,
  }
}
