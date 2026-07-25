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
  // Database cloud (mis. Neon) bisa auto-suspend saat idle dan perlu waktu untuk "bangun".
  // Beri batas waktu supaya koneksi gagal cepat (dengan pesan error jelas) daripada
  // membuat request browser menggantung/loading tanpa batas.
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
});

// Cegah proses Node crash/hang kalau koneksi idle diputus paksa oleh database
// (mis. Neon yang auto-suspend memutus koneksi yang sedang tidak dipakai).
pool.on('error', (err) => {
  console.error('Koneksi database idle terputus tak terduga:', err.message);
});

module.exports = { pool };
