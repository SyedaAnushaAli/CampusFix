// Status workflow: which role may move a request from one status to another
const STATUSES = ['Open', 'Assigned', 'In Progress', 'Resolved'];
const TRANSITIONS = {
  'Assigned':    { to: 'In Progress', roles: ['technician', 'admin'] },
  'In Progress': { to: 'Resolved',    roles: ['technician', 'admin'], noteRequired: true },
  'Resolved':    { to: 'Open',        roles: ['requester', 'admin'],  noteRequired: true } // reopen if fix failed
};
function checkTransition(from, to, role) {
  const rule = TRANSITIONS[from];
  if (!rule || rule.to !== to) return { ok: false, error: `Cannot change status from "${from}" to "${to}"` };
  if (!rule.roles.includes(role)) return { ok: false, error: `Role "${role}" may not make this change`, forbidden: true };
  return { ok: true, noteRequired: !!rule.noteRequired };
}
module.exports = { STATUSES, checkTransition };
