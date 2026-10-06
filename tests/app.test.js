'use strict';

/**
 * Pengujian fungsi utama Sistem Informasi Peminjaman Kelas.
 * Menjalankan server Express pada port acak dengan database in-memory,
 * lalu menguji lewat HTTP persis seperti yang dilakukan pengguna.
 *
 * Jalankan: npm test
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { createDatabase } = require('../src/db');
const createApp = require('../src/app');
const { offsetDate } = require('../src/utils');

let server;
let baseUrl;
let db;

/** Klien HTTP mini dengan cookie jar (meniru browser). */
function makeClient() {
  const jar = new Map();

  async function request(method, path, body) {
    const headers = {};
    if (jar.size > 0) {
      headers.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    let payload;
    if (body !== undefined) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        if (Array.isArray(v)) v.forEach((item) => params.append(k, item));
        else params.append(k, v);
      }
      payload = params.toString();
    }

    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: payload,
      redirect: 'manual'
    });

    for (const sc of res.headers.getSetCookie()) {
      const pair = sc.split(';')[0];
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '') jar.delete(name);
      else jar.set(name, value);
    }

    const text = await res.text();
    return { status: res.status, location: res.headers.get('location'), text };
  }

  return {
    get: (p) => request('GET', p),
    post: (p, body = {}) => request('POST', p, body)
  };
}

/** Tanggal uji jauh dari masa lalu & bebas bentrok dengan data dummy. */
const DAY = offsetDate(30);

before(async () => {
  db = createDatabase(':memory:');
  const app = createApp({ db, secret: 'test-secret' });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
});

// ---------------------------------------------------------------------------
// 1. Registrasi pengguna
// ---------------------------------------------------------------------------
test('1. Registrasi pengguna baru berhasil dan password di-hash', async () => {
  const c = makeClient();
  const res = await c.post('/register', {
    name: 'Anda Uji',
    email: 'uji@kampus.ac.id',
    phone: '081299999999',
    role: 'mahasiswa',
    password: 'rahasia123',
    confirm: 'rahasia123'
  });

  assert.equal(res.status, 302);
  assert.equal(res.location, '/dashboard');

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get('uji@kampus.ac.id');
  assert.ok(row, 'pengguna tersimpan di database');
  assert.notEqual(row.password, 'rahasia123', 'password tidak disimpan plain text');
  assert.ok(row.password.startsWith('$2'), 'password di-hash dengan bcrypt');
  assert.equal(row.role, 'mahasiswa');
});

test('1b. Registrasi dengan email terdaftar / password tidak cocok ditolak', async () => {
  const c = makeClient();
  const dup = await c.post('/register', {
    name: 'Duplikat',
    email: 'budi@kampus.ac.id',
    role: 'mahasiswa',
    password: 'rahasia123',
    confirm: 'rahasia123'
  });
  assert.equal(dup.status, 400);
  assert.match(dup.text, /Email sudah terdaftar/);

  const mismatch = await c.post('/register', {
    name: 'Salah',
    email: 'salah@kampus.ac.id',
    role: 'mahasiswa',
    password: 'rahasia123',
    confirm: 'beda123'
  });
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.text, /Konfirmasi password tidak sama/);
});

// ---------------------------------------------------------------------------
// 2-4. Login per role
// ---------------------------------------------------------------------------
test('2. Login mahasiswa diarahkan ke /dashboard', async () => {
  const c = makeClient();
  const res = await c.post('/login', { email: 'budi@kampus.ac.id', password: 'mahasiswa123' });
  assert.equal(res.status, 302);
  assert.equal(res.location, '/dashboard');
});

test('2b. Login dengan password salah ditolak', async () => {
  const c = makeClient();
  const res = await c.post('/login', { email: 'budi@kampus.ac.id', password: 'salah' });
  assert.equal(res.status, 401);
  assert.match(res.text, /Email atau password salah/);
});

test('3. Login dosen diarahkan ke /dashboard', async () => {
  const c = makeClient();
  const res = await c.post('/login', { email: 'andi@kampus.ac.id', password: 'dosen123' });
  assert.equal(res.status, 302);
  assert.equal(res.location, '/dashboard');
});

