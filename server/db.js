const { Pool, types } = require('pg');

// Kembalikan kolom DATE sebagai string 'YYYY-MM-DD' (bukan objek Date JS),
// karena frontend memakai .slice(0,7) dkk pada string tanggal.
types.setTypeParser(1082, (val) => val);
// Kembalikan kolom NUMERIC sebagai number (bukan string), karena frontend
// melakukan operasi aritmatika langsung pada nilai ini.
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://garasi:garasi123@localhost:5432/garasi_java_mobilindo',
});

module.exports = { pool };
