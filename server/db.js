const mysql = require('mysql2/promise');

// Konfigurasi koneksi database MySQL.
// Variabel environment dibaca dari proses Node (diset di cPanel Node.js App > Environment Variables).
const pool = mysql.createPool({
  host:     process.env.MYSQL_HOST     || 'localhost',
  user:     process.env.MYSQL_USER     || 'garasi',
  password: process.env.MYSQL_PASSWORD || 'garasi123',
  database: process.env.MYSQL_DATABASE || 'garasi_java_mobilindo',
  port:     parseInt(process.env.MYSQL_PORT || '3306', 10),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Kembalikan kolom DATE/DATETIME sebagai string (bukan objek Date JS),
  // supaya frontend bisa langsung pakai .slice(0,7) dll pada string tanggal.
  dateStrings: true,
  decimalNumbers: true,
  timezone: 'Z', // UTC
});

pool.on('error', (err) => {
  console.error('Koneksi database error:', err.message);
});

module.exports = { pool };
