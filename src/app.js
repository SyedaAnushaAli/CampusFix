const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { verifyPassword } = require('./db');
const { computePriority } = require('./priority');
const { checkTransition } = require('./workflow');

const CATEGORIES = ['Electrical', 'Plumbing', 'Network/IT', 'Furniture', 'Cleaning', 'Other'];
const URGENCIES = ['low', 'medium', 'high'];

function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const sessions = new Map(); // token -> user (in memory; see limitations in report)
  const now = () => new Date().toISOString();

  // ---------- auth ----------
  function auth(...roles) {
    return (req, res, next) => {
      const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
      const user = m && sessions.get(m[1]);
      if (!user) return res.status(401).json({ error: 'Login required' });
      if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: 'Not allowed for your role' });
      req.user = user; next();
    };
  }
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'username and password are required' });
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!u || !verifyPassword(password, u.salt, u.hash)) return res.status(401).json({ error: 'Invalid username or password' });
    const token = crypto.randomBytes(24).toString('hex');
    const user = { id: u.id, name: u.name, role: u.role };
    sessions.set(token, user);
    res.json({ token, user });
  });

  // ---------- helpers ----------
  const addHistory = (requestId, status, note, actorId) =>
    db.prepare('INSERT INTO history (request_id,status,note,actor_id,at) VALUES (?,?,?,?,?)').run(requestId, status, note, actorId, now());
  const getRequest = (id) => db.prepare(`
    SELECT r.*, t.name AS technician_name FROM requests r LEFT JOIN users t ON t.id = r.technician_id WHERE r.id = ?`).get(id);
  const canView = (user, r) => {
    if (user.role === 'admin') return true;
    if (user.role === 'technician') return r.technician_id === user.id;
    return !!db.prepare('SELECT 1 FROM reporters WHERE request_id=? AND user_id=?').get(r.id, user.id);
  };

  // ---------- requests ----------
  app.post('/api/requests', auth('requester'), (req, res) => {
    const { category, location, description, urgency, safetyRisk = false, forceNew = false } = req.body || {};
    const errors = [];
    if (!CATEGORIES.includes(category)) errors.push('category must be one of: ' + CATEGORIES.join(', '));
    if (typeof location !== 'string' || !location.trim()) errors.push('location is required');
    if (typeof description !== 'string' || description.trim().length < 10) errors.push('description must be at least 10 characters');
    if (!URGENCIES.includes(urgency)) errors.push('urgency must be low, medium or high');
    if (errors.length) return res.status(400).json({ errors });

    const loc = location.trim();
    // Conflict resolution: easy submission vs. clean queue -> merge exact duplicates unless the user insists
    const dup = !forceNew && db.prepare(
      `SELECT * FROM requests WHERE category=? AND lower(location)=lower(?) AND status <> 'Resolved' ORDER BY id LIMIT 1`).get(category, loc);
    if (dup) {
      const already = db.prepare('SELECT 1 FROM reporters WHERE request_id=? AND user_id=?').get(dup.id, req.user.id);
      if (already) return res.status(409).json({ error: 'You have already reported this issue', requestId: dup.id });
      const count = dup.report_count + 1;
      const safety = dup.safety_risk || (safetyRisk ? 1 : 0);
      const p = computePriority({ urgency: dup.urgency, safetyRisk: safety, reportCount: count });
      db.prepare('UPDATE requests SET report_count=?, safety_risk=?, priority=?, priority_label=? WHERE id=?').run(count, safety, p.score, p.label, dup.id);
      db.prepare('INSERT INTO reporters (request_id,user_id) VALUES (?,?)').run(dup.id, req.user.id);
      addHistory(dup.id, dup.status, `Duplicate report merged (${count} reports)`, req.user.id);
      return res.status(200).json({ merged: true, request: getRequest(dup.id) });
    }
    const p = computePriority({ urgency, safetyRisk: !!safetyRisk, reportCount: 1 });
    const r = db.prepare(`INSERT INTO requests (category,location,description,urgency,safety_risk,priority,priority_label,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(category, loc, description.trim(), urgency, safetyRisk ? 1 : 0, p.score, p.label, now());
    const id = Number(r.lastInsertRowid);
    db.prepare('INSERT INTO reporters (request_id,user_id) VALUES (?,?)').run(id, req.user.id);
    addHistory(id, 'Open', 'Request submitted', req.user.id);
    res.status(201).json({ merged: false, request: getRequest(id) });
  });

  app.get('/api/requests', auth(), (req, res) => {
    let rows;
    const base = `SELECT r.*, t.name AS technician_name FROM requests r LEFT JOIN users t ON t.id = r.technician_id`;
    if (req.user.role === 'admin') rows = db.prepare(`${base} ORDER BY (r.status='Resolved'), r.priority DESC, r.id`).all();
    else if (req.user.role === 'technician') rows = db.prepare(`${base} WHERE r.technician_id=? ORDER BY (r.status='Resolved'), r.priority DESC`).all(req.user.id);
    else rows = db.prepare(`${base} JOIN reporters rp ON rp.request_id=r.id WHERE rp.user_id=? ORDER BY r.id DESC`).all(req.user.id);
    res.json(rows);
  });

  app.get('/api/requests/:id', auth(), (req, res) => {
    const r = getRequest(Number(req.params.id));
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (!canView(req.user, r)) return res.status(403).json({ error: 'Not allowed to view this request' });
    const history = db.prepare('SELECT h.status,h.note,h.at,u.name AS actor FROM history h JOIN users u ON u.id=h.actor_id WHERE request_id=? ORDER BY h.id').all(r.id);
    res.json({ ...r, history });
  });

  app.post('/api/requests/:id/assign', auth('admin'), (req, res) => {
    const r = getRequest(Number(req.params.id));
    if (!r) return res.status(404).json({ error: 'Request not found' });
    const tech = db.prepare(`SELECT * FROM users WHERE id=? AND role='technician'`).get(Number((req.body || {}).technicianId));
    if (!tech) return res.status(400).json({ error: 'technicianId must be a valid technician' });
    if (r.status !== 'Open') return res.status(409).json({ error: `Only Open requests can be assigned (current: ${r.status})` });
    db.prepare(`UPDATE requests SET technician_id=?, status='Assigned' WHERE id=?`).run(tech.id, r.id);
    addHistory(r.id, 'Assigned', `Assigned to ${tech.name}`, req.user.id);
    res.json(getRequest(r.id));
  });

  app.post('/api/requests/:id/status', auth(), (req, res) => {
    const r = getRequest(Number(req.params.id));
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (!canView(req.user, r)) return res.status(403).json({ error: 'Not allowed to update this request' });
    const { status, note } = req.body || {};
    const c = checkTransition(r.status, status, req.user.role);
    if (!c.ok) return res.status(c.forbidden ? 403 : 409).json({ error: c.error });
    if (c.noteRequired && (typeof note !== 'string' || !note.trim())) return res.status(400).json({ error: 'A note is required for this change' });
    // Reopening returns the job to the admin queue
    if (status === 'Open') db.prepare(`UPDATE requests SET status='Open', technician_id=NULL WHERE id=?`).run(r.id);
    else db.prepare('UPDATE requests SET status=? WHERE id=?').run(status, r.id);
    addHistory(r.id, status, (note || '').trim() || null, req.user.id);
    res.json(getRequest(r.id));
  });

  app.get('/api/technicians', auth('admin'), (req, res) =>
    res.json(db.prepare(`SELECT id,name FROM users WHERE role='technician'`).all()));

  app.get('/api/stats', auth('admin'), (req, res) => {
    const by = db.prepare('SELECT status, COUNT(*) AS n FROM requests GROUP BY status').all();
    const open = db.prepare(`SELECT COUNT(*) AS n, COALESCE(AVG(priority),0) AS avg FROM requests WHERE status <> 'Resolved'`).get();
    res.json({ byStatus: Object.fromEntries(by.map(x => [x.status, x.n])), unresolved: open.n, avgUnresolvedPriority: Math.round(open.avg * 10) / 10 });
  });

  return app;
}
module.exports = { createApp, CATEGORIES };
