import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';
import type { IndexerAdapterListResult, PluginInspection, PluginInstallResult } from '@bookorbit/types';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Auditable } from '../../../common/decorators/auditable.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { IndexerConfigService } from './indexer-config.service';
import { IndexerRegistry } from './indexer-registry';
import { PluginLoaderService } from './plugins/plugin-loader.service';
import { MAX_PLUGIN_BYTES, PluginInstallService } from './plugins/plugin-install.service';
import { CreateIndexerDto, UpdateIndexerDto } from './dto/indexer.dto';
import type { RequestUser } from '../../../common/types/request-user';
import type { MultipartRequest } from '../../../common/types/multipart-request';

/**
 * Gated on `ManageAppSettings`, not `ManageBookRequests`: moderating a queue and holding tracker
 * credentials are different levels of trust, and an approver should not get the second by having
 * the first.
 */
@Controller('admin/request-indexers')
@RequirePermission(Permission.ManageAppSettings)
export class IndexerController {
  constructor(
    private readonly service: IndexerConfigService,
    private readonly registry: IndexerRegistry,
    private readonly plugins: PluginLoaderService,
    private readonly pluginInstaller: PluginInstallService,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  /**
   * What this install can offer. Served at runtime rather than compiled into the client, because
   * an adapter loaded from the plugin directory is not knowable at build time. The failures are
   * here too: a plugin that simply did not appear is the worst way to learn it has a typo.
   *
   * Declared before `:id` so the router does not try to parse "adapters" as a row id.
   */
  @Get('adapters')
  listAdapters(): IndexerAdapterListResult {
    return { adapters: this.registry.describe(), pluginFailures: [...this.plugins.loadFailures()] };
  }

  /**
   * Reads an uploaded plugin without keeping it, so the operator can see what it declares and read
   * the file before deciding. Nothing is written and nothing is staged.
   *
   * Audited even though nothing is kept: reading the plugin means executing it, so this is the
   * point uploaded code first runs on the server. An install leaves a trail of who introduced the
   * code; without this, running it stops short of one.
   */
  @Post('plugins/inspect')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.RequestIndexerPluginInspect,
    resource: AuditResource.RequestIndexer,
    description: (_req, res: unknown) => `Inspected indexer plugin '${(res as PluginInspection)?.type ?? 'unknown'}'`,
  })
  async inspectPlugin(@CurrentUser() user: RequestUser, @Req() req: MultipartRequest): Promise<PluginInspection> {
    return this.pluginInstaller.inspect(await readPluginUpload(user, req));
  }

  /**
   * The same file again rather than a token for the one just inspected: re-reading it is cheap, and
   * it means the file that was checked and the file that lands are the same bytes by construction.
   */
  @Post('plugins')
  @HttpCode(HttpStatus.CREATED)
  @Auditable({
    action: AuditAction.RequestIndexerPluginInstall,
    resource: AuditResource.RequestIndexer,
    description: (_req, res: unknown) =>
      `${(res as PluginInspection)?.replaces ? 'Replaced' : 'Installed'} indexer plugin '${(res as PluginInspection)?.type ?? 'unknown'}'`,
  })
  async installPlugin(@CurrentUser() user: RequestUser, @Req() req: MultipartRequest): Promise<PluginInstallResult> {
    return this.pluginInstaller.install(await readPluginUpload(user, req), user.email ?? `user:${user.id}`);
  }

  @Delete('plugins/:type')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.RequestIndexerPluginRemove,
    resource: AuditResource.RequestIndexer,
    description: (req: unknown) =>
      `Deleted indexer plugin '${(req as { params?: { type?: string } })?.params?.type ?? 'unknown'}' and its configured sources`,
  })
  async removePlugin(@CurrentUser() user: RequestUser, @Param('type') type: string): Promise<void> {
    assertSuperuser(user);
    await this.pluginInstaller.remove(type, user.email ?? `user:${user.id}`);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @Auditable({
    action: AuditAction.RequestIndexerCreate,
    resource: AuditResource.RequestIndexer,
    getResourceId: (_req, res: unknown) => (res as { id?: number })?.id,
    description: (_req, res: unknown) => `Created indexer '${(res as { name?: string })?.name ?? 'unknown'}'`,
  })
  create(@Body() dto: CreateIndexerDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @Auditable({
    action: AuditAction.RequestIndexerUpdate,
    resource: AuditResource.RequestIndexer,
    getResourceId: (req) => Number(req.params.id),
    description: (req) => `Updated indexer #${req.params.id}`,
  })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateIndexerDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.RequestIndexerDelete,
    resource: AuditResource.RequestIndexer,
    getResourceId: (req) => Number(req.params.id),
    description: (req) => `Deleted indexer #${req.params.id}`,
  })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(@Param('id', ParseIntPipe) id: number) {
    return this.service.test(id);
  }
}

/**
 * Installing a plugin runs its code in this process, with this process's reach. `ManageAppSettings`
 * is the wrong bar for that: it is a permission an operator hands out for configuration, and this
 * is not configuration. Enforced here rather than only hidden in the UI, because a hidden button is
 * not a control.
 */
function assertSuperuser(user: RequestUser): void {
  if (!user.isSuperuser) throw new ForbiddenException('Only administrators can install indexer plugins');
}

async function readPluginUpload(user: RequestUser, req: MultipartRequest): Promise<string> {
  assertSuperuser(user);

  const upload = await req.file({ limits: { fileSize: MAX_PLUGIN_BYTES } });
  if (!upload) throw new BadRequestException('No file provided');
  if (!upload.filename.endsWith('.mjs')) throw new BadRequestException('A plugin is a single .mjs file');

  const source = await upload.toBuffer();
  // Fastify truncates rather than throwing once the limit is passed, so a file that hit the cap
  // would otherwise arrive as a plausible-looking prefix and fail later as a syntax error.
  if (upload.file.truncated) throw new BadRequestException(`A plugin must be smaller than ${MAX_PLUGIN_BYTES} bytes`);
  return source.toString('utf8');
}
