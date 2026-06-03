// Okta API helpers — realm map, user access resolution, realm user cache

const BASE = process.env.OKTA_TENANT;
const TOKEN = process.env.OKTA_API_TOKEN;

async function fetchAll(initialPath) {
  const items = [];
  let url = `${BASE}${initialPath}`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `SSWS ${TOKEN}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Okta API ${res.status} on ${url}`);
    items.push(...await res.json());
    const link = res.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
  }
  return items;
}

async function oktaJson(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `SSWS ${TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Okta API ${res.status} on ${path}`);
  return res.json();
}

// ── Realm map ────────────────────────────────────────────────────────────────
// { byId: Map<id,name>, byName: Map<NAME,id>, defaultRealmId: string }
let _realmMap = null;

export async function getRealmMap() {
  if (_realmMap) return _realmMap;
  const realms = await fetchAll('/api/v1/realms?limit=200');
  const byId = new Map();
  const byName = new Map();
  let defaultRealmId = null;
  for (const r of realms) {
    const name = r.profile?.name;
    if (name) {
      byId.set(r.id, name);
      byName.set(name.toUpperCase(), r.id);
    }
    if (r.isDefault) defaultRealmId = r.id;
  }
  _realmMap = { byId, byName, defaultRealmId };
  return _realmMap;
}

// ── Realm user cache (server-side, 5-min TTL) ────────────────────────────────
const _realmUserCache = new Map(); // realmId → { ids, expiresAt }

export async function getRealmUserIds(realmId) {
  const cached = _realmUserCache.get(realmId);
  if (cached && Date.now() < cached.expiresAt) return cached.ids;

  // Authoritative: every user carries a top-level realmId.
  let ids = [];
  try {
    const users = await fetchAll(
      `/api/v1/users?limit=200&search=${encodeURIComponent(`realmId eq "${realmId}"`)}`
    );
    ids = [...new Set(users.map(u => u.id))];
  } catch (err) {
    console.error(`getRealmUserIds(${realmId}) failed:`, err.message);
  }

  _realmUserCache.set(realmId, { ids, expiresAt: Date.now() + 5 * 60 * 1000 });
  return ids;
}

// ── Access resolution ─────────────────────────────────────────────────────────
function globalAdminGroupIds() {
  return (process.env.GLOBAL_ADMIN_GROUPS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}

// Okta role types that confer unrestricted (global) log access
const SUPER_ADMIN_TYPES = new Set([
  'SUPER_ADMIN', 'ORG_ADMIN', 'READ_ONLY_ADMIN',
]);

/**
 * Resolve what realms a user can see — driven by the user's authoritative realmId.
 *
 * Rule:
 *  - Member of a SPECIFIC (non-default) realm → locked to that realm, ALWAYS.
 *    This overrides any global-group membership: a realm member can never see
 *    other realms' telemetry.
 *  - Member of the DEFAULT realm (org-level users) → global access only if they
 *    hold a super/org admin Okta role or belong to a configured global group.
 *
 * Returns:
 *   { role: 'global', realms: '*' }
 *   { role: 'realm',  realms: ['realmId'] }
 *   { role: 'none',   realms: [] }
 */
export async function resolveUserAccess(userId) {
  const [user, realmMap] = await Promise.all([
    oktaJson(`/api/v1/users/${encodeURIComponent(userId)}`),
    getRealmMap(),
  ]);

  const userRealmId = user.realmId;

  // 1. Specific realm member → hard-locked to that realm.
  if (userRealmId && userRealmId !== realmMap.defaultRealmId) {
    return { role: 'realm', realms: [userRealmId] };
  }

  // 2. Default-realm (org-level) user → may qualify for global.
  const [roles, groups] = await Promise.all([
    fetchAll(`/api/v1/users/${encodeURIComponent(userId)}/roles`).catch(() => []),
    fetchAll(`/api/v1/users/${encodeURIComponent(userId)}/groups?limit=200`),
  ]);

  if (roles.some(r => SUPER_ADMIN_TYPES.has(r.type))) {
    return { role: 'global', realms: '*' };
  }

  const globalIds = new Set(globalAdminGroupIds());
  if (groups.some(g => globalIds.has(g.id) || globalIds.has(g.profile?.name))) {
    return { role: 'global', realms: '*' };
  }

  return { role: 'none', realms: [] };
}

// ── Realm label helpers ───────────────────────────────────────────────────────
export async function realmLabels(realmIds) {
  const { byId } = await getRealmMap();
  if (realmIds === '*') {
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return realmIds.map(id => ({ id, name: byId.get(id) || id }));
}
