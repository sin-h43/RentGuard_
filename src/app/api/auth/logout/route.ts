import { clearSessionCookie } from '@/lib/cookies';
import { route } from '@/lib/http';

export const POST = route(null, async () => clearSessionCookie());
