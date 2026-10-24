import type { Request } from 'express';

/** The shape of `req.user` once a request has passed JwtAuthGuard/LocalStrategy. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  departmentId: number | null;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
