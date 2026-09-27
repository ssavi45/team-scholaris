// Run before styles/React so a saved dark preference never paints a light page.
(() => {
  let preference = null
  try { preference = localStorage.getItem('scholaris:theme') } catch { /* Storage may be blocked. */ }
  const theme = preference === 'light' || preference === 'dark'
    ? preference
    : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
})()
