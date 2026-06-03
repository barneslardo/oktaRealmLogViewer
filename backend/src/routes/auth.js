import { Router } from 'express';
import { generators } from 'openid-client';
import { getOidcClient } from '../server.js';
import { resolveUserAccess, realmLabels } from '../lib/okta.js';

const router = Router();

router.get('/login', async (req, res) => {
  try {
    const client = await getOidcClient();
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    req.session.oidcState = state;
    req.session.oidcNonce = nonce;
    req.session.codeVerifier = codeVerifier;

    const redirectUrl = client.authorizationUrl({
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    res.redirect(redirectUrl);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('Login failed');
  }
});

router.get('/callback', async (req, res) => {
  if (req.query.error) {
    const desc = req.query.error_description || req.query.error;
    console.error('Okta auth error:', req.query.error, desc);
    return res.status(403).send(`
      <html><body style="font-family:sans-serif;padding:40px;background:#0f1117;color:#e2e8f0">
        <h2 style="color:#ef4444">Access Denied</h2>
        <p>${desc.replace(/\+/g, ' ')}</p>
        <p><a href="/auth/login" style="color:#60a5fa">Try again</a></p>
      </body></html>
    `);
  }

  try {
    const client = await getOidcClient();
    const params = client.callbackParams(req);
    // openid-client v5 defaults aud to the issuer URL; Okta requires the
    // token endpoint URL exactly for private_key_jwt — override it here.
    const tokenSet = await client.callback(
      process.env.OKTA_REDIRECT_URI,
      params,
      {
        state: req.session.oidcState,
        nonce: req.session.oidcNonce,
        code_verifier: req.session.codeVerifier,
      },
      {
        clientAssertionPayload: {
          aud: client.issuer.metadata.token_endpoint,
        },
      },
    );

    const userinfo = await client.userinfo(tokenSet.access_token);
    const access = await resolveUserAccess(userinfo.sub);

    if (access.role === 'none') {
      return res.status(403).send(`
        <html><body style="font-family:sans-serif;padding:40px;background:#0f1117;color:#e2e8f0">
          <h2 style="color:#ef4444">Access Denied</h2>
          <p>Your account is not assigned to any admin group with access to this tool.</p>
          <p><a href="/auth/logout" style="color:#60a5fa">Sign out</a></p>
        </body></html>
      `);
    }

    // Store only the compact fields needed per-request.
    // realmLabels (up to 61 objects) and tokens are NOT stored in the cookie —
    // they push the session past the 4KB cookie limit and silently break it.
    req.session.user = {
      sub: userinfo.sub,
      email: userinfo.email,
      name: userinfo.name,
    };
    req.session.access = {
      role: access.role,
      realms: access.realms, // '*' or compact array of IDs
    };
    // Keep the ID token only for logout hint — it's a JWT but we need it.
    req.session.idToken = tokenSet.id_token;

    delete req.session.oidcState;
    delete req.session.oidcNonce;
    delete req.session.codeVerifier;

    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(returnTo);
  } catch (err) {
    console.error('Callback error:', err);
    res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:40px;background:#0f1117;color:#e2e8f0">
        <h2 style="color:#ef4444">Authentication Error</h2>
        <p>${err.message}</p>
        <p><a href="/auth/login" style="color:#60a5fa">Try again</a></p>
      </body></html>
    `);
  }
});

router.get('/logout', async (req, res) => {
  try {
    const client = await getOidcClient();
    const idToken = req.session.idToken;
    req.session = null;
    const logoutUrl = client.endSessionUrl({
      id_token_hint: idToken,
      post_logout_redirect_uri: process.env.OKTA_POST_LOGOUT_URI,
    });
    res.redirect(logoutUrl);
  } catch {
    req.session = null;
    res.redirect('/');
  }
});

// Realm labels are fetched from the in-memory realm map here rather than
// stored in the session cookie, keeping the cookie well under 4KB.
router.get('/me', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const labels = await realmLabels(req.session.access.realms);
    res.json({
      ...req.session.user,
      access: {
        ...req.session.access,
        realmLabels: labels,
      },
    });
  } catch {
    res.json({ ...req.session.user, access: req.session.access });
  }
});

export default router;
