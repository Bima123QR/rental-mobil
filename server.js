require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Terjadi kesalahan di server.', detail: e.message }); });
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5) + 1;
const cleanPhone = p => String(p || '').replace(/[^\d+]/g, '');
const newCode = () => 'LJ' + Date.now().toString(36).toUpperCase().slice(-6);

function admin(req, res, next) {
  if (req.get('x-admin-key') !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Password admin salah.' });
  next();
}

app.get('/api/config', (_q, res) => res.json({ wa: process.env.WA_NUMBER }));

app.get('/api/cars', wrap(async (_q, res) => {
  const r = await pool.query('SELECT * FROM cars WHERE is_active ORDER BY price_per_day');
  res.json(r.rows);
}));

// Tanggal yang sudah terpakai untuk satu mobil
app.get('/api/cars/:id/booked', wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date
     FROM bookings WHERE car_id=$1 AND status IN ('pending','confirmed') AND end_date >= CURRENT_DATE ORDER BY start_date`, [req.params.id]);
  res.json(r.rows);
}));

app.post('/api/bookings', wrap(async (req, res) => {
  const { car_id, customer_name, phone, start_date, end_date, with_driver, notes } = req.body;
  const ph = cleanPhone(phone);
  if (!car_id || !customer_name?.trim() || ph.length < 9 || !start_date || !end_date)
    return res.status(400).json({ error: 'Lengkapi nama, nomor HP, mobil, dan tanggal.' });
  if (new Date(end_date) < new Date(start_date)) return res.status(400).json({ error: 'Tanggal selesai harus setelah tanggal mulai.' });
  if (new Date(start_date) < new Date(new Date().toDateString())) return res.status(400).json({ error: 'Tanggal mulai tidak boleh kemarin.' });

  const car = (await pool.query('SELECT * FROM cars WHERE id=$1 AND is_active', [car_id])).rows[0];
  if (!car) return res.status(404).json({ error: 'Mobil tidak ditemukan.' });
  const clash = await pool.query(
    `SELECT 1 FROM bookings WHERE car_id=$1 AND status IN ('pending','confirmed') AND start_date <= $3 AND end_date >= $2 LIMIT 1`,
    [car_id, start_date, end_date]);
  if (clash.rowCount) return res.status(409).json({ error: 'Mobil sudah dipesan di tanggal tersebut. Pilih tanggal atau mobil lain.' });

  const total = days(start_date, end_date) * (car.price_per_day + (with_driver ? car.driver_fee : 0));
  const r = await pool.query(
    `INSERT INTO bookings (code,car_id,customer_name,phone,start_date,end_date,with_driver,notes,total_price)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING code,total_price`,
    [newCode(), car_id, customer_name.trim(), ph, start_date, end_date, !!with_driver, notes || null, total]);
  res.status(201).json({ ...r.rows[0], car: car.name });
}));

// Cek pesanan oleh pelanggan (kode + nomor HP)
app.get('/api/bookings/lookup', wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT b.code, c.name AS car, to_char(b.start_date,'YYYY-MM-DD') AS start_date, to_char(b.end_date,'YYYY-MM-DD') AS end_date,
            b.total_price, b.status FROM bookings b JOIN cars c ON c.id=b.car_id
     WHERE b.phone=$1 ORDER BY b.created_at DESC LIMIT 10`, [cleanPhone(req.query.phone)]);
  res.json(r.rows);
}));

app.post('/api/bookings/:code/cancel', wrap(async (req, res) => {
  const r = await pool.query(
    `UPDATE bookings SET status='cancelled' WHERE code=$1 AND phone=$2 AND status='pending' RETURNING code`,
    [req.params.code, cleanPhone(req.body.phone)]);
  if (!r.rowCount) return res.status(400).json({ error: 'Pesanan hanya bisa dibatalkan saat masih berstatus menunggu.' });
  res.json({ ok: true });
}));

// ---------- Admin ----------
app.get('/api/admin/bookings', admin, wrap(async (_q, res) => {
  const r = await pool.query(
    `SELECT b.id,b.code,c.name AS car,b.customer_name,b.phone,to_char(b.start_date,'YYYY-MM-DD') AS start_date,
            to_char(b.end_date,'YYYY-MM-DD') AS end_date,b.with_driver,b.notes,b.total_price,b.status
     FROM bookings b JOIN cars c ON c.id=b.car_id ORDER BY b.created_at DESC`);
  res.json(r.rows);
}));
app.patch('/api/admin/bookings/:id', admin, wrap(async (req, res) => {
  const r = await pool.query('UPDATE bookings SET status=$1 WHERE id=$2 RETURNING id', [req.body.status, req.params.id]);
  r.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Pesanan tidak ada.' });
}));
app.delete('/api/admin/bookings/:id', admin, wrap(async (req, res) => {
  await pool.query('DELETE FROM bookings WHERE id=$1', [req.params.id]); res.json({ ok: true });
}));
app.get('/api/admin/cars', admin, wrap(async (_q, res) => res.json((await pool.query('SELECT * FROM cars ORDER BY id')).rows)));
app.post('/api/admin/cars', admin, wrap(async (req, res) => {
  const c = req.body;
  const r = await pool.query(
    `INSERT INTO cars (name,category,seats,transmission,fuel,price_per_day,driver_fee,image_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [c.name, c.category, c.seats, c.transmission, c.fuel, c.price_per_day, c.driver_fee, c.image_url || null]);
  res.status(201).json(r.rows[0]);
}));
app.put('/api/admin/cars/:id', admin, wrap(async (req, res) => {
  const c = req.body;
  await pool.query(
    `UPDATE cars SET name=$1,category=$2,seats=$3,transmission=$4,fuel=$5,price_per_day=$6,driver_fee=$7,is_active=$8,image_url=$9 WHERE id=$10`,
    [c.name, c.category, c.seats, c.transmission, c.fuel, c.price_per_day, c.driver_fee, c.is_active, c.image_url || null, req.params.id]);
  res.json({ ok: true });
}));
app.delete('/api/admin/cars/:id', admin, wrap(async (req, res) => {
  const used = await pool.query('SELECT 1 FROM bookings WHERE car_id=$1 LIMIT 1', [req.params.id]);
  if (used.rowCount) { await pool.query('UPDATE cars SET is_active=false WHERE id=$1', [req.params.id]); return res.json({ ok: true, note: 'Mobil punya riwayat pesanan, jadi dinonaktifkan.' }); }
  await pool.query('DELETE FROM cars WHERE id=$1', [req.params.id]); res.json({ ok: true });
}));

const port = process.env.PORT || 3000;
const server = app.listen(port, async () => {
  console.log(`Server jalan di http://localhost:${port}`);
  try {
    await pool.query('SELECT 1 FROM cars LIMIT 1');
    await pool.query('SELECT image_url FROM cars LIMIT 1');
    console.log('Database OK: tabel cars ditemukan.');
  } catch (e) {
    console.error('\n>>> DATABASE BERMASALAH: ' + e.message);
    if (/does not exist/.test(e.message)) console.error('>>> Jalankan ulang db/schema.sql di pgAdmin pada database rental_mobil.');
    if (/password/i.test(e.message)) console.error('>>> Periksa DB_PASSWORD di file .env.');
    if (/ECONNREFUSED/.test(e.message)) console.error('>>> PostgreSQL belum jalan atau DB_PORT salah.');
  }
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`\n>>> Port ${port} sudah dipakai server lama. Jalankan: Get-Process node | Stop-Process -Force   lalu npm start lagi.`);
  else console.error(e);
  process.exit(1);
});
