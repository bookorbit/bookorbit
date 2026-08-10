import { describe, expect, it, vi } from 'vitest';

import { DevicePositionRebuilderRegistry } from '../../annotation/device-position-rebuilder';
import { KoboPositionRebuildService } from './kobo-position-rebuild.service';

const TARGET = { id: 1, bookId: 5, text: 'selected text' };
const KOBO_SPAN_ROW = { annotationId: 1, format: 'kobo_span', pos0: 'kobo.6.2:0', pos1: 'kobo.6.2:28', extras: {} };
const CONTEXT = { ok: true as const, file: { id: 9 }, ctx: { kepubPath: '/tmp/b.kepub.epub' }, settings: {} };

function makeService(overrides: { positions?: unknown[]; context?: unknown; converted?: boolean; reason?: string } = {}) {
  const registry = new DevicePositionRebuilderRegistry();
  const annotationSync = { findPositions: vi.fn().mockResolvedValue(overrides.positions ?? [KOBO_SPAN_ROW]) };
  const kepubContext = { resolveForBook: vi.fn().mockResolvedValue(overrides.context ?? CONTEXT) };
  const materializer = {
    convertFromKoboSpan: vi.fn().mockResolvedValue({ converted: overrides.converted ?? true, reason: overrides.reason }),
  };
  const service = new KoboPositionRebuildService(registry, annotationSync as never, kepubContext as never, materializer as never);
  return { service, registry, annotationSync, kepubContext, materializer };
}

describe('KoboPositionRebuildService', () => {
  it('registers itself as the device rebuilder on init', () => {
    const { service, registry } = makeService();

    service.onModuleInit();

    expect(registry.get()).toBe(service);
  });

  it('converts the stored kobo_span position through the shared materializer path', async () => {
    const { service, annotationSync, materializer } = makeService();

    await expect(service.rebuildCanonicalPositions(10, TARGET)).resolves.toEqual({ rebuilt: true, reason: undefined });

    expect(annotationSync.findPositions).toHaveBeenCalledWith([1], ['kobo_span']);
    expect(materializer.convertFromKoboSpan).toHaveBeenCalledWith(10, TARGET, KOBO_SPAN_ROW, CONTEXT.file, CONTEXT.ctx);
  });

  it('reports the conversion reason when the codec rejects the position', async () => {
    const { service } = makeService({ converted: false, reason: 'kepub_text_mismatch' });

    await expect(service.rebuildCanonicalPositions(10, TARGET)).resolves.toEqual({ rebuilt: false, reason: 'kepub_text_mismatch' });
  });

  it('does nothing without a kobo_span position to rebuild from', async () => {
    const { service, kepubContext } = makeService({ positions: [] });

    await expect(service.rebuildCanonicalPositions(10, TARGET)).resolves.toEqual({ rebuilt: false, reason: 'no_kobo_span_position' });
    expect(kepubContext.resolveForBook).not.toHaveBeenCalled();
  });

  it('does nothing when the kepub artifact is unavailable', async () => {
    const { service, materializer } = makeService({ context: { ok: false, reason: 'kepub_required', settings: null } });

    await expect(service.rebuildCanonicalPositions(10, TARGET)).resolves.toEqual({ rebuilt: false, reason: 'kepub_required' });
    expect(materializer.convertFromKoboSpan).not.toHaveBeenCalled();
  });
});
