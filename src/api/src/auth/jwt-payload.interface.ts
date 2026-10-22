export interface JwtPayload {
  sub: string;       // userId
  email: string;
  role: string;
  departmentId: number | null;
  iat?: number;
  exp?: number;
}
