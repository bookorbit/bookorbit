import 'reflect-metadata';

import { AuditAction, AuditResource, Permission } from '@projectx/types';

import { AllowDefaultPassword, ALLOW_DEFAULT_PASSWORD_KEY } from './allow-default-password.decorator';
import { Auditable, AUDITABLE_KEY } from './auditable.decorator';
import { Public, IS_PUBLIC_KEY } from './public.decorator';
import { RequireLibraryAccess, LIBRARY_ACCESS_KEY } from './require-library-access.decorator';
import { RequirePermission, PERMISSION_KEY } from './require-permission.decorator';

describe('common decorators', () => {
  it('stores metadata for auth, permission, library access, and audit options', () => {
    const auditableOptions = {
      action: AuditAction.LensCreate,
      resource: AuditResource.Lens,
      description: 'Created lens',
    };

    class DecoratedController {
      @Public()
      open() {}

      @AllowDefaultPassword()
      allowDefaultPassword() {}

      @RequirePermission(Permission.ManageUsers)
      withPermission() {}

      @RequireLibraryAccess('viewer')
      withLibraryAccess() {}

      @Auditable(auditableOptions)
      audited() {}
    }

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, DecoratedController.prototype.open)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_DEFAULT_PASSWORD_KEY, DecoratedController.prototype.allowDefaultPassword)).toBe(true);
    expect(Reflect.getMetadata(PERMISSION_KEY, DecoratedController.prototype.withPermission)).toBe(Permission.ManageUsers);
    expect(Reflect.getMetadata(LIBRARY_ACCESS_KEY, DecoratedController.prototype.withLibraryAccess)).toBe('viewer');
    expect(Reflect.getMetadata(AUDITABLE_KEY, DecoratedController.prototype.audited)).toEqual(auditableOptions);
  });
});
