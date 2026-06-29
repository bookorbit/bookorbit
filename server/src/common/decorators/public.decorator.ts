import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), ApiExtension('x-public', true));
