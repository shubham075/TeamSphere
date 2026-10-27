import type { Request } from 'express';

export function clientInfo(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
  };
}
