;(function () {
  function readStoredValue(key, fallback) {
    var stored = localStorage.getItem(key)
    if (stored === null) return fallback
    var value = stored
    try {
      value = JSON.parse(stored)
    } catch {
      value = stored
    }
    return typeof value === 'string' ? value : fallback
  }

  // Mirrors STANDALONE_ROUTE_PREFIXES in src/lib/theme-styles.ts; theme-init.spec.ts keeps them equal.
  var STANDALONE_ROUTE_PREFIXES = ['/read/', '/login', '/register', '/setup', '/forgot-password', '/reset-password', '/oauth2-callback', '/magic']

  function isAppShellPath(path) {
    for (var i = 0; i < STANDALONE_ROUTE_PREFIXES.length; i++) {
      var prefix = STANDALONE_ROUTE_PREFIXES[i]
      if (path === prefix || path.indexOf(prefix.charAt(prefix.length - 1) === '/' ? prefix : prefix + '/') === 0) return false
    }
    return true
  }

  var root = document.documentElement
  var theme = readStoredValue('theme', 'system')
  var accent = readStoredValue('accent', 'teal')
  var radius = readStoredValue('radius', 'default')
  var style = readStoredValue('style', 'nostalgia')
  var surfacePalette = readStoredValue('surfacePalette', 'steel')
  var rawReach = localStorage.getItem('glowReach')
  var storedReach = rawReach === null ? 50 : Number(rawReach)
  var glowReach = isFinite(storedReach) ? Math.min(200, Math.max(0, storedReach)) : 50
  var systemDark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
  var isDark = theme === 'dark' || (theme !== 'light' && systemDark)
  if (isDark) root.classList.add('dark')
  root.classList.add('accent-' + accent)
  if (radius !== 'default') root.classList.add('radius-' + radius)
  root.setAttribute('data-style', isAppShellPath(window.location.pathname) ? style : 'bookorbit')
  root.setAttribute('data-surface', surfacePalette)
  root.style.setProperty('--glow-reach', String(glowReach / 100))
  root.setAttribute('data-glow', glowReach > 0 ? 'on' : 'off')
})()
