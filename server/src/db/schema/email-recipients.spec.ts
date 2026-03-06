import { getTableConfig } from 'drizzle-orm/pg-core';

import { emailRecipientGroupMembers, emailRecipientGroups, emailRecipients } from './email-recipients';

const fkByColumn = (table: unknown) => {
  const config = getTableConfig(table as never);
  return new Map(config.foreignKeys.map((fk) => [fk.reference().columns.map((col) => col.name).join(','), fk]));
};

describe('email-recipients schema', () => {
  it('defines recipient ownership, template linkage, defaults, and uniqueness constraints', () => {
    const config = getTableConfig(emailRecipients);
    const unique = config.uniqueConstraints.map((constraint) => constraint.columns.map((col) => col.name));

    expect(unique).toContainEqual(['user_id', 'email']);
    expect(emailRecipients.isDefault.notNull).toBe(true);
    expect(emailRecipients.isDefault.default).toBe(false);
    expect(emailRecipients.updatedAt.onUpdateFn?.()).toBeInstanceOf(Date);

    const foreignKeys = fkByColumn(emailRecipients);
    expect(foreignKeys.get('user_id')?.onDelete).toBe('cascade');
    expect(foreignKeys.get('default_template_id')?.onDelete).toBe('set null');
  });

  it('enforces per-user unique group names and nullable template relationship', () => {
    const config = getTableConfig(emailRecipientGroups);
    const unique = config.uniqueConstraints.map((constraint) => constraint.columns.map((col) => col.name));

    expect(unique).toContainEqual(['user_id', 'name']);
    expect(emailRecipientGroups.updatedAt.onUpdateFn?.()).toBeInstanceOf(Date);

    const foreignKeys = fkByColumn(emailRecipientGroups);
    expect(foreignKeys.get('user_id')?.onDelete).toBe('cascade');
    expect(foreignKeys.get('default_template_id')?.onDelete).toBe('set null');
  });

  it('protects group-membership integrity with composite uniqueness and cascade deletes', () => {
    const config = getTableConfig(emailRecipientGroupMembers);
    const unique = config.uniqueConstraints.map((constraint) => constraint.columns.map((col) => col.name));

    expect(unique).toContainEqual(['group_id', 'recipient_id']);

    const foreignKeys = fkByColumn(emailRecipientGroupMembers);
    expect(foreignKeys.get('group_id')?.onDelete).toBe('cascade');
    expect(foreignKeys.get('recipient_id')?.onDelete).toBe('cascade');
  });
});
