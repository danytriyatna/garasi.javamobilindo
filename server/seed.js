// Mengisi data contoh (26 unit + 16 biaya operasional) HANYA saat tabel vehicles
// masih kosong (pertama kali server dijalankan). Dipanggil otomatis dari index.js.
const fs = require('fs');
const path = require('path');

function pengItem(p) {
  return { tgl: p.tgl || null, akun: p.akun || '', ket: (p.ket != null ? p.ket : (p.j || '')), n: p.n || 0, kas: p.kas || '' };
}

async function seedIfEmpty(pool) {
  const [rows] = await pool.execute('SELECT COUNT(*) AS c FROM vehicles');
  if (Number(rows[0].c) > 0) return; // sudah ada data -> jangan disentuh

  const vehiclesPath = path.join(__dirname, 'seed-data', 'vehicles.json');
  const opcostsPath = path.join(__dirname, 'seed-data', 'opcosts.json');
  if (!fs.existsSync(vehiclesPath)) return;

  const vehicles = JSON.parse(fs.readFileSync(vehiclesPath, 'utf8'));
  const opcosts = fs.existsSync(opcostsPath) ? JSON.parse(fs.readFileSync(opcostsPath, 'utf8')) : [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const v of vehicles) {
      await conn.execute(
        `INSERT INTO vehicles(kode,no,merk,model,\`type\`,trans,warna,thn,nopol,odo,rangka,mesin,bbm,pajak_thn,pajak_5thn,\`status\`,beli,tgl_beli,kas_beli,penawaran,target_nett)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [v.kode, v.no, v.merk, v.model, v.type, v.trans, v.warna, v.thn, v.nopol,
         (v.odo == null ? null : String(v.odo)), v.rangka, v.mesin, v.bbm,
         v.pajakThn || null, v.pajak5Thn || null, v.status || 'READY',
         v.beli || 0, v.tglBeli || null, v.kasBeli || null, v.penawaran || null, v.targetNett || null]
      );

      for (const p0 of (v.peng || [])) {
        const p = pengItem(p0);
        await conn.execute(
          `INSERT INTO vehicle_expenses(vehicle_kode,tgl,akun,kas,keterangan,nilai) VALUES (?,?,?,?,?,?)`,
          [v.kode, p.tgl, p.akun, p.kas, p.ket, p.n]
        );
      }

      if (v.jual) {
        const j = v.jual, dok = j.dok || {};
        await conn.execute(
          `INSERT INTO sales(vehicle_kode,tgl,harga,mediator,metode,fee,fee_mode,fee_raw,trade_in,leasing,dp_direct,
             alamat,telp,no_spk,tgl_pesan,no_kwitansi,tgl_serah,nama_penyerah,rek_bank,rek_atas_nama,rek_no,checklist)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [v.kode, j.tgl || null, j.harga || 0, j.mediator || '', j.metode || 'Tunai',
           j.fee || 0, j.feeMode || 'rp', j.feeRaw ?? null,
           j.tt ? JSON.stringify(j.tt) : null,
           j.leasing ? JSON.stringify(j.leasing) : null,
           j.dpDirect ? JSON.stringify(j.dpDirect) : null,
           dok.alamat || null, dok.telp || null, dok.noSPK || null, dok.tglPesan || null,
           dok.noKwitansi || null, dok.tglSerah || null, dok.namaPenyerah || null,
           dok.rekBank || null, dok.rekAtasNama || null, dok.rekNo || null,
           JSON.stringify(dok.checklist || [])]
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
          await conn.execute(
            `INSERT INTO sale_payments(vehicle_kode,tgl,jenis,keterangan,jumlah,kas) VALUES (?,?,?,?,?,?)`,
            [v.kode, p.tgl || null, p.jenis || '', p.ket || '', p.jumlah || 0, p.kas || '']
          );
        }
      }
    }

    for (const o of opcosts) {
      await conn.execute(
        `INSERT INTO op_costs(tgl,akun,kas,keterangan,jumlah) VALUES (?,?,?,?,?)`,
        [o.tgl || null, o.akun || '', o.kas || '', o.ket || '', o.jumlah || 0]
      );
    }

    await conn.commit();
    console.log(`Data awal dimuat: ${vehicles.length} kendaraan, ${opcosts.length} biaya operasional.`);
  } catch (e) {
    await conn.rollback();
    console.error('Gagal memuat data awal:', e);
  } finally {
    conn.release();
  }
}

module.exports = { seedIfEmpty };

// Membuat akun admin default HANYA saat tabel users masih kosong (instalasi pertama kali).
// Tidak pernah menimpa/menghapus akun yang sudah ada.
async function seedDefaultAdmin(pool) {
  const bcrypt = require('bcryptjs');
  const [rows] = await pool.execute('SELECT COUNT(*) AS c FROM users');
  if (Number(rows[0].c) > 0) return;
  const hash = await bcrypt.hash('admin123', 10);
  await pool.execute(
    `INSERT INTO users (username, password_hash, name, role) VALUES (?,?,?,'admin')`,
    ['admin', hash, 'Administrator']
  );
  console.log('Akun admin default dibuat -> username: admin / password: admin123 (segera ganti passwordnya!)');
}
module.exports.seedDefaultAdmin = seedDefaultAdmin;

