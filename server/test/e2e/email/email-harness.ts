import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import fastifyCookie from '@fastify/cookie';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { mkdir } from 'fs/promises';
import { createServer, type Socket } from 'net';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DEFAULT_FORMAT_PRIORITY, type Permission } from '@projectx/types';

import { AppModule } from '../../../src/app.module';
import { DB } from '../../../src/db';
import * as schema from '../../../src/db/schema';
import { MetadataService } from '../../../src/modules/metadata/metadata.service';
import { BookBucketWatcherService } from '../../../src/modules/book-bucket/book-bucket-watcher.service';
import { waitForScanCompletion } from '../app-harness';
import { createEmailFixtureRoot, type EmailFixtureRoot } from './email-fixture-builder';

type Db = NodePgDatabase<typeof schema>;

const ADMIN_SETUP_DTO = {
  username: 'email-lifecycle-e2e-admin',
  name: 'Email Lifecycle E2E Admin',
  email: 'email-lifecycle-e2e-admin@example.com',
  password: 'EmailLifecycleAdmin123',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface EnvSnapshot {
  appDataPath: string | undefined;
  appUrl: string | undefined;
}

export interface TestUserSession {
  userId: number;
  username: string;
  password: string;
  accessToken: string;
}

export interface EmailE2EContext {
  app: NestFastifyApplication;
  db: Db;
  admin: TestUserSession;
  fixture: EmailFixtureRoot;
  envSnapshot: EnvSnapshot;
  smtpSink: InProcessSmtpSink;
}

export interface CreatedLibrary {
  libraryId: number;
  libraryFolderId: number;
  folderPath: string;
}

export interface LocatedBookFile {
  libraryId: number;
  bookId: number;
  bookFileId: number;
  absolutePath: string;
  relPath: string | null;
  format: string | null;
}

export interface CapturedSmtpMessage {
  envelopeFrom: string | null;
  envelopeTo: string[];
  raw: string;
}

interface SmtpSessionState {
  mode: 'command' | 'data';
  buffer: string;
  envelopeFrom: string | null;
  envelopeTo: string[];
  dataLines: string[];
}

function parseSmtpAddress(value: string): string {
  const trimmed = value.trim();
  const match = /^<(.+)>$/.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}

function normalizeLine(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

export function extractSmtpHeader(rawMessage: string, headerName: string): string | null {
  const targetHeader = headerName.toLowerCase();
  const [headerBlock] = rawMessage.split(/\r?\n\r?\n/, 1);
  if (!headerBlock) return null;

  const lines = headerBlock.split(/\r?\n/);
  let currentHeader: string | null = null;
  let currentValue = '';

  for (const rawLine of lines) {
    if (/^\s/.test(rawLine)) {
      if (currentHeader === targetHeader) {
        currentValue = `${currentValue} ${rawLine.trim()}`;
      }
      continue;
    }

    const match = /^([^:]+):\s*(.*)$/.exec(rawLine);
    if (!match) continue;

    currentHeader = match[1].trim().toLowerCase();
    currentValue = match[2].trim();

    if (currentHeader === targetHeader) {
      return currentValue;
    }
  }

  return null;
}

export class InProcessSmtpSink {
  private readonly host = '127.0.0.1';
  private readonly sockets = new Set<Socket>();
  private readonly messages: CapturedSmtpMessage[] = [];
  private readonly server = createServer((socket) => {
    this.handleConnection(socket);
  });
  private port = 0;

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off('error', onError);
        const address = this.server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('SMTP sink did not expose a TCP address'));
          return;
        }
        this.port = address.port;
        resolve();
      };

      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(0, this.host);
    });
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  clearMessages(): void {
    this.messages.splice(0, this.messages.length);
  }

  getMessages(): CapturedSmtpMessage[] {
    return [...this.messages];
  }

  getHost(): string {
    return this.host;
  }

  getPort(): number {
    if (this.port < 1) {
      throw new Error('SMTP sink is not started');
    }
    return this.port;
  }

  async waitForMessages(count: number, timeoutMs = 10_000): Promise<CapturedSmtpMessage[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.messages.length >= count) return this.getMessages();
      await sleep(50);
    }

    throw new Error(`Timed out waiting for ${count} SMTP message(s). Captured=${this.messages.length}`);
  }

  private handleConnection(socket: Socket): void {
    this.sockets.add(socket);
    socket.setEncoding('utf8');

    const state: SmtpSessionState = {
      mode: 'command',
      buffer: '',
      envelopeFrom: null,
      envelopeTo: [],
      dataLines: [],
    };

    socket.write('220 email-lifecycle-smtp-sink ESMTP\r\n');

    socket.on('data', (chunk: string) => {
      state.buffer += chunk;
      this.processBufferedInput(socket, state);
    });

    socket.on('close', () => {
      this.sockets.delete(socket);
    });

    socket.on('error', () => {
      this.sockets.delete(socket);
    });
  }

  private processBufferedInput(socket: Socket, state: SmtpSessionState): void {
    while (true) {
      const newlineIndex = state.buffer.indexOf('\n');
      if (newlineIndex < 0) return;

      const rawLine = state.buffer.slice(0, newlineIndex);
      state.buffer = state.buffer.slice(newlineIndex + 1);
      const line = normalizeLine(rawLine);

      if (state.mode === 'data') {
        this.handleDataLine(socket, state, line);
      } else {
        this.handleCommandLine(socket, state, line);
      }
    }
  }

  private handleDataLine(socket: Socket, state: SmtpSessionState, line: string): void {
    if (line === '.') {
      this.messages.push({
        envelopeFrom: state.envelopeFrom,
        envelopeTo: [...state.envelopeTo],
        raw: state.dataLines.join('\r\n'),
      });

      state.mode = 'command';
      state.envelopeFrom = null;
      state.envelopeTo = [];
      state.dataLines = [];

      socket.write('250 2.0.0 Message accepted\r\n');
      return;
    }

    state.dataLines.push(line.startsWith('..') ? line.slice(1) : line);
  }

  private handleCommandLine(socket: Socket, state: SmtpSessionState, line: string): void {
    const [commandRaw, ...rest] = line.split(' ');
    const command = commandRaw?.toUpperCase() ?? '';
    const arg = rest.join(' ').trim();

    switch (command) {
      case 'EHLO':
      case 'HELO':
        socket.write('250-email-lifecycle-smtp-sink\r\n250 PIPELINING\r\n');
        return;
      case 'MAIL':
        if (!arg.toUpperCase().startsWith('FROM:')) {
          socket.write('501 5.5.2 Syntax error in MAIL FROM\r\n');
          return;
        }
        state.envelopeFrom = parseSmtpAddress(arg.slice(5));
        state.envelopeTo = [];
        socket.write('250 2.1.0 Sender OK\r\n');
        return;
      case 'RCPT':
        if (!arg.toUpperCase().startsWith('TO:')) {
          socket.write('501 5.5.2 Syntax error in RCPT TO\r\n');
          return;
        }
        state.envelopeTo.push(parseSmtpAddress(arg.slice(3)));
        socket.write('250 2.1.5 Recipient OK\r\n');
        return;
      case 'DATA':
        state.mode = 'data';
        state.dataLines = [];
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        return;
      case 'RSET':
        state.mode = 'command';
        state.envelopeFrom = null;
        state.envelopeTo = [];
        state.dataLines = [];
        socket.write('250 2.0.0 Reset state\r\n');
        return;
      case 'NOOP':
        socket.write('250 2.0.0 OK\r\n');
        return;
      case 'QUIT':
        socket.write('221 2.0.0 Bye\r\n');
        socket.end();
        return;
      case 'STARTTLS':
        socket.write('454 4.7.0 TLS not available\r\n');
        return;
      default:
        socket.write('250 2.0.0 OK\r\n');
    }
  }
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function createEmailE2EContext(): Promise<EmailE2EContext> {
  const fixture = await createEmailFixtureRoot();
  const envSnapshot: EnvSnapshot = {
    appDataPath: process.env.APP_DATA_PATH,
    appUrl: process.env.APP_URL,
  };

  process.env.APP_DATA_PATH = fixture.booksPath;
  process.env.APP_URL = 'http://localhost:4173';

  const smtpSink = new InProcessSmtpSink();
  await smtpSink.start();

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MetadataService)
    .useValue(makeMetadataNoopMock())
    .compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.register(fastifyCookie as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  await stopBookBucketWatcher(app);

  const db = app.get<Db>(DB);
  const admin = await getAdminSession(app, db);

  return {
    app,
    db,
    admin,
    fixture,
    envSnapshot,
    smtpSink,
  };
}

