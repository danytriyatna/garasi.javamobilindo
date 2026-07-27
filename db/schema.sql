-- ============================================================
-- Garasi Java Mobilindo — Skema Database (MySQL 8.0+)
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------- MASTER DATA ----------
CREATE TABLE IF NOT EXISTS akun_biaya (
  kode  VARCHAR(20) PRIMARY KEY,
  nama  TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS kas_bank (
  kode  VARCHAR(20) PRIMARY KEY,
  nama  TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS op_akun (
  kode  VARCHAR(20) PRIMARY KEY,
  nama  TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS leasing_umum (
  nama  VARCHAR(255) PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- KENDARAAN ----------
CREATE TABLE IF NOT EXISTS vehicles (
  kode          VARCHAR(20) PRIMARY KEY,
  no            INT NOT NULL,
  merk          TEXT,
  model         TEXT,
  `type`        TEXT,
  trans         TEXT,
  warna         TEXT,
  thn           INT,
  nopol         TEXT,
  odo           TEXT,
  rangka        TEXT,
  mesin         TEXT,
  bbm           TEXT,
  pajak_thn     DATE,
  pajak_5thn    DATE,
  `status`      VARCHAR(10) NOT NULL DEFAULT 'READY',
  beli          DECIMAL(14,2) DEFAULT 0,
  tgl_beli      DATE,
  kas_beli      TEXT,
  mediator_beli TEXT,
  penawaran     DECIMAL(14,2),
  target_nett   DECIMAL(14,2),
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_vehicles_status CHECK (`status` IN ('READY','BOOKED','SOLD'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(`status`);

-- Rincian pengeluaran (biaya rekondisi / perawatan) per unit
CREATE TABLE IF NOT EXISTS vehicle_expenses (
  id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vehicle_kode  VARCHAR(20) NOT NULL,
  tgl           DATE,
  akun          TEXT,
  kas           TEXT,
  keterangan    TEXT,
  nilai         DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_kode) REFERENCES vehicles(kode) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX IF NOT EXISTS idx_vexp_vehicle ON vehicle_expenses(vehicle_kode);
CREATE INDEX IF NOT EXISTS idx_vexp_tgl ON vehicle_expenses(tgl);

-- Data penjualan (1 unit = 1 penjualan aktif; relasi 1-ke-1 dengan vehicles)
CREATE TABLE IF NOT EXISTS sales (
  vehicle_kode    VARCHAR(20) PRIMARY KEY,
  tgl             DATE,
  harga           DECIMAL(14,2) NOT NULL DEFAULT 0,
  mediator        TEXT,
  mediator_jual   TEXT,
  metode          TEXT,
  fee             DECIMAL(14,2) DEFAULT 0,
  fee_mode        VARCHAR(10) DEFAULT 'rp',
  fee_raw         DECIMAL(14,2),
  trade_in        JSON,
  leasing         JSON,
  dp_direct       JSON,
  alamat          TEXT,
  telp            TEXT,
  no_spk          TEXT,
  tgl_pesan       DATE,
  no_kwitansi     TEXT,
  tgl_serah       DATE,
  nama_penyerah   TEXT,
  rek_bank        TEXT,
  rek_atas_nama   TEXT,
  rek_no          TEXT,
  checklist       JSON,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_kode) REFERENCES vehicles(kode) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Riwayat pembayaran / pelunasan per penjualan
CREATE TABLE IF NOT EXISTS sale_payments (
  id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vehicle_kode  VARCHAR(20) NOT NULL,
  tgl           DATE,
  jenis         TEXT,
  keterangan    TEXT,
  jumlah        DECIMAL(14,2) NOT NULL DEFAULT 0,
  kas           TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_kode) REFERENCES sales(vehicle_kode) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX IF NOT EXISTS idx_spay_vehicle ON sale_payments(vehicle_kode);

-- ---------- BIAYA OPERASIONAL ----------
CREATE TABLE IF NOT EXISTS op_costs (
  id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tgl         DATE,
  akun        TEXT,
  kas         TEXT,
  keterangan  TEXT,
  jumlah      DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX IF NOT EXISTS idx_opcosts_tgl ON op_costs(tgl);

-- ---------- KAS / BANK MASUK (di luar penjualan unit) ----------
CREATE TABLE IF NOT EXISTS cash_inflow (
  id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tgl         DATE,
  akun        TEXT,
  kas         TEXT,
  keterangan  TEXT,
  jumlah      DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX IF NOT EXISTS idx_cashinflow_tgl ON cash_inflow(tgl);

-- ---------- SALDO KAS/BANK PER PERIODE ----------
CREATE TABLE IF NOT EXISTS kas_bank_saldo (
  akun        VARCHAR(20) NOT NULL,
  tahun       INT NOT NULL,
  bulan       INT NOT NULL,
  saldo_awal  DECIMAL(14,2) NOT NULL DEFAULT 0,
  saldo_akhir DECIMAL(14,2) NOT NULL DEFAULT 0,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (akun, tahun, bulan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX IF NOT EXISTS idx_kbsaldo_periode ON kas_bank_saldo(tahun, bulan);

-- ---------- PENGGUNA (LOGIN & MANAJEMEN USER) ----------
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          VARCHAR(10) NOT NULL DEFAULT 'staff',
  active        TINYINT(1) NOT NULL DEFAULT 1,
  last_login    DATETIME,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_users_role CHECK (role IN ('admin','staff'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- PENGATURAN (HAK AKSES PER ROLE, DLL) ----------
CREATE TABLE IF NOT EXISTS settings (
  `key`   VARCHAR(100) PRIMARY KEY,
  `value` JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- DATA AKUN (CHART OF ACCOUNTS) ----------
CREATE TABLE IF NOT EXISTS accounts (
  kode VARCHAR(20) PRIMARY KEY,
  nama TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- DATA MEDIATOR (UTILITAS) ----------
CREATE TABLE IF NOT EXISTS mediators (
  id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  no_ktp        TEXT,
  nama_lengkap  TEXT NOT NULL,
  no_telp       TEXT,
  alamat        TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX IF NOT EXISTS idx_mediators_nama ON mediators(nama_lengkap(100));

-- ---------- SEED MASTER DATA ----------
INSERT IGNORE INTO akun_biaya (kode,nama) VALUES
 ('5201','Servis & Tune-up'),('5202','Ganti Oli'),('5203','Ban'),('5204','Aki'),
 ('5205','Kaki-kaki'),('5206','Kelistrikan'),('5207','Body & Cat'),('5208','Salon & Detailing'),
 ('5209','Interior'),('5210','Pajak & STNK'),('5211','Kelengkapan'),('5212','Lain-lain');

INSERT IGNORE INTO kas_bank (kode,nama) VALUES
 ('1101','Kas Besar'),('1102','Kas Kecil'),('1103','Bank BCA'),('1104','Bank Mandiri'),('1105','Bank BNI'),('1106','Bank BRI');

INSERT IGNORE INTO op_akun (kode,nama) VALUES
 ('6101','Gaji Karyawan'),('6102','Sewa Showroom'),('6103','Listrik & Air'),('6104','Internet & Telepon'),
 ('6105','Iklan & Marketing'),('6106','Perlengkapan Kantor'),('6107','BBM & Transportasi'),
 ('6108','Konsumsi'),('6109','Perawatan Showroom'),('6110','Lain-lain');

INSERT IGNORE INTO leasing_umum (nama) VALUES
 ('BCA Finance'),('Adira Finance'),('BAF (Bussan Auto Finance)'),('Mandiri Tunas Finance'),
 ('ACC (Astra Credit Companies)'),('OTO Finance'),('WOM Finance'),('Mega Auto Finance'),
 ('MPM Finance'),('CIMB Niaga Auto Finance'),('Maybank Finance');
