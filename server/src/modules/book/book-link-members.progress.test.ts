import { memberProgress } from './book-link-members.repository';

const none = { status: null, filePercentage: null, fileReadAt: null, audioPercentage: null, audioUpdatedAt: null };

describe('memberProgress', () => {
  it('is null for an edition the viewer has not started', () => {
    expect(memberProgress(none)).toBeNull();
    expect(memberProgress({ ...none, status: 'want_to_read', filePercentage: 0 })).toBeNull();
  });

  it('reports a finished edition as finished at 100%', () => {
    expect(memberProgress({ ...none, status: 'read' })).toEqual({ percentage: 100, finished: true });
    expect(memberProgress({ ...none, status: 'skimmed' })).toEqual({ percentage: 100, finished: true });
    expect(memberProgress({ ...none, status: 'read', filePercentage: 40 })).toEqual({ percentage: 100, finished: true });
    expect(memberProgress({ ...none, status: 'reading', audioPercentage: 100 })).toEqual({ percentage: 100, finished: true });
  });

  it('takes the more recent of file and audiobook progress, like a card', () => {
    const older = new Date('2026-11-01T00:00:00Z');
    const newer = new Date('2026-11-10T00:00:00Z');
    expect(memberProgress({ ...none, filePercentage: 20, fileReadAt: newer, audioPercentage: 60, audioUpdatedAt: older })).toEqual({
      percentage: 20,
      finished: false,
    });
    expect(memberProgress({ ...none, filePercentage: 20, fileReadAt: older, audioPercentage: 60, audioUpdatedAt: newer })).toEqual({
      percentage: 60,
      finished: false,
    });
  });

  it('rounds to one decimal place', () => {
    expect(memberProgress({ ...none, audioPercentage: 35.4567 })).toEqual({ percentage: 35.5, finished: false });
  });
});
