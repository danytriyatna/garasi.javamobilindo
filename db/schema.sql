-- ============================================================
-- Garasi Java Mobilindo — Skema Database (PostgreSQL)
-- ============================================================

-- ---------- MASTER DATA ----------
CREATE TABLE IF NOT EXISTS akun_biaya (
  kode  text PRIMARY KEY,
  nama  text NOT NULL
);

CREATE TABLE IF NOT EXISTS kas_bank (
  kode  text PRIMARY KEY,
  nama  text NOT NULL
);

CREATE TABLE IF NOT EXISTS op_akun (
  kode  text PRIMARY KEY,
  nama  text NOT NULL
);

CREATE TABLE IF NOT EXISTS leasing_umum (
  nama  text PRIMARY KEY
);

-- ---------- KENDARAAN ----------
CREATE TABLE IF NOT EXISTS vehicles (
  kode          text PRIMARY KEY,
  no            integer NOT NULL,
  merk          text,
  model         text,
  type          text,
  trans         text,
  warna         text,
  thn           integer,
  nopol         text,
  odo           text,          -- disimpan sebagai teks (ada data lama non-numerik, mis. "112XXX")
  rangka        text,
  mesin         text,
  bbm           text,
  pajak_thn     date,
  pajak_5thn    date,
  status        text NOT NULL DEFAULT 'READY' CHECK (status IN ('READY','SOLD')),
  beli          numeric(14,2) DEFAULT 0,
  tgl_beli      date,
  kas_beli      text,
  penawaran     numeric(14,2),
  target_nett   numeric(14,2),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);

-- Rincian pengeluaran (biaya rekondisi / perawatan) per unit
CREATE TABLE IF NOT EXISTS vehicle_expenses (
  id            bigserial PRIMARY KEY,
  vehicle_kode  text NOT NULL REFERENCES vehicles(kode) ON DELETE CASCADE,
  tgl           date,
  akun          text,
  kas           text,
  keterangan    text,
  nilai         numeric(14,2) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vexp_vehicle ON vehicle_expenses(vehicle_kode);
CREATE INDEX IF NOT EXISTS idx_vexp_tgl ON vehicle_expenses(tgl);

-- Data penjualan (1 unit = 1 penjualan aktif; relasi 1-ke-1 dengan vehicles)
CREATE TABLE IF NOT EXISTS sales (
  vehicle_kode    text PRIMARY KEY REFERENCES vehicles(kode) ON DELETE CASCADE,
  tgl             date,
  harga           numeric(14,2) NOT NULL DEFAULT 0,
  mediator        text,          -- nama pembeli
  metode          text,          -- Tunai / Transfer / Kredit (Leasing) / Tukar Tambah
  fee             numeric(14,2) DEFAULT 0,   -- nilai komisi (Rp), hasil akhir
  fee_mode        text DEFAULT 'rp',         -- 'rp' | 'pct'
  fee_raw         numeric(14,2),             -- angka mentah yang diketik user (rp atau %)
  trade_in        jsonb,          -- {merk,model,thn,warna,nopol,nilai,addStock}
  leasing         jsonb,          -- {perusahaan,dp,tenor,angsuran}
  alamat          text,
  telp            text,
  no_spk          text,
  tgl_pesan       date,
  no_kwitansi     text,
  tgl_serah       date,
  nama_penyerah   text,
  nama_kasir      text,
  rek_bank        text,
  rek_atas_nama   text,
  rek_no          text,
  checklist       text[] DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Riwayat pembayaran / pelunasan per penjualan
CREATE TABLE IF NOT EXISTS sale_payments (
  id            bigserial PRIMARY KEY,
  vehicle_kode  text NOT NULL REFERENCES sales(vehicle_kode) ON DELETE CASCADE,
  tgl           date,
  jenis         text,     -- Tanda Jadi/DP, Angsuran, Pelunasan, dst.
  keterangan    text,
  jumlah        numeric(14,2) NOT NULL DEFAULT 0,
  kas           text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_spay_vehicle ON sale_payments(vehicle_kode);

-- ---------- BIAYA OPERASIONAL ----------
CREATE TABLE IF NOT EXISTS op_costs (
  id          bigserial PRIMARY KEY,
  tgl         date,
  akun        text,
  kas         text,
  keterangan  text,
  jumlah      numeric(14,2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opcosts_tgl ON op_costs(tgl);
CREATE INDEX IF NOT EXISTS idx_opcosts_akun ON op_costs(akun);

-- trigger updated_at sederhana
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vehicles_updated ON vehicles;
CREATE TRIGGER trg_vehicles_updated BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sales_updated ON sales;
CREATE TRIGGER trg_sales_updated BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- SEED MASTER DATA ----------
INSERT INTO akun_biaya (kode,nama) VALUES
 ('5201','Servis & Tune-up'),('5202','Ganti Oli'),('5203','Ban'),('5204','Aki'),
 ('5205','Kaki-kaki'),('5206','Kelistrikan'),('5207','Body & Cat'),('5208','Salon & Detailing'),
 ('5209','Interior'),('5210','Pajak & STNK'),('5211','Kelengkapan'),('5212','Lain-lain')
ON CONFLICT (kode) DO NOTHING;

INSERT INTO kas_bank (kode,nama) VALUES
 ('1101','Kas Tunai'),('1102','Bank BCA'),('1103','Bank Mandiri'),('1104','Bank BNI'),('1105','Bank BRI')
ON CONFLICT (kode) DO NOTHING;

INSERT INTO op_akun (kode,nama) VALUES
 ('6101','Gaji Karyawan'),('6102','Sewa Showroom'),('6103','Listrik & Air'),('6104','Internet & Telepon'),
 ('6105','Iklan & Marketing'),('6106','Perlengkapan Kantor'),('6107','BBM & Transportasi'),
 ('6108','Konsumsi'),('6109','Perawatan Showroom'),('6110','Lain-lain')
ON CONFLICT (kode) DO NOTHING;

INSERT INTO leasing_umum (nama) VALUES
 ('BCA Finance'),('Adira Finance'),('BAF (Bussan Auto Finance)'),('Mandiri Tunas Finance'),
 ('ACC (Astra Credit Companies)'),('OTO Finance'),('WOM Finance'),('Mega Auto Finance'),
 ('MPM Finance'),('CIMB Niaga Auto Finance'),('Maybank Finance')
ON CONFLICT (nama) DO NOTHING;

-- ---------- PENGGUNA (LOGIN & MANAJEMEN USER) ----------
CREATE TABLE IF NOT EXISTS users (
  id            bigserial PRIMARY KEY,
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
  active        boolean NOT NULL DEFAULT true,
  last_login    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- PENGATURAN (HAK AKSES PER ROLE, DLL) ----------
CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

