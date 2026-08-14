export const FIVE_FIELD_CRON_FIELD_COUNT = 5;

const CRON_MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const CRON_DAY_OF_WEEK_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

interface CronFieldSpec {
  min: number;
  max: number;
  names?: Record<string, number>;
}

const CRON_FIELDS: readonly CronFieldSpec[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: CRON_MONTH_NAMES },
  { min: 0, max: 7, names: CRON_DAY_OF_WEEK_NAMES },
];

function parseCronFieldValue(token: string, field: CronFieldSpec): number | null {
  const named = field.names?.[token.toLowerCase()];
  if (named !== undefined) return named;
  if (!/^\d{1,2}$/.test(token)) return null;

  const value = Number(token);
  return value >= field.min && value <= field.max ? value : null;
}

function isValidCronFieldEntry(entry: string, field: CronFieldSpec): boolean {
  const [values, step, ...extraSteps] = entry.split("/");
  if (extraSteps.length > 0) return false;
  if (step !== undefined && !/^[1-9]\d*$/.test(step)) return false;
  if (values === "*") return true;

  const [start, end, ...extraBounds] = values.split("-");
  if (extraBounds.length > 0) return false;

  const startValue = parseCronFieldValue(start, field);
  if (startValue === null) return false;
  if (end === undefined) return true;

  const endValue = parseCronFieldValue(end, field);
  return endValue !== null && endValue >= startValue;
}

/**
 * Accepts only the grammar that both the server scheduler and the client's
 * human-readable preview understand, so a schedule can never look valid in the
 * UI and then be rejected by the API. Extensions such as `@daily`, `L`, `#` and
 * seconds fields are rejected on purpose: one of the two parsers chokes on each.
 */
export function isFiveFieldCronExpression(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const fields = value.trim().split(/\s+/);
  if (fields.length !== FIVE_FIELD_CRON_FIELD_COUNT) return false;

  return fields.every((field, index) => field.split(",").every((entry) => isValidCronFieldEntry(entry, CRON_FIELDS[index])));
}
