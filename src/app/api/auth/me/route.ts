import { route } from '@/lib/http';

export const GET = route(null, async ({ session }) => ({ user: session ? { id: session.uid, role: session.role, name: session.name } : null }));
