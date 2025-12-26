/**
 * Creates a streaming loader that fetches EPUB files from the server on-demand
 * instead of loading the entire ZIP file into memory.
 *
 * @param {number} bookId - The book ID for API requests
 * @param {string} baseUrl - API base URL (e.g., '/api/v1/epub')
 * @param {Object} bookInfo - Pre-fetched EPUB metadata from /info endpoint
 * @param {string} [authToken] - Optional authentication token
 * @param {string} [bookType] - Optional book type for alternative format (e.g., 'EPUB')
 * @returns {Object} Loader interface compatible with Foliate's EPUB class
 */
export const makeStreamingLoader = (bookId, baseUrl, bookInfo, authToken = null, bookType = null) => {
  // Build a map of file paths to their manifest info for quick lookup
  const manifestMap = new Map(
    bookInfo.manifest.map(item => [item.href, item])
  )

  // Build URL for fetching a file
  const getFileUrl = (name) => {
    if (!name) return null
    // URL encode the path but preserve slashes
    const encodedPath = name.split('/').map(encodeURIComponent).join('/')
    let url = `${baseUrl}/${bookId}/file/${encodedPath}`
    if (bookType) {
      url += `?bookType=${encodeURIComponent(bookType)}`
    }
    return url
  }

  // Build fetch options with auth header
  const getFetchOptions = () => {
    if (!authToken) return {}
    return {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    }
  }

  // Build URL with token for browser-initiated requests (fonts, images in CSS)
  const getDirectFileUrl = (name) => {
    if (!name) return null
    const encodedPath = name.split('/').map(encodeURIComponent).join('/')
    let url = `${baseUrl}/${bookId}/file/${encodedPath}`
    const params = []
    if (bookType) {
      params.push(`bookType=${encodeURIComponent(bookType)}`)
    }
    if (authToken) {
      params.push(`token=${encodeURIComponent(authToken)}`)
    }
    if (params.length > 0) {
      url += '?' + params.join('&')
    }
    return url
  }

  /**
   * Load file as text
   */
  const loadText = async (name) => {
    if (!name) return null
    try {
      const url = getFileUrl(name)
      const response = await fetch(url, getFetchOptions())
      if (!response.ok) {
        console.warn(`Failed to load text: ${name}`, response.status)
        return null
      }
      return await response.text()
    } catch (e) {
      console.error(`Error loading text ${name}:`, e)
      return null
    }
  }

  /**
   * Load file as Blob with optional MIME type
   */
  const loadBlob = async (name, type) => {
    if (!name) return null
    try {
      const url = getFileUrl(name)
      const response = await fetch(url, getFetchOptions())
      if (!response.ok) {
        console.warn(`Failed to load blob: ${name}`, response.status)
        return null
      }
      const blob = await response.blob()
      // Return with specified type or detected type
      if (type) {
        return new Blob([blob], {type})
      }
      return blob
    } catch (e) {
      console.error(`Error loading blob ${name}:`, e)
      return null
    }
  }

  /**
   * Get uncompressed size of a file
   */
  const getSize = (name) => {
    if (!name) return 0
    const item = manifestMap.get(name)
    return item?.size ?? 0
  }

  /**
   * Get direct URL for a file without fetching it.
   * This allows the browser to fetch resources on-demand (fonts, images).
   * Note: Uses token in URL since browser-initiated requests can't use headers.
   * @param {string} name - File path within the EPUB
   * @returns {string|null} Direct URL to the file
   */
  const getDirectUrl = (name) => {
    if (!name) return null
    return getDirectFileUrl(name)
  }

  return {
    loadText,
    loadBlob,
    getSize,
    getDirectUrl, // For lazy loading of fonts/images in CSS
    // Expose for debugging
    _bookInfo: bookInfo,
    _manifestMap: manifestMap
  }
}

export default makeStreamingLoader
