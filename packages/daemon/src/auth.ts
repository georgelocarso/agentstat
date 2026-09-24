import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export class TokenAuth {
  private token: string;
  private lanMode: boolean;

  constructor(lanMode = false, explicitToken?: string) {
    this.lanMode = lanMode;
    this.token = explicitToken || crypto.randomBytes(16).toString('hex');
  }

  public getToken(): string {
    return this.token;
  }

  public isLanMode(): boolean {
    return this.lanMode;
  }

  /**
   * Express middleware to validate bearer token or ?token= param on remote requests
   */
  public middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      // Loopback requests (127.0.0.1, ::1) are trusted by default in local mode
      const isLoopback =
        req.ip === '127.0.0.1' ||
        req.ip === '::1' ||
        req.ip === '::ffff:127.0.0.1' ||
        req.hostname === 'localhost' ||
        req.hostname === '127.0.0.1';

      if (!this.lanMode && isLoopback) {
        return next();
      }

      // Check query parameter ?token=
      const queryToken = req.query.token as string | undefined;
      if (queryToken && queryToken === this.token) {
        return next();
      }

      // Check Authorization: Bearer <token>
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const bearerToken = authHeader.slice(7).trim();
        if (bearerToken === this.token) {
          return next();
        }
      }

      // In LAN mode, remote requests without valid token get 401
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Valid token required. Pass ?token=<token> or Authorization: Bearer <token>',
      });
    };
  }
}
