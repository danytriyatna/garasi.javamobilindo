const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { seedIfEmpty, seedDefaultAdmin, seedDefaultSettings, seedDefaultAccounts, DEFAULT_STAFF_PERMS } = require('./seed');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'garasi-java-mobilindo-secret-ubah-ini',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }, // 12 jam
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------
// Autentikasi: middleware & endpoint login/logout/me
// ---------------------------------------------------------------
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Sesi login habis atau belum login.' });
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Hanya admin yang bisa mengakses ini.' });
}

async function getEffectivePermissions(role) {
  if (role === 'admin') {
    const all = {}; Object.keys(DEFAULT_STAFF_PERMS).forEach(k => all[k] = true); return all;
  }
  const [rows] = await pool.execute("SELECT `value` FROM settings WHERE `key`='staff_permissions'");
  const stored = rows[0] ? rows[0].value : {};
  return { ...DEFAULT_STAFF_PERMS, ...stored };
}
function checkPerm(key) {
  return async (req, res, next) => {
    try {
      if (!req.session || !req.session.user) return res.status(401).json({ error: 'Belum login.' });
      if (req.session.user.role === 'admin') return next();
      const perms = await getEffectivePermissions('staff');
      if (perms[key]) return next();
      return res.status(403).json({ error: 'Anda tidak memiliki izin untuk melakukan aksi ini.' });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal memeriksa hak akses.' }); }
  };
}

app.get('/api/permissions', requireAuth, async (req, res) => {
  try { res.json(await getEffectivePermissions(req.session.user.role)); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Gagal mengambil hak akses' }); }
});
app.put('/api/permissions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const clean = {};
    Object.keys(DEFAULT_STAFF_PERMS).forEach(k => { clean[k] = !!body[k]; });
    await pool.execute(
      "INSERT INTO settings(`key`,`value`) VALUES ('staff_permissions',?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [JSON.stringify(clean)]
    );
    res.json({ ok: true, permissions: clean });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menyimpan hak akses' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi.' });
    const [rows] = await pool.execute('SELECT * FROM users WHERE username=? AND active=1', [username]);
    const u = rows[0];
    if (!u) return res.status(401).json({ error: 'Username atau password salah.' });
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Username atau password salah.' });
    req.session.user = { id: u.id, username: u.username, name: u.name, role: u.role };
    await pool.execute('UPDATE users SET last_login=NOW() WHERE id=?', [u.id]);
    res.json({ ok: true, user: req.session.user });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal login.' }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.user) return res.json({ user: req.session.user });
  res.status(401).json({ error: 'Belum login.' });
});

// ---------------------------------------------------------------
// Manajemen User (khusus admin)
// ---------------------------------------------------------------
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id,username,name,role,active,last_login,created_at FROM users ORDER BY id');
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal mengambil data user' }); }
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, name, role } = req.body || {};
    if (!username || !password || !name) return res.status(400).json({ error: 'Username, password, dan nama wajib diisi.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO users(username,password_hash,name,role) VALUES (?,?,?,?)',
      [username, hash, name, role === 'admin' ? 'admin' : 'staff']
    );
    res.json({ id: result.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Username sudah dipakai.' });
    console.error(e); res.status(500).json({ error: 'Gagal menambah user' });
  }
});

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, role, active, password } = req.body || {};
    const id = req.params.id;
    if (String(req.session.user.id) === String(id) && active === false) {
      return res.status(400).json({ error: 'Tidak bisa menonaktifkan akun sendiri.' });
    }
    if (String(req.session.user.id) === String(id) && role && role !== 'admin') {
      return res.status(400).json({ error: 'Tidak bisa menurunkan peran akun sendiri.' });
    }
    const activeVal = active !== false ? 1 : 0;
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });
      const hash = await bcrypt.hash(password, 10);
      await pool.execute('UPDATE users SET name=?, role=?, active=?, password_hash=? WHERE id=?',
        [name, role === 'admin' ? 'admin' : 'staff', activeVal, hash, id]);
    } else {
      await pool.execute('UPDATE users SET name=?, role=?, active=? WHERE id=?',
        [name, role === 'admin' ? 'admin' : 'staff', activeVal, id]);
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menyimpan user' }); }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (String(req.session.user.id) === String(req.params.id)) {
      return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri.' });
    }
    const [rows] = await pool.execute("SELECT COUNT(*) AS c FROM users WHERE role='admin' AND active=1");
    const [target] = await pool.execute('SELECT role FROM users WHERE id=?', [req.params.id]);
    if (target[0] && target[0].role === 'admin' && Number(rows[0].c) <= 1) {
      return res.status(400).json({ error: 'Tidak bisa menghapus satu-satunya admin yang tersisa.' });
    }
    await pool.execute('DELETE FROM users WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menghapus user' }); }
});

