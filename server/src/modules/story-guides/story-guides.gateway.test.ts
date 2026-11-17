import { NotFoundException } from '@nestjs/common';
import { Permission, STORY_GUIDE_FEATURE } from '@bookorbit/types';

import { trackSocketHandshake } from '../../common/utils/ws-auth.utils';
import { AiJobChanges, type AiJobChange } from '../ai-jobs/ai-job-changes.service';
import { STORY_GUIDE_PUSH_MS, STORY_GUIDE_WATCH_LIMIT, StoryGuidesGateway } from './story-guides.gateway';

const builder = { id: 4, isSuperuser: false, permissions: [Permission.LibraryGenerateStoryGuide] };
const reader = { id: 5, isSuperuser: false, permissions: [] as string[] };
const admin = { id: 1, isSuperuser: true, permissions: [] as string[] };

function makeGateway() {
  const authenticator = { authenticateSocket: vi.fn() };
  const books = { verifyBookAccess: vi.fn().mockResolvedValue(undefined) };
  const changes = new AiJobChanges();
  const textListeners = new Set<(bookId: number) => void>();
  const texts = {
    onComputed: vi.fn((listener: (bookId: number) => void) => {
      textListeners.add(listener);
      return () => textListeners.delete(listener);
    }),
  };
  const textComputed = (bookId: number) => textListeners.forEach((listener) => listener(bookId));
  const gateway = new StoryGuidesGateway(authenticator as never, books as never, changes, texts as never);
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  const serverEmit = vi.fn();
  gateway.server = { to, emit: serverEmit } as never;
  gateway.onModuleInit();
  return { gateway, authenticator, books, changes, textComputed, to, emit, serverEmit };
}

