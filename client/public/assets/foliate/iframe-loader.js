const inlineDocument = (text, type, src) => {
  const parsed = new DOMParser().parseFromString(text, type === 'application/xhtml+xml' ? type : 'text/html')
  if (parsed.querySelector('parsererror')) throw new DOMException('', 'SyntaxError')
  const html = document.implementation.createHTMLDocument('')
  html.replaceChild(html.importNode(parsed.documentElement, true), html.documentElement)
  const base = html.createElement('base')
  base.href = src
  html.head.prepend(base)
  // HTML serialization keeps explicit end tags for non-void XHTML elements. Passing the XML
  // text straight to srcdoc would reinterpret self-closing divs and change persisted CFIs.
  return { markup: '<!DOCTYPE html>' + html.documentElement.outerHTML, body: html.body }
}

export const loadIframeDocument = (iframe, src, signal) =>
  new Promise((resolve, reject) => {
    let settled = false
    let inline = false
    let inlineBody
    const controller = new AbortController()
    const finish = (error, doc) => {
      if (settled) return
      settled = true
      clearTimeout(fallbackTimer)
      clearTimeout(timeoutTimer)
      iframe.removeEventListener('load', onLoad)
      signal?.removeEventListener('abort', onAbort)
      controller.abort()
      if (error) reject(error)
      else resolve(doc)
    }
    const onAbort = () => finish(new DOMException('', 'AbortError'))
    const onLoad = () => {
      const doc = iframe.contentDocument
      if (doc?.body && doc.URL === (inline ? 'about:srcdoc' : src)) {
        // HTML parsing can insert elements such as tbody. Restore the XHTML body tree so CFIs
        // saved here still address the same nodes in other browsers and the native reader.
        if (inlineBody) doc.body.replaceWith(doc.importNode(inlineBody, true))
        finish(null, doc)
      }
    }
    // Some embedded WebKit browsers leave blob frame navigations at about:blank. Only those
    // failed navigations use srcdoc; the sandbox and normal XHTML loading path stay intact.
    const fallbackTimer = setTimeout(async () => {
      if (settled || iframe.contentDocument?.URL !== 'about:blank' || !src.startsWith('blob:')) return
      try {
        const response = await fetch(src, { signal: controller.signal })
        const text = await response.text()
        if (settled) return
        const document = inlineDocument(text, response.headers.get('content-type')?.split(';')[0], src)
        inlineBody = document.body
        inline = true
        iframe.srcdoc = document.markup
      } catch (error) {
        finish(error)
      }
    }, 1000)
    const timeoutTimer = setTimeout(() => finish(new DOMException('', 'TimeoutError')), 30_000)
    iframe.addEventListener('load', onLoad)
    signal?.addEventListener('abort', onAbort, { once: true })
    iframe.removeAttribute('srcdoc')
    iframe.src = src
    if (signal?.aborted) onAbort()
  })