export async function closeEmailE2EContext(ctx: EmailE2EContext): Promise<void> {
  await ctx.app.close();
  await ctx.smtpSink.stop();
  await ctx.fixture.cleanup();
  restoreEnv(ctx.envSnapshot);
}

export async function createLibraryWithFolder(
  ctx: EmailE2EContext,
  options: {
    mode?: 'book_per_file' | 'book_per_folder';
    allowedFormats?: string[];
    name?: string;
  } = {},
): Promise<CreatedLibrary> {
  const folderPath = `${ctx.fixture.booksPath}/library-${randomUUID()}`;
  await mkdir(folderPath, { recursive: true });

  const [library] = await ctx.db
    .insert(schema.libraries)
    .values({
      name: options.name ?? `email-e2e-library-${randomUUID()}`,
      watch: false,
      organizationMode: options.mode ?? 'book_per_file',
      allowedFormats: options.allowedFormats ?? [],
      excludePatterns: [],
      formatPriority: [...DEFAULT_FORMAT_PRIORITY],
    })
    .returning({ id: schema.libraries.id });

  const [libraryFolder] = await ctx.db
    .insert(schema.libraryFolders)
    .values({
      libraryId: library.id,
      path: folderPath,
    })
    .returning({ id: schema.libraryFolders.id });

  return {
    libraryId: library.id,
    libraryFolderId: libraryFolder.id,
    folderPath,
  };
}

