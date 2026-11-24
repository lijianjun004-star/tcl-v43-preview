const accountId = /^[a-zA-Z0-9_-]{1,128}$/;
const statusesWithoutIdentity = new Set([400, 401, 403, 404]);

export function readEnrollment(row) {
  if (!row || row.active !== true ||
      typeof row._id !== 'string' || !accountId.test(row._id) ||
      typeof row.teamId !== 'string' || !accountId.test(row.teamId) ||
      !['anchor', 'operator'].includes(row.role) ||
      typeof row.displayName !== 'string' || row.displayName.trim() !== row.displayName ||
      !row.displayName || row.displayName.length > 40 ||
      /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(row.displayName)) return null;
  return {
    id: row._id, teamId: row.teamId, role: row.role, displayName: row.displayName, active: true,
  };
}

/** Validate a current short-lived user token against this environment on every call. */
export function createAuthenticator({envId, getEnrollment, fetcher = fetch}) {
  const profileUrl = new URL(`https://${envId}.api.tcloudbasegateway.com/auth/v1/user/me`);
  return async (token) => {
    if (typeof token !== 'string' || !/^[a-zA-Z0-9._~+/-]+={0,2}$/.test(token) ||
        token.length > 8192) return null;
    const response = await fetcher(profileUrl, {
      method: 'GET',
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/json'},
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (statusesWithoutIdentity.has(response.status)) return null;
    if (!response.ok) throw new Error('CloudBase identity service unavailable');
    const profile = await response.json();
    if (typeof profile?.user_id !== 'string' || !accountId.test(profile.user_id) ||
        profile.status !== 'ACTIVE' ||
        (profile.sub !== undefined && profile.sub !== profile.user_id) ||
        profile.internal_user_type === 'anonymousUser' || profile.is_anonymous === true) return null;
    const enrollment = readEnrollment(await getEnrollment(profile.user_id));
    return enrollment?.id === profile.user_id ? enrollment : null;
  };
}
