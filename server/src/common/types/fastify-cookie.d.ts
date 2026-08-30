import type fastifyCookie from '@fastify/cookie';

// TypeScript 6 does not merge the plugin's package-level augmentation into Fastify's source interfaces.
declare module 'fastify/types/request' {
  interface FastifyRequest {
    cookies: Record<string, string | undefined>;
  }
}

declare module 'fastify/types/reply' {
  interface FastifyReply {
    setCookie(name: string, value: string, options?: fastifyCookie.CookieSerializeOptions): this;
  }
}
