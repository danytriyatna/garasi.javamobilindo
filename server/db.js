const { Pool, types } = require('pg');

// Kembalikan kolom DATE sebagai string 'YYYY-MM-DD' (bukan objek Date JS),
// karena frontend memakai .slice(0,7) dkk pada string tanggal.
types.setTypeParser(1082, (val) => val);
// Kembalikan kolom NUMERIC sebagai number (bukan string), karena frontend
// melakukan operasi aritmatika langsung pada nilai ini.
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

const connectionString = process.env.DATABASE_URL ||
  'postgresql://garasi:garasi123@localhost:5432/garasi_java_mobilindo';

// Database lokal (Docker) tidak pakai SSL. Database cloud seperti Neon/Supabase
// mewajibkan SSL (biasanya ditandai "sslmode=require" di connection string-nya).
// Kita nyalakan SSL otomatis kalau itu terdeteksi, supaya 1 kode yang sama bisa
// dipakai baik untuk database lokal maupun database di server/cloud.
const needsSSL = /sslmode=require|neon\.tech|supabase\.co/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
});

module.exports = { pool };
