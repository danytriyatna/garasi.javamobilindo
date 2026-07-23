# Garasi Java Mobilindo — Aplikasi + Database PostgreSQL

Paket ini menjalankan aplikasi Data Kendaraan / Biaya Operasional / Laporan Laba Rugi
dengan data tersimpan permanen di **PostgreSQL**, sepenuhnya di komputer Anda sendiri
(tidak perlu internet setelah terpasang, tidak perlu hosting).

Struktur data disimpan di **database** (bukan lagi di file HTML atau localStorage),
sehingga:
- Data tetap ada meski browser ditutup, komputer dimatikan/di-restart.
- Bisa dicadangkan / dipindahkan dengan `pg_dump` seperti database sungguhan.
- Bisa "dilihat langsung" isinya lewat tool seperti pgAdmin/DBeaver bila suatu saat perlu.

## Isi paket
```
docker-compose.yml   -> menyalakan Postgres + server otomatis
Dockerfile           -> resep membangun server
db/schema.sql        -> struktur tabel database
server/              -> backend (Node.js + Express) yang menjembatani app <-> Postgres
public/index.html    -> aplikasi (tampilan) yang dibuka di browser
```

## Cara menjalankan (paling mudah — pakai Docker)

1. Install **Docker Desktop** (sekali saja): https://www.docker.com/products/docker-desktop/
   Buka Docker Desktop, tunggu sampai statusnya "running".
2. Buka Terminal / Command Prompt, masuk ke folder paket ini, contoh:
   ```
   cd garasi-db
   ```
3. Jalankan:
   ```
   docker compose up -d
   ```
   Tunggu 1-2 menit di percobaan pertama (mengunduh & menyiapkan database).
4. Buka browser ke: **http://localhost:3000**

Data contoh (26 kendaraan + 16 biaya operasional) otomatis terisi di percobaan pertama.
Setelah itu, semua yang Anda tambah/ubah/hapus di aplikasi tersimpan permanen di database.

### Menghentikan / menyalakan lagi
- Hentikan: `docker compose down` (data TIDAK hilang, tersimpan di volume Docker)
- Nyalakan lagi: `docker compose up -d`
- Melihat log server: `docker compose logs -f app`

### Mengosongkan total & mulai dari data contoh lagi (opsional, hati-hati)
```
docker compose down -v
docker compose up -d
```
`-v` menghapus volume database (semua data hilang), lalu data contoh awal akan
otomatis terisi ulang.

## Cara menjalankan TANPA Docker (manual)

Butuh: **PostgreSQL** (versi 14+) dan **Node.js** (versi 18+) terpasang di komputer.

1. Buat database & terapkan skema:
   ```
   createdb garasi_java_mobilindo
   psql -d garasi_java_mobilindo -f db/schema.sql
   ```
2. Masuk ke folder server, install dependency, lalu jalankan:
   ```
   cd server
   npm install
   set DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/garasi_java_mobilindo   (Windows CMD)
   $env:DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/garasi_java_mobilindo" (PowerShell)
   export DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/garasi_java_mobilindo (Mac/Linux)
   npm start
   ```
3. Buka browser ke **http://localhost:3000**

Data contoh otomatis terisi di percobaan pertama (server mendeteksi tabel `vehicles`
masih kosong lalu mengisinya dari `server/seed-data/`).

## Mencadangkan data (backup)

Dengan Docker:
```
docker compose exec db pg_dump -U garasi garasi_java_mobilindo > backup.sql
```

Memulihkan dari cadangan (ke database baru/kosong):
```
docker compose exec -T db psql -U garasi garasi_java_mobilindo < backup.sql
```

## Catatan penting

- Aplikasi (`http://localhost:3000`) hanya bisa dibuka **di komputer yang sama**
  tempat `docker compose up` dijalankan (sesuai kebutuhan Anda: 1 device, tanpa online).
- Jangan hapus folder `garasi-db` ini setelah setup — `docker-compose.yml` dan
  `db/schema.sql` dipakai setiap kali menyalakan ulang.
- Untuk pindah ke komputer lain di kemudian hari: cadangkan (`pg_dump`) di komputer lama,
  pasang paket ini di komputer baru, lalu pulihkan cadangannya.
