'use strict';
/* Who may do what in the learning platform, and where (the design's permissions matrix). Pure: given a person's role grants
   ({ role, programme_id, region_id }), it answers; the server asks before every read and write (NFR-01, ADM-02).
     global_admin          everything, everywhere (audited)
     programme_owner       their programme: content, approvals, its learners and credentials
     regional_coordinator  their region: inviting and enrolling people, fixing profiles, seeing progress
     content_editor        drafting lessons, scripts, translations and questions in their programmes; never approving
     assessor              deciding the assessments assigned to them
     technical_admin       diagnostics (counts, settings, masked errors); no personal profiles or answers
   A learner always sees and partly edits their own profile. */
const ROLES = ['global_admin', 'programme_owner', 'regional_coordinator', 'content_editor', 'assessor', 'technical_admin'];

const has = (grants, role, where = {}) => grants.some((g) => g.role === role
  && (where.programmeId === undefined || !g.programme_id || g.programme_id === where.programmeId)
  && (where.regionId === undefined || !g.region_id || g.region_id === where.regionId));
const admin = (grants) => has(grants, 'global_admin');

/** may this person (their grants and id) do this to that (its region, programme, owner)? */
function can(grants, action, { regionId, programmeId, personId, selfId } = {}) {
  const self = !!personId && personId === selfId;
  switch (action) {
    case 'person.read': return self || admin(grants) || (!!regionId && has(grants, 'regional_coordinator', { regionId }));
    case 'person.list': return admin(grants) || has(grants, 'regional_coordinator');
    case 'person.create': return admin(grants) || (!!regionId && has(grants, 'regional_coordinator', { regionId }));
    case 'person.edit': return self || admin(grants) || (!!regionId && has(grants, 'regional_coordinator', { regionId }));
    case 'person.merge': return admin(grants);
    case 'role.grant': return admin(grants);
    case 'audit.read': return admin(grants) || (!!programmeId && has(grants, 'programme_owner', { programmeId }));
    case 'view-as': return admin(grants);
    case 'programme.create': return admin(grants);
    case 'programme.edit': return admin(grants) || (!!programmeId && has(grants, 'programme_owner', { programmeId }));
    case 'content.draft': return admin(grants) || (!!programmeId && (has(grants, 'programme_owner', { programmeId }) || has(grants, 'content_editor', { programmeId })));
    case 'content.approve': return admin(grants) || (!!programmeId && has(grants, 'programme_owner', { programmeId }));
    case 'enrol': return self || admin(grants) || (!!programmeId && has(grants, 'programme_owner', { programmeId })) || (!!regionId && has(grants, 'regional_coordinator', { regionId }));
    case 'assess': return admin(grants) || (!!programmeId && (has(grants, 'programme_owner', { programmeId }) || has(grants, 'assessor', { programmeId })));
    case 'credential.change': return admin(grants) || (!!programmeId && has(grants, 'programme_owner', { programmeId }));
    case 'diagnostics.read': return admin(grants) || has(grants, 'technical_admin');
    case 'report.read': return admin(grants) || (!!programmeId && has(grants, 'programme_owner', { programmeId })) || (!!regionId && has(grants, 'regional_coordinator', { regionId }));
    default: return false;
  }
}

// the profile fields each kind of person may change (PER-06): learners only their own preferences
const SELF_FIELDS = ['preferred_name', 'locale'];
const ADMIN_FIELDS = ['legal_name', 'preferred_name', 'email', 'country', 'region_id', 'locale', 'status'];
function editableFields(grants, { regionId, personId, selfId }) {
  if (admin(grants) || (!!regionId && has(grants, 'regional_coordinator', { regionId }))) return ADMIN_FIELDS;
  return personId === selfId ? SELF_FIELDS : [];
}
/** the regions someone may see people in: 'all', or a list */
function regionsVisible(grants) {
  if (admin(grants)) return 'all';
  return [...new Set(grants.filter((g) => g.role === 'regional_coordinator' && g.region_id).map((g) => g.region_id))];
}

module.exports = { ROLES, can, editableFields, regionsVisible, SELF_FIELDS, ADMIN_FIELDS };
