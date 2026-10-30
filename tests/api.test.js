const request = require('supertest');
const { openDb, seedUsers } = require('../src/db');
const { createApp } = require('../src/app');

let app;
const loginAs = async (u) => (await request(app).post('/api/login').send({ username: u, password: 'Pass1234' })).body.token;
const auth = (t) => ({ Authorization: 'Bearer ' + t });
const good = { category: 'Electrical', location: 'Block A, Lab 3', description: 'Ceiling light flickers constantly', urgency: 'medium' };

beforeEach(() => { const db = openDb(':memory:'); seedUsers(db); app = createApp(db); });

describe('authentication', () => {
  test('TC01 valid login returns a token and role', async () => {
    const r = await request(app).post('/api/login').send({ username: 'student1', password: 'Pass1234' });
    expect(r.status).toBe(200); expect(r.body.token).toBeTruthy(); expect(r.body.user.role).toBe('requester');
  });
  test('TC02 wrong password is rejected', async () => {
    const r = await request(app).post('/api/login').send({ username: 'student1', password: 'nope' });
    expect(r.status).toBe(401);
  });
  test('API requires login', async () => expect((await request(app).get('/api/requests')).status).toBe(401));
});

describe('submitting requests', () => {
  test('TC03 student submits a valid request (201, status Open, priority computed)', async () => {
    const t = await loginAs('student1');
    const r = await request(app).post('/api/requests').set(auth(t)).send(good);
    expect(r.status).toBe(201); expect(r.body.request.status).toBe('Open');
    expect(r.body.request.priority).toBe(20); expect(r.body.request.priority_label).toBe('Medium');
  });
  test('TC04 invalid request is rejected with clear errors (400)', async () => {
    const t = await loginAs('student1');
    const r = await request(app).post('/api/requests').set(auth(t)).send({ category: 'Magic', location: ' ', description: 'short', urgency: 'now' });
    expect(r.status).toBe(400); expect(r.body.errors.length).toBe(4);
  });
  test('TC05 same issue from another student is merged and priority rises', async () => {
    const t1 = await loginAs('student1'), t2 = await loginAs('student2');
    await request(app).post('/api/requests').set(auth(t1)).send(good);
    const r = await request(app).post('/api/requests').set(auth(t2)).send({ ...good, location: 'block a, lab 3' });
    expect(r.status).toBe(200); expect(r.body.merged).toBe(true);
    expect(r.body.request.report_count).toBe(2); expect(r.body.request.priority).toBe(25);
    const mine = await request(app).get('/api/requests').set(auth(t2));
    expect(mine.body.length).toBe(1); // merging reporter can still track it
  });
  test('TC06 same student cannot report the same open issue twice (409)', async () => {
    const t = await loginAs('student1');
    await request(app).post('/api/requests').set(auth(t)).send(good);
    expect((await request(app).post('/api/requests').set(auth(t)).send(good)).status).toBe(409);
  });
  test('forceNew creates a separate request instead of merging', async () => {
    const t1 = await loginAs('student1'), t2 = await loginAs('student2');
    await request(app).post('/api/requests').set(auth(t1)).send(good);
    const r = await request(app).post('/api/requests').set(auth(t2)).send({ ...good, forceNew: true });
    expect(r.status).toBe(201);
  });
});