test('4. Login admin diarahkan ke /admin', async () => {
  const c = makeClient();
  const res = await c.post('/login', { email: 'admin@kampus.ac.id', password: 'admin123' });
  assert.equal(res.status, 302);
  assert.equal(res.location, '/admin');
});

// ---------------------------------------------------------------------------
// 5-7. CRUD kelas oleh admin
// ---------------------------------------------------------------------------
test('5. Admin menambah kelas baru', async () => {
  const admin = makeClient();
  await admin.post('/login', { email: 'admin@kampus.ac.id', password: 'admin123' });

  const res = await admin.post('/admin/kelas', {
    room_name: 'Ruang Uji',
    building: 'Gedung Uji',
    floor: '2',
    capacity: '25',
    facilities: ['Proyektor', 'AC'],
    status: 'Tersedia'
  });

  assert.equal(res.status, 302);
  assert.equal(res.location, '/admin/kelas');

  const row = db.prepare('SELECT * FROM classrooms WHERE room_name = ?').get('Ruang Uji');
  assert.ok(row, 'kelas tersimpan');
  assert.equal(row.building, 'Gedung Uji');
  assert.equal(row.capacity, 25);
  assert.equal(row.facilities, 'Proyektor|AC');
});

test('6. Admin mengubah data kelas', async () => {
  const admin = makeClient();
  await admin.post('/login', { email: 'admin@kampus.ac.id', password: 'admin123' });

  const row = db.prepare('SELECT * FROM classrooms WHERE room_name = ?').get('Ruang Uji');
  const res = await admin.post(`/admin/kelas/${row.id}`, {
    room_name: 'Ruang Uji Baru',
    building: 'Gedung Uji',
    floor: '3',
    capacity: '35',
    facilities: ['Komputer'],
    status: 'Tidak tersedia'
  });

  assert.equal(res.status, 302);
  const updated = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(row.id);
  assert.equal(updated.room_name, 'Ruang Uji Baru');
  assert.equal(updated.capacity, 35);
  assert.equal(updated.status, 'Tidak tersedia');
});

test('7. Admin menghapus kelas', async () => {
  const admin = makeClient();
  await admin.post('/login', { email: 'admin@kampus.ac.id', password: 'admin123' });

  const row = db.prepare('SELECT * FROM classrooms WHERE room_name = ?').get('Ruang Uji Baru');
  const res = await admin.post(`/admin/kelas/${row.id}/hapus`);

  assert.equal(res.status, 302);
  const gone = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(row.id);
  assert.equal(gone, undefined, 'kelas terhapus dari database');
});

// ---------------------------------------------------------------------------
// 8. Pengguna melihat kelas
// ---------------------------------------------------------------------------
test('8. Pengguna melihat daftar kelas dan detail kelas', async () => {
  const c = makeClient();
  await c.post('/login', { email: 'budi@kampus.ac.id', password: 'mahasiswa123' });

  const list = await c.get('/kelas');
  assert.equal(list.status, 200);
  assert.match(list.text, /Ruang 101/);
  assert.match(list.text, /Lab Komputer 1/);

  // Filter pencarian
  const filtered = await c.get('/kelas?building=Gedung B');
  assert.equal(filtered.status, 200);
  assert.match(filtered.text, /Lab Komputer 1/);
  assert.doesNotMatch(filtered.text, /Ruang 101/);

  const detail = await c.get('/kelas/1');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Jadwal Penggunaan/);
  assert.match(detail.text, /Ajukan Peminjaman/);
});

