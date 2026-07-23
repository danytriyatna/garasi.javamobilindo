// Mengisi data contoh (26 unit + 16 biaya operasional) HANYA saat tabel vehicles
// masih kosong (pertama kali server dijalankan). Dipanggil otomatis dari index.js.
const fs = require('fs');
const path = require('path');

function pengItem(p) {
  return { tgl: p.tgl || null, akun: p.akun || '', ket: (p.ket != null ? p.ket : (p.j || '')), n: p.n || 0, kas: p.kas || '' };
}

async function seedIfEmpty(pool) {
  const { rows } = await pool.query('SELECT count(*)::int AS c FROM vehicles');
  if (rows[0].c > 0) return; // sudah ada data (mungkin dari input pengguna) -> jangan disentuh

  const vehiclesPath = path.join(__dirname, 'seed-data', 'vehicles.json');
  const opcostsPath = path.join(__dirname, 'seed-data', 'opcosts.json');
  if (!fs.existsSync(vehiclesPath)) return;

  const vehicles = JSON.parse(fs.readFileSync(vehiclesPath, 'utf8'));
  const opcosts = fs.existsSync(opcostsPath) ? JSON.parse(fs.readFileSync(opcostsPath, 'utf8')) : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const v of vehicles) {
      await client.query(
        `INSERT INTO vehicles(kode,no,merk,model,type,trans,warna,thn,nopol,odo,rangka,mesin,bbm,pajak_thn,pajak_5thn,status,beli,tgl_beli,kas_beli,penawaran,target_nett)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [v.kode, v.no, v.merk, v.model, v.type, v.trans, v.warna, v.thn, v.nopol,
         (v.odo == null ? null : String(v.odo)), v.rangka, v.mesin, v.bbm,
         v.pajakThn || null, v.pajak5Thn || null, v.status || 'READY',
         v.beli || 0, v.tglBeli || null, v.kasBeli || null, v.penawaran || null, v.targetNett || null]
      );

      for (const p0 of (v.peng || [])) {
        const p = pengItem(p0);
        await client.query(
          `INSERT INTO vehicle_expenses(vehicle_kode,tgl,akun,kas,keterangan,nilai) VALUES ($1,$2,$3,$4,$5,$6)`,
          [v.kode, p.tgl, p.akun, p.kas, p.ket, p.n]
        );
      }

      if (v.jual) {
        const j = v.jual, dok = j.dok || {};
        await client.query(
          `INSERT INTO sales(vehicle_kode,tgl,harga,mediator,metode,fee,fee_mode,fee_raw,trade_in,leasing,
             alamat,telp,no_spk,tgl_pesan,no_kwitansi,tgl_serah,nama_penyerah,nama_kasir,rek_bank,rek_atas_nama,rek_no,checklist)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
          [v.kode, j.tgl || null, j.harga || 0, j.mediator || '', j.metode || 'Tunai',
           j.fee || 0, j.feeMode || 'rp', j.feeRaw ?? null,
           j.tt ? JSON.stringify(j.tt) : null, j.leasing ? JSON.stringify(j.leasing) : null,
           dok.alamat || null, dok.telp || null, dok.noSPK || null, dok.tglPesan || null,
           dok.noKwitansi || null, dok.tglSerah || null, dok.namaPenyerah || null, dok.namaKasir || null,
           dok.rekBank || null, dok.rekAtasNama || null, dok.rekNo || null, dok.checklist || []]
        );

        let pays;
        if (Array.isArray(j.pembayaran)) {
          pays = j.pembayaran;
        } else if (dok.jumlahBayar) {
          pays = [{ tgl: j.tgl, jenis: 'Tanda Jadi / DP', ket: '', jumlah: dok.jumlahBayar, kas: '' }];
        } else {
          const ttN = (j.tt && j.tt.nilai) || 0;
          const net = Math.max(0, (j.harga || 0) - ttN);
          pays = [{ tgl: j.tgl, jenis: 'Pembayaran Tunai', ket: 'Pelunasan (data awal)', jumlah: net, kas: '' }];
        }
        for (const p of pays) {
          await client.query(
            `INSERT INTO sale_payments(vehicle_kode,tgl,jenis,keterangan,jumlah,kas) VALUES ($1,$2,$3,$4,$5,$6)`,
            [v.kode, p.tgl || null, p.jenis || '', p.ket || '', p.jumlah || 0, p.kas || '']
          );
        }
      }
    }

    for (const o of opcosts) {
      await client.query(
        `INSERT INTO op_costs(tgl,akun,kas,keterangan,jumlah) VALUES ($1,$2,$3,$4,$5)`,
        [o.tgl || null, o.akun || '', o.kas || '', o.ket || '', o.jumlah || 0]
      );
    }

    await client.query('COMMIT');
    console.log(`Data awal dimuat: ${vehicles.length} kendaraan, ${opcosts.length} biaya operasional.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Gagal memuat data awal:', e);
  } finally {
    client.release();
  }
}

module.exports = { seedIfEmpty };

// Membuat akun admin default HANYA saat tabel users masih kosong (instalasi pertama kali).
// Tidak pernah menimpa/menghapus akun yang sudah ada.
async function seedDefaultAdmin(pool) {
  const bcrypt = require('bcryptjs');
  const { rows } = await pool.query('SELECT count(*)::int AS c FROM users');
  if (rows[0].c > 0) return;
  const hash = await bcrypt.hash('admin123', 10);
  await pool.query(
    `INSERT INTO users (username, password_hash, name, role) VALUES ($1,$2,$3,'admin')`,
    ['admin', hash, 'Administrator']
  );
  console.log('Akun admin default dibuat -> username: admin / password: admin123 (segera ganti passwordnya!)');
}
module.exports.seedDefaultAdmin = seedDefaultAdmin;

// Hak akses default untuk role 'staff' -- permisif (semua boleh) supaya perilaku
// yang sudah ada tidak berubah tiba-tiba. Admin selalu penuh, tidak diatur di sini.
const DEFAULT_STAFF_PERMS = {
  menu_kendaraan: true, menu_operasional: true, menu_labarugi: true,
  kendaraan_tambah: true, kendaraan_edit: true, kendaraan_hapus: true, kendaraan_export: true,
  operasional_tambah: true, operasional_edit: true, operasional_hapus: true, operasional_export: true,
};
async function seedDefaultSettings(pool) {
  const { rows } = await pool.query("SELECT 1 FROM settings WHERE key='staff_permissions'");
  if (rows.length > 0) return;
  await pool.query("INSERT INTO settings(key, value) VALUES ('staff_permissions', $1)", [JSON.stringify(DEFAULT_STAFF_PERMS)]);
  console.log('Hak akses default untuk role staff dibuat (semua diizinkan).');
}
module.exports.seedDefaultSettings = seedDefaultSettings;
module.exports.DEFAULT_STAFF_PERMS = DEFAULT_STAFF_PERMS;
