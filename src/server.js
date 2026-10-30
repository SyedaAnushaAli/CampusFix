const { openDb, seedUsers } = require('./db');
const { createApp } = require('./app');
const fresh = !require('fs').existsSync('campusfix.db');
const db = openDb('campusfix.db');
if (fresh) seedUsers(db);
const port = process.env.PORT || 3100;
createApp(db).listen(port, () => console.log(`CampusFix running on http://localhost:${port}`));
