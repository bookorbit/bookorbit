import { BadRequestException, ConflictException, GoneException, HttpException, HttpStatus, PayloadTooLargeException } from '@nestjs/common';
import { UploadErrorCode, type UploadErrorCode as UploadErrorCodeValue } from '@bookorbit/types';

type UploadExceptionConstructor = new (response: object) => HttpException;

function coded(ExceptionType: UploadExceptionConstructor, errorCode: UploadErrorCodeValue, message: string): HttpException {
  return new ExceptionType({ errorCode, message });
}

export const uploadError = {
  tooLarge: (message: string) => coded(PayloadTooLargeException, UploadErrorCode.TooLarge, message),
  empty: () => coded(BadRequestException, UploadErrorCode.Empty, 'File must not be empty'),
  unsupportedFormat: (message: string) => coded(BadRequestException, UploadErrorCode.UnsupportedFormat, message),
  formatNotAllowed: (message: string) => coded(BadRequestException, UploadErrorCode.FormatNotAllowed, message),
  invalidContent: (message: string) => coded(BadRequestException, UploadErrorCode.InvalidContent, message),
  duplicate: (message: string) => coded(ConflictException, UploadErrorCode.Duplicate, message),
  destinationConflict: (message: string) => coded(ConflictException, UploadErrorCode.DestinationConflict, message),
  invalidTarget: (message: string) => coded(BadRequestException, UploadErrorCode.InvalidTarget, message),
  offsetMismatch: (message: string) => coded(ConflictException, UploadErrorCode.OffsetMismatch, message),
  checksumMismatch: (message: string) => coded(BadRequestException, UploadErrorCode.ChecksumMismatch, message),
  sessionExpired: () => coded(GoneException, UploadErrorCode.SessionExpired, 'Upload session has expired'),
  invalidSessionState: (message: string) => coded(ConflictException, UploadErrorCode.SessionStateInvalid, message),
  storageFull: (message: string) =>
    coded(
      class extends HttpException {
        constructor(response: object) {
          super(response, HttpStatus.INSUFFICIENT_STORAGE);
        }
      },
      UploadErrorCode.StorageFull,
      message,
    ),
};
