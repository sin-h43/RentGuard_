import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { readToken, Role, Session, SESSION_COOKIE } from './session';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Map PostgreSQL errors (constraints, triggers, procedures) to safe HTTP errors. */
function fromPg(e: any): HttpError | null {
  const code: string | undefined = e?.code;
  if (!code || typeof code !== 'string') return null;
  switch (code) {
    case '23505':
      return new HttpError(409, 'That record already exists.');
    case '23514':
      return new HttpError(400, `The database rejected this value (${e.constraint ?? 'check constraint'}).`);
    case '23503':
      return new HttpError(400, 'A referenced record does not exist or does not match.');
    case '23502':
      return new HttpError(400, 'A required field is missing.');
    case '23P01':
      return new HttpError(409, 'This overlaps with an existing record (for example, an existing lease).');
    case '22P02':
    case '22007':
    case '22003':
    case '22001':
      return new HttpError(400, 'One of the values has an invalid format.');
    case 'P0001': // RAISE EXCEPTION from our own triggers / procedures
      return new HttpError(400, String(e.message ?? 'Rejected by a database rule.'));
    default:
      return null;
  }
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError) {
    const msg = e.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ');
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const mapped = fromPg(e);
  if (mapped) return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  console.error(e);
  return NextResponse.json({ error: 'Something went wrong on the server.' }, { status: 500 });
}

export interface Ctx {
  req: NextRequest;
  session: Session | null;
  params: Record<string, string>;
}

type RouteCtx = { params: Promise<Record<string, string>> };

/**
 * Wraps a route handler with authentication, role-based authorization and
 * uniform error handling.  roles = null -> public endpoint.
 */
export function route(roles: Role[] | null, fn: (c: Ctx) => Promise<unknown>) {
  return async (req: NextRequest, ctx: RouteCtx): Promise<NextResponse> => {
    try {
      const session = await readToken(req.cookies.get(SESSION_COOKIE)?.value);
      if (roles) {
        if (!session) throw new HttpError(401, 'Please log in first.');
        if (!roles.includes(session.role)) throw new HttpError(403, 'Your role is not allowed to do this.');
      }
      const params = ctx?.params ? await ctx.params : {};
      const out = await fn({ req, session, params });
      return out instanceof NextResponse ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function intParam(v: string | undefined, name = 'id'): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${name}.`);
  return n;
}

export async function jsonBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}
