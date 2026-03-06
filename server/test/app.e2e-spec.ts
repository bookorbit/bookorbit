import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { IS_PUBLIC_KEY, Public } from '../src/common/decorators/public.decorator';
import { RequirePermission } from '../src/common/decorators/require-permission.decorator';
import { PermissionGuard } from '../src/common/guards/permission.guard';
import { PermissionService } from '../src/common/services/permission.service';
import type { RequestUser } from '../src/common/types/request-user';

type LoginBody = {
  username?: string;
  password?: string;
};

const userRole = {
  id: 1,
  name: 'User',
  description: null,
  isSuperuser: false,
  isSystem: false,
  permissions: [] as Array<{ id: number; name: string }>,
};

function makeUser(permissionNames: string[]): RequestUser {
  return {
    id: 1,
    username: 'smoke-user',
    name: 'Smoke User',
    email: null,
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    roles: [
      {
        ...userRole,
        permissions: permissionNames.map((name, index) => ({ id: index + 1, name })),
      },
    ],
  };
}

@Injectable()
class TestJwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: RequestUser }>();
    const auth = request.headers.authorization;

    if (auth === 'Bearer admin-token') {
      request.user = makeUser(['manage_users']);
      return true;
    }

    if (auth === 'Bearer user-token') {
      request.user = makeUser([]);
      return true;
    }

    throw new UnauthorizedException();
  }
}

@Controller('auth')
class SmokeAuthController {
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginBody) {
    if (body.username === 'admin' && body.password === 'admin') {
      return { accessToken: 'admin-token', user: makeUser(['manage_users']) };
    }
    return { accessToken: 'user-token', user: makeUser([]) };
  }
}

@Controller('smoke')
class SmokeProtectedController {
  @Get('private')
  getPrivate() {
    return { ok: true };
  }

  @Get('admin')
  @RequirePermission('manage_users')
  getAdmin() {
    return { ok: true };
  }
}

@Module({
  controllers: [SmokeAuthController, SmokeProtectedController],
  providers: [PermissionService, { provide: APP_GUARD, useClass: TestJwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionGuard }],
})
class SmokeAppModule {}

describe('API smoke (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [SmokeAppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/v1/auth/login returns an access token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBe('admin-token');
  });

  it('GET /api/v1/smoke/private allows authenticated access', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/smoke/private',
      headers: { authorization: 'Bearer user-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('GET /api/v1/smoke/admin denies users without permission', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/smoke/admin',
      headers: { authorization: 'Bearer user-token' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/v1/smoke/admin allows users with required permission', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/smoke/admin',
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
