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
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='staff_permissions'");
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
    await pool.query(
      "INSERT INTO settings(key,value) VALUES ('staff_permissions',$1) ON CONFLICT (key) DO UPDATE SET value=$1",
      [JSON.stringify(clean)]
    );
    res.json({ ok: true, permissions: clean });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menyimpan hak akses' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi.' });
    const { rows } = await pool.query('SELECT * FROM users WHERE username=$1 AND active=true', [username]);
    const u = rows[0];
    if (!u) return res.status(401).json({ error: 'Username atau password salah.' });
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Username atau password salah.' });
    req.session.user = { id: u.id, username: u.username, name: u.name, role: u.role };
    await pool.query('UPDATE users SET last_login=now() WHERE id=$1', [u.id]);
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
    const { rows } = await pool.query('SELECT id,username,name,role,active,last_login,created_at FROM users ORDER BY id');
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal mengambil data user' }); }
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, name, role } = req.body || {};
    if (!username || !password || !name) return res.status(400).json({ error: 'Username, password, dan nama wajib diisi.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users(username,password_hash,name,role) VALUES ($1,$2,$3,$4) RETURNING id',
      [username, hash, name, role === 'admin' ? 'admin' : 'staff']
    );
    res.json({ id: rows[0].id });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Username sudah dipakai.' });
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
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET name=$1, role=$2, active=$3, password_hash=$4 WHERE id=$5',
        [name, role === 'admin' ? 'admin' : 'staff', active !== false, hash, id]);
    } else {
      await pool.query('UPDATE users SET name=$1, role=$2, active=$3 WHERE id=$4',
        [name, role === 'admin' ? 'admin' : 'staff', active !== false, id]);
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menyimpan user' }); }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (String(req.session.user.id) === String(req.params.id)) {
      return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri.' });
    }
    const { rows } = await pool.query("SELECT count(*)::int AS c FROM users WHERE role='admin' AND active=true");
    const target = await pool.query('SELECT role FROM users WHERE id=$1', [req.params.id]);
    if (target.rows[0] && target.rows[0].role === 'admin' && rows[0].c <= 1) {
      return res.status(400).json({ error: 'Tidak bisa menghapus satu-satunya admin yang tersisa.' });
    }
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menghapus user' }); }
});

// ---------------------------------------------------------------
// Data Akun (Chart of Accounts) — baca boleh siapa saja yang login
// (dipakai untuk dropdown Kas Masuk/Keluar), ubah khusus admin.
// ---------------------------------------------------------------
app.get('/api/accounts', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT kode, nama FROM accounts ORDER BY kode');
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal mengambil data akun' }); }
});

app.post('/api/accounts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { kode, nama } = req.body || {};
    if (!kode || !nama) return res.status(400).json({ error: 'Kode dan nama akun wajib diisi.' });
    if (!/^[1-6]\d{3}$/.test(kode)) return res.status(400).json({ error: 'Kode akun harus 4 digit, diawali angka 1-6 (kepala kelompok).' });
    await pool.query('INSERT INTO accounts(kode, nama) VALUES ($1,$2)', [kode, nama]);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Kode akun sudah dipakai.' });
    console.error(e); res.status(500).json({ error: 'Gagal menambah akun' });
  }
});

app.put('/api/accounts/:kode', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nama } = req.body || {};
    if (!nama) return res.status(400).json({ error: 'Nama akun wajib diisi.' });
    await pool.query('UPDATE accounts SET nama=$1 WHERE kode=$2', [nama, req.params.kode]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menyimpan akun' }); }
});

app.delete('/api/accounts/:kode', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM accounts WHERE kode=$1', [req.params.kode]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menghapus akun' }); }
});

// ---------------------------------------------------------------
// Helpers: rakit bentuk JSON kendaraan sesuai yang dipakai frontend
// ---------------------------------------------------------------
async function fetchAllVehicles() {
  const { rows: vs } = await pool.query('SELECT * FROM vehicles ORDER BY no');
  if (vs.length === 0) return [];
  const kodes = vs.map((v) => v.kode);

  const { rows: exps } = await pool.query(
    'SELECT * FROM vehicle_expenses WHERE vehicle_kode = ANY($1) ORDER BY id',
    [kodes]
  );
  const { rows: sales } = await pool.query(
    'SELECT * FROM sales WHERE vehicle_kode = ANY($1)',
    [kodes]
  );
  const { rows: pays } = await pool.query(
    'SELECT * FROM sale_payments WHERE vehicle_kode = ANY($1) ORDER BY id',
    [kodes]
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
    beli: v.beli || 0, tglBeli: v.tgl_beli, kasBeli: v.kas_beli,
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
        namaPenyerah: sale.nama_penyerah || '', namaKasir: sale.nama_kasir || '',
        rekBank: sale.rek_bank || '', rekAtasNama: sale.rek_atas_nama || '', rekNo: sale.rek_no || '',
        checklist: sale.checklist || [],
      },
      pembayaran: pays.map((p) => ({ tgl: p.tgl, jenis: p.jenis || '', ket: p.keterangan || '', jumlah: p.jumlah || 0, kas: p.kas || '' })),
    };
  }
  return out;
}

