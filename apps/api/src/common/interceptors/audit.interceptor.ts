import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../utils/audit.service';

// Field names that must never be persisted in the immutable audit log (which
// audit:view holders can read). Covers credentials and the loan fields the app
// treats as sensitive/encrypted — otherwise every POST/PUT /loans body wrote a
// permanent plaintext copy of lender/principal/rate/balance into AuditEvent.
const SENSITIVE_KEYS = new Set([
  'password', 'passwordhash', 'mfasecret', 'mfatoken', 'totp',
  'token', 'accesstoken', 'refreshtoken', 'secret', 'clientsecret',
  'lender', 'principalamt', 'interestrate', 'currentbalance',
]);

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redactSensitive(v);
    }
    return out;
  }
  return value;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const user = request.user;

    // Only audit mutating operations
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next.handle();
    }

    const actionMap: Record<string, string> = {
      POST: 'CREATE',
      PUT: 'UPDATE',
      PATCH: 'UPDATE',
      DELETE: 'DELETE',
    };

    return next.handle().pipe(
      tap((responseData) => {
        const entity = context.getClass().name.replace('Controller', '');
        const entityId =
          request.params?.id ||
          (responseData as Record<string, unknown>)?.id ||
          undefined;

        this.auditService.log({
          userId: user?.sub,
          action: actionMap[method] || method,
          entity,
          entityId: entityId as string,
          newValues: method !== 'DELETE'
            ? (redactSensitive(request.body) as Record<string, unknown> | undefined)
            : undefined,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });
      }),
    );
  }
}
