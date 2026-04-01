import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { emailProviders } from '../../db/schema';
import { EmailEncryptionService } from './email-encryption.service';
import { EmailTransportService } from './email-transport.service';
import { EmailProviderRepository } from './email-provider.repository';
import { CreateEmailProviderDto } from './dto/create-email-provider.dto';
import { UpdateEmailProviderDto } from './dto/update-email-provider.dto';
import type { EmailProvider } from '../../db/schema';

@Injectable()
export class EmailProviderService {
  constructor(
    private readonly repo: EmailProviderRepository,
    private readonly encryption: EmailEncryptionService,
    private readonly transport: EmailTransportService,
  ) {}

  async findAll(user: RequestUser) {
    const rows = await this.repo.findAllForUser(user.id);
    return rows.map((p) => this.sanitize(p));
  }

  async findOne(id: number, user: RequestUser) {
    const provider = await this.getOwnedOrShared(id, user);
    return this.sanitize(provider);
  }

  async create(dto: CreateEmailProviderDto, user: RequestUser) {
    const passwordEnc = dto.password ? this.encryption.encrypt(dto.password) : null;
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
    });
    return this.sanitize(created);
  }

  async update(id: number, dto: UpdateEmailProviderDto, user: RequestUser) {
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
    if (dto.password !== undefined) {
      patch.passwordEnc = dto.password ? this.encryption.encrypt(dto.password) : null;
    }

    const [updated] = await this.repo.update(id, user.id, patch);
    if (!updated) throw new NotFoundException('Provider not found');
    return this.sanitize(updated);
  }

  async remove(id: number, user: RequestUser) {
    const provider = await this.getOwned(id, user);
    if (provider.isSystemProvider) {
      throw new BadRequestException('Cannot delete the system mail provider. Remove the system designation first.');
    }
    await this.repo.delete(id, user.id);
  }

  async setDefault(id: number, user: RequestUser) {
    await this.getOwned(id, user);
    await this.repo.clearDefault(user.id);
    const [updated] = await this.repo.setDefault(id, user.id);
    if (!updated) throw new NotFoundException('Provider not found');
    return this.sanitize(updated);
  }

  async toggleShared(id: number, user: RequestUser) {
    if (!user.isSuperuser) throw new ForbiddenException('Only superusers can share providers');
    const provider = await this.getOwned(id, user);
    const [updated] = await this.repo.setSharedByOwner(id, user.id, !provider.isShared);
    if (!updated) throw new NotFoundException('Provider not found');
    return this.sanitize(updated);
  }

  async setSystemProvider(id: number, user: RequestUser) {
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

  async testConnection(id: number, user: RequestUser): Promise<{ success: boolean; error?: string }> {
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
    });

    try {
      await this.transport.verifyTransporter(transporter);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async getProviderWithDecryptedPassword(id: number, user: RequestUser): Promise<EmailProvider & { plainPassword: string | null }> {
    const provider = await this.getOwnedOrShared(id, user);
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

  private sanitize(provider: EmailProvider) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordEnc, ...rest } = provider;
    return { ...rest, hasPassword: !!provider.passwordEnc };
  }
}