async function upsertVehicle(client, kode, body) {
  const beli = body.beli || 0;
  await client.query(
    `INSERT INTO vehicles(kode,no,merk,model,type,trans,warna,thn,nopol,odo,rangka,mesin,bbm,pajak_thn,pajak_5thn,status,beli,tgl_beli,kas_beli,penawaran,target_nett)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (kode) DO UPDATE SET
       merk=$3,model=$4,type=$5,trans=$6,warna=$7,thn=$8,nopol=$9,odo=$10,rangka=$11,mesin=$12,bbm=$13,
       pajak_thn=$14,pajak_5thn=$15,status=$16,beli=$17,tgl_beli=$18,kas_beli=$19,penawaran=$20,target_nett=$21`,
    [kode, body.no, body.merk, body.model, body.type, body.trans, body.warna, body.thn, body.nopol,
     body.odo == null ? null : String(body.odo), body.rangka, body.mesin, body.bbm,
     body.pajakThn || null, body.pajak5Thn || null, body.status || 'READY',
     beli, body.tglBeli || null, body.kasBeli || null, body.penawaran || null, body.targetNett || null]
  );

  await client.query('DELETE FROM vehicle_expenses WHERE vehicle_kode=$1', [kode]);
  for (const p of body.peng || []) {
    await client.query(
      'INSERT INTO vehicle_expenses(vehicle_kode,tgl,akun,kas,keterangan,nilai) VALUES ($1,$2,$3,$4,$5,$6)',
      [kode, p.tgl || null, p.akun || '', p.kas || '', p.ket || '', p.n || 0]
    );
  }

  await client.query('DELETE FROM sales WHERE vehicle_kode=$1', [kode]); // cascade hapus sale_payments juga
  if (body.jual) {
    const j = body.jual, dok = j.dok || {};
    await client.query(
      `INSERT INTO sales(vehicle_kode,tgl,harga,mediator,metode,fee,fee_mode,fee_raw,trade_in,leasing,
         alamat,telp,no_spk,tgl_pesan,no_kwitansi,tgl_serah,nama_penyerah,nama_kasir,rek_bank,rek_atas_nama,rek_no,checklist)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [kode, j.tgl || null, j.harga || 0, j.mediator || '', j.metode || 'Tunai',
       j.fee || 0, j.feeMode || 'rp', j.feeRaw ?? null,
       j.tt ? JSON.stringify(j.tt) : null, j.leasing ? JSON.stringify(j.leasing) : null,
       dok.alamat || null, dok.telp || null, dok.noSPK || null, dok.tglPesan || null,
       dok.noKwitansi || null, dok.tglSerah || null, dok.namaPenyerah || null, dok.namaKasir || null,
       dok.rekBank || null, dok.rekAtasNama || null, dok.rekNo || null, dok.checklist || []]
    );
    for (const p of j.pembayaran || []) {
      await client.query(
        'INSERT INTO sale_payments(vehicle_kode,tgl,jenis,keterangan,jumlah,kas) VALUES ($1,$2,$3,$4,$5,$6)',
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT COALESCE(MAX(no),0)+1 AS next FROM vehicles');
    const no = rows[0].next;
    const kode = 'K-' + String(no).padStart(3, '0');
    await upsertVehicle(client, kode, { ...req.body, no });
    await client.query('COMMIT');
    res.json({ kode, no });
  } catch (e) {
    await client.query('ROLLBACK'); console.error(e);
    res.status(500).json({ error: 'Gagal menambah kendaraan' });
  } finally { client.release(); }
});

app.put('/api/vehicles/:kode', requireAuth, checkPerm('kendaraan_edit'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT no FROM vehicles WHERE kode=$1', [req.params.kode]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Unit tidak ditemukan' }); }
    await upsertVehicle(client, req.params.kode, { ...req.body, no: req.body.no || rows[0].no });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK'); console.error(e);
    res.status(500).json({ error: 'Gagal menyimpan kendaraan' });
  } finally { client.release(); }
});

app.delete('/api/vehicles/:kode', requireAuth, checkPerm('kendaraan_hapus'), async (req, res) => {
  try {
    await pool.query('DELETE FROM vehicles WHERE kode=$1', [req.params.kode]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menghapus kendaraan' }); }
});

// ---------------------------------------------------------------
// Routes: BIAYA OPERASIONAL
// ---------------------------------------------------------------
app.get('/api/opcosts', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM op_costs ORDER BY tgl DESC NULLS LAST, id DESC');
    res.json(rows.map((o) => ({ id: o.id, tgl: o.tgl, akun: o.akun || '', kas: o.kas || '', ket: o.keterangan || '', jumlah: o.jumlah || 0 })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal mengambil biaya operasional' }); }
});

app.post('/api/opcosts', requireAuth, checkPerm('operasional_tambah'), async (req, res) => {
  try {
    const b = req.body;
    const { rows } = await pool.query(
      'INSERT INTO op_costs(tgl,akun,kas,keterangan,jumlah) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [b.tgl || null, b.akun || '', b.kas || '', b.ket || '', b.jumlah || 0]
    );
    res.json({ id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menambah biaya operasional' }); }
});

app.put('/api/opcosts/:id', requireAuth, checkPerm('operasional_edit'), async (req, res) => {
  try {
    const b = req.body;
    await pool.query(
      'UPDATE op_costs SET tgl=$1,akun=$2,kas=$3,keterangan=$4,jumlah=$5 WHERE id=$6',
      [b.tgl || null, b.akun || '', b.kas || '', b.ket || '', b.jumlah || 0, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menyimpan biaya operasional' }); }
});

app.delete('/api/opcosts/:id', requireAuth, checkPerm('operasional_hapus'), async (req, res) => {
  try {
    await pool.query('DELETE FROM op_costs WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menghapus biaya operasional' }); }
});

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'connected' }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

const PORT = process.env.PORT || 3000;

async function waitForDb(maxTries = 30, delayMs = 1000) {
  let lastErr;
  for (let i = 1; i <= maxTries; i++) {
    try { await pool.query('SELECT 1'); return; }
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
