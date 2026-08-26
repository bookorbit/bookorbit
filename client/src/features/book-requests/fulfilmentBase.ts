/** Works on any request, and only a moderator may call it. */
const ADMIN_BASE = '/api/v1/admin/book-requests'
/** The same routes, restricted server-side to the requests that are the caller's to drive. */
const SELF_BASE = '/api/v1/book-request-fulfilment'

/**
 * Which controller answers fulfilment calls for this viewer.
 *
 * The two expose the same route shapes on purpose, so the picker, the grab dialog and the attempts
 * panel stay one component each rather than two. What differs is the scope the server enforces: a
 * moderator may fulfil anything, a self-server only the row that is theirs to drive. Nothing here decides
 * authorization; it decides which endpoint to ask, and the server answers whether it is allowed.
 *
 * A plain function of a boolean rather than a composable reading `usePermissions`. That import
 * reaches `useAuth`, which imports the router, which touches `window` at module scope - and the
 * composables that call this run under the node test environment, where there is no window. The
 * components already know whether they can manage; they pass it down.
 */
export function fulfilmentBase(canManage: boolean): string {
  return canManage ? ADMIN_BASE : SELF_BASE
}
