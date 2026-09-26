import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Permission, isAudioFormat } from '@bookorbit/types';
import type { AuthenticationMethod, WatchDownloadTicketResponse, WatchMediaOverlayDownloadTicketResponse } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { PermissionService } from '../../common/services/permission.service';
import { AuthService } from '../auth/auth.service';
import { BookService } from '../book/book.service';
import { EpubService } from '../reader/epub/epub.service';

const WATCH_DOWNLOAD_AUDIENCE = 'bookorbit-watch-download';
const WATCH_DOWNLOAD_TTL_SECONDS = 12 * 60 * 60;

/**
 * Media-overlay tickets keep `purpose` and the audience of the audiobook ticket so the shared
 * cover route accepts both, and carry an empty `fileIds` so the audiobook file route rejects them
 * on its existing membership check rather than needing an arm of its own.
 */
interface WatchDownloadClaims {
  sub: string | number;
  ver: number;
  amr?: AuthenticationMethod;
  bookId: number;
  fileIds: number[];
  purpose: 'watch-download';
  overlay?: WatchDownloadOverlayClaim;
  exp?: number;
}

interface WatchDownloadOverlayClaim {
  fileId: number;
  hrefs: string[];
}

export interface WatchMediaOverlayResource {
  user: RequestUser;
  bookId: number;
  fileId: number;
  href: string;
}

