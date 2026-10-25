import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PartnersService, type PartnerContext } from './partners.service';

export type PartnerRequest = Request & { partner: PartnerContext };

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

export function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.ip || req.socket?.remoteAddress || 'unknown';
}

/** Authenticates `X-API-Key` (or `Authorization: Bearer`) as a data partner and rate-limits per key. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private hits = new Map<number, number[]>();
  private failures = new Map<string, number[]>();

  constructor(private partners: PartnersService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PartnerRequest>();
    const ip = clientIp(req);
    const now = Date.now();

    // Slow down key guessing from one address.
    const fails = (this.failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    if (fails.length >= 20) throw new HttpException('Too many failed attempts. Try again in a minute.', HttpStatus.TOO_MANY_REQUESTS);

    const header = req.headers['x-api-key'];
    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const raw = (Array.isArray(header) ? header[0] : header) || bearer || '';
    const partner = await this.partners.authenticate(raw.trim(), ip);
    if (!partner) {
      this.failures.set(ip, [...fails, now]);
      throw new UnauthorizedException('Missing, invalid, expired or revoked API key.');
    }

    const recent = (this.hits.get(partner.keyId) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_PER_WINDOW) throw new HttpException('Rate limit exceeded (60 requests per minute per key).', HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now);
    this.hits.set(partner.keyId, recent);

    req.partner = partner;
    return true;
  }
}