// ---------------------------------------------------------------
// Data Akun (Chart of Accounts) — baca boleh siapa saja yang login
// (dipakai untuk dropdown Kas Masuk/Keluar), ubah khusus admin.
// ---------------------------------------------------------------
app.get('/api/accounts', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT kode, nama FROM accounts ORDER BY kode');
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal mengambil data akun' }); }
});

app.post('/api/accounts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { kode, nama } = req.body || {};
    if (!kode || !nama) return res.status(400).json({ error: 'Kode dan nama akun wajib diisi.' });
    if (!/^[1-6]\d{3}$/.test(kode)) return res.status(400).json({ error: 'Kode akun harus 4 digit, diawali angka 1-6 (kepala kelompok).' });
    await pool.execute('INSERT INTO accounts(kode, nama) VALUES (?,?)', [kode, nama]);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Kode akun sudah dipakai.' });
    console.error(e); res.status(500).json({ error: 'Gagal menambah akun' });
  }
});

app.put('/api/accounts/:kode', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nama } = req.body || {};
    if (!nama) return res.status(400).json({ error: 'Nama akun wajib diisi.' });
    await pool.execute('UPDATE accounts SET nama=? WHERE kode=?', [nama, req.params.kode]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menyimpan akun' }); }
});

app.delete('/api/accounts/:kode', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.execute('DELETE FROM accounts WHERE kode=?', [req.params.kode]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menghapus akun' }); }
});

// ---------------------------------------------------------------
// Data Mediator (Utilitas) — baca boleh siapa saja yang login, ubah khusus admin.
// ---------------------------------------------------------------
app.get('/api/mediators', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, no_ktp, nama_lengkap, no_telp, alamat FROM mediators ORDER BY nama_lengkap');
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal mengambil data mediator' }); }
});