export async function triggerAndWaitForLibraryScan(
  ctx: EmailE2EContext,
  libraryId: number,
  timeoutMs = 45_000,
): Promise<typeof schema.scanJobs.$inferSelect> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/scanner/libraries/${libraryId}/scan`,
    headers: authHeader(ctx.admin.accessToken),
  });

  if (response.statusCode !== 202) {
    throw new Error(`Scan endpoint failed: ${response.statusCode} ${response.body}`);
  }

  const body = response.json() as { jobId?: number };
  if (!body.jobId) {
    throw new Error(`Scan endpoint returned no jobId: ${response.body}`);
  }

  return waitForScanCompletion(ctx.db, body.jobId, timeoutMs);
}

export async function locateBookByAbsolutePath(ctx: EmailE2EContext, absolutePath: string): Promise<LocatedBookFile> {
  const [row] = await ctx.db
    .select({
      libraryId: schema.books.libraryId,
      bookId: schema.books.id,
      bookFileId: schema.bookFiles.id,
      absolutePath: schema.bookFiles.absolutePath,
      relPath: schema.bookFiles.relPath,
      format: schema.bookFiles.format,
    })
    .from(schema.bookFiles)
    .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
    .where(and(eq(schema.books.status, 'present'), eq(schema.bookFiles.absolutePath, absolutePath)))
    .limit(1);

  if (!row) {
    throw new Error(`No present book file found for path "${absolutePath}"`);
  }

  return row;
}

export async function createUserAndLogin(
  ctx: EmailE2EContext,
  options: {
    permissions?: Permission[];
    isSuperuser?: boolean;
    isDefaultPassword?: boolean;
    active?: boolean;
    username?: string;
    password?: string;
    email?: string;
  } = {},
): Promise<TestUserSession> {
  const suffix = randomUUID().replaceAll('-', '');
  const username = options.username ?? `email-e2e-user-${suffix}`;
  const password = options.password ?? 'EmailE2EUser123';
  const email = options.email ?? `${username}@example.com`;
  const passwordHash = await hash(password, 12);

  const [created] = await ctx.db
    .insert(schema.users)
    .values({
      username,
      name: `Email E2E User ${suffix}`,
      email,
      passwordHash,
      active: options.active ?? true,
      isSuperuser: options.isSuperuser ?? false,
      isDefaultPassword: options.isDefaultPassword ?? false,
      provisioningMethod: 'local',
    })
    .returning({ id: schema.users.id });

  const permissions = options.permissions ?? [];
  if (permissions.length > 0) {
    await ctx.db.insert(schema.userPermissions).values(permissions.map((permissionName) => ({ userId: created.id, permissionName })));
  }

  const accessToken = await loginForToken(ctx.app, username, password);
  if (!accessToken) {
    throw new Error(`Login failed for ${username}`);
  }

  return {
    userId: created.id,
    username,
    password,
    accessToken,
  };
}

export async function grantLibraryAccess(
  ctx: EmailE2EContext,
  userId: number,
  libraryId: number,
  accessLevel: 'viewer' | 'editor' | 'owner' = 'viewer',
): Promise<void> {
  await ctx.db
    .insert(schema.userLibraryAccess)
    .values({ userId, libraryId, accessLevel })
    .onConflictDoUpdate({
      target: [schema.userLibraryAccess.userId, schema.userLibraryAccess.libraryId],
      set: { accessLevel },
    });
}

export async function resetEmailModuleState(ctx: EmailE2EContext): Promise<void> {
  await ctx.db.delete(schema.emailSendLog);
  await ctx.db.delete(schema.emailPreferences);
  await ctx.db.delete(schema.emailRecipientGroupMembers);
  await ctx.db.delete(schema.emailRecipientGroups);
  await ctx.db.delete(schema.emailRecipients);
  await ctx.db.delete(schema.emailProviders);
  await ctx.db.delete(schema.emailTemplates).where(isNotNull(schema.emailTemplates.userId));
  ctx.smtpSink.clearMessages();
}

export async function seedBookMetadataContext(
  ctx: EmailE2EContext,
  input: {
    bookId: number;
    title: string;
    seriesName?: string;
    seriesIndex?: number;
    authorNames: string[];
    tagNames?: string[];
  },
): Promise<void> {
  const metadataPatch = {
    title: input.title,
    seriesName: input.seriesName ?? null,
    seriesIndex: input.seriesIndex ?? null,
    updatedAt: new Date(),
  } as const;

  await ctx.db
    .insert(schema.bookMetadata)
    .values({
      bookId: input.bookId,
      ...metadataPatch,
    })
    .onConflictDoUpdate({
      target: schema.bookMetadata.bookId,
      set: metadataPatch,
    });

  await ctx.db.delete(schema.bookAuthors).where(eq(schema.bookAuthors.bookId, input.bookId));
  const authorIds: number[] = [];
  for (const authorName of input.authorNames) {
    const [inserted] = await ctx.db
      .insert(schema.authors)
      .values({ name: authorName, sortName: authorName })
      .onConflictDoNothing()
      .returning({ id: schema.authors.id });

    const authorId =
      inserted?.id ??
      (await ctx.db.select({ id: schema.authors.id }).from(schema.authors).where(eq(schema.authors.name, authorName)).limit(1))[0]?.id;

    if (!authorId) {
      throw new Error(`Unable to resolve author id for "${authorName}"`);
    }
    authorIds.push(authorId);
  }

  if (authorIds.length > 0) {
    await ctx.db.insert(schema.bookAuthors).values(
      authorIds.map((authorId, index) => ({
        bookId: input.bookId,
        authorId,
        displayOrder: index,
      })),
    );
  }

  await ctx.db.delete(schema.bookTags).where(eq(schema.bookTags.bookId, input.bookId));
  const tagNames = [...new Set(input.tagNames ?? [])];
  if (tagNames.length === 0) return;

  const [existingTags, insertedTags] = await Promise.all([
    ctx.db.select({ id: schema.tags.id, name: schema.tags.name }).from(schema.tags).where(inArray(schema.tags.name, tagNames)),
    ctx.db
      .insert(schema.tags)
      .values(tagNames.map((name) => ({ name })))
      .onConflictDoNothing()
      .returning({ id: schema.tags.id, name: schema.tags.name }),
  ]);

  const tagIdByName = new Map<string, number>();
  for (const row of existingTags) {
    tagIdByName.set(row.name, row.id);
  }
  for (const row of insertedTags) {
    tagIdByName.set(row.name, row.id);
  }

  await ctx.db.insert(schema.bookTags).values(
    tagNames.map((name) => {
      const tagId = tagIdByName.get(name);
      if (!tagId) {
        throw new Error(`Unable to resolve tag id for "${name}"`);
      }
      return { bookId: input.bookId, tagId };
    }),
  );
}

export async function waitForCondition(check: () => Promise<void>, timeoutMs = 15_000, pollMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      await sleep(pollMs);
    }
  }

  throw new Error(`Timed out waiting for condition: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function makeMetadataNoopMock(): Pick<
  MetadataService,
  'extractAndSave' | 'refreshCoverForBook' | 'extractAudioFileDuration' | 'aggregateAudioDuration' | 'extractAudioChaptersAndNarrators'
