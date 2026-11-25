const grantColumns = 'enrollment_id,activation_expires_at,used_at,device_digest,device_expires_at,revoked_at';

export function createDeviceGrantStore(db, prefix) {
  async function rpc(name, params) {
    const result = await db.rpc(prefix + '_' + name, params);
    if (result?.error || !result?.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
      throw new Error('Device operation failed');
    }
    return result.data;
  }

  return {
    async findByDevice(digest) {
      const result = await db.from(`${prefix}_device_grants`).select(grantColumns).eq('device_digest', digest).limit(1);
      if (result?.error || !Array.isArray(result?.data)) throw new Error('Device grant lookup failed');
      return result.data[0] ?? null;
    },
    async countAttempt({clientKey, action, shared}) {
      const result = await rpc('count_device_attempt', {
        p_client_key: clientKey,
        p_action: action,
        p_shared: shared,
      });
      if (typeof result.allowed !== 'boolean' ||
          !Number.isInteger(result.retryAfter) || result.retryAfter < 1 || result.retryAfter > 300) {
        throw new Error('Invalid device attempt response');
      }
      return result;
    },
    enroll({name, role, deviceDigest, internalDigest}) {
      return rpc('auto_enroll_device', {
        p_name: name,
        p_role: role,
        p_device_digest: deviceDigest,
        p_internal_digest: internalDigest,
      });
    },
    activate({name, role, codeDigest, deviceDigest}) {
      return rpc('activate_device', {
        p_name: name,
        p_role: role,
        p_code_digest: codeDigest,
        p_device_digest: deviceDigest,
      });
    },
    async issueCode({issuerDeviceDigest, codeDigest}) {
      const result = await rpc('issue_device_code', {
        p_issuer_device_digest: issuerDeviceDigest,
        p_code_digest: codeDigest,
      });
      if (result.expiresAt === null) return null;
      if (typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt)) ||
          typeof result.name !== 'string' || !['anchor', 'operator'].includes(result.role)) {
        throw new Error('Invalid device code issuance response');
      }
      return {expiresAt: new Date(result.expiresAt).toISOString(), name: result.name, role: result.role};
    },
  };
}
