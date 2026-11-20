import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put } from '@nestjs/common';

import { AuditAction, AuditResource, Permission, type LibraryDockAdminEntry } from '@bookorbit/types';

import { Auditable, type AuditRequest } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { AdoptLibraryDockFolderDto, LibraryDockFolderDto, RenameLibraryDockFolderDto, UpdateLibraryDockDto } from './dto/library-dock.dto';
import { LibraryDockService } from './library-dock.service';

const dockIdOf = (_req: AuditRequest, body: unknown) => (body as LibraryDockAdminEntry | undefined)?.dock?.id;
const libraryOf = (req: AuditRequest) => ({ libraryId: Number(req.params.libraryId) });
const folderOf = (req: AuditRequest) => ({ folderName: (req.body as { folderName?: string } | undefined)?.folderName });

/** Library docks: one drop folder per library under `_libraries` in the Book Dock folder. */
@Controller('book-dock/docks')
@RequirePermission(Permission.BookDockAccess)
export class LibraryDockController {
  constructor(private readonly docks: LibraryDockService) {}

  /** The docks the caller may upload into. Also how a client tells this server has library docks (P1). */
  @Get()
  listUploadTargets(@CurrentUser() user: RequestUser) {
    return this.docks.listUploadTargets(user);
  }

  /** Tries filing from each library's dock with a throwaway file: instant move, or copy (D7). */
  @Post('filing-check')
  @RequirePermission(Permission.ManageBookDock)
  @HttpCode(HttpStatus.OK)
  checkFiling(@CurrentUser() user: RequestUser) {
    return this.docks.checkFiling(user);
  }

  @Get('admin')
  @RequirePermission(Permission.ManageBookDock)
  getAdmin(@CurrentUser() user: RequestUser) {
    return this.docks.getAdmin(user);
  }

  @Put(':libraryId')
  @RequirePermission(Permission.ManageBookDock)
  @Auditable({
    action: AuditAction.LibraryDockUpdate,
    resource: AuditResource.LibraryDock,
    getResourceId: dockIdOf,
    getMeta: libraryOf,
    description: 'Updated a library dock',
  })
  update(@CurrentUser() user: RequestUser, @Param('libraryId', ParseIntPipe) libraryId: number, @Body() dto: UpdateLibraryDockDto) {
    return this.docks.updateDock(user, libraryId, dto);
  }

  @Post(':libraryId/rename-folder')
  @RequirePermission(Permission.ManageBookDock)
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.LibraryDockFolderRename,
    resource: AuditResource.LibraryDock,
    getResourceId: dockIdOf,
    getMeta: libraryOf,
    description: 'Renamed a library dock folder',
  })
  renameFolder(@CurrentUser() user: RequestUser, @Param('libraryId', ParseIntPipe) libraryId: number, @Body() dto: RenameLibraryDockFolderDto) {
    return this.docks.renameFolder(user, libraryId, dto.folderName);
  }

  @Post('folders/adopt')
  @RequirePermission(Permission.ManageBookDock)
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.LibraryDockFolderAdopt,
    resource: AuditResource.LibraryDock,
    getResourceId: dockIdOf,
    getMeta: (req) => ({ ...folderOf(req), libraryId: (req.body as { libraryId?: number } | undefined)?.libraryId }),
    description: 'Adopted a folder as a library dock',
  })
  adoptFolder(@CurrentUser() user: RequestUser, @Body() dto: AdoptLibraryDockFolderDto) {
    return this.docks.adoptFolder(user, dto.folderName, dto.libraryId);
  }

  @Post('folders/move-to-unsorted')
  @RequirePermission(Permission.ManageBookDock)
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.LibraryDockFolderMove,
    resource: AuditResource.LibraryDock,
    getMeta: (req, body) => ({ ...folderOf(req), ...(body as object) }),
    description: 'Moved a library docks folder to Unsorted',
  })
  moveFolderToUnsorted(@Body() dto: LibraryDockFolderDto) {
    return this.docks.moveFolderToUnsorted(dto.folderName);
  }

  @Post('folders/remove')
  @RequirePermission(Permission.ManageBookDock)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.LibraryDockFolderRemove,
    resource: AuditResource.LibraryDock,
    getMeta: folderOf,
    description: 'Removed an empty library docks folder',
  })
  removeFolder(@Body() dto: LibraryDockFolderDto) {
    return this.docks.removeFolder(dto.folderName);
  }
}
