import type { Request } from 'express';

/** The shape of `req.user` once a request has passed JwtAuthGuard/LocalStrategy. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  /** The role's own name when it differs from the built-in role it behaves like (custom roles). Used for the permission matrix. */
  roleKey?: string;
  departmentId: number | null;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