> {
  return {
    extractAndSave: () => Promise.resolve(undefined),
    refreshCoverForBook: () => Promise.resolve(false),
    extractAudioFileDuration: () => Promise.resolve(undefined),
    aggregateAudioDuration: () => Promise.resolve(undefined),
    extractAudioChaptersAndNarrators: () => Promise.resolve(undefined),
  };
}

async function stopBookBucketWatcher(app: NestFastifyApplication): Promise<void> {
  const watcher = app.get(BookBucketWatcherService);
  await watcher.onModuleDestroy();
}

async function getAdminSession(app: NestFastifyApplication, db: Db): Promise<TestUserSession> {
  const setupResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: ADMIN_SETUP_DTO,
  });

  if (setupResponse.statusCode === 201) {
    const body = setupResponse.json() as { accessToken?: string };
    if (!body.accessToken) throw new Error('Setup succeeded but accessToken is missing');
    const [admin] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, ADMIN_SETUP_DTO.username)).limit(1);
    if (!admin) throw new Error('Setup succeeded but admin user was not created');
    return {
      userId: admin.id,
      username: ADMIN_SETUP_DTO.username,
      password: ADMIN_SETUP_DTO.password,
      accessToken: body.accessToken,
    };
  }

  if (setupResponse.statusCode === 409) {
    const existingToken = await loginForToken(app, ADMIN_SETUP_DTO.username, ADMIN_SETUP_DTO.password);
    if (existingToken) {
      const [admin] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, ADMIN_SETUP_DTO.username)).limit(1);
      if (!admin) throw new Error('Admin login succeeded but admin row is missing');
      return {
        userId: admin.id,
        username: ADMIN_SETUP_DTO.username,
        password: ADMIN_SETUP_DTO.password,
        accessToken: existingToken,
      };
    }

    const suffix = randomUUID().replaceAll('-', '');
    const fallbackUsername = `email-lifecycle-e2e-admin-${suffix}`;
    const passwordHash = await hash(ADMIN_SETUP_DTO.password, 12);

    const [fallbackAdmin] = await db
      .insert(schema.users)
      .values({
        username: fallbackUsername,
        name: 'Email Lifecycle E2E Admin',
        email: `${fallbackUsername}@example.com`,
        passwordHash,
        isSuperuser: true,
        isDefaultPassword: false,
        provisioningMethod: 'local',
      })
      .returning({ id: schema.users.id });

    const fallbackToken = await loginForToken(app, fallbackUsername, ADMIN_SETUP_DTO.password);
    if (!fallbackToken) {
      throw new Error('Setup is already complete and fallback admin login failed');
    }

    return {
      userId: fallbackAdmin.id,
      username: fallbackUsername,
      password: ADMIN_SETUP_DTO.password,
      accessToken: fallbackToken,
    };
  }

  throw new Error(`Unable to complete setup: ${setupResponse.statusCode} ${setupResponse.body}`);
}

async function loginForToken(app: NestFastifyApplication, username: string, password: string): Promise<string | null> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });
  if (response.statusCode !== 200) return null;
  const body = response.json() as { accessToken?: string };
  return body.accessToken ?? null;
}

function restoreEnv(snapshot: EnvSnapshot): void {
  if (snapshot.appDataPath === undefined) delete process.env.APP_DATA_PATH;
  else process.env.APP_DATA_PATH = snapshot.appDataPath;

  if (snapshot.appUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = snapshot.appUrl;
}
