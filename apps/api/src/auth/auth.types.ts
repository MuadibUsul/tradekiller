import type { Request } from 'express';

export interface WebAccessClaims {
  uid: string;
  email: string;
  sid: string;
  iat?: number;
  exp?: number;
}

export interface RequestWithWebUser extends Request {
  webUser?: WebAccessClaims;
}
