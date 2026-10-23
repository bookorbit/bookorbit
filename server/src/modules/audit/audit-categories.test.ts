import {
  AUDIT_CATEGORY_PREFIXES,
  AUDIT_SECURITY_ACTIONS,
  AUDIT_SECURITY_GROUPS,
  AUDIT_SIGN_IN_ACTIONS,
  AuditAction,
  getAuditCategory,
} from '@bookorbit/types';

// The shared definitions live in packages/types, whose own specs never run; they are covered here.
describe('audit categories and views', () => {
  it('places every known action in a real category', () => {
    const unplaced = Object.values(AuditAction).filter((action) => getAuditCategory(action) === 'other');
    expect(unplaced).toEqual([]);
  });

  it('gives requests, Book Dock and maintenance their own homes instead of "other"', () => {
    expect(getAuditCategory(AuditAction.BookRequestImport)).toBe('requests');
    expect(getAuditCategory(AuditAction.RequestIndexerPluginInstall)).toBe('requests');
    expect(getAuditCategory(AuditAction.BookDockFinalize)).toBe('books');
    expect(getAuditCategory(AuditAction.MaintenanceOrphanedCoversClean)).toBe('settings');
  });

  it('degrades an action this build has never seen to "other"', () => {
    expect(getAuditCategory('club.create')).toBe('other');
  });

  it('keeps prefixes from overlapping, so an action has exactly one category', () => {
    const prefixes = Object.values(AUDIT_CATEGORY_PREFIXES).flat();
    for (const action of Object.values(AuditAction)) {
      expect(prefixes.filter((prefix) => action.startsWith(prefix))).toHaveLength(1);
    }
  });

  it('builds the Security view from groups that do not overlap', () => {
    const grouped = Object.values(AUDIT_SECURITY_GROUPS).flat();
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...AUDIT_SECURITY_ACTIONS].sort()).toEqual([...grouped].sort());
  });

  it('counts a failed sign-in as both sign-in traffic and a security event', () => {
    expect(AUDIT_SIGN_IN_ACTIONS).toContain(AuditAction.AuthLoginFailed);
    expect(AUDIT_SECURITY_ACTIONS).toContain(AuditAction.AuthLoginFailed);
  });
});