app.post('/api/mediators', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { noKtp, namaLengkap, noTelp, alamat } = req.body || {};
    if (!namaLengkap) return res.status(400).json({ error: 'Nama lengkap wajib diisi.' });
    const [result] = await pool.execute(
      'INSERT INTO mediators(no_ktp,nama_lengkap,no_telp,alamat) VALUES (?,?,?,?)',
      [noKtp || null, namaLengkap, noTelp || null, alamat || null]
    );
    res.json({ id: result.insertId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menambah mediator' }); }
});

app.put('/api/mediators/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { noKtp, namaLengkap, noTelp, alamat } = req.body || {};
    if (!namaLengkap) return res.status(400).json({ error: 'Nama lengkap wajib diisi.' });
    await pool.execute(
      'UPDATE mediators SET no_ktp=?, nama_lengkap=?, no_telp=?, alamat=? WHERE id=?',
      [noKtp || null, namaLengkap, noTelp || null, alamat || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menyimpan mediator' }); }
});

app.delete('/api/mediators/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.execute('DELETE FROM mediators WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menghapus mediator' }); }
});

// ---------------------------------------------------------------
// Helpers: rakit bentuk JSON kendaraan sesuai yang dipakai frontend
// ---------------------------------------------------------------
async function fetchAllVehicles() {
  const [vs] = await pool.execute('SELECT * FROM vehicles ORDER BY no');
  if (vs.length === 0) return [];
  const kodes = vs.map((v) => v.kode);
  const placeholders = kodes.map(() => '?').join(',');

  const [exps] = await pool.execute(
    `SELECT * FROM vehicle_expenses WHERE vehicle_kode IN (${placeholders}) ORDER BY id`,
    kodes
  );
  const [sales] = await pool.execute(
    `SELECT * FROM sales WHERE vehicle_kode IN (${placeholders})`,
    kodes
  );
  const [pays] = await pool.execute(
    `SELECT * FROM sale_payments WHERE vehicle_kode IN (${placeholders}) ORDER BY id`,
    kodes
  );

  const expByVeh = {}, saleByVeh = {}, payByVeh = {};
  for (const e of exps) (expByVeh[e.vehicle_kode] ||= []).push(e);
  for (const s of sales) saleByVeh[s.vehicle_kode] = s;
  for (const p of pays) (payByVeh[p.vehicle_kode] ||= []).push(p);

  return vs.map((v) => toVehicleJSON(v, expByVeh[v.kode] || [], saleByVeh[v.kode], payByVeh[v.kode] || []));
}

function toVehicleJSON(v, exps, sale, pays) {
  const out = {
    kode: v.kode, no: v.no, merk: v.merk, model: v.model, type: v.type,
    trans: v.trans, warna: v.warna, thn: v.thn, nopol: v.nopol,
    odo: v.odo === null ? null : (isNaN(v.odo) ? v.odo : Number(v.odo)),
    rangka: v.rangka, mesin: v.mesin, bbm: v.bbm,
    pajakThn: v.pajak_thn, pajak5Thn: v.pajak_5thn, status: v.status,
    beli: v.beli || 0, tglBeli: v.tgl_beli, kasBeli: v.kas_beli, mediatorBeli: v.mediator_beli,
    penawaran: v.penawaran, targetNett: v.target_nett,
    peng: exps.map((e) => ({ tgl: e.tgl, akun: e.akun || '', ket: e.keterangan || '', n: e.nilai || 0, kas: e.kas || '' })),
    jual: null,
  };
  if (sale) {
    out.jual = {
      tgl: sale.tgl, harga: sale.harga || 0, mediator: sale.mediator || '',
      metode: sale.metode || 'Tunai', fee: sale.fee || 0, feeMode: sale.fee_mode || 'rp',
      feeRaw: sale.fee_raw,
      tt: sale.trade_in || null,
      leasing: sale.leasing || null,
      dok: {
        alamat: sale.alamat || '', telp: sale.telp || '', noSPK: sale.no_spk || '',
        tglPesan: sale.tgl_pesan, noKwitansi: sale.no_kwitansi || '', tglSerah: sale.tgl_serah,
        namaPenyerah: sale.nama_penyerah || '',
        rekBank: sale.rek_bank || '', rekAtasNama: sale.rek_atas_nama || '', rekNo: sale.rek_no || '',
        checklist: sale.checklist || [],
      },
      pembayaran: pays.map((p) => ({ tgl: p.tgl, jenis: p.jenis || '', ket: p.keterangan || '', jumlah: p.jumlah || 0, kas: p.kas || '' })),
    };
  }
  return out;
}

async function upsertVehicle(conn, kode, body) {
  const beli = body.beli || 0;
  await conn.execute(
    `INSERT INTO vehicles(kode,no,merk,model,\`type\`,trans,warna,thn,nopol,odo,rangka,mesin,bbm,pajak_thn,pajak_5thn,\`status\`,beli,tgl_beli,kas_beli,penawaran,target_nett,mediator_beli)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       merk=VALUES(merk),model=VALUES(model),\`type\`=VALUES(\`type\`),trans=VALUES(trans),warna=VALUES(warna),thn=VALUES(thn),nopol=VALUES(nopol),odo=VALUES(odo),rangka=VALUES(rangka),mesin=VALUES(mesin),bbm=VALUES(bbm),
       pajak_thn=VALUES(pajak_thn),pajak_5thn=VALUES(pajak_5thn),\`status\`=VALUES(\`status\`),beli=VALUES(beli),tgl_beli=VALUES(tgl_beli),kas_beli=VALUES(kas_beli),penawaran=VALUES(penawaran),target_nett=VALUES(target_nett),mediator_beli=VALUES(mediator_beli)`,
    [kode, body.no, body.merk, body.model, body.type, body.trans, body.warna, body.thn, body.nopol,
     body.odo == null ? null : String(body.odo), body.rangka, body.mesin, body.bbm,
     body.pajakThn || null, body.pajak5Thn || null, body.status || 'READY',
     beli, body.tglBeli || null, body.kasBeli || null, body.penawaran || null, body.targetNett || null,
     body.mediatorBeli || null]
  );

  await conn.execute('DELETE FROM vehicle_expenses WHERE vehicle_kode=?', [kode]);
  for (const p of body.peng || []) {
    await conn.execute(
      'INSERT INTO vehicle_expenses(vehicle_kode,tgl,akun,kas,keterangan,nilai) VALUES (?,?,?,?,?,?)',
      [kode, p.tgl || null, p.akun || '', p.kas || '', p.ket || '', p.n || 0]
    );
  }

  await conn.execute('DELETE FROM sales WHERE vehicle_kode=?', [kode]); // cascade hapus sale_payments juga
  if (body.jual) {
    const j = body.jual, dok = j.dok || {};
    await conn.execute(
      `INSERT INTO sales(vehicle_kode,tgl,harga,mediator,metode,fee,fee_mode,fee_raw,trade_in,leasing,
         alamat,telp,no_spk,tgl_pesan,no_kwitansi,tgl_serah,nama_penyerah,rek_bank,rek_atas_nama,rek_no,checklist)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [kode, j.tgl || null, j.harga || 0, j.mediator || '', j.metode || 'Tunai',
       j.fee || 0, j.feeMode || 'rp', j.feeRaw ?? null,
       j.tt ? JSON.stringify(j.tt) : null, j.leasing ? JSON.stringify(j.leasing) : null,
       dok.alamat || null, dok.telp || null, dok.noSPK || null, dok.tglPesan || null,
       dok.noKwitansi || null, dok.tglSerah || null, dok.namaPenyerah || null,
       dok.rekBank || null, dok.rekAtasNama || null, dok.rekNo || null,
       JSON.stringify(dok.checklist || [])]
    );
    for (const p of j.pembayaran || []) {
      await conn.execute(
        'INSERT INTO sale_payments(vehicle_kode,tgl,jenis,keterangan,jumlah,kas) VALUES (?,?,?,?,?,?)',
        [kode, p.tgl || null, p.jenis || '', p.ket || '', p.jumlah || 0, p.kas || '']
      );
    }
  }
}

// ---------------------------------------------------------------
// Routes: KENDARAAN
// ---------------------------------------------------------------
app.get('/api/vehicles', requireAuth, async (req, res) => {
  try { res.json(await fetchAllVehicles()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Gagal mengambil data kendaraan' }); }
});

app.post('/api/vehicles', requireAuth, checkPerm('kendaraan_tambah'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT COALESCE(MAX(no),0)+1 AS next FROM vehicles');
    const no = rows[0].next;
    const kode = 'K-' + String(no).padStart(3, '0');
    await upsertVehicle(conn, kode, { ...req.body, no });
    await conn.commit();
    res.json({ kode, no });
  } catch (e) {
    await conn.rollback(); console.error(e);
    res.status(500).json({ error: 'Gagal menambah kendaraan' });
  } finally { conn.release(); }
});

app.put('/api/vehicles/:kode', requireAuth, checkPerm('kendaraan_edit'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT no FROM vehicles WHERE kode=?', [req.params.kode]);
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ error: 'Unit tidak ditemukan' }); }
    await upsertVehicle(conn, req.params.kode, { ...req.body, no: req.body.no || rows[0].no });
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback(); console.error(e);
    res.status(500).json({ error: 'Gagal menyimpan kendaraan' });
  } finally { conn.release(); }
});

app.delete('/api/vehicles/:kode', requireAuth, checkPerm('kendaraan_hapus'), async (req, res) => {
  try {
    await pool.execute('DELETE FROM vehicles WHERE kode=?', [req.params.kode]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menghapus kendaraan' }); }
});

// ---------------------------------------------------------------
// Routes: BIAYA OPERASIONAL
// ---------------------------------------------------------------
app.get('/api/opcosts', requireAuth, async (req, res) => {
  try {
    // NULL di ORDER BY: taruh di belakang (MySQL: tgl IS NULL ASC = NULL terakhir)
    const [rows] = await pool.execute('SELECT * FROM op_costs ORDER BY tgl IS NULL ASC, tgl DESC, id DESC');
    res.json(rows.map((o) => ({ id: o.id, tgl: o.tgl, akun: o.akun || '', kas: o.kas || '', ket: o.keterangan || '', jumlah: o.jumlah || 0 })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal mengambil biaya operasional' }); }
});

app.post('/api/opcosts', requireAuth, checkPerm('operasional_tambah'), async (req, res) => {
  try {
    const b = req.body;
    const [result] = await pool.execute(
      'INSERT INTO op_costs(tgl,akun,kas,keterangan,jumlah) VALUES (?,?,?,?,?)',
      [b.tgl || null, b.akun || '', b.kas || '', b.ket || '', b.jumlah || 0]
    );
    res.json({ id: result.insertId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menambah biaya operasional' }); }
});

app.put('/api/opcosts/:id', requireAuth, checkPerm('operasional_edit'), async (req, res) => {
  try {
    const b = req.body;
    await pool.execute(
      'UPDATE op_costs SET tgl=?,akun=?,kas=?,keterangan=?,jumlah=? WHERE id=?',
      [b.tgl || null, b.akun || '', b.kas || '', b.ket || '', b.jumlah || 0, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menyimpan biaya operasional' }); }
});

app.delete('/api/opcosts/:id', requireAuth, checkPerm('operasional_hapus'), async (req, res) => {
  try {
    await pool.execute('DELETE FROM op_costs WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menghapus biaya operasional' }); }
});

// ---------------------------------------------------------------
// Routes: KAS / BANK MASUK (di luar penjualan unit)
// ---------------------------------------------------------------
app.get('/api/cashinflow', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM cash_inflow ORDER BY tgl IS NULL ASC, tgl DESC, id DESC');
    res.json(rows.map((o) => ({ id: o.id, tgl: o.tgl, akun: o.akun || '', kas: o.kas || '', ket: o.keterangan || '', jumlah: o.jumlah || 0 })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal mengambil kas masuk' }); }
});

app.post('/api/cashinflow', requireAuth, checkPerm('kas_masuk_tambah'), async (req, res) => {
  try {
    const b = req.body;
    const [result] = await pool.execute(
      'INSERT INTO cash_inflow(tgl,akun,kas,keterangan,jumlah) VALUES (?,?,?,?,?)',
      [b.tgl || null, b.akun || '', b.kas || '', b.ket || '', b.jumlah || 0]
    );
    res.json({ id: result.insertId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menambah kas masuk' }); }
});

app.put('/api/cashinflow/:id', requireAuth, checkPerm('kas_masuk_edit'), async (req, res) => {
  try {
    const b = req.body;
    await pool.execute(
      'UPDATE cash_inflow SET tgl=?,akun=?,kas=?,keterangan=?,jumlah=? WHERE id=?',
      [b.tgl || null, b.akun || '', b.kas || '', b.ket || '', b.jumlah || 0, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menyimpan kas masuk' }); }
});

app.delete('/api/cashinflow/:id', requireAuth, checkPerm('kas_masuk_hapus'), async (req, res) => {
  try {
    await pool.execute('DELETE FROM cash_inflow WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menghapus kas masuk' }); }
});

// ---------------------------------------------------------------
// Routes: SALDO KAS/BANK PER PERIODE (Laporan Mutasi Kas/Bank)
// ---------------------------------------------------------------
app.get('/api/kasbank-saldo', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT akun, tahun, bulan, saldo_awal, saldo_akhir FROM kas_bank_saldo ORDER BY tahun, bulan, akun');
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal mengambil saldo kas/bank' }); }
});

app.post('/api/kasbank-saldo', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { tahun, bulan, items } = req.body || {};
    const th = parseInt(tahun, 10), bl = parseInt(bulan, 10);
    if (!th || !bl || bl < 1 || bl > 12) return res.status(400).json({ error: 'Periode tahun/bulan tidak valid.' });
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Data item saldo tidak valid.' });
    await conn.beginTransaction();
    for (const it of items) {
      if (!it || !it.akun) continue;
      await conn.execute(
        `INSERT INTO kas_bank_saldo(akun,tahun,bulan,saldo_awal,saldo_akhir,updated_at)
         VALUES (?,?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE saldo_awal=VALUES(saldo_awal), saldo_akhir=VALUES(saldo_akhir), updated_at=NOW()`,
        [it.akun, th, bl, it.saldoAwal || 0, it.saldoAkhir || 0]
      );
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback(); console.error(e);
    res.status(500).json({ error: 'Gagal menyimpan saldo kas/bank' });
  } finally { conn.release(); }
});

app.get('/api/health', async (req, res) => {
  try { await pool.execute('SELECT 1'); res.json({ ok: true, db: 'connected' }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

const PORT = process.env.PORT || 3000;

async function waitForDb(maxTries = 30, delayMs = 1000) {
  let lastErr;
  for (let i = 1; i <= maxTries; i++) {
    try { await pool.execute('SELECT 1'); return; }
    catch (e) {
      lastErr = e;
      console.log(`Menunggu database siap... (${i}/${maxTries}) - alasan: ${e.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('Database tidak bisa dihubungi setelah beberapa kali percobaan. Alasan terakhir: ' + (lastErr && lastErr.message));
}

(async () => {
  try {
    await waitForDb();
    await seedIfEmpty(pool);
    await seedDefaultAdmin(pool);
    await seedDefaultSettings(pool);
    await seedDefaultAccounts(pool);
    app.listen(PORT, () => console.log(`Garasi Java Mobilindo server jalan di http://localhost:${PORT}`));
  } catch (e) {
    console.error('Gagal memulai server:', e);
    process.exit(1);
  }
})();
