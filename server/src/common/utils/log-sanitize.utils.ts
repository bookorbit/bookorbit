const MAX_LOG_VALUE_LENGTH = 200;

export function sanitizeLogValue(value: string, maxLength = MAX_LOG_VALUE_LENGTH): string {
  return value.replace(/[\r\n\t]/g, ' ').slice(0, maxLength);
}