function socket(user: object | null) {
  const rooms = new Set<string>(['sock-1']);
  const client = {
    id: 'sock-1',
    data: user ? { user } : {},
    rooms,
    join: vi.fn((room: string) => {
      rooms.add(room);
      return Promise.resolve();
    }),
    leave: vi.fn((room: string) => {
      rooms.delete(room);
      return Promise.resolve();
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  if (user) void trackSocketHandshake(client as never, Promise.resolve(user as never));
  return client;
}

function change(overrides: Partial<AiJobChange> = {}): AiJobChange {
  return { id: 'job-1', feature: STORY_GUIDE_FEATURE, subjectRef: { bookId: 7, fileId: 70 }, requestedBy: 1, kind: 'progress', ...overrides };
}

describe('StoryGuidesGateway', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('connection', () => {
    it('lets in someone who may build story guides, and a superuser', async () => {
      for (const user of [builder, admin]) {
        const { gateway, authenticator } = makeGateway();
        authenticator.authenticateSocket.mockResolvedValue(user);
        const client = socket(null);
        await gateway.handleConnection(client as never);
        expect(client.disconnect).not.toHaveBeenCalled();
        expect(client.data).toEqual({ user });
      }
    });

    it('turns away someone without the permission', async () => {
      const { gateway, authenticator } = makeGateway();
      authenticator.authenticateSocket.mockResolvedValue(reader);
      const client = socket(null);
      await gateway.handleConnection(client as never);
      expect(client.disconnect).toHaveBeenCalled();
    });
  });

  describe('watching a book', () => {
    it('joins the book after the same access check as the status route', async () => {
      const { gateway, books } = makeGateway();
      const client = socket(builder);
      expect(await gateway.watch(client as never, 7)).toBe(true);
      expect(books.verifyBookAccess).toHaveBeenCalledWith(7, builder);
      expect(client.join).toHaveBeenCalledWith('story-guide:book:7');
    });

    it('refuses a book the user cannot see', async () => {
      const { gateway, books } = makeGateway();
      books.verifyBookAccess.mockRejectedValue(new NotFoundException());
      const client = socket(builder);
      expect(await gateway.watch(client as never, 7)).toBe(false);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('refuses an id that is not a book id, and a socket with no user', async () => {
      const { gateway, books } = makeGateway();
      for (const bad of [0, -1, 1.5, '7', null, { bookId: 7 }]) {
        expect(await gateway.watch(socket(builder) as never, bad)).toBe(false);
      }
      expect(await gateway.watch(socket(null) as never, 7)).toBe(false);
      expect(books.verifyBookAccess).not.toHaveBeenCalled();
    });

    it(`watches at most ${STORY_GUIDE_WATCH_LIMIT} books per socket`, async () => {
      const { gateway } = makeGateway();
      const client = socket(builder);
      for (let id = 1; id <= STORY_GUIDE_WATCH_LIMIT; id++) expect(await gateway.watch(client as never, id)).toBe(true);
      expect(await gateway.watch(client as never, 999)).toBe(false);
      // A book already watched is still a yes.
      expect(await gateway.watch(client as never, 1)).toBe(true);
      await gateway.unwatch(client as never, 1);
      expect(client.leave).toHaveBeenCalledWith('story-guide:book:1');
      expect(await gateway.watch(client as never, 999)).toBe(true);
    });
  });

  describe('pushing changes', () => {
    it('sends one change per book for everything heard in a window, to that book only', () => {
      const { changes, to, emit, serverEmit } = makeGateway();
      changes.changed(change());
      changes.changed(change());
      changes.changed(change({ id: 'job-2', subjectRef: { bookId: 8, fileId: 80 } }));
      expect(to).not.toHaveBeenCalled();
      vi.advanceTimersByTime(STORY_GUIDE_PUSH_MS);
      expect(to.mock.calls).toEqual([['story-guide:book:7'], ['story-guide:book:8']]);
      expect(emit.mock.calls).toEqual([
        ['story-guide:changed', { bookId: 7 }],
        ['story-guide:changed', { bookId: 8 }],
      ]);
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('also tells every page the queue moved when a job changed status', () => {
      const { changes, serverEmit } = makeGateway();
      changes.changed(change({ kind: 'state' }));
      vi.advanceTimersByTime(STORY_GUIDE_PUSH_MS);
      expect(serverEmit).toHaveBeenCalledWith('story-guide:queue-changed');
    });

    it('ignores other features and subjects without a book', () => {
      const { changes, to, serverEmit } = makeGateway();
      changes.changed(change({ feature: 'other', kind: 'state' }));
      changes.changed(change({ subjectRef: { fileId: 70 } }));
      vi.advanceTimersByTime(STORY_GUIDE_PUSH_MS);
      expect(to).not.toHaveBeenCalled();
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('starts a new window after sending, and stops hearing on shutdown', () => {
      const { gateway, changes, emit } = makeGateway();
      changes.changed(change());
      vi.advanceTimersByTime(STORY_GUIDE_PUSH_MS);
      changes.changed(change());
      vi.advanceTimersByTime(STORY_GUIDE_PUSH_MS);
      expect(emit).toHaveBeenCalledTimes(2);
      gateway.onModuleDestroy();
      changes.changed(change());
      vi.advanceTimersByTime(STORY_GUIDE_PUSH_MS);
      expect(emit).toHaveBeenCalledTimes(2);
    });

    it("tells a book's page when its text has been read, so checking ends without a reload", () => {
      const { textComputed, changes, to, emit, serverEmit } = makeGateway();
      textComputed(7);
      changes.changed(change());
      textComputed(9);
      vi.advanceTimersByTime(STORY_GUIDE_PUSH_MS);
      expect(to.mock.calls).toEqual([['story-guide:book:7'], ['story-guide:book:9']]);
      expect(emit.mock.calls).toEqual([
        ['story-guide:changed', { bookId: 7 }],
        ['story-guide:changed', { bookId: 9 }],
      ]);
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('stops hearing read texts on shutdown', () => {
      const { gateway, textComputed, emit } = makeGateway();
      gateway.onModuleDestroy();
      textComputed(7);
      vi.advanceTimersByTime(STORY_GUIDE_PUSH_MS);
      expect(emit).not.toHaveBeenCalled();
    });

    it('does not throw without a socket server, as in a script context', () => {
      const { gateway, changes } = makeGateway();
      gateway.server = undefined;
      changes.changed(change());
      expect(() => vi.advanceTimersByTime(STORY_GUIDE_PUSH_MS)).not.toThrow();
    });
  });
});
