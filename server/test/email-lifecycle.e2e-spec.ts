import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import { desc, eq } from 'drizzle-orm';
import { Permission } from '@projectx/types';

import * as schema from '../src/db/schema';
import { createEpubFixture } from './e2e/email/email-fixture-builder';
import {
  authHeader,
  closeEmailE2EContext,
  createEmailE2EContext,
  createLibraryWithFolder,
  createUserAndLogin,
  extractSmtpHeader,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  resetEmailModuleState,
  seedBookMetadataContext,
  triggerAndWaitForLibraryScan,
  waitForCondition,
  type EmailE2EContext,
  type LocatedBookFile,
  type TestUserSession,
} from './e2e/email/email-harness';

interface ScenarioRunResult {
  id: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
}

function buildProviderPayload(
  ctx: EmailE2EContext,
  namePrefix: string,
  overrides: Partial<{
    host: string;
    port: number;
    auth: boolean;
    ssl: boolean;
    startTls: boolean;
    username: string;
    password: string;
    fromName: string;
    fromAddress: string;
  }> = {},
) {
  return {
    name: `${namePrefix}-${randomUUID().slice(0, 8)}`,
    host: overrides.host ?? ctx.smtpSink.getHost(),
    port: overrides.port ?? ctx.smtpSink.getPort(),
    auth: overrides.auth ?? false,
    ssl: overrides.ssl ?? false,
    startTls: overrides.startTls ?? false,
    ...(overrides.username !== undefined ? { username: overrides.username } : {}),
    ...(overrides.password !== undefined ? { password: overrides.password } : {}),
    ...(overrides.fromName !== undefined ? { fromName: overrides.fromName } : {}),
    ...(overrides.fromAddress !== undefined ? { fromAddress: overrides.fromAddress } : {}),
  };
}

async function writeScenarioReport(results: ScenarioRunResult[]): Promise<void> {
  const reportDir = process.env.JUNIT_OUTPUT ? dirname(process.env.JUNIT_OUTPUT) : join(process.cwd(), '..', 'test-results', 'server');
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, 'email-lifecycle-e2e-scenarios.json');
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: results.length,
        passed: results.filter((result) => result.status === 'passed').length,
        failed: results.filter((result) => result.status === 'failed').length,
        results,
      },
      null,
      2,
    ),
  );
}