// ---------------------------------------------------------------------------
// 9. Pengguna mengajukan peminjaman
// ---------------------------------------------------------------------------
test('9. Pengguna mengajukan peminjaman valid (status Menunggu)', async () => {
  const c = makeClient();
  await c.post('/login', { email: 'andi@kampus.ac.id', password: 'dosen123' });

  const res = await c.post('/peminjaman', {
    classroom_id: '4', // Lab Komputer 1 (kapasitas 30)
    booking_date: DAY,
    start_time: '08:00',
    end_time: '10:00',
    purpose: 'Praktikum Jaringan',
    participant_count: '25',
    user_note: 'Butuh proyektor'
  });

  assert.equal(res.status, 302);
  assert.equal(res.location, '/peminjaman');

  const row = db.prepare(
    'SELECT * FROM bookings WHERE classroom_id = 4 AND booking_date = ? ORDER BY id DESC LIMIT 1'
  ).get(DAY);
  assert.ok(row, 'pengajuan tersimpan');
  assert.equal(row.status, 'Menunggu');
  assert.equal(row.purpose, 'Praktikum Jaringan');
});

// ---------------------------------------------------------------------------
// 10-13. Validasi form peminjaman
// ---------------------------------------------------------------------------
test('10. Sistem menolak peminjaman dengan data kosong', async () => {
  const c = makeClient();
  await c.post('/login', { email: 'budi@kampus.ac.id', password: 'mahasiswa123' });

  const res = await c.post('/peminjaman', {});
  assert.equal(res.status, 400);
  assert.match(res.text, /wajib diisi/);
  const count = db.prepare('SELECT COUNT(*) AS c FROM bookings WHERE purpose IS NULL OR purpose = ?')
    .get('').c;
  assert.equal(count, 0, 'tidak ada data kosong yang tersimpan');
});

test('11. Sistem menolak waktu tidak valid dan tanggal masa lalu', async () => {
  const c = makeClient();
  await c.post('/login', { email: 'budi@kampus.ac.id', password: 'mahasiswa123' });

  // Waktu selesai <= waktu mulai
  const badTime = await c.post('/peminjaman', {
    classroom_id: '1',
    booking_date: DAY,
    start_time: '10:00',
    end_time: '09:00',
    purpose: 'Kuliah',
    participant_count: '10'
  });
  assert.equal(badTime.status, 400);
  assert.match(badTime.text, /Waktu selesai harus lebih besar dari waktu mulai/);

  // Format waktu rusak
  const broken = await c.post('/peminjaman', {
    classroom_id: '1',
    booking_date: DAY,
    start_time: '99:99',
    end_time: '10:00',
    purpose: 'Kuliah',
    participant_count: '10'
  });
  assert.equal(broken.status, 400);
  assert.match(broken.text, /Waktu mulai tidak valid/);

  // Tanggal masa lalu
  const past = await c.post('/peminjaman', {
    classroom_id: '1',
    booking_date: offsetDate(-3),
    start_time: '08:00',
    end_time: '10:00',
    purpose: 'Kuliah',
    participant_count: '10'
  });
  assert.equal(past.status, 400);
  assert.match(past.text, /masa lalu/);
});

test('12. Sistem menolak jumlah peserta melebihi kapasitas', async () => {
  const c = makeClient();
  await c.post('/login', { email: 'budi@kampus.ac.id', password: 'mahasiswa123' });

  const res = await c.post('/peminjaman', {
    classroom_id: '4', // kapasitas 30
    booking_date: DAY,
    start_time: '13:00',
    end_time: '15:00',
    purpose: 'Seminar',
    participant_count: '45'
  });

  assert.equal(res.status, 400);
  assert.match(res.text, /melebihi kapasitas kelas \(30\)/);
  const row = db.prepare(
    "SELECT * FROM bookings WHERE classroom_id = 4 AND start_time = '13:00' AND booking_date = ?"
  ).get(DAY);
  assert.equal(row, undefined, 'pengajuan tidak tersimpan');
});