// Hak akses default untuk role 'staff' -- permisif (semua boleh) supaya perilaku
// yang sudah ada tidak berubah tiba-tiba. Admin selalu penuh, tidak diatur di sini.
const DEFAULT_STAFF_PERMS = {
  menu_kendaraan: true, menu_operasional: true, menu_kas_masuk: true, menu_labarugi: true, menu_mutasikas: true,
  kendaraan_tambah: true, kendaraan_edit: true, kendaraan_hapus: true, kendaraan_export: true,
  operasional_tambah: true, operasional_edit: true, operasional_hapus: true, operasional_export: true,
  kas_masuk_tambah: true, kas_masuk_edit: true, kas_masuk_hapus: true, kas_masuk_export: true,
};
async function seedDefaultSettings(pool) {
  const [rows] = await pool.execute("SELECT 1 FROM settings WHERE `key`='staff_permissions'");
  if (rows.length > 0) return;
  await pool.execute("INSERT INTO settings(`key`, `value`) VALUES ('staff_permissions', ?)", [JSON.stringify(DEFAULT_STAFF_PERMS)]);
  console.log('Hak akses default untuk role staff dibuat (semua diizinkan).');
}
module.exports.seedDefaultSettings = seedDefaultSettings;
module.exports.DEFAULT_STAFF_PERMS = DEFAULT_STAFF_PERMS;

// Referensi Data Akun (Chart of Accounts) untuk usaha jual-beli kendaraan bekas.
const DEFAULT_ACCOUNTS = [
  // 1xxx — Aset / Kas & Bank
  ['1001','Kas Besar'],
  ['1002','Kas Kecil'],
  ['1003','Bank BCA'],
  ['1004','Bank Mandiri'],
  ['1005','Bank BRI'],
  ['1006','Bank BNI'],
  ['1007','Piutang Usaha (Belum Lunas)'],
  ['1008','Persediaan Kendaraan (Stok Unit)'],
  ['1009','Uang Muka Pembelian Unit'],
  ['1010','Peralatan Kantor & Bengkel'],
  ['1011','Kendaraan Operasional'],
  // 2xxx — Kewajiban / Hutang
  ['2001','Hutang Usaha (Pemasok/Mitra)'],
  ['2002','Hutang Leasing/Bank (Pembiayaan Unit)'],
  ['2003','Titipan DP Pelanggan'],
  ['2004','Hutang Pajak'],
  ['2005','Hutang Gaji Karyawan'],
  // 3xxx — Ekuitas / Modal
  ['3001','Modal Pemilik'],
  ['3002','Prive (Pengambilan Pribadi Pemilik)'],
  ['3003','Laba Ditahan'],
  // 4xxx — Pendapatan / Kas Masuk
  ['4001','Pendapatan Penjualan Kendaraan'],
  ['4002','Pendapatan Komisi Mediator/Perantara'],
  ['4003','Pendapatan Jasa Titip Jual (Konsinyasi)'],
  ['4004','Pendapatan Tukar Tambah'],
  ['4005','Pendapatan Jasa Cuci/Detailing'],
  ['4006','Pendapatan Lain-lain'],
  // 5xxx — Biaya Perawatan Unit (HPP, langsung terkait 1 unit)
  ['5001','Servis & Tune-up'],
  ['5002','Ganti Oli & Filter'],
  ['5003','Perbaikan Body & Cat (Salon/Cat Body)'],
  ['5004','Ban & Velg'],
  ['5005','Aki & Kelistrikan'],
  ['5006','AC Mobil'],
  ['5007','Detailing & Poles'],
  ['5008','Pajak Kendaraan (STNK/Pajak Tahunan)'],
  ['5009','Biaya Balik Nama (BBN)'],
  ['5010','Biaya Derek/Transportasi Unit'],
  ['5011','Kunci & Aksesoris'],
  ['5012','Lain-lain (Biaya Perawatan)'],
  // 6xxx — Beban Usaha / Kas Keluar (operasional, tidak terkait 1 unit tertentu)
  ['6001','Gaji Karyawan'],
  ['6002','Sewa Showroom/Kantor'],
  ['6003','Listrik & Air'],
  ['6004','Internet & Telepon'],
  ['6005','Marketing & Iklan'],
  ['6006','Komisi Mediator/Sales'],
  ['6007','Perlengkapan Kantor (ATK)'],
  ['6008','Transportasi & BBM Operasional'],
  ['6009','Pajak & Perizinan Usaha'],
  ['6010','Biaya Bank/Admin'],
  ['6011','Lain-lain (Beban Usaha)'],
];
async function seedDefaultAccounts(pool) {
  const [rows] = await pool.execute('SELECT COUNT(*) AS c FROM accounts');
  if (Number(rows[0].c) === 0) {
    for (const [kode, nama] of DEFAULT_ACCOUNTS) {
      await pool.execute('INSERT IGNORE INTO accounts(kode,nama) VALUES (?,?)', [kode, nama]);
    }
    console.log(`Referensi Data Akun dibuat (${DEFAULT_ACCOUNTS.length} akun, kepala 1-6).`);
  } else {
    try {
      await pool.execute("UPDATE accounts SET nama = 'Kas Besar' WHERE nama = 'Kas Tunai'");
      await pool.execute("UPDATE accounts SET kode = CONCAT('TEMP_', kode)");
      for (const [kode, nama] of DEFAULT_ACCOUNTS) {
        const [exist] = await pool.execute('SELECT kode FROM accounts WHERE nama = ?', [nama]);
        if (exist.length > 0) {
          await pool.execute('UPDATE accounts SET kode = ? WHERE nama = ?', [kode, nama]);
        } else {
          await pool.execute('INSERT IGNORE INTO accounts(kode, nama) VALUES (?, ?)', [kode, nama]);
        }
      }
      await pool.execute("DELETE FROM accounts WHERE kode LIKE 'TEMP_%'");
      console.log('Migrasi Data Akun (Kas Besar, Kas Kecil, & Urutan Kode 1xxx) selesai.');
    } catch (e) {
      console.error('Migrasi data akun error:', e.message);
    }
  }
}
module.exports.seedDefaultAccounts = seedDefaultAccounts;
