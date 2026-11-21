// All configuration comes from environment variables. Nothing is hard-coded.
// Getters are lazy so `next build` works without secrets present.
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  get databaseUrl() {
    return need('DATABASE_URL');
  },
  get sessionSecret() {
    const s = need('SESSION_SECRET');
    if (s.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
    return s;
  },
  get neo4jConfigured() {
    return Boolean(process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD);
  },
  get neo4jUri() {
    return need('NEO4J_URI');
  },
  get neo4jUser() {
    return need('NEO4J_USER');
  },
  get neo4jPassword() {
    return need('NEO4J_PASSWORD');
  },
  get uploadDir() {
    return process.env.UPLOAD_DIR || './uploads';
  },
  get isProd() {
    return process.env.NODE_ENV === 'production';
  },
};