describe('access control and workflow', () => {
  test('TC07 student cannot assign requests (403)', async () => {
    const t = await loginAs('student1');
    await request(app).post('/api/requests').set(auth(t)).send(good);
    expect((await request(app).post('/api/requests/1/assign').set(auth(t)).send({ technicianId: 3 })).status).toBe(403);
  });
  test('TC08 student cannot see another student\'s request (403)', async () => {
    const t1 = await loginAs('student1'), t2 = await loginAs('student2');
    await request(app).post('/api/requests').set(auth(t1)).send(good);
    expect((await request(app).get('/api/requests/1').set(auth(t2))).status).toBe(403);
  });
  test('TC09 full lifecycle: submit -> assign -> start -> resolve -> history recorded', async () => {
    const s = await loginAs('student1'), a = await loginAs('admin1'), t = await loginAs('tech1');
    await request(app).post('/api/requests').set(auth(s)).send(good);
    const techs = (await request(app).get('/api/technicians').set(auth(a))).body;
    expect((await request(app).post('/api/requests/1/assign').set(auth(a)).send({ technicianId: techs[0].id })).body.status).toBe('Assigned');
    expect((await request(app).post('/api/requests/1/status').set(auth(t)).send({ status: 'In Progress' })).body.status).toBe('In Progress');
    expect((await request(app).post('/api/requests/1/status').set(auth(t)).send({ status: 'Resolved', note: 'Replaced starter' })).body.status).toBe('Resolved');
    const d = await request(app).get('/api/requests/1').set(auth(s));
    expect(d.body.history.map(h => h.status)).toEqual(['Open', 'Assigned', 'In Progress', 'Resolved']);
  });
  test('TC10 technician cannot resolve without a note (400) or skip steps (409)', async () => {
    const s = await loginAs('student1'), a = await loginAs('admin1'), t = await loginAs('tech1');
    await request(app).post('/api/requests').set(auth(s)).send(good);
    await request(app).post('/api/requests/1/assign').set(auth(a)).send({ technicianId: 3 });
    expect((await request(app).post('/api/requests/1/status').set(auth(t)).send({ status: 'Resolved', note: 'x' })).status).toBe(409);
    await request(app).post('/api/requests/1/status').set(auth(t)).send({ status: 'In Progress' });
    expect((await request(app).post('/api/requests/1/status').set(auth(t)).send({ status: 'Resolved' })).status).toBe(400);
  });
  test('TC11 requester can reopen a resolved request, which returns to the admin queue', async () => {
    const s = await loginAs('student1'), a = await loginAs('admin1'), t = await loginAs('tech1');
    await request(app).post('/api/requests').set(auth(s)).send(good);
    await request(app).post('/api/requests/1/assign').set(auth(a)).send({ technicianId: 3 });
    await request(app).post('/api/requests/1/status').set(auth(t)).send({ status: 'In Progress' });
    await request(app).post('/api/requests/1/status').set(auth(t)).send({ status: 'Resolved', note: 'done' });
    const r = await request(app).post('/api/requests/1/status').set(auth(s)).send({ status: 'Open', note: 'Still flickering' });
    expect(r.status).toBe(200); expect(r.body.status).toBe('Open'); expect(r.body.technician_id).toBeNull();
  });
  test('admin queue is ordered by priority (hazard first)', async () => {
    const s = await loginAs('student1'), a = await loginAs('admin1');
    await request(app).post('/api/requests').set(auth(s)).send({ ...good, location: 'Library', urgency: 'low' });
    await request(app).post('/api/requests').set(auth(s)).send({ ...good, location: 'Cafeteria', urgency: 'medium', safetyRisk: true });
    const list = (await request(app).get('/api/requests').set(auth(a))).body;
    expect(list.map(x => x.location)).toEqual(['Cafeteria', 'Library']);
  });
});

describe('known limitations (documented behaviour)', () => {
  test('TC14 LIMITATION: differently worded location of the same room is NOT detected as a duplicate', async () => {
    const t1 = await loginAs('student1'), t2 = await loginAs('student2');
    await request(app).post('/api/requests').set(auth(t1)).send({ ...good, location: 'Block A, Lab 3' });
    const r = await request(app).post('/api/requests').set(auth(t2)).send({ ...good, location: 'Lab 3 (Block A)' });
    expect(r.status).toBe(201); // two separate requests are created; fix = location dropdown / normalisation
    expect(r.body.merged).toBe(false);
  });
});

describe('non-functional checks', () => {
  test('TC12 SQL injection text is stored as plain data and does not break queries', async () => {
    const s = await loginAs('student1');
    const r = await request(app).post('/api/requests').set(auth(s)).send({ ...good, location: "x'; DROP TABLE requests;--" });
    expect(r.status).toBe(201);
    expect((await request(app).get('/api/requests').set(auth(s))).body.length).toBe(1);
  });
  test('TC13 admin list of 1000 requests responds in under 200 ms (NFR)', async () => {
    const db = openDb(':memory:'); seedUsers(db); const app2 = createApp(db);
    const ins = db.prepare(`INSERT INTO requests (category,location,description,urgency,priority,priority_label,created_at) VALUES ('Other',?,'bulk generated request','low',10,'Low','2026-01-01')`);
    db.exec('BEGIN'); for (let i = 0; i < 1000; i++) ins.run('Room ' + i); db.exec('COMMIT');
    const tok = (await request(app2).post('/api/login').send({ username: 'admin1', password: 'Pass1234' })).body.token;
    const t0 = process.hrtime.bigint();
    const r = await request(app2).get('/api/requests').set(auth(tok));
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log('LIST_1000_MS=' + ms.toFixed(1));
    expect(r.body.length).toBe(1000); expect(ms).toBeLessThan(200);
  });
});
