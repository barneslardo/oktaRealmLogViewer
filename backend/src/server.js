import 'dotenv/config';
import express from 'express';
import cookieSession from 'cookie-session';
import { fileURLToPath } from 'url';
import path from 'path';
import { Issuer } from 'openid-client';
import authRouter from './routes/auth.js';
import logsRouter from './routes/logs.js';
import { requireAuth } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

const app = express();

app.set('trust proxy', 1);

app.use(cookieSession({
  name: 'okta_session',
  secret: process.env.SESSION_SECRET,
  maxAge: 8 * 60 * 60 * 1000, // 8 hours
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
}));

app.use(express.json());

// OIDC client initialization — shared across routes
let oidcClient;
export async function getOidcClient() {
  if (oidcClient) return oidcClient;
  const issuer = await Issuer.discover(process.env.OKTA_ISSUER);
  oidcClient = new issuer.Client({
    client_id: process.env.OKTA_CLIENT_ID,
    redirect_uris: [process.env.OKTA_REDIRECT_URI],
    post_logout_redirect_uris: [process.env.OKTA_POST_LOGOUT_URI],
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'RS256',
  }, {
    keys: [JSON.parse(process.env.OKTA_PRIVATE_KEY_JWK)],
  });
  return oidcClient;
}

app.use('/auth', authRouter);
app.use('/api/logs', requireAuth, logsRouter);

// Health check (unauthenticated)
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Serve React build in production
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', requireAuth, (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// Initialize OIDC client then start server
getOidcClient()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Okta Realm Log Viewer running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize OIDC client:', err);
    process.exit(1);
  });
