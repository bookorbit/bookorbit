;(function () {
  function readStoredValue(key, fallback) {
    var stored = localStorage.getItem(key)
    if (stored === null) return fallback
    try {
      return JSON.parse(stored)
    } catch {
      return stored
    }
  }

  var theme = readStoredValue('theme', 'system')
  var accent = readStoredValue('accent', 'neutral')
  var radius = readStoredValue('radius', 'default')
  var systemDark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
  var isDark = theme === 'dark' || (theme !== 'light' && systemDark)
  if (isDark) document.documentElement.classList.add('dark')
  if (accent !== 'neutral') document.documentElement.classList.add('accent-' + accent)
  if (radius !== 'default') document.documentElement.classList.add('radius-' + radius)
})()
