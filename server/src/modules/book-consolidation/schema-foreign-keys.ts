import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';

import * as schema from '../../db/schema';

export interface ForeignKeyColumn {
  key: string;
  onDelete: string;
}

/** Every foreign key in the schema whose referenced table is `foreignTableName`, as `table.column` keys. */
export function foreignKeysReferencing(foreignTableName: string): ForeignKeyColumn[] {
  const found: ForeignKeyColumn[] = [];
  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;
    const config = getTableConfig(value);
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      if (getTableConfig(reference.foreignTable).name !== foreignTableName) continue;
      found.push({
        key: `${config.name}.${reference.columns.map((column) => column.name).join('+')}`,
        onDelete: foreignKey.onDelete ?? 'no action',
      });
    }
  }
  return found.sort((a, b) => a.key.localeCompare(b.key));
}
