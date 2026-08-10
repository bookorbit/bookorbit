export interface ThemeMode {
  fg: string
  bg: string
  link: string
}

export interface Theme {
  name: string
  labelKey: string
  light: ThemeMode
  dark: ThemeMode
  fg?: string
  bg?: string
  link?: string
}

export const themes: Theme[] = [
  {
    name: 'default',
    labelKey: 'reader.settings.themes.default',
    light: { fg: '#000000', bg: '#ffffff', link: '#0066cc' },
    dark: { fg: '#e0e0e0', bg: '#222222', link: '#77bbee' },
  },
  {
    name: 'gray',
    labelKey: 'reader.settings.themes.gray',
    light: { fg: '#222222', bg: '#e0e0e0', link: '#4488cc' },
    dark: { fg: '#c6c6c6', bg: '#444444', link: '#88ccee' },
  },
  {
    name: 'sepia',
    labelKey: 'reader.settings.themes.sepia',
    light: { fg: '#5b4636', bg: '#f1e8d0', link: '#008b8b' },
    dark: { fg: '#ffd595', bg: '#342e25', link: '#48d1cc' },
  },
  {
    name: 'crimson',
    labelKey: 'reader.settings.themes.crimson',
    light: { fg: '#2f1f25', bg: '#fdf1f4', link: '#dd0031' },
    dark: { fg: '#f3dbe2', bg: '#3a252d', link: '#ff5a86' },
  },
  {
    name: 'meadow',
    labelKey: 'reader.settings.themes.meadow',
    light: { fg: '#232c16', bg: '#d7dbbd', link: '#177b4d' },
    dark: { fg: '#d8deba', bg: '#333627', link: '#a6d608' },
  },
  {
    name: 'rosewood',
    labelKey: 'reader.settings.themes.rosewood',
    light: { fg: '#4e1609', bg: '#f0d1d5', link: '#de3838' },
    dark: { fg: '#e5c4c8', bg: '#462f32', link: '#ff646e' },
  },
  {
    name: 'azure',
    labelKey: 'reader.settings.themes.azure',
    light: { fg: '#262d48', bg: '#cedef5', link: '#2d53e5' },
    dark: { fg: '#babee1', bg: '#282e47', link: '#ff646e' },
  },
  {
    name: 'dawnlight',
    labelKey: 'reader.settings.themes.dawnlight',
    light: { fg: '#586e75', bg: '#fdf6e3', link: '#268bd2' },
    dark: { fg: '#93a1a1', bg: '#002b36', link: '#268bd2' },
  },
  {
    name: 'ember',
    labelKey: 'reader.settings.themes.ember',
    light: { fg: '#3c3836', bg: '#fbf1c7', link: '#076678' },
    dark: { fg: '#ebdbb2', bg: '#282828', link: '#83a598' },
  },
  {
    name: 'aurora',
    labelKey: 'reader.settings.themes.aurora',
    light: { fg: '#2e3440', bg: '#eceff4', link: '#5e81ac' },
    dark: { fg: '#d8dee9', bg: '#2e3440', link: '#88c0d0' },
  },
  {
    name: 'ocean',
    labelKey: 'reader.settings.themes.ocean',
    light: { fg: '#0a4d4d', bg: '#e0f7fa', link: '#00838f' },
    dark: { fg: '#b2dfdb', bg: '#263238', link: '#4dd0e1' },
  },
  {
    name: 'mist',
    labelKey: 'reader.settings.themes.mist',
    light: { fg: '#4a148c', bg: '#f3e5f5', link: '#7b1fa2' },
    dark: { fg: '#c7b6dd', bg: '#3a3150', link: '#b39ddb' },
  },
  {
    name: 'amoled',
    labelKey: 'reader.settings.themes.amoled',
    light: { fg: '#000000', bg: '#ffffff', link: '#0066cc' },
    dark: { fg: '#ffffff', bg: '#000000', link: '#77bbee' },
  },
]
