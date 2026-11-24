import {createHash} from 'node:crypto';
import {readEnrollment} from './cloudbase-identity.mjs';

const pageSize = 10;
const maxPages = 100;
const maxResultBytes = 8 * 1024 * 1024;
const duplicateCodes = new Set(['DATABASE_DUPLICATE_WRITE', 11000, '11000', 'E11000']);
const documentKey = id => createHash('sha256').update(id).digest('hex').slice(0, 32);

function checked(result) {
  if (result?.code && result.code !== 'SUCCESS' && result.code !== 'OK') {
    const error = new Error('CloudBase database request failed');
    error.code = result.code;
    throw error;
  }
  return result;
}

function rows(result) {
  if (!Array.isArray(checked(result)?.data)) throw new Error('Invalid CloudBase database response');
  return result.data;
}

function withoutDocId({_id, ...record}) {
  return record;
}

export function createDatabaseAdapter(db, collectionPrefix) {
  const enrollments = db.collection(`${collectionPrefix}_enrollments`);
  const assignments = db.collection(`${collectionPrefix}_assignments`);
  const submissions = db.collection(`${collectionPrefix}_submissions`);

  // Use a collection query: SDK optimizes an exact _id lookup into a GET that 404s
  // for missing records. An empty match here also keeps auth and service errors distinct.
  const getDocument = async (collection, documentId) =>
    rows(await collection.where({_id: db.command.in([documentId])}).limit(1).get())[0] ?? null;

  async function pageById(collection, filter, fields) {
    const result = [];
    let cursor = null;
    let accumulatedBytes = 0;
    for (let page = 0; page < maxPages; page++) {
      const query = cursor === null ? filter : {...filter, _id: db.command.gt(cursor)};
      let request = collection.where(query).orderBy('_id', 'asc').limit(pageSize);
      if (fields) request = request.field(fields);
      const batch = rows(await request.get());
      if (batch.length > pageSize) throw new Error('Invalid CloudBase page size');
      for (const item of batch) {
        if (typeof item?._id !== 'string' || !item._id || (cursor !== null && item._id <= cursor)) {
          throw new Error('Invalid CloudBase cursor');
        }
        accumulatedBytes += Buffer.byteLength(JSON.stringify(item));
        if (accumulatedBytes > maxResultBytes) {
          throw new Error('CloudBase result exceeded the pilot size limit');
        }
        cursor = item._id;
      }
      result.push(...batch);
      if (batch.length < pageSize) return result;
    }
    throw new Error('CloudBase result exceeded the pilot pagination limit');
  }

  async function getRecord(collection, id) {
    const document = await getDocument(collection, documentKey(id));
    if (!document) return null;
    if (document.id !== id) throw new Error('CloudBase record key collision');
    return withoutDocId(document);
  }

  async function insertRecord(collection, record) {
    const _id = documentKey(record.id);
    try {
      // add is an insert, not set/upsert. CloudBase's unique _id prevents concurrent overwrites.
      const result = checked(await collection.add({...record, _id}));
      if (!result || ![result._id, result.id, ...(result.ids || [])].includes(_id)) {
        throw new Error('CloudBase did not confirm document insert');
      }
      return true;
    } catch (error) {
      if (duplicateCodes.has(error?.code)) return false;
      throw error;
    }
  }

  return {
    getEnrollment: uid => getDocument(enrollments, uid),
    directory: {
      listAnchors: async teamId => (await pageById(enrollments, {teamId, role: 'anchor', active: true}))
        .map(readEnrollment)
        .filter(Boolean),
    },
    store: {
      getAssignment: id => getRecord(assignments, id),
      createAssignment: record => insertRecord(assignments, record),
      listAssignments: async teamId => (await pageById(assignments, {teamId})).map(withoutDocId),
      getSubmission: id => getRecord(submissions, id),
      createSubmission: record => insertRecord(submissions, record),
      listSubmissions: async (assignmentId, teamId) => (await pageById(
        submissions, {assignmentId, teamId},
      )).map(withoutDocId),
      listAnchorSubmissionStatuses: async (teamId, anchorId) => (await pageById(
        submissions, {teamId, anchorId}, {_id: true, assignmentId: true, submittedAt: true},
      )).map(({assignmentId, submittedAt}) => ({assignmentId, submittedAt})),
    },
  };
}