describe('Email lifecycle (e2e)', { timeout: 180_000 }, () => {
  let ctx!: EmailE2EContext;
  const scenarioResults: ScenarioRunResult[] = [];
  let scenarioStartedAt = 0;

  let superManager!: TestUserSession;
  let managerOnly!: TestUserSession;
  let senderOnly!: TestUserSession;
  let senderNoLibrary!: TestUserSession;
  let emaillessUser!: TestUserSession;
  let foreignSender!: TestUserSession;

  let book!: LocatedBookFile;

  async function apiAs(user: TestUserSession, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
    return ctx.app.inject({
      method,
      url,
      headers: authHeader(user.accessToken),
      ...(payload === undefined ? {} : { payload }),
    });
  }

  function expectError(response: Awaited<ReturnType<EmailE2EContext['app']['inject']>>, statusCode: number, messageIncludes?: string): void {
    expect(response.statusCode).toBe(statusCode);
    if (!messageIncludes) return;
    const body = response.json() as { message?: string };
    expect(body.message ?? '').toContain(messageIncludes);
  }

  async function latestLogForUser(userId: number): Promise<typeof schema.emailSendLog.$inferSelect | null> {
    const [entry] = await ctx.db
      .select()
      .from(schema.emailSendLog)
      .where(eq(schema.emailSendLog.userId, userId))
      .orderBy(desc(schema.emailSendLog.id))
      .limit(1);
    return entry ?? null;
  }

  async function waitForLog(
    id: number,
    predicate: (entry: typeof schema.emailSendLog.$inferSelect) => boolean,
    timeoutMs = 12_000,
  ): Promise<typeof schema.emailSendLog.$inferSelect> {
    let entry: typeof schema.emailSendLog.$inferSelect | null = null;

    await waitForCondition(async () => {
      const [row] = await ctx.db.select().from(schema.emailSendLog).where(eq(schema.emailSendLog.id, id)).limit(1);
      if (!row) throw new Error(`Log ${id} not found`);
      if (!predicate(row)) throw new Error(`Log ${id} has unexpected state: status=${row.status} attemptCount=${row.attemptCount}`);
      entry = row;
    }, timeoutMs);

    if (!entry) {
      throw new Error(`Log ${id} not found after wait`);
    }

    return entry;
  }

  beforeAll(async () => {
    ctx = await createEmailE2EContext();
    superManager = ctx.admin;

    const library = await createLibraryWithFolder(ctx, { name: `email-lifecycle-library-${randomUUID()}` });
    const bookAbsolutePath = await createEpubFixture(library.folderPath, 'email-lifecycle.epub', {
      title: 'Email Lifecycle Book',
    });

    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    book = await locateBookByAbsolutePath(ctx, bookAbsolutePath);
    await seedBookMetadataContext(ctx, {
      bookId: book.bookId,
      title: 'Email Lifecycle Book',
      seriesName: 'Email Series',
      seriesIndex: 3,
      authorNames: ['Email Author One', 'Email Author Two'],
      tagNames: ['tag-alpha'],
    });

    managerOnly = await createUserAndLogin(ctx, { permissions: [Permission.ManageEmail] });
    senderOnly = await createUserAndLogin(ctx, { permissions: [Permission.EmailSend] });
    senderNoLibrary = await createUserAndLogin(ctx, { permissions: [Permission.EmailSend] });
    emaillessUser = await createUserAndLogin(ctx);
    foreignSender = await createUserAndLogin(ctx, { permissions: [Permission.EmailSend] });

    await grantLibraryAccess(ctx, senderOnly.userId, library.libraryId, 'viewer');
    await grantLibraryAccess(ctx, foreignSender.userId, library.libraryId, 'viewer');
  }, 180_000);

  beforeEach(async () => {
    scenarioStartedAt = Date.now();
    await resetEmailModuleState(ctx);
  });

  afterEach((taskContext) => {
    const result = taskContext.task.result;
    if (!result) return;

    const status = result.state === 'pass' ? 'passed' : 'failed';
    const error = result.errors?.[0]?.message;
    scenarioResults.push({
      id: taskContext.task.name,
      status,
      durationMs: Math.max(0, Date.now() - scenarioStartedAt),
      ...(error ? { error } : {}),
    });
  });

  afterAll(async () => {
    await writeScenarioReport(scenarioResults);
    if (ctx) {
      await closeEmailE2EContext(ctx);
    }
  });

  describe('providers lifecycle and policy gates', () => {
    it('enforces permission boundaries, share/system rules, and delete invariants', async () => {
      const createResponse = await apiAs(managerOnly, 'POST', '/api/v1/email/providers', buildProviderPayload(ctx, 'manager-provider'));
      expect(createResponse.statusCode).toBe(201);
      const createdProvider = createResponse.json() as { id: number; name: string; hasPassword: boolean; isShared: boolean };
      expect(createdProvider).toEqual(expect.objectContaining({ hasPassword: false, isShared: false }));

      const managerListResponse = await apiAs(managerOnly, 'GET', '/api/v1/email/providers');
      expectError(managerListResponse, 403, Permission.EmailSend);

      const senderCreateResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/providers', buildProviderPayload(ctx, 'sender-provider'));
      expectError(senderCreateResponse, 403, Permission.ManageEmail);

      const senderListBeforeShare = await apiAs(senderOnly, 'GET', '/api/v1/email/providers');
      expect(senderListBeforeShare.statusCode).toBe(200);
      expect(senderListBeforeShare.json()).toEqual([]);

      const managerToggleShare = await apiAs(managerOnly, 'PATCH', `/api/v1/email/providers/${createdProvider.id}/share`);
      expectError(managerToggleShare, 403, 'Only superusers can share providers');

      const superToggleShare = await apiAs(superManager, 'PATCH', `/api/v1/email/providers/${createdProvider.id}/share`);
      expectError(superToggleShare, 403, 'Cannot modify this provider');

      const superOwnedProviderResponse = await apiAs(
        superManager,
        'POST',
        '/api/v1/email/providers',
        buildProviderPayload(ctx, 'super-owned-provider'),
      );
      expect(superOwnedProviderResponse.statusCode).toBe(201);
      const superOwnedProvider = superOwnedProviderResponse.json() as { id: number };

      const superOwnedShare = await apiAs(superManager, 'PATCH', `/api/v1/email/providers/${superOwnedProvider.id}/share`);
      expect(superOwnedShare.statusCode).toBe(200);
      expect((superOwnedShare.json() as { isShared: boolean }).isShared).toBe(true);

      const senderListAfterShare = await apiAs(senderOnly, 'GET', '/api/v1/email/providers');
      expect(senderListAfterShare.statusCode).toBe(200);
      expect(senderListAfterShare.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: superOwnedProvider.id, isShared: true })]));

      const managerSetSystem = await apiAs(managerOnly, 'PATCH', `/api/v1/email/providers/${superOwnedProvider.id}/system`);
      expectError(managerSetSystem, 403, 'Only superusers can configure the system mail provider');

      const superSetSystem = await apiAs(superManager, 'PATCH', `/api/v1/email/providers/${superOwnedProvider.id}/system`);
      expect(superSetSystem.statusCode).toBe(200);
      expect((superSetSystem.json() as { isSystemProvider: boolean }).isSystemProvider).toBe(true);

      const deleteSystemProvider = await apiAs(superManager, 'DELETE', `/api/v1/email/providers/${superOwnedProvider.id}`);
      expectError(deleteSystemProvider, 400, 'Cannot delete the system mail provider');

      const clearSystemResponse = await apiAs(superManager, 'DELETE', '/api/v1/email/providers/system');
      expect(clearSystemResponse.statusCode).toBe(204);

      const deleteSuperProvider = await apiAs(superManager, 'DELETE', `/api/v1/email/providers/${superOwnedProvider.id}`);
      expect(deleteSuperProvider.statusCode).toBe(204);

      const deleteResponse = await apiAs(managerOnly, 'DELETE', `/api/v1/email/providers/${createdProvider.id}`);
      expect(deleteResponse.statusCode).toBe(204);
    });

    it('returns connection test contract for both success and failure', async () => {
      const validProviderResponse = await apiAs(managerOnly, 'POST', '/api/v1/email/providers', buildProviderPayload(ctx, 'smtp-valid-connection'));
      expect(validProviderResponse.statusCode).toBe(201);
      const validProvider = validProviderResponse.json() as { id: number };

      const validTestResponse = await apiAs(managerOnly, 'POST', `/api/v1/email/providers/${validProvider.id}/test`);
      expect(validTestResponse.statusCode).toBe(200);
      expect(validTestResponse.json()).toEqual({ success: true });

      const invalidProviderResponse = await apiAs(
        managerOnly,
        'POST',
        '/api/v1/email/providers',
        buildProviderPayload(ctx, 'smtp-invalid-connection', {
          host: '127.0.0.1',
          port: 1,
        }),
      );
      expect(invalidProviderResponse.statusCode).toBe(201);
      const invalidProvider = invalidProviderResponse.json() as { id: number };

      const invalidTestResponse = await apiAs(managerOnly, 'POST', `/api/v1/email/providers/${invalidProvider.id}/test`);
      expect(invalidTestResponse.statusCode).toBe(200);
      expect(invalidTestResponse.json()).toEqual(expect.objectContaining({ success: false, error: expect.any(String) }));
    });
  });

  describe('templates lifecycle, defaults, and preview contract', () => {
    it('enforces role-gating and system-template update restrictions', async () => {
      const senderListResponse = await apiAs(senderOnly, 'GET', '/api/v1/email/templates');
      expect(senderListResponse.statusCode).toBe(200);
      const senderTemplates = senderListResponse.json() as Array<{ id: number; isSystem: boolean }>;
      const systemTemplate = senderTemplates.find((template) => template.isSystem);
      expect(systemTemplate).toBeDefined();

      const managerListResponse = await apiAs(managerOnly, 'GET', '/api/v1/email/templates');
      expectError(managerListResponse, 403, Permission.EmailSend);

      const senderSystemUpdate = await apiAs(senderOnly, 'PUT', `/api/v1/email/templates/${systemTemplate!.id}`, {
        subject: 'sender-cannot-update-system-template',
      });
      expectError(senderSystemUpdate, 403, 'Only administrators can modify system templates');

      const superSystemUpdate = await apiAs(superManager, 'PUT', `/api/v1/email/templates/${systemTemplate!.id}`, {
        subject: `System subject ${randomUUID().slice(0, 8)}`,
      });
      expect(superSystemUpdate.statusCode).toBe(200);
      expect((superSystemUpdate.json() as { id: number }).id).toBe(systemTemplate!.id);
    });

    it('renders template preview with backward-compatible aliases and /api/v1 coverUrl', async () => {
      const createTemplateResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/templates', {
        name: `preview-template-${randomUUID().slice(0, 8)}`,
        subject: '{{title}}|{{authors}}|{{author}}|{{seriesName}}|{{series}}',
        bodyText: 'cover={{coverUrl}}',
      });
      expect(createTemplateResponse.statusCode).toBe(201);
      const template = createTemplateResponse.json() as { id: number };

      const previewResponse = await apiAs(senderOnly, 'POST', `/api/v1/email/templates/${template.id}/preview`, {
        bookId: book.bookId,
      });
      expect(previewResponse.statusCode).toBe(200);
      expect(previewResponse.json()).toEqual({
        subject: 'Email Lifecycle Book|Email Author One, Email Author Two|Email Author One, Email Author Two|Email Series|Email Series',
        bodyText: `cover=http://localhost:4173/api/v1/books/${book.bookId}/cover`,
      });

      const inaccessibleTemplateResponse = await apiAs(senderNoLibrary, 'POST', '/api/v1/email/templates', {
        name: `inaccessible-preview-template-${randomUUID().slice(0, 8)}`,
        subject: 'x',
        bodyText: 'x',
      });
      expect(inaccessibleTemplateResponse.statusCode).toBe(201);
      const inaccessibleTemplate = inaccessibleTemplateResponse.json() as { id: number };

      const inaccessiblePreviewResponse = await apiAs(senderNoLibrary, 'POST', `/api/v1/email/templates/${inaccessibleTemplate.id}/preview`, {
        bookId: book.bookId,
      });
      expectError(inaccessiblePreviewResponse, 403, 'No access to this library');
    });

    it('maps duplicate template names to 409 conflicts', async () => {
      const name = `duplicate-template-${randomUUID().slice(0, 8)}`;
      const firstCreate = await apiAs(senderOnly, 'POST', '/api/v1/email/templates', {
        name,
        subject: 'First subject',
        bodyText: 'Body',
      });
      expect(firstCreate.statusCode).toBe(201);

      const duplicateCreate = await apiAs(senderOnly, 'POST', '/api/v1/email/templates', {
        name,
        subject: 'Second subject',
        bodyText: 'Body',
      });
      expectError(duplicateCreate, 409, 'already exists');
    });
  });

  describe('recipients/groups/preferences ownership and conflicts', () => {
    it('enforces recipient ownership and duplicate-email conflicts', async () => {
      const recipientResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/recipients', {
        name: 'Sender Kindle',
        email: 'kindle+sender@example.com',
        deviceType: 'kindle',
        preferredFormat: 'epub',
      });
      expect(recipientResponse.statusCode).toBe(201);
      const recipient = recipientResponse.json() as { id: number; isDefault: boolean };
      expect(recipient.isDefault).toBe(false);

      const setDefaultResponse = await apiAs(senderOnly, 'PATCH', `/api/v1/email/recipients/${recipient.id}/default`);
      expect(setDefaultResponse.statusCode).toBe(200);
      expect((setDefaultResponse.json() as { isDefault: boolean }).isDefault).toBe(true);

      const foreignReadResponse = await apiAs(foreignSender, 'GET', `/api/v1/email/recipients/${recipient.id}`);
      expectError(foreignReadResponse, 403, 'Cannot modify this recipient');

      const duplicateRecipientResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/recipients', {
        name: 'Duplicate Sender Kindle',
        email: 'kindle+sender@example.com',
      });
      expectError(duplicateRecipientResponse, 409, 'already exists');

      const emaillessCreateResponse = await apiAs(emaillessUser, 'POST', '/api/v1/email/recipients', {
        name: 'No Permission',
        email: 'no-permission@example.com',
      });
      expectError(emaillessCreateResponse, 403, Permission.EmailSend);
    });

    it('enforces group ownership checks and duplicate-name conflicts', async () => {
      const senderRecipientResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/recipients', {
        name: 'Sender Group Member',
        email: 'group-member@example.com',
      });
      expect(senderRecipientResponse.statusCode).toBe(201);
      const senderRecipient = senderRecipientResponse.json() as { id: number };

      const foreignRecipientResponse = await apiAs(foreignSender, 'POST', '/api/v1/email/recipients', {
        name: 'Foreign Group Member',
        email: 'foreign-group-member@example.com',
      });
      expect(foreignRecipientResponse.statusCode).toBe(201);
      const foreignRecipient = foreignRecipientResponse.json() as { id: number };

      const groupResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/recipient-groups', {
        name: `kindle-group-${randomUUID().slice(0, 8)}`,
      });
      expect(groupResponse.statusCode).toBe(201);
      const group = groupResponse.json() as { id: number; name: string };

      const duplicateGroupResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/recipient-groups', {
        name: group.name,
      });
      expectError(duplicateGroupResponse, 409, 'already exists');

      const addMemberResponse = await apiAs(senderOnly, 'POST', `/api/v1/email/recipient-groups/${group.id}/members`, {
        recipientId: senderRecipient.id,
      });
      expect(addMemberResponse.statusCode).toBe(201);
      expect((addMemberResponse.json() as { members: Array<{ id: number }> }).members).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: senderRecipient.id })]),
      );

      const addForeignMemberResponse = await apiAs(senderOnly, 'POST', `/api/v1/email/recipient-groups/${group.id}/members`, {
        recipientId: foreignRecipient.id,
      });
      expectError(addForeignMemberResponse, 403, 'Cannot add a recipient you do not own');

      const removeMemberResponse = await apiAs(senderOnly, 'DELETE', `/api/v1/email/recipient-groups/${group.id}/members/${senderRecipient.id}`);
      expect(removeMemberResponse.statusCode).toBe(204);
    });

    it('validates preferences cross-references against accessible resources', async () => {
      const privateProviderResponse = await apiAs(managerOnly, 'POST', '/api/v1/email/providers', buildProviderPayload(ctx, 'private-provider'));
      expect(privateProviderResponse.statusCode).toBe(201);
      const privateProvider = privateProviderResponse.json() as { id: number };

      const sharedProviderResponse = await apiAs(superManager, 'POST', '/api/v1/email/providers', buildProviderPayload(ctx, 'shared-provider'));
      expect(sharedProviderResponse.statusCode).toBe(201);
      const sharedProvider = sharedProviderResponse.json() as { id: number };
      const shareResponse = await apiAs(superManager, 'PATCH', `/api/v1/email/providers/${sharedProvider.id}/share`);
      expect(shareResponse.statusCode).toBe(200);

      const recipientResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/recipients', {
        name: 'Pref Recipient',
        email: 'prefs-recipient@example.com',
      });
      expect(recipientResponse.statusCode).toBe(201);
      const recipient = recipientResponse.json() as { id: number };

      const templateResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/templates', {
        name: `prefs-template-${randomUUID().slice(0, 8)}`,
        subject: 'Prefs {{title}}',
        bodyText: 'Body',
      });
      expect(templateResponse.statusCode).toBe(201);
      const template = templateResponse.json() as { id: number };

      const foreignRecipientResponse = await apiAs(foreignSender, 'POST', '/api/v1/email/recipients', {
        name: 'Foreign Pref Recipient',
        email: 'foreign-pref-recipient@example.com',
      });
      expect(foreignRecipientResponse.statusCode).toBe(201);
      const foreignRecipient = foreignRecipientResponse.json() as { id: number };

      const foreignTemplateResponse = await apiAs(foreignSender, 'POST', '/api/v1/email/templates', {
        name: `foreign-pref-template-${randomUUID().slice(0, 8)}`,
        subject: 'Foreign {{title}}',
        bodyText: 'Body',
      });
      expect(foreignTemplateResponse.statusCode).toBe(201);
      const foreignTemplate = foreignTemplateResponse.json() as { id: number };

      const validPreferencesResponse = await apiAs(senderOnly, 'PUT', '/api/v1/email/preferences', {
        defaultProviderId: sharedProvider.id,
        defaultRecipientId: recipient.id,
        defaultTemplateId: template.id,
      });
      expect(validPreferencesResponse.statusCode).toBe(200);
      expect(validPreferencesResponse.json()).toEqual({
        id: expect.any(Number),
        userId: senderOnly.userId,
        defaultProviderId: sharedProvider.id,
        defaultRecipientId: recipient.id,
        defaultTemplateId: template.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      const privateProviderPreferenceResponse = await apiAs(senderOnly, 'PUT', '/api/v1/email/preferences', {
        defaultProviderId: privateProvider.id,
      });
      expectError(privateProviderPreferenceResponse, 403, 'No access to this provider');

      const foreignRecipientPreferenceResponse = await apiAs(senderOnly, 'PUT', '/api/v1/email/preferences', {
        defaultRecipientId: foreignRecipient.id,
      });
      expectError(foreignRecipientPreferenceResponse, 403, 'Cannot modify this recipient');

      const foreignTemplatePreferenceResponse = await apiAs(senderOnly, 'PUT', '/api/v1/email/preferences', {
        defaultTemplateId: foreignTemplate.id,
      });
      expectError(foreignTemplatePreferenceResponse, 403, 'No access to this template');

      const recipientWithForeignTemplate = await apiAs(senderOnly, 'POST', '/api/v1/email/recipients', {
        name: 'Recipient With Foreign Template',
        email: 'recipient-with-foreign-template@example.com',
        defaultTemplateId: foreignTemplate.id,
      });
      expectError(recipientWithForeignTemplate, 403, 'No access to this template');

      const groupWithForeignTemplate = await apiAs(senderOnly, 'POST', '/api/v1/email/recipient-groups', {
        name: `foreign-template-group-${randomUUID().slice(0, 8)}`,
        defaultTemplateId: foreignTemplate.id,
      });
      expectError(groupWithForeignTemplate, 403, 'No access to this template');
    });
  });

  describe('send + quick-send + log + resend flow integrity', () => {
    it('uses explicit templateId over recipient default and applies provider from fields', async () => {
      const providerCreateResponse = await apiAs(superManager, 'POST', '/api/v1/email/providers', {
        ...buildProviderPayload(ctx, 'sender-provider'),
        fromName: 'ProjectX Bot',
        fromAddress: 'bot@example.com',
      });
      expect(providerCreateResponse.statusCode).toBe(201);
      const provider = providerCreateResponse.json() as { id: number };
      const shareResponse = await apiAs(superManager, 'PATCH', `/api/v1/email/providers/${provider.id}/share`);
      expect(shareResponse.statusCode).toBe(200);

      const defaultTemplateResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/templates', {
        name: `recipient-default-${randomUUID().slice(0, 8)}`,
        subject: 'Recipient {{title}}',
        bodyText: 'Recipient body',
      });
      expect(defaultTemplateResponse.statusCode).toBe(201);
      const defaultTemplate = defaultTemplateResponse.json() as { id: number };

      const overrideTemplateResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/templates', {
        name: `override-template-${randomUUID().slice(0, 8)}`,
        subject: 'Override {{title}}',
        bodyText: 'Override body',
      });
      expect(overrideTemplateResponse.statusCode).toBe(201);
      const overrideTemplate = overrideTemplateResponse.json() as { id: number };

      const recipientResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/recipients', {
        name: 'Send Recipient',
        email: 'send-recipient@example.com',
        defaultTemplateId: defaultTemplate.id,
      });
      expect(recipientResponse.statusCode).toBe(201);
      const recipient = recipientResponse.json() as { id: number };

      const sendResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/send', {
        bookIds: [book.bookId],
        recipientIds: [recipient.id],
        providerId: provider.id,
        templateId: overrideTemplate.id,
      });
      expect(sendResponse.statusCode).toBe(202);
      expect(sendResponse.json()).toEqual({ queued: 1 });

      await ctx.smtpSink.waitForMessages(1);
      const firstLog = await latestLogForUser(senderOnly.userId);
      if (!firstLog) {
        throw new Error('Missing send log entry for sender');
      }
      await waitForLog(firstLog.id, (entry) => entry.status === 'sent');

      const [captured] = ctx.smtpSink.getMessages();
      const fromHeader = extractSmtpHeader(captured.raw, 'from');
      const subjectHeader = extractSmtpHeader(captured.raw, 'subject');
      expect(fromHeader).toContain('ProjectX Bot <bot@example.com>');
      expect(subjectHeader).toBe('Override Email Lifecycle Book');
      expect(subjectHeader).not.toContain('Recipient');

      const missingTemplateSendResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/send', {
        bookIds: [book.bookId],
        recipientIds: [recipient.id],
        providerId: provider.id,
        templateId: 999_999_999,
      });
      expectError(missingTemplateSendResponse, 404, 'Template not found');
    });

    it('keeps group defaultTemplateId non-operational in send resolution', async () => {
      const providerCreateResponse = await apiAs(
        superManager,
        'POST',
        '/api/v1/email/providers',
        buildProviderPayload(ctx, 'group-template-provider'),
      );
      expect(providerCreateResponse.statusCode).toBe(201);
      const provider = providerCreateResponse.json() as { id: number };
      const shareResponse = await apiAs(superManager, 'PATCH', `/api/v1/email/providers/${provider.id}/share`);
      expect(shareResponse.statusCode).toBe(200);

      const prefsTemplateResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/templates', {
        name: `prefs-template-${randomUUID().slice(0, 8)}`,
        subject: 'Prefs {{title}}',
        bodyText: 'Prefs body',
      });
      expect(prefsTemplateResponse.statusCode).toBe(201);
      const prefsTemplate = prefsTemplateResponse.json() as { id: number };

      const groupTemplateResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/templates', {
        name: `group-template-${randomUUID().slice(0, 8)}`,
        subject: 'Group {{title}}',
        bodyText: 'Group body',
      });
      expect(groupTemplateResponse.statusCode).toBe(201);
      const groupTemplate = groupTemplateResponse.json() as { id: number };

      const recipientResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/recipients', {
        name: 'Group Recipient',
        email: 'group-recipient@example.com',
      });
      expect(recipientResponse.statusCode).toBe(201);
      const recipient = recipientResponse.json() as { id: number };

      const groupResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/recipient-groups', {
        name: `group-${randomUUID().slice(0, 8)}`,
        defaultTemplateId: groupTemplate.id,
      });
      expect(groupResponse.statusCode).toBe(201);
      const group = groupResponse.json() as { id: number };

      const addMemberResponse = await apiAs(senderOnly, 'POST', `/api/v1/email/recipient-groups/${group.id}/members`, {
        recipientId: recipient.id,
      });
      expect(addMemberResponse.statusCode).toBe(201);

      const preferencesResponse = await apiAs(senderOnly, 'PUT', '/api/v1/email/preferences', {
        defaultProviderId: provider.id,
        defaultTemplateId: prefsTemplate.id,
      });
      expect(preferencesResponse.statusCode).toBe(200);

      const sendResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/send', {
        bookIds: [book.bookId],
        groupIds: [group.id],
        providerId: provider.id,
      });
      expect(sendResponse.statusCode).toBe(202);
      expect(sendResponse.json()).toEqual({ queued: 1 });

      await ctx.smtpSink.waitForMessages(1);
      const [captured] = ctx.smtpSink.getMessages();
      const subjectHeader = extractSmtpHeader(captured.raw, 'subject');
      expect(subjectHeader).toBe('Prefs Email Lifecycle Book');
    });

    it('enforces quick-send defaults and library-access boundaries', async () => {
      const providerCreateResponse = await apiAs(superManager, 'POST', '/api/v1/email/providers', buildProviderPayload(ctx, 'quick-send-provider'));
      expect(providerCreateResponse.statusCode).toBe(201);
      const provider = providerCreateResponse.json() as { id: number };
      const shareResponse = await apiAs(superManager, 'PATCH', `/api/v1/email/providers/${provider.id}/share`);
      expect(shareResponse.statusCode).toBe(200);

      const recipientResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/recipients', {
        name: 'Quick Recipient',
        email: 'quick-recipient@example.com',
      });
      expect(recipientResponse.statusCode).toBe(201);
      const recipient = recipientResponse.json() as { id: number };

      const preferenceResponse = await apiAs(senderOnly, 'PUT', '/api/v1/email/preferences', {
        defaultProviderId: provider.id,
        defaultRecipientId: recipient.id,
      });
      expect(preferenceResponse.statusCode).toBe(200);

      const quickSendResponse = await apiAs(senderOnly, 'POST', `/api/v1/email/send/quick/${book.bookId}`);
      expect(quickSendResponse.statusCode).toBe(202);
      expect(quickSendResponse.json()).toEqual({ queued: 1 });
      await ctx.smtpSink.waitForMessages(1);

      const noLibraryQuickSend = await apiAs(senderNoLibrary, 'POST', `/api/v1/email/send/quick/${book.bookId}`);
      expectError(noLibraryQuickSend, 403, 'No access to this library');

      const noDefaultQuickSend = await apiAs(foreignSender, 'POST', `/api/v1/email/send/quick/${book.bookId}`);
      expectError(noDefaultQuickSend, 400, 'No default recipient configured');
    });

    it('keeps user log scoped and supports failure-first then successful resend', async () => {
      const failingProviderResponse = await apiAs(superManager, 'POST', '/api/v1/email/providers', {
        ...buildProviderPayload(ctx, 'failing-provider'),
        host: '127.0.0.1',
        port: 1,
      });
      expect(failingProviderResponse.statusCode).toBe(201);
      const failingProvider = failingProviderResponse.json() as { id: number };
      const shareResponse = await apiAs(superManager, 'PATCH', `/api/v1/email/providers/${failingProvider.id}/share`);
      expect(shareResponse.statusCode).toBe(200);

      const recipientResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/recipients', {
        name: 'Retry Recipient',
        email: 'retry-recipient@example.com',
      });
      expect(recipientResponse.statusCode).toBe(201);
      const recipient = recipientResponse.json() as { id: number };

      const sendResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/send', {
        bookIds: [book.bookId],
        recipientIds: [recipient.id],
        providerId: failingProvider.id,
      });
      expect(sendResponse.statusCode).toBe(202);
      expect(sendResponse.json()).toEqual({ queued: 1 });

      let failedLogId = 0;
      await waitForCondition(async () => {
        const latest = await latestLogForUser(senderOnly.userId);
        if (!latest) throw new Error('Missing sender log');
        if (latest.attemptCount < 1 || latest.errorMessage === null) {
          throw new Error(`Expected first-attempt failure, got attemptCount=${latest.attemptCount} error=${latest.errorMessage ?? 'null'}`);
        }
        failedLogId = latest.id;
      }, 12_000);

      const foreignLogList = await apiAs(foreignSender, 'GET', '/api/v1/email/log?page=0&size=20');
      expect(foreignLogList.statusCode).toBe(200);
      expect(foreignLogList.json()).toEqual([]);

      const foreignDelete = await apiAs(foreignSender, 'DELETE', `/api/v1/email/log/${failedLogId}`);
      expectError(foreignDelete, 403, 'No access to this log entry');

      const foreignResend = await apiAs(foreignSender, 'POST', `/api/v1/email/log/${failedLogId}/resend`);
      expectError(foreignResend, 403, 'No access to this log entry');

      const repairProvider = await apiAs(superManager, 'PUT', `/api/v1/email/providers/${failingProvider.id}`, {
        host: ctx.smtpSink.getHost(),
        port: ctx.smtpSink.getPort(),
        auth: false,
        ssl: false,
        startTls: false,
      });
      expect(repairProvider.statusCode).toBe(200);

      const resendResponse = await apiAs(senderOnly, 'POST', `/api/v1/email/log/${failedLogId}/resend`);
      expect(resendResponse.statusCode).toBe(202);
      expect(resendResponse.json()).toEqual({ queued: 1 });

      await ctx.smtpSink.waitForMessages(1);

      let resendLogId = 0;
      await waitForCondition(async () => {
        const latest = await latestLogForUser(senderOnly.userId);
        if (!latest) throw new Error('Missing latest sender log');
        if (latest.id === failedLogId) throw new Error('Resend log has not been created yet');
        if (latest.status !== 'sent') throw new Error(`Resend log not sent yet: ${latest.status}`);
        resendLogId = latest.id;
      }, 12_000);

      const senderDeleteResendLog = await apiAs(senderOnly, 'DELETE', `/api/v1/email/log/${resendLogId}`);
      expect(senderDeleteResendLog.statusCode).toBe(204);
    });
  });

  describe('admin log and superuser enforcement', () => {
    it('restricts /email/admin/log to superusers only', async () => {
      const providerCreateResponse = await apiAs(superManager, 'POST', '/api/v1/email/providers', buildProviderPayload(ctx, 'admin-log-provider'));
      expect(providerCreateResponse.statusCode).toBe(201);
      const provider = providerCreateResponse.json() as { id: number };
      const shareResponse = await apiAs(superManager, 'PATCH', `/api/v1/email/providers/${provider.id}/share`);
      expect(shareResponse.statusCode).toBe(200);

      const recipientResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/recipients', {
        name: 'Admin Log Recipient',
        email: 'admin-log-recipient@example.com',
      });
      expect(recipientResponse.statusCode).toBe(201);
      const recipient = recipientResponse.json() as { id: number };

      const sendResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/send', {
        bookIds: [book.bookId],
        recipientIds: [recipient.id],
        providerId: provider.id,
      });
      expect(sendResponse.statusCode).toBe(202);
      await ctx.smtpSink.waitForMessages(1);

      const managerAdminLogResponse = await apiAs(managerOnly, 'GET', '/api/v1/email/admin/log?page=0&size=20');
      expectError(managerAdminLogResponse, 403, 'Only superusers can view all email logs');

      const senderAdminLogResponse = await apiAs(senderOnly, 'GET', '/api/v1/email/admin/log?page=0&size=20');
      expectError(senderAdminLogResponse, 403, Permission.ManageEmail);

      const superAdminLogResponse = await apiAs(superManager, 'GET', '/api/v1/email/admin/log?page=0&size=20');
      expect(superAdminLogResponse.statusCode).toBe(200);
      const entries = superAdminLogResponse.json() as Array<{ userId: number }>;
      expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ userId: senderOnly.userId })]));
    });
  });

  describe('client contract regression checks', () => {
    it('preserves API response shapes consumed by email composables', async () => {
      const providerCreateResponse = await apiAs(superManager, 'POST', '/api/v1/email/providers', {
        ...buildProviderPayload(ctx, 'client-contract-provider'),
        fromName: 'Contract Bot',
        fromAddress: 'contract@example.com',
      });
      expect(providerCreateResponse.statusCode).toBe(201);
      const provider = providerCreateResponse.json() as { id: number };
      const shareResponse = await apiAs(superManager, 'PATCH', `/api/v1/email/providers/${provider.id}/share`);
      expect(shareResponse.statusCode).toBe(200);

      const templateCreateResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/templates', {
        name: `client-contract-template-${randomUUID().slice(0, 8)}`,
        subject: 'Client Contract {{title}}',
        bodyText: 'Client Contract Body',
      });
      expect(templateCreateResponse.statusCode).toBe(201);
      const template = templateCreateResponse.json() as { id: number };

      const recipientCreateResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/recipients', {
        name: 'Client Contract Recipient',
        email: 'client-contract-recipient@example.com',
      });
      expect(recipientCreateResponse.statusCode).toBe(201);
      const recipient = recipientCreateResponse.json() as { id: number };

      const groupCreateResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/recipient-groups', {
        name: `client-contract-group-${randomUUID().slice(0, 8)}`,
      });
      expect(groupCreateResponse.statusCode).toBe(201);
      const group = groupCreateResponse.json() as { id: number };

      const addMemberResponse = await apiAs(senderOnly, 'POST', `/api/v1/email/recipient-groups/${group.id}/members`, {
        recipientId: recipient.id,
      });
      expect(addMemberResponse.statusCode).toBe(201);

      const savePreferencesResponse = await apiAs(senderOnly, 'PUT', '/api/v1/email/preferences', {
        defaultProviderId: provider.id,
        defaultRecipientId: recipient.id,
        defaultTemplateId: template.id,
      });
      expect(savePreferencesResponse.statusCode).toBe(200);

      const providersResponse = await apiAs(senderOnly, 'GET', '/api/v1/email/providers');
      expect(providersResponse.statusCode).toBe(200);
      expect(providersResponse.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: provider.id,
            fromName: 'Contract Bot',
            fromAddress: 'contract@example.com',
            hasPassword: false,
            isShared: true,
          }),
        ]),
      );

      const templatesResponse = await apiAs(senderOnly, 'GET', '/api/v1/email/templates');
      expect(templatesResponse.statusCode).toBe(200);
      expect(templatesResponse.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: template.id,
            name: expect.any(String),
            subject: expect.any(String),
            bodyText: expect.any(String),
            isDefault: expect.any(Boolean),
            isSystem: expect.any(Boolean),
          }),
        ]),
      );

      const recipientsResponse = await apiAs(senderOnly, 'GET', '/api/v1/email/recipients');
      expect(recipientsResponse.statusCode).toBe(200);
      expect(recipientsResponse.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: recipient.id,
            name: expect.any(String),
            email: expect.any(String),
            isDefault: expect.any(Boolean),
            defaultTemplateId: null,
          }),
        ]),
      );

      const groupsResponse = await apiAs(senderOnly, 'GET', '/api/v1/email/recipient-groups');
      expect(groupsResponse.statusCode).toBe(200);
      expect(groupsResponse.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: group.id,
            name: expect.any(String),
            members: expect.arrayContaining([expect.objectContaining({ id: recipient.id })]),
          }),
        ]),
      );

      const preferencesResponse = await apiAs(senderOnly, 'GET', '/api/v1/email/preferences');
      expect(preferencesResponse.statusCode).toBe(200);
      expect(preferencesResponse.json()).toEqual(
        expect.objectContaining({
          userId: senderOnly.userId,
          defaultProviderId: provider.id,
          defaultRecipientId: recipient.id,
          defaultTemplateId: template.id,
        }),
      );

      const sendResponse = await apiAs(senderOnly, 'POST', '/api/v1/email/send', {
        bookIds: [book.bookId],
        recipientIds: [recipient.id],
        providerId: provider.id,
      });
      expect(sendResponse.statusCode).toBe(202);
      expect(sendResponse.json()).toEqual({ queued: 1 });
      await ctx.smtpSink.waitForMessages(1);

      const logResponse = await apiAs(senderOnly, 'GET', '/api/v1/email/log?page=0&size=20');
      expect(logResponse.statusCode).toBe(200);
      expect(logResponse.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(Number),
            userId: senderOnly.userId,
            toEmail: expect.any(String),
            status: expect.stringMatching(/pending|sent|failed/),
            attemptCount: expect.any(Number),
          }),
        ]),
      );
    });
  });
});
