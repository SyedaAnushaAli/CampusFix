# CampusFix – Campus Maintenance Request Tracker
SCD Lab 16 (open-ended CEP). Students report campus problems, an admin triages them by computed priority and assigns technicians, technicians update the status.

## Run
    npm install
    npm start        # http://localhost:3100  (needs Node 22+)
    npm test         # 26 automated tests, writes reports/junit.xml

Demo users (password `Pass1234`): `student1`, `student2` (requesters), `tech1` (technician), `admin1` (admin).

## Structure
- `src/db.js` – SQLite schema, password hashing (scrypt)
- `src/priority.js` – priority scoring rules
- `src/workflow.js` – allowed status transitions per role
- `src/app.js` – REST API (Express)
- `public/index.html` – role-based web UI
- `tests/` – Jest + Supertest tests
- `.github/workflows/ci.yml` – CI pipeline
