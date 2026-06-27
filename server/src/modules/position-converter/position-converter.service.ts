import { Injectable } from '@nestjs/common';

import { chapterIndexFromSpineStep, parseCfi } from './cfi.utils';
import { EpubDomService } from './epub-dom.service';
import {
  CfiToXPointerResult,
  ConversionResult,
  CONVERTER_VERSION,
  cfiRangeToXPointer,
  collapsedPointToCfi,
  xpointerPointToCollapsed,
  xpointerRangeToCfi,
} from './position-converter.core';
import { parseXPointer } from './xpointer.utils';

export interface XPointerToCfiParams {
  bookFileId: number;
  pos0: string;
  pos1: string | null;
  text: string | null;
}

export interface CfiToXPointerParams {
  bookFileId: number;
  cfi: string;
  text: string | null;
}

export interface XPointerToCfiOutcome extends Record<string, unknown> {
  status: 'exact' | 'repaired' | 'failed';
  cfi?: string;
  chapterIndex?: number;
  reason?: string;
}

export interface CfiToXPointerOutcome extends Record<string, unknown> {
  status: 'exact' | 'repaired' | 'failed';
  pos0?: string;
  pos1?: string;
  chapterIndex?: number;
  reason?: string;
}

@Injectable()
export class PositionConverterService {
  readonly version = CONVERTER_VERSION;

  constructor(private readonly epubDom: EpubDomService) {}

  async xpointerToCfi(params: XPointerToCfiParams): Promise<XPointerToCfiOutcome> {
    const parsed = parseXPointer(params.pos0);
    if (!parsed) return { status: 'failed', reason: 'unparsable_pos0' };
    const chapterIndex = parsed.docFragmentIndex - 1;
    if (chapterIndex < 0) return { status: 'failed', reason: 'invalid_fragment' };

    const doc = await this.epubDom.getChapter(params.bookFileId, chapterIndex);
    if (!doc) return { status: 'failed', reason: 'chapter_unavailable', chapterIndex };

    const result: ConversionResult = xpointerRangeToCfi(doc, chapterIndex, params.pos0, params.pos1, params.text);
    if (result.status === 'failed') return { status: 'failed', reason: result.reason, chapterIndex };
    return { status: result.status, cfi: result.pos0, chapterIndex };
  }

  /** Converts a single reading-position xpointer (point, not range) to a point CFI. */
  async xpointerPointToCfi(params: { bookFileId: number; pos: string }): Promise<XPointerToCfiOutcome> {
    const parsed = parseXPointer(params.pos);
    if (!parsed) return { status: 'failed', reason: 'unparsable_pos0' };
    const chapterIndex = parsed.docFragmentIndex - 1;
    if (chapterIndex < 0) return { status: 'failed', reason: 'invalid_fragment' };

    const doc = await this.epubDom.getChapter(params.bookFileId, chapterIndex);
    if (!doc) return { status: 'failed', reason: 'chapter_unavailable', chapterIndex };

    const cp = xpointerPointToCollapsed(doc, params.pos);
    if (cp == null) return { status: 'failed', reason: 'unresolvable_structure', chapterIndex };
    const cfi = collapsedPointToCfi(doc, chapterIndex, cp);
    if (!cfi) return { status: 'failed', reason: 'cfi_generation_failed', chapterIndex };
    return { status: 'exact', cfi, chapterIndex };
  }

  async cfiToXpointer(params: CfiToXPointerParams): Promise<CfiToXPointerOutcome> {
    const parsed = parseCfi(params.cfi);
    if (!parsed) return { status: 'failed', reason: 'unparsable_cfi' };
    const chapterIndex = chapterIndexFromSpineStep(parsed.spineStep);
    if (chapterIndex == null) return { status: 'failed', reason: 'missing_spine_step' };

    const doc = await this.epubDom.getChapter(params.bookFileId, chapterIndex);
    if (!doc) return { status: 'failed', reason: 'chapter_unavailable', chapterIndex };

    const result: CfiToXPointerResult = cfiRangeToXPointer(doc, chapterIndex, params.cfi, params.text);
    if (result.status === 'failed') return { status: 'failed', reason: result.reason, chapterIndex };
    return { status: result.status, pos0: result.pos0, pos1: result.pos1, chapterIndex };
  }
}