test('13. Sistem menolak jadwal bentrok, tapi mengizinkan jam berbatasan', async () => {
  const c = makeClient();
  await c.post('/login', { email: 'budi@kampus.ac.id', password: 'mahasiswa123' });

  const base = {
    classroom_id: '5', // Ruang Seminar
    booking_date: DAY,
    purpose: 'Rapat Organisasi',
    participant_count: '20'
  };

  // Bentrok total (sama persis)
  const exact = await c.post('/peminjaman', {
    ...base, start_time: '08:00', end_time: '10:00'
  });
  assert.equal(exact.status, 302, 'pengajuan pertama diterima');

  // Contoh spesifikasi: 08.30–09.30 (di dalam jadwal) -> DITOLAK
  const inside = await c.post('/peminjaman', {
    ...base, start_time: '08:30', end_time: '09:30'
  });
  assert.equal(inside.status, 409);
  assert.match(inside.text, /Kelas tidak tersedia pada waktu tersebut karena sudah digunakan/);

  // 09.00–11.00 (menyilang) -> DITOLAK
  const crossing = await c.post('/peminjaman', {
    ...base, start_time: '09:00', end_time: '11:00'
  });
  assert.equal(crossing.status, 409);

  // 09.30–10.30 (menyilang) -> DITOLAK
  const tail = await c.post('/peminjaman', {
    ...base, start_time: '09:30', end_time: '10:30'
  });
  assert.equal(tail.status, 409);

  // 10.00–12.00 (berbatasan tepat) -> DIPERBOLEHKAN
  const adjacent = await c.post('/peminjaman', {
    ...base, start_time: '10:00', end_time: '12:00'
  });
  assert.equal(adjacent.status, 302, 'jam berbatasan tidak dianggap bentrok');

  const count = db.prepare(
    'SELECT COUNT(*) AS c FROM bookings WHERE classroom_id = 5 AND booking_date = ?'
  ).get(DAY).c;
  assert.equal(count, 2, 'hanya 2 pengajuan tersimpan (pemblokir tidak masuk)');
});

// ---------------------------------------------------------------------------
// 14-15. Admin menyetujui / menolak pengajuan
// ---------------------------------------------------------------------------
test('14. Admin menyetujui pengajuan', async () => {
  const admin = makeClient();
  await admin.post('/login', { email: 'admin@kampus.ac.id', password: 'admin123' });

  const booking = db.prepare(
    "SELECT * FROM bookings WHERE classroom_id = 4 AND booking_date = ? AND status = 'Menunggu'"
  ).get(DAY);
  assert.ok(booking, 'ada pengajuan menunggu untuk diuji');

  const res = await admin.post(`/admin/peminjaman/${booking.id}/setujui`, {
    catatan: 'Silakan gunakan sesuai jadwal.'
  });
  assert.equal(res.status, 302);

  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id);
  assert.equal(updated.status, 'Disetujui');
  assert.equal(updated.admin_note, 'Silakan gunakan sesuai jadwal.');
});

test('15. Admin menolak pengajuan — wajib beralasan', async () => {
  const admin = makeClient();
  await admin.post('/login', { email: 'admin@kampus.ac.id', password: 'admin123' });

  const booking = db.prepare(
    "SELECT * FROM bookings WHERE classroom_id = 5 AND booking_date = ? AND status = 'Menunggu' ORDER BY id LIMIT 1"
  ).get(DAY);
  assert.ok(booking, 'ada pengajuan menunggu untuk diuji');

  // Tanpa alasan -> ditolak, status tidak berubah
  const noReason = await admin.post(`/admin/peminjaman/${booking.id}/tolak`, {});
  assert.equal(noReason.status, 302);
  assert.match(noReason.location, new RegExp(`/admin/peminjaman/${booking.id}$`));
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id = ?').get(booking.id).status, 'Menunggu');

  // Dengan alasan -> status Ditolak + catatan tersimpan
  const res = await admin.post(`/admin/peminjaman/${booking.id}/tolak`, {
    alasan: 'Kelas sedang digunakan untuk kegiatan akademik.'
  });
  assert.equal(res.status, 302);

  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id);
  assert.equal(updated.status, 'Ditolak');
  assert.match(updated.admin_note, /kegiatan akademik/);
});

