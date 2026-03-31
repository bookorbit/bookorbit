import { SetMetadata } from '@nestjs/common';

export const ALLOW_DEFAULT_PASSWORD_KEY = 'allowDefaultPassword';
export const AllowDefaultPassword = () => SetMetadata(ALLOW_DEFAULT_PASSWORD_KEY, true);
