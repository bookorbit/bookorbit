import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  AI_FEATURE_DEFINITIONS,
  type VisionScanAppInfo,
  type VisionScanBook,
  type VisionScanErrorCode,
  type VisionScanRequest,
  type VisionScanResponse,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AiClient } from '../ai/ai-client.service';
import { isAiError, type AiResult } from '../ai/ai-client.types';
import { AiSettingsService } from '../ai/ai-settings.service';
import { AI_VISION_MAX_OUTPUT_TOKENS, AI_VISION_SCHEMA, AI_VISION_SYSTEM, aiVisionUser, parseVisionBooks } from '../ai/ai-vision';
import { VisualMatchService } from '../visual-match/visual-match.service';
import { prepareVisionImage, VisionScanImageError } from './vision-scan-image';

export const VISION_SCAN_FEATURE = 'vision-scan';
/** How long a scan waits for the model, retries included; the app waits a little longer. */
export const VISION_SCAN_TIMEOUT_MS = 45_000;

const DEFINITION = AI_FEATURE_DEFINITIONS[VISION_SCAN_FEATURE];

function scanError(code: VisionScanErrorCode, message: string): HttpException {
  const body = { message, errorCode: code };
  switch (code) {
    case 'VISION_SCAN_OFF':
    case 'VISION_SCAN_BUDGET':
      return new ForbiddenException(body);
    case 'VISION_SCAN_IMAGE_INVALID':
      return new BadRequestException(body);
    case 'VISION_SCAN_REFUSED':
      return new UnprocessableEntityException(body);
    case 'VISION_SCAN_TIMEOUT':
      return new GatewayTimeoutException(body);
    default:
      return new BadGatewayException(body);
  }
}

/**
 * Photo scans: the admin's Vision model reads the books in a photo of a cover or a shelf, and the
 * visual matcher decides which are in the reader's libraries. One synchronous model call, capped in
 * time, counted against the feature's budget like any AI request.
 */
@Injectable()
export class VisionScanService {
  private readonly logger = new Logger(VisionScanService.name);

  constructor(
    private readonly ai: AiClient,
    private readonly settings: AiSettingsService,
    private readonly visualMatch: VisualMatchService,
  ) {}

  /** `signal` aborts when the app gives up, so a scan nobody waits for stops spending. */
  async scan(user: RequestUser, request: VisionScanRequest, signal?: AbortSignal): Promise<VisionScanResponse> {
    const event = 'vision_scan.scan';
    const startedAt = Date.now();
    const bytes = Buffer.from(request.image, 'base64');
    this.logger.log(`[${event}] [start] userId=${user.id} kind=${request.kind} bytes=${bytes.length} - photo scan started`);

    try {
      const image = await prepareVisionImage(bytes, request.kind).catch((error: unknown) => {
        if (error instanceof VisionScanImageError) throw scanError('VISION_SCAN_IMAGE_INVALID', error.message);
        throw error;
      });

      const timeout = AbortSignal.timeout(VISION_SCAN_TIMEOUT_MS);
      const result = await this.read(request, image, signal ? AbortSignal.any([timeout, signal]) : timeout, timeout);
      if (result.finish === 'refused' || result.finish === 'filtered') throw scanError('VISION_SCAN_REFUSED', 'The model declined the photo');

      const read = parseVisionBooks(result.json);
      const matched =
        read.length > 0
          ? await this.visualMatch.matchShelf(user, {
              spines: read.map((book, index) => ({ id: String(index), lines: book.author ? [book.title, book.author] : [book.title] })),
            })
          : { results: [] };
      const books: VisionScanBook[] = read.map((book, index) => ({
        id: String(index),
        title: book.title,
        author: book.author,
        box: book.box,
        matches: matched.results[index]?.matches ?? [],
      }));

      this.logger.log(
        `[${event}] [end] userId=${user.id} kind=${request.kind} width=${image.width} height=${image.height} model=${sanitizeLogValue(result.model)} books=${books.length} matched=${books.filter((book) => book.matches.length > 0).length} durationMs=${Date.now() - startedAt} - photo scan finished`,
      );
      return { kind: request.kind, books };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const code = error instanceof HttpException ? ((error.getResponse() as { errorCode?: string }).errorCode ?? 'http') : err.constructor.name;
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} kind=${request.kind} durationMs=${Date.now() - startedAt} errorClass=${err.constructor.name} code=${code} error="${sanitizeLogValue(err.message)}" - photo scan failed`,
      );
      throw error;
    }
  }

  /** In `app-info`: on when the admin turned the feature on and the Vision slot has a model. */
  async appInfo(): Promise<VisionScanAppInfo> {
    const [features, slots] = await Promise.all([this.settings.features(), this.settings.slots()]);
    const ready = DEFINITION.slots.every((slot) => slots[slot].connectionId !== null && slots[slot].model !== null);
    return { enabled: features[VISION_SCAN_FEATURE].enabled && ready };
  }

  private async read(
    request: VisionScanRequest,
    image: Awaited<ReturnType<typeof prepareVisionImage>>,
    signal: AbortSignal,
    timeout: AbortSignal,
  ): Promise<AiResult> {
    try {
      return await this.ai.complete({
        feature: VISION_SCAN_FEATURE,
        slot: 'vision',
        system: AI_VISION_SYSTEM,
        user: aiVisionUser(request.kind),
        images: [image],
        schema: AI_VISION_SCHEMA,
        maxOutputTokens: AI_VISION_MAX_OUTPUT_TOKENS,
        signal,
      });
    } catch (error) {
      if (!isAiError(error)) throw error;
      switch (error.code) {
        case 'off':
        case 'slot-empty':
          throw scanError('VISION_SCAN_OFF', 'Photo scans are turned off on this server');
        case 'budget':
          throw scanError('VISION_SCAN_BUDGET', "This month's AI budget is used up");
        case 'cancelled':
          if (timeout.aborted) throw scanError('VISION_SCAN_TIMEOUT', 'The AI provider took too long to answer');
          throw error;
        default:
          throw scanError('VISION_SCAN_PROVIDER', 'The AI provider could not read the photo');
      }
    }
  }
}