// ---------------------------------------------------------------------------
// 16-17. Pengguna melihat status & riwayat
// ---------------------------------------------------------------------------
test('16. Pengguna melihat perubahan status pengajuan', async () => {
  const c = makeClient();
  await c.post('/login', { email: 'andi@kampus.ac.id', password: 'dosen123' });

  const booking = db.prepare(
    'SELECT * FROM bookings WHERE classroom_id = 4 AND booking_date = ? ORDER BY id DESC LIMIT 1'
  ).get(DAY);

  const detail = await c.get(`/peminjaman/${booking.id}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Disetujui/);
  assert.match(detail.text, /Silakan gunakan sesuai jadwal/);
});

test('16b. Pengguna hanya dapat melihat peminjaman miliknya sendiri', async () => {
  const c = makeClient();
  await c.post('/login', { email: 'budi@kampus.ac.id', password: 'mahasiswa123' });

  // Peminjaman milik pengguna lain (id 1 milik Budi, cari milik Siti)
  const others = db.prepare(
    'SELECT id FROM bookings WHERE user_id != ? ORDER BY id LIMIT 1'
  ).get(2);
  const res = await c.get(`/peminjaman/${others.id}`);
  assert.equal(res.status, 403);

  const adminPage = await c.get('/admin');
  assert.equal(adminPage.status, 403, 'mahasiswa tidak dapat membuka halaman admin');
});

test('17. Pengguna melihat riwayat peminjaman dengan filter status', async () => {
  const c = makeClient();
  await c.post('/login', { email: 'budi@kampus.ac.id', password: 'mahasiswa123' });

  const all = await c.get('/peminjaman');
  assert.equal(all.status, 200);
  assert.match(all.text, /Peminjaman Saya/);
  assert.match(all.text, /Kuliah Basis Data/);

  const filtered = await c.get('/peminjaman?status=Disetujui');
  assert.equal(filtered.status, 200);
  assert.match(filtered.text, /Disetujui/);

  // Batalkan pengajuan berstatus Menunggu (milik Budi pada H+1)
  const pending = db.prepare(
    "SELECT * FROM bookings WHERE user_id = 2 AND status = 'Menunggu' ORDER BY id LIMIT 1"
  ).get();
  if (pending) {
    const cancel = await c.post(`/peminjaman/${pending.id}/batal`);
    assert.equal(cancel.status, 302);
    assert.equal(
      db.prepare('SELECT status FROM bookings WHERE id = ?').get(pending.id).status,
      'Dibatalkan'
    );
  }
});

// ---------------------------------------------------------------------------
// 18. Admin melihat laporan
// ---------------------------------------------------------------------------
test('18. Admin melihat laporan dengan ringkasan & filter', async () => {
  const admin = makeClient();
  await admin.post('/login', { email: 'admin@kampus.ac.id', password: 'admin123' });

  const res = await admin.get('/admin/laporan');
  assert.equal(res.status, 200);
  assert.match(res.text, /Total Peminjaman/);
  assert.match(res.text, /Disetujui/);
  assert.match(res.text, /Ditolak/);
  assert.match(res.text, /Dibatalkan/);
  assert.match(res.text, /Frekuensi Penggunaan Kelas/);

  const filtered = await admin.get(`/admin/laporan?from=${DAY}&to=${DAY}&status=Disetujui`);
  assert.equal(filtered.status, 200);

  // Dashboard admin
  const dash = await admin.get('/admin');
  assert.equal(dash.status, 200);
  assert.match(dash.text, /Total Kelas/);
  assert.match(dash.text, /Pengajuan Menunggu/);

  // Halaman lain admin
  for (const p of ['/admin/kelas', '/admin/pengajuan', '/admin/kalender', '/admin/pengguna']) {
    const r = await admin.get(p);
    assert.equal(r.status, 200, `${p} harus 200`);
  }
});

// ---------------------------------------------------------------------------
// Tambahan: proteksi rute & akses tanpa login
// ---------------------------------------------------------------------------
test('Akses tanpa login diarahkan ke halaman login', async () => {
  const c = makeClient();
  for (const p of ['/dashboard', '/kelas', '/peminjaman', '/kalender', '/admin']) {
    const res = await c.get(p);
    assert.equal(res.status, 302, `${p} harus redirect`);
    assert.equal(res.location, '/login');
  }
});

test('Dosen tidak dapat membuka halaman admin', async () => {
  const c = makeClient();
  await c.post('/login', { email: 'andi@kampus.ac.id', password: 'dosen123' });
  const res = await c.get('/admin/pengajuan');
  assert.equal(res.status, 403);
});
