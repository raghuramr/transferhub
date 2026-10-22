import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { JwtPayload } from './jwt-payload.interface';
import * as sql from 'mssql';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private config: ConfigService,
    private db: DatabaseService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const result = await this.db.query<any>(
      `SELECT u.Id, u.Email, u.FirstName, u.LastName, u.IsActive, u.IsLocked, u.DepartmentId,
              r.Name AS Role
       FROM Users u JOIN Roles r ON r.Id = u.RoleId
       WHERE u.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: payload.sub }],
    );

    const user = result.recordset[0];
    if (!user || !user.IsActive) throw new UnauthorizedException('User not found or inactive');
    if (user.IsLocked) throw new UnauthorizedException('Account is locked');

    return {
      id: user.Id,
      email: user.Email,
      firstName: user.FirstName,
      lastName: user.LastName,
      role: user.Role,
      departmentId: user.DepartmentId,
    };
  }
}
