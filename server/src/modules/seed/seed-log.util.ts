export function getSanitizedErrorInfo(error: unknown): { errorClass: string; errorMessage: string } {
  const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const errorMessage = rawMessage.replace(/\s+/g, ' ').replace(/"/g, "'").trim() || 'unknown error';
  return { errorClass, errorMessage };
}
