import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import type { EmailProvider as EmailProviderJson, EmailTestResult } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { Unserialized } from '../../common/types/unserialized';
import { emailProviders } from '../../db/schema';
import { EmailEncryptionService } from './email-encryption.service';
import { EmailTransportService } from './email-transport.service';
import { EmailProviderRepository } from './email-provider.repository';
import { EmailPreferencesRepository } from './email-preferences.repository';
import { CreateEmailProviderDto } from './dto/create-email-provider.dto';
import { UpdateEmailProviderDto } from './dto/update-email-provider.dto';
import type { EmailProvider } from '../../db/schema';
import { isUniqueViolation } from './email-db-error.util';

type EmailProviderResponse = Unserialized<EmailProviderJson, 'createdAt' | 'updatedAt' | 'lastTestedAt'>;

@Injectable()
export class EmailProviderService {
  constructor(
    private readonly repo: EmailProviderRepository,
    private readonly encryption: EmailEncryptionService,
    private readonly transport: EmailTransportService,
    private readonly preferences: EmailPreferencesRepository,
  ) {}

  async findAll(user: RequestUser): Promise<EmailProviderResponse[]> {
    const rows = await this.repo.findAllForUser(user.id);
    return rows.map((p) => this.sanitize(p));
  }

  async findOne(id: number, user: RequestUser): Promise<EmailProviderResponse> {
    const provider = await this.getOwnedOrShared(id, user);
    return this.sanitize(provider);
  }

  async create(dto: CreateEmailProviderDto, user: RequestUser): Promise<EmailProviderResponse> {
    const passwordEnc = dto.password ? this.encryption.encrypt(dto.password) : null;
    try {
      const [created] = await this.repo.insert({
        userId: user.id,
        name: dto.name,
        host: dto.host,
        port: dto.port,
        username: dto.username ?? null,
        passwordEnc,
        fromName: dto.fromName ?? null,
        fromAddress: dto.fromAddress ?? null,
        auth: dto.auth,
        ssl: dto.ssl,
        startTls: dto.startTls,
        tlsRejectUnauthorized: dto.tlsRejectUnauthorized,
      });
      return this.sanitize(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An email provider with this name already exists');
      }
      throw error;
    }
  }

  async update(id: number, dto: UpdateEmailProviderDto, user: RequestUser): Promise<EmailProviderResponse> {
    await this.getOwned(id, user);

    const patch: Partial<typeof emailProviders.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.host !== undefined) patch.host = dto.host;
    if (dto.port !== undefined) patch.port = dto.port;
    if (dto.username !== undefined) patch.username = dto.username;
    if (dto.fromName !== undefined) patch.fromName = dto.fromName;
    if (dto.fromAddress !== undefined) patch.fromAddress = dto.fromAddress;
    if (dto.auth !== undefined) patch.auth = dto.auth;
    if (dto.ssl !== undefined) patch.ssl = dto.ssl;
    if (dto.startTls !== undefined) patch.startTls = dto.startTls;
    if (dto.tlsRejectUnauthorized !== undefined) patch.tlsRejectUnauthorized = dto.tlsRejectUnauthorized;
    if (dto.password !== undefined) {
      patch.passwordEnc = dto.password ? this.encryption.encrypt(dto.password) : null;
    }

    try {
      const [updated] = await this.repo.update(id, user.id, patch);
      if (!updated) throw new NotFoundException('Provider not found');
      return this.sanitize(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An email provider with this name already exists');
      }
      throw error;
    }
  }

  async remove(id: number, user: RequestUser) {
    const provider = await this.getOwned(id, user);
    if (provider.isSystemProvider) {
      throw new BadRequestException('Cannot delete the system mail provider. Remove the system designation first.');
    }
    await this.repo.delete(id, user.id);
  }

  async setDefault(id: number, user: RequestUser): Promise<EmailProviderResponse> {
    await this.getOwned(id, user);
    await this.preferences.setDefaults(user.id, { defaultProviderId: id });
    const [updated] = await this.repo.findById(id);
    if (!updated) throw new NotFoundException('Provider not found');
    return this.sanitize(updated);
  }

  async toggleShared(id: number, user: RequestUser): Promise<EmailProviderResponse> {
    if (!user.isSuperuser && !user.permissions.includes(Permission.ManageEmail)) {
      throw new ForbiddenException(`Missing permission: ${Permission.ManageEmail}`);
    }
    const provider = await this.getOwned(id, user);
    const [updated] = await this.repo.setSharedByOwner(id, user.id, !provider.isShared);
    if (!updated) throw new NotFoundException('Provider not found');
    return this.sanitize(updated);
  }

  async setSystemProvider(id: number, user: RequestUser): Promise<EmailProviderResponse> {
    if (!user.isSuperuser) throw new ForbiddenException('Only superusers can configure the system mail provider');
    await this.getOwnedOrShared(id, user);
    const updated = await this.repo.setSystemProvider(id);
    if (!updated) throw new NotFoundException('Provider not found');
    return this.sanitize(updated);
  }

  async clearSystemProvider(user: RequestUser) {
    if (!user.isSuperuser) throw new ForbiddenException('Only superusers can configure the system mail provider');
    await this.repo.clearSystemProvider();
  }

  async testConnection(id: number, user: RequestUser): Promise<EmailTestResult> {
    const provider = await this.getOwnedOrShared(id, user);
    const password = provider.passwordEnc ? this.encryption.decrypt(provider.passwordEnc) : undefined;

    const transporter = this.transport.buildTransporter({
      host: provider.host,
      port: provider.port,
      username: provider.username,
      password: password ?? null,
      auth: provider.auth,
      ssl: provider.ssl,
      startTls: provider.startTls,
      tlsRejectUnauthorized: provider.tlsRejectUnauthorized,
    });

    let result: EmailTestResult;
    try {
      await this.transport.verifyTransporter(transporter);
      result = { success: true };
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    await this.repo.recordTestResult(id, result.success, result.error ? result.error.slice(0, 1000) : null);
    return result;
  }

  async getProviderWithDecryptedPassword(id: number, user: RequestUser): Promise<EmailProvider & { plainPassword: string | null }> {
    const provider = await this.getOwnedOrShared(id, user);
    const plainPassword = provider.passwordEnc ? this.encryption.decrypt(provider.passwordEnc) : null;
    return { ...provider, plainPassword };
  }

  async getSharedDefaultWithDecryptedPassword(): Promise<(EmailProvider & { plainPassword: string | null }) | null> {
    const [provider] = await this.repo.findSharedDefault();
    if (!provider) return null;
    const plainPassword = provider.passwordEnc ? this.encryption.decrypt(provider.passwordEnc) : null;
    return { ...provider, plainPassword };
  }

  private async getOwned(id: number, user: RequestUser): Promise<EmailProvider> {
    const [provider] = await this.repo.findById(id);
    if (!provider) throw new NotFoundException('Provider not found');
    if (provider.userId !== user.id) throw new ForbiddenException('Cannot modify this provider');
    return provider;
  }

  private async getOwnedOrShared(id: number, user: RequestUser): Promise<EmailProvider> {
    const [provider] = await this.repo.findById(id);
    if (!provider) throw new NotFoundException('Provider not found');
    if (provider.userId !== user.id && !provider.isShared) {
      throw new ForbiddenException('No access to this provider');
    }
    return provider;
  }

  private sanitize(provider: EmailProvider): EmailProviderResponse {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordEnc, ...rest } = provider;
    return { ...rest, hasPassword: !!provider.passwordEnc };
  }
}