@Injectable()
export class WatchDownloadService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly bookService: BookService,
    private readonly permissionService: PermissionService,
    private readonly epubService: EpubService,
  ) {}

  async issue(bookId: number, requestedFileIds: number[], user: RequestUser): Promise<WatchDownloadTicketResponse> {
    const fileIds = [...new Set(requestedFileIds)];
    if (fileIds.length !== requestedFileIds.length) {
      throw new BadRequestException('fileIds must be unique');
    }

    const files = await Promise.all(fileIds.map((fileId) => this.bookService.getFileInfo(fileId, user)));
    if (files.some((file) => file.bookId !== bookId)) {
      throw new BadRequestException('Every file must belong to the requested book');
    }
    if (files.some((file) => !isAudioFormat(file.format))) {
      throw new BadRequestException('Watch downloads only support audiobook files');
    }

    const token = await this.jwtService.signAsync(
      {
        ver: user.tokenVersion,
        amr: user.authenticationMethod ?? 'legacy',
        bookId,
        fileIds,
        purpose: 'watch-download',
      },
      {
        subject: String(user.id),
        audience: WATCH_DOWNLOAD_AUDIENCE,
        expiresIn: WATCH_DOWNLOAD_TTL_SECONDS,
      },
    );
    const expiresAt = new Date(Date.now() + WATCH_DOWNLOAD_TTL_SECONDS * 1000).toISOString();
    const coverPath = await this.bookService.getCoverPath(bookId, user, { medium: 'audio' });

    return {
      token,
      expiresAt,
      files: files.map((file, index) => ({
        fileId: fileIds[index],
        format: file.format,
        sizeBytes: file.size,
        downloadPath: `/api/v1/watch-downloads/files/${fileIds[index]}`,
      })),
      coverPath: coverPath ? `/api/v1/watch-downloads/books/${bookId}/cover` : null,
    };
  }

  /**
   * Issues a ticket over narration audio inside one EPUB3 archive. The ticket pins the exact
   * hrefs it may serve, and the download route addresses them by their position in that list, so
   * no caller-supplied path ever reaches the archive.
   */
  async issueMediaOverlay(
    bookId: number,
    fileId: number,
    requestedHrefs: string[],
    user: RequestUser,
  ): Promise<WatchMediaOverlayDownloadTicketResponse> {
    const hrefs = [...new Set(requestedHrefs)];
    if (hrefs.length !== requestedHrefs.length) {
      throw new BadRequestException('hrefs must be unique');
    }

    const file = await this.bookService.getFileInfo(fileId, user);
    if (file.bookId !== bookId) {
      throw new BadRequestException('The file must belong to the requested book');
    }
    if (file.format.toLowerCase() !== 'epub') {
      throw new BadRequestException('Media-overlay Watch downloads only support EPUB files');
    }

    const playlist = await this.epubService.getMediaOverlayPlaylist(bookId, fileId, user);
    const resources = new Map(playlist.resources.map((resource) => [resource.href, resource]));
    const requested = hrefs.map((href) => {
      const resource = resources.get(href);
      if (!resource) throw new BadRequestException(`Media-overlay resource not in playlist: ${href}`);
      return resource;
    });

    const token = await this.jwtService.signAsync(
      {
        ver: user.tokenVersion,
        amr: user.authenticationMethod ?? 'legacy',
        bookId,
        fileIds: [],
        purpose: 'watch-download',
        overlay: { fileId, hrefs },
      },
      {
        subject: String(user.id),
        audience: WATCH_DOWNLOAD_AUDIENCE,
        expiresIn: WATCH_DOWNLOAD_TTL_SECONDS,
      },
    );
    const expiresAt = new Date(Date.now() + WATCH_DOWNLOAD_TTL_SECONDS * 1000).toISOString();
    const coverPath = await this.bookService.getCoverPath(bookId, user, { medium: 'audio' });

    return {
      token,
      expiresAt,
      files: requested.map((resource, index) => ({
        href: resource.href,
        mediaType: resource.mediaType,
        sizeBytes: resource.size,
        downloadPath: `/api/v1/watch-downloads/media-overlay/files/${index}`,
      })),
      coverPath: coverPath ? `/api/v1/watch-downloads/books/${bookId}/cover` : null,
    };
  }

  async authorize(rawAuthorization: string | undefined, expectedBookId?: number, expectedFileId?: number): Promise<RequestUser> {
    const claims = await this.verifiedClaims(rawAuthorization);
    if (expectedBookId !== undefined && claims.bookId !== expectedBookId) {
      throw new NotFoundException('Book is not included in this Watch download');
    }
    if (expectedFileId !== undefined && !claims.fileIds.includes(expectedFileId)) {
      throw new NotFoundException('File is not included in this Watch download');
    }
    return this.validatedUser(claims);
  }

  /** Resolves a ticket index back to the href the ticket was minted for. */
  async authorizeMediaOverlay(rawAuthorization: string | undefined, index: number): Promise<WatchMediaOverlayResource> {
    const claims = await this.verifiedClaims(rawAuthorization);
    const overlay = claims.overlay;
    if (
      !overlay ||
      !Number.isInteger(overlay.fileId) ||
      overlay.fileId <= 0 ||
      !Array.isArray(overlay.hrefs) ||
      !overlay.hrefs.every((href) => typeof href === 'string' && href.length > 0)
    ) {
      throw new UnauthorizedException('Invalid Watch download ticket');
    }
    if (!Number.isInteger(index) || index < 0 || index >= overlay.hrefs.length) {
      throw new NotFoundException('Resource is not included in this Watch download');
    }
    const user = await this.validatedUser(claims);
    return { user, bookId: claims.bookId, fileId: overlay.fileId, href: overlay.hrefs[index] };
  }

  private async verifiedClaims(rawAuthorization: string | undefined): Promise<WatchDownloadClaims> {
    const token = this.bearerToken(rawAuthorization);
    let claims: WatchDownloadClaims;
    try {
      claims = await this.jwtService.verifyAsync<WatchDownloadClaims>(token, {
        audience: WATCH_DOWNLOAD_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired Watch download ticket');
    }

    const userId = Number(claims.sub);
    if (
      claims.purpose !== 'watch-download' ||
      !Number.isInteger(userId) ||
      userId <= 0 ||
      !Number.isInteger(claims.ver) ||
      !Number.isInteger(claims.bookId) ||
      !Array.isArray(claims.fileIds)
    ) {
      throw new UnauthorizedException('Invalid Watch download ticket');
    }
    return claims;
  }

  private async validatedUser(claims: WatchDownloadClaims): Promise<RequestUser> {
    const user = await this.authService.validateUser(Number(claims.sub), claims.ver, claims.amr ?? 'legacy');
    if (!user) throw new UnauthorizedException('Watch download ticket is no longer valid');
    if (!this.permissionService.userHas(user, Permission.LibraryDownload)) {
      throw new ForbiddenException(`Missing permission: ${Permission.LibraryDownload}`);
    }
    return user;
  }

  private bearerToken(value: string | undefined): string {
    const match = /^Bearer\s+(.+)$/i.exec(value?.trim() ?? '');
    if (!match) throw new UnauthorizedException('Watch download ticket is required');
    return match[1];
  }
}
