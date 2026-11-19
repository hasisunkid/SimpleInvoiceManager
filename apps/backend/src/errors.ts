import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Uniform error body `{ error, message }` (NFR-UX-03: the UI translates `error`).
 * Validation errors become VALIDATION_FAILED; unexpected errors are logged and hidden.
 */
export function handleError(err: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (err.validation) {
    return reply.code(400).send({ error: 'VALIDATION_FAILED', message: err.message });
  }
  const status = err.statusCode ?? 500;
  if (status >= 500) {
    request.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'INTERNAL', message: 'Internal server error' });
  }
  return reply.code(status).send({ error: err.code ?? 'BAD_REQUEST', message: err.message });
}
