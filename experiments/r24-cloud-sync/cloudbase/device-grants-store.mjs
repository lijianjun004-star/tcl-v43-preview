const columns = 'enrollment_id,activation_expires_at,used_at,device_digest,device_expires_at,revoked_at';

export function createDeviceGrantStore(db, prefix) {
  const table = `${prefix}_device_grants`;

  async function find(column, digest) {
    const result = await db.from(table).select(columns).eq(column, digest).limit(1);
    if (result?.error || !Array.isArray(result?.data)) throw new Error('Device grant lookup failed');
    return result.data[0] ?? null;
  }

  return {
    findByCode: digest => find('code_digest', digest),
    findByDevice: digest => find('device_digest', digest),
    async claim({codeDigest, enrollmentId, deviceDigest, usedAt, deviceExpiresAt}) {
      const result = await db.from(table).update({
        used_at: usedAt,
        device_digest: deviceDigest,
        device_expires_at: deviceExpiresAt,
      })
        .eq('code_digest', codeDigest)
        .eq('enrollment_id', enrollmentId)
        .is('used_at', null)
        .is('revoked_at', null)
        .gt('activation_expires_at', usedAt)
        .select(columns);
      if (result?.error?.code === '23505') return null;
      if (result?.error || !Array.isArray(result?.data) || result.data.length > 1) {
        throw new Error('Device grant claim failed');
      }
      return result.data[0] ?? null;
    },
  };
}
