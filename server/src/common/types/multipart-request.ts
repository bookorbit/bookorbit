import type { Multipart, MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';

export type MultipartRequest = FastifyRequest & {
  file: (opts?: object) => Promise<MultipartFile | undefined>;
  files: (opts?: object) => AsyncIterable<MultipartFile>;
  parts: (opts?: object) => AsyncIterableIterator<Multipart>;
};
