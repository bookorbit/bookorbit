;(function () {
  var theme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  var accent = localStorage.getItem('accent') || 'neutral'
  var radius = localStorage.getItem('radius') || 'default'
  if (theme === 'dark') document.documentElement.classList.add('dark')
  if (accent !== 'neutral') document.documentElement.classList.add('accent-' + accent)
  if (radius !== 'default') document.documentElement.classList.add('radius-' + radius)
})()
