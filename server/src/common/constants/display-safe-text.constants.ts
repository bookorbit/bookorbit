/**
 * Identity fields chosen by anonymous visitors are rendered back to administrators in the user
 * list and the audit log, so they must not be able to carry invisible or direction-flipping
 * characters that let one account impersonate another. Unicode letters stay allowed: BookOrbit is
 * multilingual and legitimate usernames are written in every script.
 */
const CONTROL = '\\u0000-\\u001F\\u007F';
const ZERO_WIDTH_AND_BIDI = '\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF';

export const DISPLAY_SAFE_TEXT_PATTERN = new RegExp(`^[^${CONTROL}${ZERO_WIDTH_AND_BIDI}]+$`, 'u');

export const DISPLAY_SAFE_TEXT_MESSAGE = 'must not contain control, zero-width, or text-direction characters';

export const TRIMMED_TEXT_PATTERN = /^\S(.*\S)?$/u;

export const TRIMMED_TEXT_MESSAGE = 'must not start or end with whitespace';
