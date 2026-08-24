import { afterEach, describe, expect, it } from 'vitest'
import { PluginRegistry, setDocumentLoaded, startLoadingDocument } from '@embedpdf/core'
import { Rotation, type PdfDocumentObject, type PdfEngine } from '@embedpdf/models'
import { ScrollPluginPackage, ScrollStrategy } from '@embedpdf/plugin-scroll'
import { ViewportPlugin, ViewportPluginPackage } from '@embedpdf/plugin-viewport'
import { ZoomPlugin, ZoomPluginPackage } from '@embedpdf/plugin-zoom'

describe('patched EmbedPDF custom zoom initialization', () => {
  let registry: PluginRegistry | null = null

  afterEach(async () => {
    await registry?.destroy()
    registry = null
  })

  it('applies a numeric default zoom and releases the startup gate after viewport measurement', async () => {
    registry = new PluginRegistry({} as PdfEngine)
    registry.registerPlugin(ViewportPluginPackage, { viewportGap: 12 })
    registry.registerPlugin(ScrollPluginPackage, {
      defaultStrategy: ScrollStrategy.Vertical,
      defaultPageGap: 12,
      defaultBufferSize: 3,
    })
    registry.registerPlugin(ZoomPluginPackage, {
      defaultZoomLevel: 1.2,
      minZoom: 0.25,
      maxZoom: 4,
    })
    await registry.initialize()

    const store = registry.getStore()
    const documentId = 'custom-zoom-document'
    const document: PdfDocumentObject = {
      id: documentId,
      pageCount: 1,
      pages: [{ index: 0, size: { width: 600, height: 800 }, rotation: Rotation.Degree0, objectNumber: 1 }],
      isEncrypted: false,
      isOwnerUnlocked: true,
      permissions: 0,
      normalizedRotation: true,
    }

    store.dispatchToCore(startLoadingDocument(documentId, 'PDF'))
    store.dispatchToCore(setDocumentLoaded(documentId, document))

    const viewport = registry.getPlugin<ViewportPlugin>(ViewportPlugin.id)
    const zoom = registry.getPlugin<ZoomPlugin>(ZoomPlugin.id)
    expect(viewport?.provides().hasGate('zoom', documentId)).toBe(true)

    viewport?.setViewportResizeMetrics(documentId, {
      width: 1000,
      height: 700,
      clientWidth: 1000,
      clientHeight: 700,
      scrollTop: 0,
      scrollLeft: 0,
      scrollWidth: 1000,
      scrollHeight: 700,
      clientLeft: 0,
      clientTop: 0,
    })
    await new Promise((resolve) => setTimeout(resolve, 175))

    expect(viewport?.provides().hasGate('zoom', documentId)).toBe(false)
    expect(zoom?.provides().forDocument(documentId).getState()).toMatchObject({ zoomLevel: 1.2, currentZoomLevel: 1.2 })
    expect(store.getState().core.documents[documentId]?.scale).toBe(1.2)
  })
})
