'use strict';

/** Utilitas tanggal, waktu, dan bantuan umum. */

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Format Date -> "YYYY-MM-DD" (waktu lokal). */
function toYmd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Tanggal hari ini "YYYY-MM-DD". */
function todayStr() {
  return toYmd(new Date());
}

/** Hari ini + n hari ("YYYY-MM-DD"). */
function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toYmd(d);
}

/** "YYYY-MM-DD" -> "Selasa, 6 Oktober 2026". */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  return `${DAYS[dt.getDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "08:00" -> "08.00" (gaya penulisan jam Indonesia). */
function formatTime(t) {
  return t ? String(t).replace(':', '.') : '';
}

/** "Proyektor|AC" -> ['Proyektor', 'AC']. */
function splitFacilities(s) {
  return String(s || '').split('|').map((x) => x.trim()).filter(Boolean);
}

const STATUS_CLASSES = {
  Menunggu: 'badge-waiting',
  Disetujui: 'badge-approved',
  Ditolak: 'badge-rejected',
  Selesai: 'badge-done',
  Dibatalkan: 'badge-cancelled'
};

function statusClass(status) {
  return STATUS_CLASSES[status] || 'badge-neutral';
}

/**
 * Cari peminjaman yang BENTROK dengan slot waktu tsb.
 * Hanya status Menunggu/Disetujui yang memblokir jadwal.
 * Overlap: existing.start < new.end && existing.end > new.start
 * (jam berbatasan, mis. 08.00-10.00 & 10.00-12.00 -> TIDAK bentrok)
 */
function findConflict(db, { classroom_id, booking_date, start_time, end_time }) {
  return db.prepare(`
    SELECT b.*, u.name AS user_name, c.room_name
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    JOIN classrooms c ON c.id = b.classroom_id
    WHERE b.classroom_id = ?
      AND b.booking_date = ?
      AND b.status IN ('Menunggu', 'Disetujui')
      AND b.start_time < ?
      AND b.end_time > ?
    ORDER BY b.start_time
  `).get(classroom_id, booking_date, end_time, start_time);
}

/** Tandai semua peminjuan Disetujui yang waktunya sudah lewat menjadi Selesai. */
function markFinished(db) {
  const now = new Date();
  const today = toYmd(now);
  const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  db.prepare(`
    UPDATE bookings SET status = 'Selesai'
    WHERE status = 'Disetujui'
      AND (booking_date < ? OR (booking_date = ? AND end_time <= ?))
  `).run(today, today, nowTime);
}

module.exports = {
  pad,
  toYmd,
  todayStr,
  offsetDate,
  formatDate,
  formatTime,
  splitFacilities,
  statusClass,
  findConflict,
  markFinished
};
