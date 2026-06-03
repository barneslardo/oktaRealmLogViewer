import { Router } from 'express';
import { getRealmUserIds } from '../lib/okta.js';

const router = Router();

const OKTA_BASE = process.env.OKTA_TENANT;
const API_TOKEN = process.env.OKTA_API_TOKEN;

/**
 * Build a SCIM filter scoped to the user's allowed realms.
 *
 * Global admins: no realm filter (optionally scoped to one realm via realmId param)
 *
 * Realm admins: filter by the Okta user IDs that belong to each allowed realm.
 *   - actor.id  → events the realm users performed
 *   - target.id → events performed ON realm users (admin actions, etc.)
 *   target.id also includes the realm ID itself to catch realm-management events.
 *
 * An additional userFilter (eventType etc.) is ANDed on top.
 */
async function buildRealmFilter(access, selectedRealmId) {
  // Global admin with no realm selected → no filter
  if (access.realms === '*' && !selectedRealmId) return null;

  const realmIds = selectedRealmId ? [selectedRealmId] : access.realms;

  // Gather all user IDs across the relevant realm(s)
  const userIdSets = await Promise.all(realmIds.map(id => getRealmUserIds(id)));
  const userIds = [...new Set(userIdSets.flat())];

  const actorClauses  = userIds.map(id => `actor.id eq "${id}"`);
  const targetClauses = [
    ...userIds.map(id => `target.id eq "${id}"`),
    // Also include the realm itself as a target (realm-management events)
    ...realmIds.map(id => `target.id eq "${id}"`),
  ];

  const allClauses = [...actorClauses, ...targetClauses];

  if (allClauses.length === 0) {
    // No users found in realm — return a filter that matches nothing
    return `target.id eq "no-users-in-realm"`;
  }

  return `(${allClauses.join(' or ')})`;
}

router.get('/', async (req, res) => {
  const access = req.session.access;
  const { since, until, q, eventType, realmId, limit = '100', after } = req.query;

  // Global admins may scope to a specific realm via the UI dropdown
  const selectedRealm = (access.realms === '*' && realmId) ? realmId : null;

  try {
    const [realmFilter] = await Promise.all([
      buildRealmFilter(access, selectedRealm),
    ]);

    const eventFilter = eventType ? `eventType eq "${eventType}"` : null;
    const filterParts = [realmFilter, eventFilter ? `(${eventFilter})` : null].filter(Boolean);
    const filter = filterParts.length ? filterParts.join(' and ') : null;

    const params = new URLSearchParams();
    params.set('limit', Math.min(Number(limit), 1000).toString());
    params.set('sortOrder', 'DESCENDING'); // newest events first
    if (filter) params.set('filter', filter);
    if (since) params.set('since', new Date(since).toISOString());
    if (until) params.set('until', new Date(until).toISOString());
    if (q) params.set('q', q);
    if (after) params.set('after', after);

    const url = `${OKTA_BASE}/api/v1/logs?${params.toString()}`;
    const response = await fetch(url, {
      headers: { Authorization: `SSWS ${API_TOKEN}`, Accept: 'application/json' },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`Okta API ${response.status}:`, body);
      return res.status(response.status).json({ error: 'Okta API request failed', detail: body });
    }

    const data = await response.json();
    const linkHeader = response.headers.get('link') || '';
    const nextMatch = linkHeader.match(/<[^>]*[?&]after=([^&>]+)[^>]*>;\s*rel="next"/);

    res.json({ logs: data, nextCursor: nextMatch ? nextMatch[1] : null });
  } catch (err) {
    console.error('Log fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Distinct event types visible to this user (scoped to their realm access)
router.get('/event-types', async (req, res) => {
  const access = req.session.access;
  const { realmId } = req.query;
  const selectedRealm = (access.realms === '*' && realmId) ? realmId : null;

  try {
    const realmFilter = await buildRealmFilter(access, selectedRealm);
    const params = new URLSearchParams({ limit: '1000' });
    if (realmFilter) params.set('filter', realmFilter);
    params.set('since', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    const url = `${OKTA_BASE}/api/v1/logs?${params.toString()}`;
    const response = await fetch(url, {
      headers: { Authorization: `SSWS ${API_TOKEN}`, Accept: 'application/json' },
    });

    if (!response.ok) return res.status(response.status).json({ error: 'Okta API error' });

    const data = await response.json();
    res.json([...new Set(data.map(e => e.eventType))].sort());
  } catch (err) {
    console.error('Event types error:', err);
    res.status(500).json({ error: 'Failed to fetch event types' });
  }
});

export default router;
