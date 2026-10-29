import type { FastifyReply, FastifyRequest } from 'fastify';

export async function withRequestAbort<T>(request: FastifyRequest, reply: FastifyReply, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  request.raw.once('aborted', abort);
  reply.raw.once('close', abort);
  try {
    return await run(controller.signal);
  } finally {
    request.raw.removeListener('aborted', abort);
    reply.raw.removeListener('close', abort);
  }
}
