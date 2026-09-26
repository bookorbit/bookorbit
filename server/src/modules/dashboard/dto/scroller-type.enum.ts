import { BOOK_SCROLLER_TYPE } from '@bookorbit/types';
import type { BookScrollerType } from '@bookorbit/types';

// Only book shelves are served here. A podcast shelf value reaching `scrollers/:type` is a client
// bug, and ParseEnumPipe rejecting it is the intended contract.
export const ScrollerType = BOOK_SCROLLER_TYPE;
export type ScrollerType = BookScrollerType;
