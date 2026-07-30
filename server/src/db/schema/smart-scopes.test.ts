import { getTableConfig } from 'drizzle-orm/pg-core';

import { smartScopeKoboSubscriptions } from './smart-scopes';

describe('smart scope Kobo subscriptions table', () => {
  const config = getTableConfig(smartScopeKoboSubscriptions);

  it('keys on user and scope so opting in twice cannot duplicate a row', () => {
    const primaryKeyColumns = config.primaryKeys.map((key) => key.columns.map((column) => column.name));

    expect(primaryKeyColumns).toEqual([['user_id', 'smart_scope_id']]);
  });

  it('leads the primary key with user_id so per-user lookups use it', () => {
    expect(config.primaryKeys[0]?.columns[0]?.name).toBe('user_id');
  });

  it('indexes smart_scope_id so deleting a scope does not scan the table', () => {
    const leadingIndexColumns = config.indexes.map((tableIndex) => tableIndex.config.columns[0]?.name);

    expect(leadingIndexColumns).toContain('smart_scope_id');
  });

  it('cascades from both owners so deleting a user or a scope cannot strand a subscription', () => {
    const cascades = config.foreignKeys.map((foreignKey) => ({
      columns: foreignKey.reference().columns.map((column) => column.name),
      onDelete: foreignKey.onDelete,
    }));

    expect(cascades).toEqual(
      expect.arrayContaining([
        { columns: ['user_id'], onDelete: 'cascade' },
        { columns: ['smart_scope_id'], onDelete: 'cascade' },
      ]),
    );
  });
});
