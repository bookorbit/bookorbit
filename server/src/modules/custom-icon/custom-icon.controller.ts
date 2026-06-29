import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { createReadStream } from 'fs';
import type { FastifyReply } from 'fastify';
import {
  CUSTOM_ICON_DEFAULT_PAGE_SIZE,
  CUSTOM_ICON_MAX_FILE_SIZE,
  CUSTOM_ICON_MAX_UPLOAD_FILES,
  Permission,
  type CustomIconUploadMetaItem,
} from '@bookorbit/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { MultipartRequest } from '../../common/types/multipart-request';
import { CustomIconService } from './custom-icon.service';
import { BulkDeleteCustomIconsDto } from './dto/bulk-delete-custom-icons.dto';
import { ListCustomIconsDto } from './dto/list-custom-icons.dto';
import { UpdateCustomIconDto } from './dto/update-custom-icon.dto';

interface UploadedIconFile {
  filename: string;
  bytes: Buffer;
}

@Controller('custom-icons')
export class CustomIconController {
  constructor(private readonly customIconService: CustomIconService) {}

  @Get()
  catalog() {
    return this.customIconService.catalog();
  }

  @Get('manage')
  list(@Query() query: ListCustomIconsDto) {
    return this.customIconService.listPage({
      q: query.q,
      sort: query.sort ?? 'newest',
      page: query.page ?? 0,
      size: query.size ?? CUSTOM_ICON_DEFAULT_PAGE_SIZE,
    });
  }

  @Get(':slug/usage')
  usage(@Param('slug') slug: string) {
    return this.customIconService.getUsage(slug);
  }

  @Post('stage')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ManageIcons)
  async stage(@Req() req: MultipartRequest) {
    const files = await this.collectFiles(req);
    return this.customIconService.stageMany(files.files);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(Permission.ManageIcons)
  async upload(@Req() req: MultipartRequest) {
    const { files, meta } = await this.collectFiles(req);
    return this.customIconService.uploadMany(files, meta);
  }

  @Post('bulk-delete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ManageIcons)
  bulkDelete(@Body() dto: BulkDeleteCustomIconsDto) {
    return this.customIconService.bulkRemove(dto.slugs);
  }

  @Patch(':slug')
  @RequirePermission(Permission.ManageIcons)
  update(@Param('slug') slug: string, @Body() dto: UpdateCustomIconDto) {
    return this.customIconService.update(slug, dto);
  }

  @Patch(':slug/svg')
  @RequirePermission(Permission.ManageIcons)
  async replaceSvg(@Param('slug') slug: string, @Req() req: MultipartRequest) {
    const data = await req.file({ limits: { fileSize: CUSTOM_ICON_MAX_FILE_SIZE } });
    if (!data) throw new BadRequestException('No file provided');
    return this.customIconService.replaceSvg(slug, data.filename, await data.toBuffer());
  }

  @Delete(':slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageIcons)
  async remove(@Param('slug') slug: string) {
    await this.customIconService.remove(slug);
  }

  @Get(':slug.svg')
  async serveSvg(
    @Param('slug') slug: string,
    @Query('v') version: string | undefined,
    @Req() req: { headers: Record<string, string | undefined> },
    @Res() reply: FastifyReply,
  ) {
    const { filePath, icon } = await this.customIconService.getFileInfo(slug);
    const etag = `"${icon.fileHash}"`;
    if (req.headers['if-none-match'] === etag) {
      reply.status(304).send();
      return;
    }
    reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
    reply.header('ETag', etag);
    // Versioned URL (contains matching hash) → cache indefinitely; replace triggers a new URL.
    // Unversioned URL → cache for 1 hour to avoid per-render round-trips.
    const cacheControl = version === icon.fileHash ? 'private, max-age=31536000, immutable' : 'private, max-age=3600';
    reply.header('Cache-Control', cacheControl);
    reply.send(createReadStream(filePath));
  }

  private async collectFiles(req: MultipartRequest): Promise<{ files: UploadedIconFile[]; meta?: CustomIconUploadMetaItem[] }> {
    const files: UploadedIconFile[] = [];
    let meta: CustomIconUploadMetaItem[] | undefined;
    for await (const part of req.parts({ limits: { files: CUSTOM_ICON_MAX_UPLOAD_FILES, fileSize: CUSTOM_ICON_MAX_FILE_SIZE } })) {
      if (part.type === 'file') {
        files.push({ filename: part.filename, bytes: await part.toBuffer() });
      } else if (part.fieldname === 'meta' && typeof part.value === 'string') {
        meta = parseMeta(part.value);
      }
    }
    return { files, meta };
  }
}

function parseMeta(raw: string): CustomIconUploadMetaItem[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        filename: asString(item.filename),
        name: asString(item.name),
      }));
  } catch {
    throw new BadRequestException('Invalid upload metadata');
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
