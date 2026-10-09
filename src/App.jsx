import { useState, useEffect, useRef, Fragment } from "react";
import {
  ChevronLeft, ChevronRight, Camera, Check, Plus, X, Users,
  MessageCircle, Upload, Phone, Trash2, Send, Image as ImageIcon,
  Info, Calendar as CalendarIcon, Minus, BarChart2, Smartphone, Pencil, Building2, Wand2,
  Download, LayoutGrid, ClipboardList, LayoutDashboard, Bell, Search, Wifi, ArrowUpRight, CheckCircle2, AlertTriangle, Clock, Zap,
  Settings, TrendingUp, Award, FileUp, ChevronDown, Home, UserCircle2, LogOut, Package
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid
} from "recharts";
import * as XLSX from "xlsx"; // npm install xlsx -- dipakai untuk export Rekap KPI ke Excel
import { db } from "./firebase.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, arrayUnion, setDoc
} from "firebase/firestore";

// ---------- Design tokens ----------
const COLORS = {
  bg: "#F8FAFC",         // page background (slate-50)
  card: "#FFFFFF",
  border: "#E2E8F0",     // slate-200
  ink: "#0F172A",        // slate-900
  inkSoft: "#64748B",    // slate-500
  primary: "#4F46E5",    // indigo-600
  primarySoft: "#EEF2FF",// indigo-50
  primaryDark: "#4338CA",
};
const STATUS_COLORS = { rencana: "#DC2626", selesai: "#059669" }; // red-600 / emerald-600
// Warna pastel untuk kalender: dipakai supaya sekilas kelihatan mana yang sudah dieksekusi (biru)
// dan mana yang masih rencana (orange), terpisah dari warna posisi/anggota (CHIP_PALETTE di bawah).
const STATUS_PASTEL = {
  rencana: { bg: "#FFEDD5", text: "#9A3412", border: "#FDBA74" },  // orange-100 / orange-800 / orange-300
  selesai: { bg: "#DBEAFE", text: "#1E40AF", border: "#93C5FD" },  // blue-100 / blue-800 / blue-300
};
const CHIP_PALETTE = [
  "#4F46E5", // indigo
  "#059669", // emerald
  "#D97706", // amber
  "#DB2777", // pink
  "#0891B2", // cyan
  "#DC2626", // red
  "#7C3AED", // violet
  "#0D9488", // teal
  "#CA8A04", // yellow-brown
  "#EA580C", // orange
  "#2563EB", // blue
  "#65A30D", // lime-green
  "#C026D3", // fuchsia
  "#0369A1", // sky-dark
  "#B91C1C", // brick red
  "#4D7C0F", // olive
  "#9333EA", // purple
  "#0F766E", // deep teal
  "#BE185D", // rose
  "#3F6212", // dark olive
];

const BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

// Warna + ikon per JENIS KEGIATAN (bukan per anggota) -- dipakai di grid Jadwal Tim (Beranda) dan
// donut "Ringkasan Kegiatan" supaya kategori yang sama selalu tampil dengan warna yang sama di
// seluruh halaman, mengikuti gaya referensi desain (chip kegiatan berwarna pastel per kategori).
const CATEGORY_META = {
  "Branding":      { color: "#7C3AED", bg: "#F5F3FF", icon: Send },
  "Req Branding":  { color: "#B45309", bg: "#FFFBEB", icon: Package },
  "DTU":           { color: "#2563EB", bg: "#EFF6FF", icon: Building2 },
  "Attack Desa":   { color: "#DC2626", bg: "#FEF2F2", icon: AlertTriangle },
  "Attack School": { color: "#059669", bg: "#ECFDF5", icon: CheckCircle2 },
  "Event":         { color: "#EA580C", bg: "#FFF7ED", icon: CalendarIcon },
  "FWA":           { color: "#0891B2", bg: "#ECFEFF", icon: Wifi },
};
function categoryMeta(label) {
  return CATEGORY_META[label] || { color: "#64748B", bg: "#F1F5F9", icon: LayoutGrid };
}

// Hierarki Planner (berlaku per Oktober 2026 — perubahan struktur organisasi):
// RGE (eksekutor kegiatan lapangan & dokumentasi) sekarang ada DUA jalur pemantau di atasnya:
//   1. GTM Region — satu peran tunggal yang membawahi SEMUA RGE di semua branch/wilayah (menggantikan
//      2 peran lama yang terpisah per wilayah: Markom Bali & Markom Nusra / REGB & REGN).
//   2. HOA — membawahi RGE dalam SATU branch saja (biasanya 2 RGE per branch). Menggantikan peran
//      lama "BSM". Jadi kegiatan tiap RGE dilaporkan ke GTM Region (selalu) DAN ke HOA branch
//      yang bersangkutan.
// Field "Branch" di tiap anggota tetap dipakai untuk mencocokkan notifikasi WhatsApp harian (oleh
// automation n8n di luar file ini): RGE & HOA isi nama branch yang sama (mis. "Flores Barat") supaya
// otomatis match; GTM Region meng-cover semua branch jadi field Branch-nya boleh dikosongkan.
// PENTING: HOA menghandel branch-nya secara utuh, TIDAK dipisah per brand (IM3/3ID) -- jadi Branch
// cukup diisi nama wilayah saja (mis. "Flores Barat"), tanpa embel-embel brand seperti konvensi BSM
// yang lama (dulu bisa ada 2 BSM beda brand dalam 1 branch; sekarang cukup 1 HOA untuk 2 brand sekaligus).
const POSISI_OPSI = ["RGE", "GTM Region", "HOA"];
const LEGACY_POSISI_MAP = {
  REGB: "GTM Region", REGN: "GTM Region", "MARKOM BALI": "GTM Region", "MARKOM NUSRA": "GTM Region",
  BSM: "HOA",
};
function normalizePosisi(raw) {
  const t = String(raw || "").trim();
  return LEGACY_POSISI_MAP[t.toUpperCase()] || t;
}
function isPosisiAllowed(raw) {
  return POSISI_OPSI.some((p) => p.toUpperCase() === normalizePosisi(raw).toUpperCase());
}

// ---------- Urutan branch (dipakai untuk mengurutkan RGE di Jadwal Tim & Anggota Tim) ----------
const BRANCH_ORDER = ["bali barat", "bali timur", "lombok barat", "lombok timur", "sumbawa", "flores barat", "flores timur", "sumba", "timor utara", "timor selatan"];
function branchRank(b) {
  const t = String(b || "").trim().toLowerCase();
  if (!t) return 999;
  const exact = BRANCH_ORDER.indexOf(t);
  if (exact >= 0) return exact;
  if (t === "timor") return BRANCH_ORDER.indexOf("timor utara"); // nama lama tanpa arah
  let best = -1;
  BRANCH_ORDER.forEach((o, i) => { if (t.startsWith(o + " ") && (best < 0 || o.length > BRANCH_ORDER[best].length)) best = i; });
  return best >= 0 ? best : 999; // branch di luar daftar ditaruh paling bawah
}
// Urut: sesuai BRANCH_ORDER, lalu nama (A-Z) di dalam branch yang sama.
function sortMembersByBranch(list) {
  return [...list].sort((a, b) =>
    branchRank(a.branch) - branchRank(b.branch) ||
    String(a.branch || "").localeCompare(String(b.branch || "")) ||
    String(a.name || "").localeCompare(String(b.name || "")));
}
function sortBranches(list) {
  return [...list].sort((a, b) => branchRank(a) - branchRank(b) || String(a).localeCompare(String(b)));
}

// ---------- Deteksi member dobel (berdasarkan nomor WA) ----------
// Kunci nomor dinormalkan supaya "0812...", "812...", "+62 812..." dianggap nomor yang sama.
function phoneKey(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  else if (d.startsWith("8")) d = "62" + d;
  return d;
}
// Mengembalikan [{ key, keeper, dups }]. Data yang dipertahankan (keeper) = yang paling banyak dipakai
// kegiatan (supaya tidak ada kegiatan yang kehilangan PIC); kalau seri, utamakan doc id yang sama
// dengan nomornya (format hasil sync n8n) dan berawalan 62.
function findDuplicateMemberGroups(members, activities) {
  const groups = {};
  for (const m of members) {
    const key = phoneKey(m.phone);
    if (!key) continue;
    (groups[key] = groups[key] || []).push(m);
  }
  return Object.entries(groups)
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => {
      const score = (m) =>
        activities.filter((a) => a.assignedMemberId === m.id).length * 1000 +
        (m.id === String(m.phone || "").replace(/\D/g, "") ? 10 : 0) +
        (String(m.id).startsWith("62") ? 5 : 0) +
        (isPosisiAllowed(m.posisi || "RGE") ? 1 : 0);
      const sorted = [...list].sort((a, b) => score(b) - score(a));
      return { key, keeper: sorted[0], dups: sorted.slice(1) };
    });
}
const HARI = ["Sen","Sel","Rab","Kam","Jum","Sab","Min"];
const JENIS_KEGIATAN_OPSI = ["DTU", "Attack Desa", "Attack School", "Branding", "Req Branding", "Event", "FWA"];

// Mengelompokkan variasi penulisan jenis kegiatan yang bebas/tidak konsisten (mis. "Attack Desa Seraya",
// "attack desa marannu", "pasang matpro toko Sinar Jaya", "Reskin toko ABC") ke dalam 6 kategori BAKU
// di atas, berdasarkan kata kunci, supaya data lama (termasuk yang salah pilih kategori atau ditulis
// bebas lewat WhatsApp sebelum kategori ini dikunci) tetap ikut terkelompok dengan benar.
// 6 kategori ini SENGAJA disamakan dengan 6 kategori laporan foto grup RGE di WA (posm/event/dtu/
// desa/school/fwa -- lihat KATEGORI_LABEL & node "Parse Kategori & Field Laporan RGE" di n8n), minus
// "nota" karena nota cuma dipakai untuk verifikasi pembayaran, bukan jenis kegiatan tersendiri.
// posm (WA) = Branding (web), sisanya penamaannya sama.
//
// PENTING: urutan array ini disengaja — kategori yang lebih spesifik diletakkan lebih dulu. Contoh:
// "Attack School" harus dicek sebelum "Attack Desa", supaya judul seperti "Attack Sekolah Marannu"
// tidak keburu ketangkap kata kunci umum "attack" dan salah masuk ke kategori Attack Desa.
const JENIS_KEYWORDS = [
  { match: ["attack sekolah", "attack school", "sekolah", "school"], label: "Attack School" },
  { match: ["attack"], label: "Attack Desa" },
  {
    match: ["req branding", "permintaan branding", "minta branding", "request branding", "cetak branding"],
    label: "Req Branding",
  },
  {
    match: [
      "branding", "brending", "brandi", "matpro", "poster", "shopsign", "shop sign",
      "pengukuran shopsign", "pengukuran shop sign", "spanduk", "rontek", "pemasangan", "reskin",
    ],
    label: "Branding",
  },
  { match: ["dtu", "direct to user", "direct selling"], label: "DTU" },
  { match: ["event", "bazar", "pameran"], label: "Event" },
  { match: ["fwa", "wifi rumahan", "home internet"], label: "FWA" },
];
// Dipakai untuk data LAMA yang jenis kegiatannya sudah tidak lagi sesuai 6 kategori baku (mis. "Rapat",
// "Kunjungan Lapangan", dll — lihat MigrasiKategoriModal). Untuk kegiatan BARU, jenisKegiatan wajib
// dipilih langsung dari salah satu dari 6 opsi di JENIS_KEGIATAN_OPSI lewat dropdown (tidak ada lagi
// input bebas), jadi normalizeJenisKegiatan di bawah ini terutama berguna untuk merapikan data lama.
function normalizeJenisKegiatan(raw) {
  const t = (raw || "").toLowerCase();
  for (const { match, label } of JENIS_KEYWORDS) {
    if (match.some((k) => t.includes(k))) return label;
  }
  return (raw || "").trim() || "Lainnya";
}

// Menentukan form "Hasil Kegiatan" mana yang relevan untuk suatu jenis kegiatan — dipakai supaya
// isian di modal detail kegiatan sama persis dengan format yang dipakai bot WhatsApp (lihat n8n:
// fungsi kategoriHasil di node "Cek & Susun Aksi Hasil Kegiatan" / "Cek & Proses Balasan Hasil Kegiatan").
// - "jualan": Attack Desa, Attack Sekolah, DTU, Event -> Jualan SP IM3 / SP 3ID / Hifi
// - "branding": Branding -> Pasang poster / shopblind / Branding vinil / spanduk / rontek
// - null: jenis kegiatan lain (Rapat, Kunjungan, FWA, dst) tidak punya form hasil manual di sini --
//   khusus FWA, pencapaiannya sudah otomatis kehitung lewat laporan foto grup RGE (lihat tab Rekap
//   KPI RGE), jadi tidak perlu diinput ulang manual di modal ini.
function kategoriHasil(jenisKegiatanRaw) {
  const label = normalizeJenisKegiatan(jenisKegiatanRaw);
  if (label === "Branding") return "branding";
  if (label === "Attack Desa" || label === "Attack School" || label === "DTU" || label === "Event") return "jualan";
  return null;
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
// rgeReports ditulis n8n TIDAK punya field memberId -- yang ada cuma "Sender" (nomor WA pengirim).
// memberId di app ini = Firestore doc id member = nomor WA juga, jadi cocokkan by nomor yang sudah
// dibuang karakter non-digit-nya (supaya "+62..." vs "62..." vs "0..." tetap ketemu).
function digitsOnly(v) { return String(v ?? "").replace(/\D/g, ""); }
function reportSenderDigits(r) { return digitsOnly(r?.Sender ?? r?.sender ?? r?.phone ?? r?.Phone ?? ""); }
function dateKey(y, m, d) { return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function todayKey() { const t = new Date(); return dateKey(t.getFullYear(), t.getMonth(), t.getDate()); }
function posisiColor(posisi) {
  let h = 0;
  for (let i = 0; i < (posisi || "").length; i++) h = (h * 31 + posisi.charCodeAt(i)) >>> 0;
  return CHIP_PALETTE[h % CHIP_PALETTE.length];
}
// Warna per-ORANG (bukan per-posisi seperti posisiColor) -- dipakai di Dashboard/Planner/Team supaya
// tiap anggota punya 1 warna konsisten sendiri (mis. selalu biru buat Andi, hijau buat Budi, dst).
// Warna per-anggota di-assign berurutan begitu id-nya PERTAMA KALI terlihat (bukan hash), supaya
// selama 20 palet cukup (mis. 18 RGE), semua orang dijamin dapat warna yang beda-beda -- hash bisa
// tabrakan (banyak nomor WA berbagi awalan yang sama), assignment berurutan tidak.
const _memberColorCache = {};
let _memberColorNextIndex = 0;
function memberColor(memberIdOrName) {
  const key = String(memberIdOrName || "");
  if (!key) return CHIP_PALETTE[0];
  if (_memberColorCache[key] === undefined) {
    _memberColorCache[key] = CHIP_PALETTE[_memberColorNextIndex % CHIP_PALETTE.length];
    _memberColorNextIndex++;
  }
  return _memberColorCache[key];
}

// ---------- Status kegiatan yang "hidup" (diturunkan dari tanggal/jam + status rencana/selesai yang
// SUDAH ADA di Firestore -- TIDAK menambah field baru). 6 state: belum_mulai, hari_ini, berjalan,
// menunggu_report, selesai, overdue. Dipakai di Dashboard, Planner, dan badge kegiatan lainnya. ----------
const STATUS_META = {
  belum_mulai:      { label: "Belum Mulai",      color: "#94A3B8", bg: "#F1F5F9" },
  hari_ini:         { label: "Hari Ini",         color: "#4F46E5", bg: "#EEF2FF" },
  berjalan:         { label: "Sedang Berjalan",  color: "#D97706", bg: "#FFFBEB" },
  menunggu_report:  { label: "Menunggu Report",  color: "#DB2777", bg: "#FDF2F8" },
  selesai:          { label: "Selesai",          color: "#059669", bg: "#ECFDF5" },
  overdue:          { label: "Overdue",          color: "#DC2626", bg: "#FEF2F2" },
};
function statusOf(activity, now = new Date()) {
  if (activity.status === "selesai") return "selesai";
  const parts = String(activity.date || "").split("-").map(Number);
  if (parts.length !== 3 || !parts[0]) return "belum_mulai";
  const [y, m, d] = parts;
  const [hh, mm] = String(activity.time || "00:00").split(":").map(Number);
  const scheduled = new Date(y, m - 1, d, hh || 0, mm || 0);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const actDateStart = new Date(y, m - 1, d);
  if (actDateStart < todayStart) return "overdue";
  if (actDateStart > todayStart) return "belum_mulai";
  const diffHours = (now - scheduled) / 36e5;
  if (diffHours < 0) return "hari_ini";
  if (diffHours <= 3) return "berjalan";
  return "menunggu_report";
}
// SLA "Req Branding": dari tanggal permintaan (activity.date, diisi GTM Region/HOA) sampai RGE upload foto
// serah terima (photos[] -- field yang SAMA yang sudah dipakai jalur WA/dokumentasi, jadi tidak perlu
// field/collection baru). Target SLA: 5 hari kalender.
const REQ_BRANDING_SLA_DAYS = 5;
function reqBrandingSLA(activity) {
  const photos = Array.isArray(activity?.photos) ? activity.photos : [];
  const assignedDate = activity?.date;
  const latestPhoto = [...photos].sort((a, b) => String(a.uploadedAt || "").localeCompare(String(b.uploadedAt || ""))).pop();
  const msPerDay = 86400000;
  if (!assignedDate) return { hasHandover: false, elapsedDays: null, onTime: null, statusLabel: "Tanggal permintaan belum diisi" };
  const start = new Date(`${assignedDate}T00:00:00`);
  if (latestPhoto?.uploadedAt) {
    const completed = new Date(latestPhoto.uploadedAt);
    const elapsedDays = Math.max(0, Math.round((new Date(completed.toDateString()) - start) / msPerDay));
    const onTime = elapsedDays <= REQ_BRANDING_SLA_DAYS;
    return { hasHandover: true, completedDate: completed, elapsedDays, onTime, statusLabel: onTime ? `Tepat waktu (${elapsedDays} hari)` : `Terlambat (${elapsedDays} hari, target ${REQ_BRANDING_SLA_DAYS} hari)` };
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const elapsedDays = Math.max(0, Math.round((today - start) / msPerDay));
  const onTime = elapsedDays <= REQ_BRANDING_SLA_DAYS;
  return { hasHandover: false, elapsedDays, onTime, statusLabel: onTime ? `Berjalan (hari ke-${elapsedDays} dari ${REQ_BRANDING_SLA_DAYS})` : `Terlambat (hari ke-${elapsedDays}, target ${REQ_BRANDING_SLA_DAYS} hari) — belum ada foto serah terima` };
}

function reportInfoForActivity(activity, member, rgeReports = []) {
  const categoryMap = { branding: "posm", posm: "posm", event: "event", dtu: "dtu", "attack desa": "desa", desa: "desa", "attack school": "school", school: "school", fwa: "fwa", nota: "nota" };
  const wanted = categoryMap[String(activity?.jenisKegiatan || "").toLowerCase()];
  const memberId = activity?.assignedMemberId;

  // Prioritas baru: n8n menyimpan hubungan eksplisit activityId pada rgeReports.
  // Ini menghilangkan ambiguitas ketika satu RGE punya beberapa kegiatan pada tanggal/kategori yang sama.
  const directRows = rgeReports.filter((r) => String(r.activityId || r.ActivityId || "") === String(activity?.id || ""));

  // Fallback legacy: tetap mendukung laporan lama yang belum memiliki activityId. rgeReports TIDAK
  // punya field memberId -- cocokkan by nomor WA (Sender) ke member.phone / assignedMemberId, dua-duanya
  // dinormalkan ke digit saja dulu.
  const memberDigits = digitsOnly(member?.phone ?? memberId ?? "");
  const rows = directRows.length > 0 ? directRows : rgeReports.filter((r) => {
    const cat = String(r.category || r.Kategori || "").toLowerCase();
    const ts = String(r.Timestamp || r.receivedAt || r.timestamp || "");
    const date = ts.slice(0, 10);
    const senderDigits = reportSenderDigits(r);
    const memberMatch = !memberDigits || (senderDigits && senderDigits === memberDigits);
    const categoryMatch = !wanted || !cat || cat === wanted;
    const dateMatch = !activity?.date || !date || date === activity.date;
    return memberMatch && categoryMatch && dateMatch;
  });
  const latest = rows.sort((a,b) => String(b.Timestamp || b.receivedAt || b.timestamp || "").localeCompare(String(a.Timestamp || a.receivedAt || a.timestamp || "")))[0];
  const photo = latest?.FotoURL || latest?.fotoUrl || latest?.photoUrl || latest?.imageUrl;
  const hasil = activity?.hasil || {};
  const hasResult = Object.values(hasil).some(v => Number(v) > 0 || (typeof v === "string" && v.trim()));
  return { received: Boolean(latest), photo: Boolean(photo), latest, hasResult, linkedByActivityId: directRows.length > 0 };
}

function progressOf(status) {
  return { belum_mulai: 0, hari_ini: 10, berjalan: 55, menunggu_report: 80, selesai: 100, overdue: 30 }[status] ?? 0;
}
function resizeImage(file, maxDim = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- Small UI atoms ----------
function IconBtn({ onClick, children, title, style }) {
  return (
    <button onClick={onClick} title={title} style={style} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition flex items-center justify-center">
      {children}
    </button>
  );
}
function PrimaryBtn({ onClick, children, disabled, style, className = "" }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={style}
      className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 justify-center transition shadow-sm ${disabled ? "bg-slate-300 text-white cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700 text-white"} ${className}`}
    >
      {children}
    </button>
  );
}
function GhostBtn({ onClick, children, style, className = "" }) {
  return (
    <button onClick={onClick} style={style} className={`px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 justify-center transition ${className}`}>
      {children}
    </button>
  );
}
function Field({ label, required = false, children }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
        {label}
        {required && <span className="normal-case tracking-normal font-bold text-rose-600">· Wajib diisi</span>}
      </span>
      {children}
    </label>
  );
}
const inputStyle = {
  border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "8px 10px",
  fontSize: 14, color: COLORS.ink, background: "#fff", outline: "none", width: "100%",
};

// ---------- Donut chart (SVG stroke-based, dependency-free) ----------
// segments: [{ label, value, color }]. Dipakai untuk "Ringkasan Kegiatan" (multi-kategori) dan bisa
// juga dipakai untuk gauge 1 nilai (2 segmen: capaian vs sisa) di "Pencapaian KPI".
function DonutChart({ segments, size = 112, thickness = 14, centerLabel, centerSub }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F1F5F9" strokeWidth={thickness} />
        {total > 0 && segments.filter(s => s.value > 0).map((s, i) => {
          const frac = s.value / total;
          const dash = frac * circumference;
          const circle = (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap={segments.length === 1 ? "round" : "butt"}
            />
          );
          offset += dash;
          return circle;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-extrabold text-slate-900 leading-none">{centerLabel}</span>
        {centerSub && <span className="text-[9px] text-slate-400 mt-1 text-center px-2">{centerSub}</span>}
      </div>
    </div>
  );
}

// ---------- Modal shell ----------
function Modal({ onClose, children, width = 480 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: width, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        {children}
      </div>
    </div>
  );
}
function ModalHeader({ title, onClose, icon }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="font-bold text-base text-slate-900">{title}</h3>
      </div>
      <IconBtn onClick={onClose}><X size={18} /></IconBtn>
    </div>
  );
}

function StatusMarker({ status, size = 13 }) {
  const color = status === "selesai" ? STATUS_COLORS.selesai : STATUS_COLORS.rencana;
  return (
    <span style={{
      width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} title={status === "selesai" ? "Sudah dilaksanakan" : "Rencana"}>
      {status === "selesai" ? <Check size={size * 0.68} color="#fff" strokeWidth={3} /> : <Minus size={size * 0.68} color="#fff" strokeWidth={3} />}
    </span>
  );
}
function StatusBadge({ status }) {
  const selesai = status === "selesai";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{ background: selesai ? "#D1FAE5" : "#FEE2E2", color: selesai ? "#065F46" : "#991B1B" }}
    >
      <StatusMarker status={status} size={11} /> {selesai ? "Selesai" : "Rencana"}
    </span>
  );
}

// ---------- Calendar event chip ----------
// Warna latar chip mengikuti STATUS (orange pastel = rencana, biru pastel = selesai) supaya sekilas
// kelihatan mana yang sudah dieksekusi. Warna anggota/posisi (CHIP_PALETTE) dipindah jadi aksen garis
// kiri saja, tidak lagi jadi warna dominan — sebelumnya semua chip ikut warna posisi sehingga banyak
// yang kelihatan "orange semua" dan sulit dibedakan status-nya.
function EventChip({ activity }) {
  const memberColor = posisiColor(activity._posisi);
  const selesai = activity.status === "selesai";
  const tone = selesai ? STATUS_PASTEL.selesai : STATUS_PASTEL.rencana;
  return (
    <div
      className="text-[10px] px-1.5 py-0.5 rounded truncate flex items-center gap-1 font-medium"
      style={{ background: tone.bg, color: tone.text, borderLeft: `3px solid ${memberColor}` }}
      title={`${activity.title} — ${selesai ? "Sudah dilaksanakan" : "Rencana"}`}
    >
      {activity.time && <span className="font-mono flex-shrink-0">{activity.time}</span>}
      <span className="truncate">{activity.title}</span>
      {activity.photos?.length > 0 && <Camera size={9} className="flex-shrink-0 ml-auto" />}
    </div>
  );
}

// ---------- Sidebar navigasi utama (dark) ----------
const NAV_ITEMS = [
  { key: "dashboard", label: "Beranda", icon: Home },
  { key: "kalender", plannerView: "weekly", label: "Jadwal Tim", icon: CalendarIcon },
  { key: "kalender", plannerView: "monthly", label: "Kalender", icon: LayoutGrid },
  { key: "galeriBranch", label: "Laporan & Rekap", icon: ClipboardList },
  { key: "rekapKPI", label: "Pencapaian KPI", icon: TrendingUp },
  { key: "team", label: "Anggota Tim", icon: Users },
  { key: "notifikasi", label: "Notifikasi", icon: Bell },
  { key: "pengaturan", label: "Pengaturan", icon: Settings },
];
function SidebarNav({ mainTab, plannerView, onNavigate, notifCount, mobileOpen, onCloseMobile, onAddActivity, onImportExcel, onKirimReportWA }) {
  const isActive = (item) => item.key === "kalender" ? mainTab === "kalender" && plannerView === item.plannerView : mainTab === item.key;
  return (
    <>
      {mobileOpen && <div onClick={onCloseMobile} className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden" />}
      <aside className={`fixed lg:sticky top-0 left-0 h-screen w-[250px] shrink-0 z-50 flex flex-col text-white transition-transform duration-200 overflow-hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`} style={{ background: "linear-gradient(180deg,#0B1120 0%,#0F172A 100%)" }}>
        <div className="px-4 pt-4 pb-3 flex items-center gap-2.5 shrink-0">
          <div className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#4F46E5,#7C3AED)" }}><LayoutDashboard size={17} /></div>
          <div className="min-w-0">
            <div className="font-extrabold tracking-tight truncate text-[15px]">Team Planner</div>
            <div className="text-[8.5px] text-slate-400 font-semibold tracking-widest">PLAN · EXECUTE · ACHIEVE</div>
          </div>
          <button onClick={onCloseMobile} className="ml-auto p-1.5 rounded-lg hover:bg-white/10 lg:hidden"><X size={16} /></button>
        </div>

        <nav className="px-3 flex flex-col gap-0.5 shrink-0">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={() => { onNavigate(item.key, item.plannerView); onCloseMobile(); }}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-semibold transition text-left ${active ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white hover:bg-white/5"}`}
              >
                <Icon size={16} className="shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {item.key === "notifikasi" && notifCount > 0 && (
                  <span className="text-[9px] font-bold bg-rose-500 text-white rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1">{notifCount}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-h-[10px]" />

        <div className="px-3 pb-2.5 shrink-0">
          <button onClick={() => onNavigate("pengaturan")} className="w-full rounded-2xl px-3 py-2.5 flex items-center gap-2.5 text-left relative overflow-hidden" style={{ background: "linear-gradient(135deg,#064E3B,#065F46)" }}>
            <span className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><MessageCircle size={15} /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-[12px] leading-tight">Otomasi Aktif</span>
              <span className="block text-[9.5px] text-emerald-100/80 truncate">Reminder & Report via WA</span>
            </span>
            <ArrowUpRight size={15} className="text-white/80 shrink-0" />
          </button>
        </div>

        <div className="px-3 pb-4 shrink-0">
          <div className="text-[9px] font-black uppercase tracking-widest text-slate-500 px-2 mb-1.5">Quick Action</div>
          <div className="flex flex-col gap-1.5">
            <button onClick={onAddActivity} className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-white/5 border border-white/10 text-white hover:bg-white/10 transition"><Plus size={13} /> Tambah Jadwal</button>
            <button onClick={onImportExcel} className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-white/5 border border-white/10 text-white hover:bg-white/10 transition"><FileUp size={13} /> Import Excel</button>
            <button onClick={onKirimReportWA} className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold text-white transition" style={{ background: "#25D366" }}><Send size={13} /> Kirim Report WA</button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ---------- Header atas (search, notifikasi, status WA, user) ----------
function TopHeader({ members, activities, onOpenMenu, onOpenActivity, onOpenMembers, notifCount, onOpenNotif }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matchActivities = q ? activities.filter(a => `${a.title || ""} ${a.location || ""}`.toLowerCase().includes(q)).slice(0, 5) : [];
  const matchMembers = q ? members.filter(m => `${m.name || ""} ${m.branch || ""}`.toLowerCase().includes(q)).slice(0, 5) : [];
  const hasResults = matchActivities.length > 0 || matchMembers.length > 0;
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="h-16 px-4 sm:px-6 flex items-center gap-3">
        <button onClick={onOpenMenu} className="p-2 rounded-lg hover:bg-slate-100 lg:hidden"><LayoutGrid size={18} /></button>
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama tim, aktivitas, atau lokasi…"
            className="w-full h-10 pl-9 pr-3 rounded-full border border-slate-200 bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
          />
          {q && hasResults && (
            <div className="absolute mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-40 max-h-80 overflow-y-auto">
              {matchActivities.length > 0 && <div className="px-3 pt-2 pb-1 text-[10px] font-black uppercase text-slate-400">Kegiatan</div>}
              {matchActivities.map(a => (
                <button key={a.id} onClick={() => { onOpenActivity(a.id); setQuery(""); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2">
                  <CalendarIcon size={13} className="text-indigo-400 shrink-0" /> <span className="truncate">{a.title}</span> <span className="text-slate-400 text-xs ml-auto shrink-0">{a.date}</span>
                </button>
              ))}
              {matchMembers.length > 0 && <div className="px-3 pt-2 pb-1 text-[10px] font-black uppercase text-slate-400 border-t border-slate-100">Anggota</div>}
              {matchMembers.map(m => (
                <button key={m.id} onClick={() => { onOpenMembers(); setQuery(""); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2">
                  <Users size={13} className="text-emerald-400 shrink-0" /> <span className="truncate">{m.name}</span> <span className="text-slate-400 text-xs ml-auto shrink-0">{m.branch}</span>
                </button>
              ))}
            </div>
          )}
          {q && !hasResults && (
            <div className="absolute mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-lg z-40 px-3 py-3 text-xs text-slate-400">Tidak ada hasil untuk "{query}".</div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3 shrink-0">
          <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold"><Wifi size={12} /> WA Gateway <span className="text-emerald-500">● Connected</span></span>
          <button onClick={onOpenNotif} className="relative p-2 rounded-full hover:bg-slate-100 transition">
            <Bell size={19} className="text-slate-500" />
            {notifCount > 0 && <span className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">{notifCount}</span>}
          </button>
          <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-200">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-black" style={{ background: "linear-gradient(135deg,#4F46E5,#7C3AED)" }}><UserCircle2 size={18} /></div>
            <div className="leading-tight">
              <div className="text-xs font-bold text-slate-800">Admin</div>
              <div className="text-[10px] text-slate-400">Team Planner</div>
            </div>
            <ChevronDown size={14} className="text-slate-400" />
          </div>
        </div>
      </div>
    </header>
  );
}

// ---------- Notifikasi: agregasi item yang butuh perhatian di seluruh data (bukan cuma hari ini) ----------
// Satu sumber kebenaran untuk "butuh perhatian", dipakai baik oleh badge notifikasi (sidebar/header)
// maupun halaman Notifikasi -- supaya angkanya selalu sama persis dengan isi listnya.
// Req Branding SENGAJA dikeluarkan dari aturan overdue/report generik (kegiatan lapangan berbasis
// jam), dan dicek pakai SLA 5 harinya sendiri supaya tidak dobel-hitung.
function computeAttentionItems(activities, members, rgeReports) {
  const memberOf = (id) => members.find((m) => m.id === id);
  const now = new Date();
  const items = [];
  for (const a of activities) {
    if (normalizeJenisKegiatan(a.jenisKegiatan) === "Req Branding") {
      const sla = reqBrandingSLA(a);
      if (sla.onTime === false) {
        items.push({ id: a.id, activity: a, member: memberOf(a.assignedMemberId), kind: "req_branding_late", label: "SLA Req Branding Terlewat", color: "#DC2626", bg: "#FEF2F2", sortKey: String(a.date || "") });
      }
      continue;
    }
    const st = statusOf(a, now);
    if (st === "overdue") {
      items.push({ id: a.id, activity: a, member: memberOf(a.assignedMemberId), kind: "overdue", label: STATUS_META.overdue.label, color: STATUS_META.overdue.color, bg: STATUS_META.overdue.bg, sortKey: `${a.date || ""}${a.time || ""}` });
    } else if (st === "menunggu_report") {
      const rep = reportInfoForActivity(a, memberOf(a.assignedMemberId), rgeReports);
      if (!rep.received) {
        items.push({ id: a.id, activity: a, member: memberOf(a.assignedMemberId), kind: "report_pending", label: STATUS_META.menunggu_report.label, color: STATUS_META.menunggu_report.color, bg: STATUS_META.menunggu_report.bg, sortKey: `${a.date || ""}${a.time || ""}` });
      }
    }
  }
  return items.sort((x, y) => y.sortKey.localeCompare(x.sortKey));
}

function NotifikasiPage({ activities, members, rgeReports, onOpen }) {
  const items = computeAttentionItems(activities, members, rgeReports);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Notifikasi</h1>
        <p className="text-sm text-slate-500 mt-1">Kegiatan overdue, report WA yang belum masuk, dan SLA Req Branding yang terlewat.</p>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {items.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">Semua kegiatan aman, tidak ada yang butuh perhatian 🎉</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((it) => {
              const a = it.activity;
              const Icon = it.kind === "overdue" ? Clock : it.kind === "req_branding_late" ? Package : MessageCircle;
              return (
                <button key={it.id} onClick={() => onOpen(it.id)} className="w-full px-5 py-3.5 flex items-center gap-3 text-left hover:bg-slate-50 transition">
                  <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: it.bg, color: it.color }}>
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-800 truncate">{a.title}</span>
                    <span className="block text-xs text-slate-400 truncate">{it.member?.name || "Tanpa PIC"} · {a.date}{a.time ? ` · ${a.time}` : ""}</span>
                  </span>
                  <span className="text-[11px] font-bold shrink-0" style={{ color: it.color }}>{it.label}</span>
                  <ArrowUpRight size={15} className="text-slate-300 shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Pengaturan: status integrasi & jalan pintas -- bukan form konfigurasi baru (belum ada
// backend untuk itu), supaya tidak menampilkan tombol yang keliatan aktif tapi sebenarnya tidak
// tersambung ke apa pun. ----------
function PengaturanPage({ onOpenInfo, onOpenMembers, onOpenMigrasi }) {
  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Pengaturan</h1>
        <p className="text-sm text-slate-500 mt-1">Status integrasi dan jalan pintas pengaturan data.</p>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col gap-3">
        <h3 className="font-bold text-sm text-slate-900">Status Integrasi</h3>
        <div className="flex items-center justify-between text-sm py-2 border-b border-slate-100">
          <span className="flex items-center gap-2 text-slate-600"><Wifi size={15} className="text-emerald-500" /> WA Gateway (WAHA)</span>
          <span className="text-[11px] font-bold text-emerald-600">Connected</span>
        </div>
        <div className="flex items-center justify-between text-sm py-2 border-b border-slate-100">
          <span className="flex items-center gap-2 text-slate-600"><Zap size={15} className="text-violet-500" /> n8n Automation</span>
          <span className="text-[11px] font-bold text-emerald-600">Active</span>
        </div>
        <div className="flex items-center justify-between text-sm py-2">
          <span className="flex items-center gap-2 text-slate-600"><LayoutDashboard size={15} className="text-indigo-500" /> Firestore Sync</span>
          <span className="text-[11px] font-bold text-emerald-600">Live</span>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col gap-2">
        <h3 className="font-bold text-sm text-slate-900 mb-1">Jalan Pintas</h3>
        <button onClick={onOpenMembers} className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-slate-700"><span className="flex items-center gap-2"><Users size={15} /> Kelola data anggota</span><ArrowUpRight size={14} className="text-slate-300" /></button>
        <button onClick={onOpenMigrasi} className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-slate-700"><span className="flex items-center gap-2"><Wand2 size={15} /> Rapikan kategori kegiatan lama</span><ArrowUpRight size={14} className="text-slate-300" /></button>
        <button onClick={onOpenInfo} className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-slate-700"><span className="flex items-center gap-2"><Info size={15} /> Cara kerja sistem</span><ArrowUpRight size={14} className="text-slate-300" /></button>
      </div>
    </div>
  );
}

export default function PapanKegiatan() {
  const [ready, setReady] = useState(false);
  const [members, setMembers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [cursor, setCursor] = useState(() => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() }; });
  const [weekCursor, setWeekCursor] = useState(() => { const t = new Date(); const day = (t.getDay() + 6) % 7; const start = new Date(t); start.setDate(t.getDate() - day); return start; });
  const [plannerView, setPlannerView] = useState("weekly");
  const [dayModal, setDayModal] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showSim, setShowSim] = useState(false);
  const [showAddActivity, setShowAddActivity] = useState(null);
  const [showMigrasi, setShowMigrasi] = useState(false);
  const [toast, setToast] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);
  // Tab utama halaman: "kalender" (tampilan lama, default), "galeriBranch" (galeri foto laporan
  // RGE per branch dari grup WA), "rekapKPI" (rekap target vs pencapaian KPI per RGE per bulan).
  const [mainTab, setMainTab] = useState("dashboard");
  // rgeReports: ditulis oleh n8n (node "Simpan ke Firestore - rgeReports") tiap kali ada laporan
  // posm/event/dtu/desa/school/fwa/nota dari grup RGE WhatsApp. kpiTargets: target bulanan per RGE,
  // diisi manual lewat form di tab "Rekap KPI".
  const [rgeReports, setRgeReports] = useState([]);
  const [kpiTargets, setKpiTargets] = useState([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const importInputRef = useRef(null);

  function notify(msg) { setToast(msg); setTimeout(() => setToast(null), 2600); }

  // Vite's default template ships `#root { max-width:1280px; margin:0 auto; padding:2rem;
  // text-align:center }` in index.css. Kalau itu masih ada di project ini, layout sidebar+header
  // di atas jadi "terjepit" di tengah viewport (muncul background kosong di kiri-kanan, dan semua
  // elemen ikut terlihat lebih besar/renggang dari proporsi aslinya). Kita netralkan di sini supaya
  // app ini selalu full-bleed apa pun isi index.css-nya -- idealnya baris itu juga dihapus manual
  // dari index.css, tapi ini jaga-jaga.
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-team-planner-reset", "true");
    style.textContent = `
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: ${COLORS.bg}; }
      #root { max-width: none !important; width: 100% !important; margin: 0 !important; padding: 0 !important; text-align: left !important; min-height: 100vh; }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);


  useEffect(() => {
    const unsubMembers = onSnapshot(
      collection(db, "members"),
      (snap) => setMembers(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
      (err) => { console.error(err); notify("Gagal memuat data anggota dari Firestore."); }
    );
    const unsubActivities = onSnapshot(
      collection(db, "activities"),
      (snap) => { setActivities(snap.docs.map((d) => ({ ...d.data(), id: d.id }))); setReady(true); },
      (err) => { console.error(err); notify("Gagal memuat data kegiatan dari Firestore."); setReady(true); }
    );
    const unsubReports = onSnapshot(
      collection(db, "rgeReports"),
      (snap) => setRgeReports(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
      (err) => console.error("Gagal memuat rgeReports:", err)
    );
    const unsubTargets = onSnapshot(
      collection(db, "kpiTargets"),
      (snap) => setKpiTargets(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
      (err) => console.error("Gagal memuat kpiTargets:", err)
    );
    return () => { unsubMembers(); unsubActivities(); unsubReports(); unsubTargets(); };
  }, []);

  // Simpan/update target KPI bulanan 1 RGE. Doc id dibuat deterministik (memberId_bulan) supaya
  // simpan ulang di bulan yang sama otomatis nge-update, bukan bikin dokumen baru.
  async function saveKpiTarget(memberId, monthKey, patch) {
    const id = `${memberId}_${monthKey}`;
    try {
      await setDoc(doc(db, "kpiTargets", id), { memberId, monthKey, ...patch }, { merge: true });
      notify("Target KPI tersimpan.");
    } catch (e) {
      console.error(e);
      notify("Gagal menyimpan target KPI.");
    }
  }

  async function addMember(member) {
    // Document ID Firestore dibuat dari nomor WA (bukan auto-generate) -- supaya konsisten dengan
    // sync otomatis Sheet MEMBER -> Firestore dari n8n (docId = nomor WA juga). Kalau ID-nya beda,
    // member yang sama bisa kesimpan 2x (dobel) di web.
    const phone = String(member.phone || "").replace(/\D/g, "");
    try {
      if (phone) await setDoc(doc(db, "members", phone), member);
      else await addDoc(collection(db, "members"), member);
    }
    catch (e) { console.error(e); notify("Gagal menyimpan anggota baru."); }
  }
  async function updateMember(id, patch) {
    try { await updateDoc(doc(db, "members", id), patch); }
    catch (e) { console.error(e); notify("Gagal memperbarui anggota."); }
  }
  async function removeMember(id) {
    try { await deleteDoc(doc(db, "members", id)); }
    catch (e) { console.error(e); notify("Gagal menghapus anggota."); }
  }
  // Hapus member dobel (nomor WA sama). Sebelum dihapus, semua kegiatan & target KPI yang menunjuk ke
  // data dobel dipindahkan ke data yang dipertahankan, jadi tidak ada kegiatan yang kehilangan PIC.
  async function mergeDuplicateMembers(groups) {
    let removed = 0;
    try {
      for (const { keeper, dups } of groups) {
        for (const dup of dups) {
          for (const a of activities.filter((x) => x.assignedMemberId === dup.id)) {
            await updateDoc(doc(db, "activities", a.id), { assignedMemberId: keeper.id });
          }
          for (const t of kpiTargets.filter((x) => x.memberId === dup.id)) {
            const newId = `${keeper.id}_${t.monthKey}`;
            if (!kpiTargets.some((x) => x.id === newId)) {
              const { id: _oldId, ...rest } = t;
              await setDoc(doc(db, "kpiTargets", newId), { ...rest, memberId: keeper.id });
            }
            await deleteDoc(doc(db, "kpiTargets", t.id));
          }
          // Lengkapi data keeper yang kosong dari data dobel (mis. branch/posisi), baru hapus dobelnya.
          const fill = {};
          if (!keeper.branch && dup.branch) fill.branch = dup.branch;
          if (!keeper.name && dup.name) fill.name = dup.name;
          if (Object.keys(fill).length) await updateDoc(doc(db, "members", keeper.id), fill);
          await deleteDoc(doc(db, "members", dup.id));
          removed++;
        }
      }
      notify(`${removed} data anggota dobel dihapus.`);
    } catch (e) {
      console.error(e);
      notify(`Berhenti di tengah jalan (${removed} terhapus). Coba lagi, proses ini aman diulang.`);
    }
  }
  // Import Excel (Quick Action di sidebar): upload file .xlsx berisi kolom Nama / Nomor WA / Branch /
  // Posisi -- kolom yang SAMA seperti sheet MEMBER yang dibaca n8n (lihat node "Siapkan Data Member
  // utk Firestore"). docId dibuat dari nomor WA supaya konsisten dengan sync otomatis dari n8n
  // (upsert, bukan dobel data kalau file yang sama diimport ulang).
  function triggerImportExcel() { importInputRef.current?.click(); }
  async function handleImportExcelFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const norm = (obj, keys) => {
        for (const k of Object.keys(obj)) {
          if (keys.some((x) => k.trim().toLowerCase() === x)) return obj[k];
        }
        return "";
      };
      let ok = 0, skipped = 0;
      for (const row of rows) {
        const phone = String(norm(row, ["nomor wa", "phone", "no wa", "whatsapp"])).replace(/\D/g, "");
        if (!phone) { skipped++; continue; }
        const posisi = normalizePosisi(norm(row, ["posisi", "position"]) || "RGE");
        if (!isPosisiAllowed(posisi)) { skipped++; continue; } // posisi di luar RGE/GTM Region/HOA: tidak dibawa ke Planner
        await addMember({
          name: norm(row, ["nama", "name"]),
          phone,
          branch: norm(row, ["branch"]),
          posisi,
        });
        ok++;
      }
      notify(`Import selesai: ${ok} anggota tersimpan${skipped ? `, ${skipped} baris dilewati (nomor WA kosong / posisi bukan RGE, GTM Region, HOA)` : ""}.`);
    } catch (err) {
      console.error("Gagal import Excel:", err);
      notify("Gagal membaca file Excel. Pastikan formatnya .xlsx dengan kolom Nama/Nomor WA/Branch/Posisi.");
    }
  }

  async function addActivity(activity) {
    try { await addDoc(collection(db, "activities"), { ...activity, jenisKegiatan: normalizeJenisKegiatan(activity.jenisKegiatan), photos: activity.photos || [] }); }
    catch (e) { console.error(e); notify("Gagal menyimpan kegiatan baru."); }
  }
  async function updateActivity(id, patch) {
    try {
      const finalPatch = patch.jenisKegiatan !== undefined ? { ...patch, jenisKegiatan: normalizeJenisKegiatan(patch.jenisKegiatan) } : patch;
      await updateDoc(doc(db, "activities", id), finalPatch);
    }
    catch (e) { console.error(e); notify("Gagal memperbarui kegiatan."); }
  }
  async function deleteActivity(id) {
    // Beberapa kegiatan lama (mis. yang masuk lewat n8n/WhatsApp) kadang punya id dengan spasi
    // nyangkut di depan/belakang — trim dulu supaya path Firestore-nya tepat sasaran.
    const cleanId = String(id || "").trim();
    if (!cleanId) { notify("Gagal menghapus: ID kegiatan tidak valid/kosong."); return false; }
    try {
      await deleteDoc(doc(db, "activities", cleanId));
      return true;
    } catch (e) {
      console.error("Gagal menghapus kegiatan", cleanId, e);
      // Dokumen sudah tidak ada di Firestore (mis. sudah kehapus dari sisi lain) — anggap sukses
      // saja daripada bikin kegiatan itu nyangkut selamanya di kalender.
      if (e?.code === "not-found") return true;
      // Kalau masih gagal, ini HAMPIR SELALU soal Firestore Security Rules yang menolak operasi
      // "delete" pada koleksi "activities" (bukan bug di tombolnya). Kode error asli ditampilkan
      // di toast supaya langsung ketahuan: kalau munculnya "permission-denied", perbaiki rules-nya,
      // bukan kode web ini.
      notify(`Gagal menghapus (${e?.code || "error"}): ${e?.message || "coba lagi."}`);
      return false;
    }
  }
  async function addPhoto(activityId, photo) {
    try { await updateDoc(doc(db, "activities", activityId), { status: "selesai", photos: arrayUnion(photo) }); }
    catch (e) { console.error(e); notify("Gagal mengunggah foto."); }
  }
  async function removePhoto(activityId, photoId) {
    try {
      const act = activities.find((a) => a.id === activityId);
      if (!act) return;
      const remaining = (act.photos || []).filter((p) => p.id !== photoId);
      const patch = { photos: remaining };
      // Kalau foto terakhir dihapus dan kegiatan sebelumnya sudah "selesai", buka lagi otomatis jadi
      // "rencana" — supaya kegiatan ini kembali dianggap terbuka dan foto baru yang dikirim RGE lewat
      // WhatsApp bisa tercocokkan ke kegiatan ini (lihat node "Cocokkan Kegiatan by Tanggal Foto" di n8n,
      // yang hanya mencari di antara kegiatan berstatus "rencana").
      if (remaining.length === 0 && act.status === "selesai") patch.status = "rencana";
      await updateDoc(doc(db, "activities", activityId), patch);
      notify(remaining.length === 0
        ? 'Foto dihapus. Kegiatan dibuka lagi jadi "Rencana" — minta RGE kirim ulang foto yang relevan lewat WhatsApp.'
        : "Foto dihapus dari dokumentasi.");
    } catch (e) {
      console.error("Gagal menghapus foto", e);
      notify(`Gagal menghapus foto (${e?.code || "error"}): ${e?.message || "coba lagi."}`);
    }
  }

  const memberById = (id) => members.find((m) => m.id === id);

  // ---------- Calendar grid computation ----------
  const first = new Date(cursor.y, cursor.m, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const activitiesByDate = {};
  activities.forEach((a) => {
    const withPosisi = { ...a, _posisi: memberById(a.assignedMemberId)?.posisi };
    (activitiesByDate[a.date] ||= []).push(withPosisi);
  });
  Object.values(activitiesByDate).forEach((list) => list.sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99")));

  const todaysActivities = activitiesByDate[todayKey()] || [];

  const notifCount = computeAttentionItems(activities, members, rgeReports).length;

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400 font-medium">Memuat papan kegiatan…</div>;
  }

  return (
    <div className="min-h-screen w-full flex" style={{ background: COLORS.bg }}>
      <input ref={importInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportExcelFile} />

      <SidebarNav
        mainTab={mainTab}
        plannerView={plannerView}
        onNavigate={(tab, pv) => { setMainTab(tab); if (pv) setPlannerView(pv); }}
        notifCount={notifCount}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        onAddActivity={() => setShowAddActivity({ date: todayKey() })}
        onImportExcel={triggerImportExcel}
        onKirimReportWA={() => setShowSim(true)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopHeader
          members={members}
          activities={activities}
          onOpenMenu={() => setMobileNavOpen(true)}
          onOpenActivity={(id) => setDetailId(id)}
          onOpenMembers={() => setShowMembers(true)}
          notifCount={notifCount}
          onOpenNotif={() => setMainTab("notifikasi")}
        />

        <main className="flex-1 w-full max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {mainTab === "dashboard" && (
            <Dashboard
              activities={activities} members={members} rgeReports={rgeReports} kpiTargets={kpiTargets}
              weekCursor={weekCursor} setWeekCursor={setWeekCursor}
              onOpenActivity={(id) => setDetailId(id)}
              onAddActivity={(date, memberId) => setShowAddActivity({ date, memberId })}
              onGoFullSchedule={() => { setMainTab("kalender"); setPlannerView("weekly"); }}
            />
          )}

          {mainTab === "team" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-slate-900">Anggota Tim</h1>
                  <p className="text-sm text-slate-500 mt-1">Ringkasan eksekusi RGE hari ini, dan kelola data anggota.</p>
                </div>
                <div className="flex items-center gap-2">
                  <GhostBtn onClick={() => setShowSim(true)}><Smartphone size={14} /> Simulasi WhatsApp</GhostBtn>
                  <PrimaryBtn onClick={() => setShowMembers(true)}><Users size={15} /> Kelola Anggota</PrimaryBtn>
                </div>
              </div>
              <TeamOverview activities={activities} members={members} />
            </div>
          )}

          {mainTab === "galeriBranch" && (
            <LaporanRekapPage activities={activities} members={members} rgeReports={rgeReports} onOpenActivity={(id) => setDetailId(id)} />
          )}

          {mainTab === "rekapKPI" && (
            <div className="flex flex-col gap-4">
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-900">Pencapaian KPI</h1>
                <p className="text-sm text-slate-500 mt-1">Target vs pencapaian bulanan per RGE.</p>
              </div>
              <RekapKPI members={members} rgeReports={rgeReports} kpiTargets={kpiTargets} onSaveTarget={saveKpiTarget} activities={activities} onOpenActivity={(id) => setDetailId(id)} />
            </div>
          )}

          {mainTab === "kalender" && (
            plannerView === "weekly" ? (
              <WeeklyPlanner activities={activities} members={members} rgeReports={rgeReports} weekCursor={weekCursor} setWeekCursor={setWeekCursor} onOpenActivity={(id) => setDetailId(id)} onAddActivity={(date, memberId) => setShowAddActivity({ date, memberId })} onViewChange={setPlannerView} />
            ) : (
              <MonthlyPlanner activities={activities} members={members} cursor={cursor} setCursor={setCursor} onOpenActivity={(id) => setDetailId(id)} onAddActivity={(date, memberId) => setShowAddActivity({ date, memberId })} onViewChange={setPlannerView} />
            )
          )}

          {mainTab === "notifikasi" && (
            <NotifikasiPage activities={activities} members={members} rgeReports={rgeReports} onOpen={(id) => setDetailId(id)} />
          )}

          {mainTab === "pengaturan" && (
            <PengaturanPage onOpenInfo={() => setInfoOpen(true)} onOpenMembers={() => setShowMembers(true)} onOpenMigrasi={() => setShowMigrasi(true)} />
          )}
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg z-[100] flex items-center gap-2">
          <Check size={15} /> {toast}
        </div>
      )}

      {/* Day modal */}
      {dayModal && (
        <Modal onClose={() => setDayModal(null)} width={440}>
          <ModalHeader title={new Date(dayModal + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} onClose={() => setDayModal(null)} />
          <div className="p-5 flex flex-col gap-3">
            {(activitiesByDate[dayModal] || []).length === 0 && (
              <p className="text-slate-400 text-sm">Belum ada kegiatan pada tanggal ini.</p>
            )}
            {(activitiesByDate[dayModal] || []).map((a) => {
              const mem = memberById(a.assignedMemberId);
              return (
                <div key={a.id} onClick={() => { setDetailId(a.id); setDayModal(null); }} className="border border-slate-200 rounded-xl p-3 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/40 transition">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <StatusMarker status={a.status} />
                      {a.time && <span className="font-mono text-xs text-slate-400 flex-shrink-0">{a.time}</span>}
                      <span className="font-semibold text-sm text-slate-900 truncate">{a.title}</span>
                    </span>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{mem ? `${mem.name} · ${mem.posisi}` : "Belum ditugaskan"}</div>
                  {a.photos?.length > 0 && <div className="text-xs text-slate-500 mt-1 flex items-center gap-1"><Camera size={12} />{a.photos.length} foto</div>}
                </div>
              );
            })}
            <PrimaryBtn onClick={() => { setShowAddActivity({ date: dayModal }); setDayModal(null); }}><Plus size={15} /> Tambah kegiatan</PrimaryBtn>
          </div>
        </Modal>
      )}

      {showAddActivity && (
        <AddActivityModal
          initialDate={showAddActivity.date}
          initialMemberId={showAddActivity.memberId}
          members={members}
          onClose={() => setShowAddActivity(null)}
          onSave={(a) => { addActivity({ ...a, status: "rencana", createdVia: "web" }); setShowAddActivity(null); notify("Kegiatan ditambahkan ke kalender."); }}
        />
      )}

      {detailId && (
        <ActivityDetailModal
          activity={activities.find((a) => a.id === detailId)}
          member={memberById(activities.find((a) => a.id === detailId)?.assignedMemberId)}
          members={members}
          rgeReports={rgeReports}
          onClose={() => setDetailId(null)}
          onToggleStatus={(id, status) => updateActivity(id, { status })}
          onReschedule={(id, date, time) => updateActivity(id, { date, time })}
          onEdit={(id, patch) => { updateActivity(id, patch); notify("Kegiatan diperbarui."); }}
          onDelete={async (id) => { const ok = await deleteActivity(id); if (ok) { setDetailId(null); notify("Kegiatan dihapus."); } }}
          onAddPhoto={(photo) => addPhoto(detailId, photo)}
          onRemovePhoto={removePhoto}
        />
      )}

      {showMembers && (
        <MembersModal members={members} onClose={() => setShowMembers(false)} onAdd={addMember} onRemove={removeMember} onEdit={updateMember} duplicateGroups={findDuplicateMemberGroups(members, activities)} onMergeDuplicates={mergeDuplicateMembers} />
      )}

      {showSim && (
        <WhatsAppSimModal
          members={members}
          activities={activities}
          onClose={() => setShowSim(false)}
          onNewSchedule={(a) => { addActivity(a); notify(`Jadwal baru diterima dari ${memberById(a.assignedMemberId)?.name} via WhatsApp.`); }}
          onUploadResult={(activityId, photo) => { addPhoto(activityId, photo); notify(`Foto hasil kegiatan diterima via WhatsApp.`); }}
        />
      )}

      {showMigrasi && (
        <MigrasiKategoriModal activities={activities} onClose={() => setShowMigrasi(false)} onApply={updateActivity} />
      )}

      {infoOpen && (
        <Modal onClose={() => setInfoOpen(false)} width={480}>
          <ModalHeader title="Cara kerja sistem" onClose={() => setInfoOpen(false)} icon={<Info size={18} />} />
          <div className="p-5 flex flex-col gap-3 text-sm text-slate-700 leading-relaxed">
            <p>Kalender ini terhubung <b>langsung ke Firestore</b> dan diperbarui secara real-time. Tombol "Simulasi WhatsApp" tersedia untuk uji coba cepat dari web, tapi kegiatan sungguhan biasanya masuk lewat WhatsApp tim.</p>
            <p>Alur produksinya:</p>
            <ol className="pl-4 flex flex-col gap-1 list-decimal">
              <li>Anggota kirim pesan/foto ke nomor WhatsApp tim.</li>
              <li>WAHA menerima pesan lewat <i>webhook</i> dan mengirim ke n8n.</li>
              <li>n8n mencocokkan nomor pengirim dengan data anggota (nama + posisi).</li>
              <li>n8n memproses format pesan (mis. "JADWAL", foto dokumentasi) dan menyimpan ke Firestore.</li>
              <li>Web ini otomatis menampilkan perubahan itu tanpa perlu refresh.</li>
            </ol>
            <p className="text-slate-400">Data di papan ini dapat dilihat bersama oleh siapa pun yang membuka tautan web ini.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- Weekly Planner: operational timeline untuk seluruh tim ----------
function WeeklyPlanner({ activities, members, rgeReports, weekCursor, setWeekCursor, onOpenActivity, onAddActivity, onViewChange }) {
  const [memberFilter, setMemberFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const weekStart = new Date(weekCursor); weekStart.setHours(0,0,0,0);
  const days = Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(weekStart.getDate()+i);return d;});
  const weekKeys=days.map(d=>dateKey(d.getFullYear(),d.getMonth(),d.getDate())); const today=todayKey();
  const teamMembers=members.filter(m=>(m.posisi||"RGE")==="RGE"); const baseMembers=sortMembersByBranch(teamMembers.length?teamMembers:members);
  // Filter branch mengurangi JUMLAH BARIS anggota yang dirender (bukan cuma kegiatan di dalam sel),
  // supaya tabel bisa muat tanpa perlu scroll ke bawah kalau tim-nya besar.
  const branches=sortBranches(Array.from(new Set(baseMembers.filter(m=>m.branch).map(m=>m.branch))));
  const visibleMembers=branchFilter==="all"?baseMembers:baseMembers.filter(m=>m.branch===branchFilter);
  const memberMap=Object.fromEntries(members.map(m=>[m.id,m]));
  const filtered=activities.filter(a=>{const mem=memberMap[a.assignedMemberId];if(!weekKeys.includes(a.date))return false;if(memberFilter!=="all"&&a.assignedMemberId!==memberFilter)return false;const st=statusOf(a);if(statusFilter!=="all"&&st!==statusFilter)return false;if(typeFilter!=="all"&&normalizeJenisKegiatan(a.jenisKegiatan)!==typeFilter)return false;if(query.trim()){const hay=`${a.title||""} ${a.location||""} ${mem?.name||""} ${mem?.branch||""}`.toLowerCase();if(!hay.includes(query.trim().toLowerCase()))return false;}return true;});
  const byMemberDay=(id,key)=>filtered.filter(a=>a.assignedMemberId===id&&a.date===key).sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99"));
  const weekActivities=activities.filter(a=>weekKeys.includes(a.date)); const weekDone=weekActivities.filter(a=>statusOf(a)==="selesai").length; const weekPending=weekActivities.filter(a=>["menunggu_report","overdue"].includes(statusOf(a))).length; const weekTotal=weekActivities.length; const completion=weekTotal?Math.round(weekDone/weekTotal*100):0;
  const moveWeek=offset=>{const d=new Date(weekStart);d.setDate(d.getDate()+offset*7);setWeekCursor(d)}; const goToday=()=>{const t=new Date();const day=(t.getDay()+6)%7;t.setDate(t.getDate()-day);setWeekCursor(t)};
  const monthLabel=days[0].getMonth()===days[6].getMonth()?`${BULAN[days[0].getMonth()]} ${days[0].getFullYear()}`:`${BULAN[days[0].getMonth()]} – ${BULAN[days[6].getMonth()]} ${days[6].getFullYear()}`;
  const statusOptions=[["all","Semua status"],["belum_mulai","Belum mulai"],["hari_ini","Hari ini"],["berjalan","Sedang berjalan"],["menunggu_report","Menunggu report"],["selesai","Selesai"],["overdue","Overdue"]];
  return <div className="space-y-5">
    <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4"><div><div className="flex items-center gap-2 mb-1"><span className="w-2 h-2 rounded-full bg-indigo-500"/><span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-indigo-600">Team Operations</span></div><h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">Weekly Planner</h1><p className="text-sm text-slate-500 mt-1">Pantau 18 anggota dalam satu timeline — jadwal, eksekusi, dan report WA.</p></div><div className="flex items-center gap-2"><button onClick={() => onViewChange("monthly")} className="px-3 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600">Kalender Bulanan</button><GhostBtn onClick={goToday}>Hari ini</GhostBtn><IconBtn onClick={()=>moveWeek(-1)} title="Minggu sebelumnya"><ChevronLeft size={18}/></IconBtn><IconBtn onClick={()=>moveWeek(1)} title="Minggu berikutnya"><ChevronRight size={18}/></IconBtn></div></div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[["Total kegiatan",weekTotal,"Minggu ini","text-slate-900","bg-slate-100"],["Selesai",weekDone,`${completion}% completion`,"text-emerald-600","bg-emerald-50"],["Perlu perhatian",weekPending,"Overdue + report","text-rose-600","bg-rose-50"],["Tim aktif",new Set(weekActivities.map(a=>a.assignedMemberId).filter(Boolean)).size,`${visibleMembers.length} anggota terdaftar`,"text-indigo-600","bg-indigo-50"]].map(([label,value,sub,text,bg])=><div key={label} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"><div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center mb-3`}><span className={`font-black ${text}`}>•</span></div><div className={`text-2xl font-black ${text}`}>{value}</div><div className="text-xs font-bold text-slate-700 mt-0.5">{label}</div><div className="text-[10px] text-slate-400 mt-1">{sub}</div></div>)}</div>
    <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm"><div className="flex flex-col lg:flex-row gap-2"><div className="relative flex-1 min-w-[220px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cari kegiatan, PIC, lokasi…" className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"/></div><select value={branchFilter} onChange={e=>{setBranchFilter(e.target.value);setMemberFilter("all");}} className="h-10 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 bg-white"><option value="all">Semua branch</option>{branches.map(b=><option key={b} value={b}>{b}</option>)}</select><select value={memberFilter} onChange={e=>setMemberFilter(e.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 bg-white"><option value="all">Semua anggota</option>{visibleMembers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select><select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 bg-white"><option value="all">Semua kegiatan</option>{JENIS_KEGIATAN_OPSI.map(x=><option key={x} value={x}>{x}</option>)}</select><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 bg-white">{statusOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div></div>
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"><div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/70"><div><div className="font-extrabold text-slate-900">{monthLabel}</div><div className="text-[10px] text-slate-400 font-semibold">{weekKeys[0]} — {weekKeys[6]}</div></div><div className="flex items-center gap-3 text-[10px] font-bold text-slate-400"><span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-emerald-500"/> Selesai</span><span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-amber-500"/> Berjalan</span><span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-rose-500"/> Perhatian</span></div></div>
      <div className="overflow-x-auto"><div className="min-w-[1180px]"><div className="grid grid-cols-[190px_repeat(7,minmax(140px,1fr))] border-b border-slate-200 bg-white sticky top-0 z-10"><div className="p-3 text-[10px] font-black uppercase tracking-wider text-slate-400">Anggota Tim</div>{days.map((d,i)=>{const key=weekKeys[i];const isToday=key===today;const count=weekActivities.filter(a=>a.date===key).length;return <div key={key} className={`p-2.5 border-l border-slate-100 ${isToday?"bg-indigo-50":""}`}><div className={`text-[10px] font-black uppercase ${isToday?"text-indigo-600":"text-slate-400"}`}>{HARI[i]}</div><div className={`text-base font-black ${isToday?"text-indigo-700":"text-slate-800"}`}>{d.getDate()}</div><div className="text-[9px] text-slate-400">{count} kegiatan</div></div>})}</div>
      {visibleMembers.map(m=><div key={m.id} className="grid grid-cols-[190px_repeat(7,minmax(140px,1fr))] border-b border-slate-100 last:border-b-0 min-h-[122px]"><div className="p-3 bg-slate-50/60 flex items-start gap-2.5 sticky left-0 z-[1] border-r border-slate-100"><span className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-black shrink-0" style={{background:memberColor(m.id)}}>{(m.name||"?").slice(0,1).toUpperCase()}</span><div className="min-w-0"><div className="font-extrabold text-xs text-slate-800 truncate">{m.name}</div><div className="text-[9px] text-slate-400 truncate mt-0.5">{m.branch||"Tanpa branch"}</div><div className="text-[9px] text-indigo-500 font-bold mt-1">{m.posisi||"RGE"}</div></div></div>{weekKeys.map((key)=>{const dayActs=byMemberDay(m.id,key);const isToday=key===today;return <div key={key} className={`border-l border-slate-100 p-1.5 space-y-1 ${isToday?"bg-indigo-50/40":"bg-white"}`}>{dayActs.map(a=>{const st=statusOf(a);const meta=STATUS_META[st];return <button key={a.id} onClick={()=>onOpenActivity(a.id)} title={`${a.title} · ${meta.label}`} className="w-full text-left rounded-xl border p-2 hover:shadow-sm transition bg-white" style={{borderColor:`${meta.color}40`,borderLeftWidth:3,borderLeftColor:meta.color}}><div className="flex items-center justify-between gap-1"><span className="text-[9px] font-black" style={{color:meta.color}}>{a.time||"—"}</span>{a.photos?.length>0&&<Camera size={10} className="text-slate-400"/>}</div><div className="text-[10px] font-bold text-slate-700 leading-tight mt-1">{a.title}</div><div className="mt-1.5 flex items-center gap-1"><span className="text-[8px] px-1.5 py-0.5 rounded-full font-bold" style={{color:meta.color,background:meta.bg}}>{meta.label}</span></div></button>})}<button onClick={()=>onAddActivity(key,m.id)} style={{borderColor:`${memberColor(m.id)}55`,background:`${memberColor(m.id)}14`,color:memberColor(m.id)}} className="w-full h-7 rounded-lg border hover:brightness-95 transition flex items-center justify-center"><Plus size={14} strokeWidth={2.75}/></button></div>})}</div>)}
      {visibleMembers.length===0&&<div className="p-10 text-center text-sm text-slate-400">Belum ada anggota tim.</div>}</div></div></div>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"><div className="flex items-center justify-between mb-3"><div><h3 className="font-extrabold text-sm text-slate-900">Status operasional minggu ini</h3><p className="text-[10px] text-slate-400">Progress dihitung dari status kegiatan yang sudah ada.</p></div><span className="text-lg font-black text-indigo-600">{completion}%</span></div><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{width:`${completion}%`}}/></div></div><div className="bg-slate-900 rounded-2xl p-4 shadow-sm text-white"><div className="flex items-center gap-2 mb-2"><Zap size={15} className="text-amber-300"/><h3 className="font-extrabold text-sm">Automation Ready</h3></div><p className="text-[10px] text-slate-300 leading-relaxed">Planner membaca status kegiatan yang sama dengan alur reminder dan report WhatsApp. Tidak ada field Firestore baru yang diperlukan.</p><div className="flex gap-2 mt-3"><span className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 text-[9px] font-bold">WA Gateway</span><span className="px-2 py-1 rounded-lg bg-violet-500/15 text-violet-300 text-[9px] font-bold">n8n</span></div></div></div>
  </div>;
}

// ---------- Monthly Planner: mode kalender lama tetap tersedia, default planner tetap weekly ----------
function MonthlyPlanner({ activities, members, cursor, setCursor, onOpenActivity, onAddActivity, onViewChange }) {
  const first = new Date(cursor.y, cursor.m, 1); const startOffset = (first.getDay() + 6) % 7; const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells=[]; for(let i=0;i<startOffset;i++)cells.push(null); for(let d=1;d<=daysInMonth;d++)cells.push(d); while(cells.length%7!==0)cells.push(null);
  const byDate={}; activities.forEach(a=>{(byDate[a.date] ||= []).push(a)}); Object.values(byDate).forEach(list=>list.sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99")));
  return <div className="space-y-5"><div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3"><div><div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-indigo-600">Calendar View</div><h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">Kalender Bulanan</h1><p className="text-sm text-slate-500 mt-1">Tampilan kalender tetap tersedia untuk melihat kepadatan kegiatan per tanggal.</p></div><div className="flex items-center gap-2"><button onClick={()=>onViewChange("weekly")} className="px-3 py-2 rounded-xl text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">Weekly Planner</button><IconBtn onClick={()=>setCursor(c=>c.m===0?{y:c.y-1,m:11}:{y:c.y,m:c.m-1})}><ChevronLeft size={18}/></IconBtn><div className="min-w-[150px] text-center font-extrabold text-slate-900">{BULAN[cursor.m]} {cursor.y}</div><IconBtn onClick={()=>setCursor(c=>c.m===11?{y:c.y+1,m:0}:{y:c.y,m:c.m+1})}><ChevronRight size={18}/></IconBtn></div></div><div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-sm"><div className="grid grid-cols-7 gap-2 text-center text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">{HARI.map(h=><div key={h}>{h}</div>)}</div><div className="grid grid-cols-7 gap-2">{cells.map((d,i)=>{if(d===null)return <div key={i} className="min-h-[110px]"/>;const key=dateKey(cursor.y,cursor.m,d);const dayActs=byDate[key]||[];const isToday=key===todayKey();return <div key={key} className={`min-h-[110px] rounded-xl border p-2 text-left ${isToday?"border-indigo-400 bg-indigo-50/50":"border-slate-200 bg-slate-50/40"}`}><div className={`text-xs font-black mb-1 ${isToday?"text-indigo-700":"text-slate-600"}`}>{d}</div><div className="space-y-1">{dayActs.slice(0,3).map(a=><button key={a.id} onClick={()=>onOpenActivity(a.id)} className="w-full text-left"><EventChip activity={{...a,_posisi:members.find(m=>m.id===a.assignedMemberId)?.posisi}}/></button>)}{dayActs.length>3&&<div className="text-[9px] font-bold text-slate-400">+{dayActs.length-3} kegiatan</div>}</div><button onClick={()=>onAddActivity(key)} className="mt-1 w-full h-6 rounded-lg border border-dashed border-slate-200 text-slate-300 hover:text-indigo-500 hover:border-indigo-300 flex items-center justify-center"><Plus size={12}/></button></div>})}</div></div></div>;
}

// ---------- Sidebar: Agenda Hari Ini ----------
function AgendaHariIni({ activities, members, onOpen }) {
  const todayLabel = new Date().toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
        <h3 className="font-bold text-slate-900 flex items-center gap-2 text-sm">
          <Smartphone size={16} className="text-indigo-600" /> Agenda Hari Ini
        </h3>
        <span className="text-[11px] font-semibold bg-slate-100 text-slate-500 px-2 py-1 rounded-full">{todayLabel}</span>
      </div>
      {activities.length === 0 ? (
        <p className="text-sm text-slate-400">Tidak ada kegiatan terjadwal hari ini.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {activities.map((a) => {
            const mem = members.find((m) => m.id === a.assignedMemberId);
            const selesai = a.status === "selesai";
            return (
              <div key={a.id} onClick={() => onOpen(a.id)} className="p-3 bg-slate-50 rounded-xl border border-slate-100 relative overflow-hidden cursor-pointer hover:bg-slate-100 transition">
                <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: selesai ? STATUS_COLORS.selesai : STATUS_COLORS.rencana }} />
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    {a.time && <span className="text-xs font-semibold text-indigo-600">{a.time} WIB</span>}
                    <h4 className="font-semibold text-sm text-slate-900 mt-0.5 truncate">{a.title}</h4>
                    <p className="text-xs text-slate-500 mt-1 truncate">👤 {mem ? `${mem.name} (${mem.posisi})` : "Belum ditugaskan"}</p>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Sidebar: Resume per Anggota ----------
function ResumeAnggota({ members, activities, cursor }) {
  const monthPrefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
  const monthActs = activities.filter((a) => a.date && a.date.startsWith(monthPrefix));

  // GTM Region & HOA adalah pemantau (atasan), bukan eksekutor kegiatan — resume ini hanya untuk RGE.
  const executorMembers = members.filter((m) => normalizePosisi(m.posisi || "RGE") === "RGE");
  const rows = executorMembers.map((m) => {
    const mine = monthActs.filter((a) => a.assignedMemberId === m.id);
    return {
      id: m.id, name: m.name, posisi: m.posisi,
      total: mine.length,
      pending: mine.filter((a) => a.status !== "selesai").length,
      selesai: mine.filter((a) => a.status === "selesai").length,
    };
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h3 className="font-bold text-slate-900 flex items-center gap-2 text-sm border-b border-slate-100 pb-3 mb-3">
        <Users size={16} className="text-indigo-600" /> Resume Anggota — {BULAN[cursor.m]}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">Belum ada anggota terdaftar.</p>
      ) : (
        <div className="flex flex-col divide-y divide-slate-100">
          {rows.map((r) => (
            <div key={r.id} className="py-2.5 flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-slate-800">{r.name}</span>
                <span className="text-slate-400 text-xs ml-1">({r.posisi})</span>
              </div>
              <div className="flex items-center gap-2.5 text-[11px] flex-shrink-0 font-medium">
                <span className="text-slate-500">Total <b className="text-slate-800">{r.total}</b></span>
                <span style={{ color: STATUS_COLORS.rencana }}>Pending <b>{r.pending}</b></span>
                <span style={{ color: STATUS_COLORS.selesai }}>Selesai <b>{r.selesai}</b></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Add Activity Modal ----------
function AddActivityModal({ initialDate, initialMemberId, members, onClose, onSave }) {
  const [date, setDate] = useState(initialDate || todayKey());
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [description, setDescription] = useState("");
  const [jenisKegiatan, setJenisKegiatan] = useState("");
  const rgeOnly = members.filter((m) => (m.posisi || "RGE") === "RGE");
  const assignableMembers = rgeOnly.length ? rgeOnly : members; // jaga-jaga kalau posisi belum konsisten
  const [assignedMemberId, setAssignedMemberId] = useState(initialMemberId || assignableMembers[0]?.id || "");
  const [handoverTo, setHandoverTo] = useState("");
  const isReqBranding = jenisKegiatan === "Req Branding";
  return (
    <Modal onClose={onClose} width={420}>
      <ModalHeader title="Tambah Kegiatan" onClose={onClose} icon={<Plus size={18} />} />
      <div className="p-5 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label={isReqBranding ? "Tanggal Permintaan" : "Tanggal"} required><input type="date" required style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Jam" required><input type="time" required style={inputStyle} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        <Field label="Judul kegiatan" required>
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Contoh: Attack Desa Wolomeze" />
        </Field>
        <Field label="Jenis kegiatan" required>
          <select required style={inputStyle} value={jenisKegiatan} onChange={(e) => setJenisKegiatan(e.target.value)}>
            <option value="" disabled>Pilih jenis kegiatan…</option>
            {JENIS_KEGIATAN_OPSI.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </Field>
        {isReqBranding && (
          <>
            <Field label="Diserahkan ke" required>
              <select required style={inputStyle} value={handoverTo} onChange={(e) => setHandoverTo(e.target.value)}>
                <option value="" disabled>Pilih penerima…</option>
                <option value="DSE">DSE</option>
                <option value="RSE">RSE</option>
                <option value="Depo">Depo</option>
              </select>
            </Field>
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 -mt-1">
              SLA permintaan branding: <b>5 hari</b> sejak tanggal permintaan ini sampai RGE upload foto serah terima. Durasinya dihitung otomatis di tab Pencapaian KPI begitu foto masuk.
            </p>
          </>
        )}
        <Field label="Deskripsi (opsional)">
          <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={isReqBranding ? "RGE yang menyerahkan" : "Penanggung jawab"}>
          <select style={inputStyle} value={assignedMemberId} onChange={(e) => setAssignedMemberId(e.target.value)}>
            {assignableMembers.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.posisi}</option>)}
          </select>
        </Field>
        <PrimaryBtn
          disabled={!title.trim() || !date || !time || !jenisKegiatan || (isReqBranding && !handoverTo)}
          onClick={() => onSave({ title: title.trim(), date, time, description, jenisKegiatan, assignedMemberId, ...(isReqBranding ? { handoverTo } : {}) })}
        >Simpan Kegiatan</PrimaryBtn>
      </div>
    </Modal>
  );
}

// ---------- Activity Detail Modal ----------
function ActivityDetailModal({ activity, member, members, rgeReports, onClose, onToggleStatus, onReschedule, onEdit, onDelete, onAddPhoto, onRemovePhoto }) {
  const [uploading, setUploading] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editJenis, setEditJenis] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editMemberId, setEditMemberId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hasilSpIM3, setHasilSpIM3] = useState("");
  const [hasilSp3ID, setHasilSp3ID] = useState("");
  const [hasilHifi, setHasilHifi] = useState("");
  const [hasilPoster, setHasilPoster] = useState("");
  const [hasilShopblind, setHasilShopblind] = useState("");
  const [hasilVinil, setHasilVinil] = useState("");
  const [hasilSpanduk, setHasilSpanduk] = useState("");
  const [hasilRontek, setHasilRontek] = useState("");
  const [savingHasil, setSavingHasil] = useState(false);
  const fileRef = useRef(null);
  const kategoriHasilAktif = kategoriHasil(activity?.jenisKegiatan);

  // Sinkron ulang form "Hasil Kegiatan" tiap kali kegiatan yang dibuka berganti (mis. lompat dari
  // satu kegiatan ke kegiatan lain lewat modal hari) supaya tidak nyangkut nilai kegiatan sebelumnya.
  useEffect(() => {
    setHasilSpIM3(activity?.hasil?.spIM3 ?? "");
    setHasilSp3ID(activity?.hasil?.sp3ID ?? "");
    setHasilHifi(activity?.hasil?.hifi ?? "");
    setHasilPoster(activity?.hasil?.poster ?? "");
    setHasilShopblind(activity?.hasil?.shopblind ?? "");
    setHasilVinil(activity?.hasil?.vinil ?? "");
    setHasilSpanduk(activity?.hasil?.spanduk ?? "");
    setHasilRontek(activity?.hasil?.rontek ?? "");
  }, [activity?.id]);

  if (!activity) return null;
  const chipColor = posisiColor(member?.posisi);
  const reportInfo = normalizeJenisKegiatan(activity.jenisKegiatan) === "Req Branding"
    ? { ...reportInfoForActivity(activity, member, rgeReports), received: Boolean(activity.photos?.length), photo: Boolean(activity.photos?.length) }
    : reportInfoForActivity(activity, member, rgeReports);
  const reportSteps = [
    ["Jadwal", true],
    ["Reminder WA", true],
    ["Report WA", reportInfo.received],
    ["Dokumentasi", reportInfo.photo],
    ["Hasil", reportInfo.hasResult],
  ];

  const reportChain = (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white/80 p-4">
      <div className="flex items-center justify-between mb-3"><div><div className="text-xs font-black text-slate-900">Execution → Report → Achievement</div><div className="text-[11px] text-slate-500">Status kegiatan dan laporan WA dalam satu alur.</div></div><span className={`text-[10px] font-extrabold px-2 py-1 rounded-full ${reportInfo.received ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{reportInfo.received ? "REPORT RECEIVED" : "REPORT PENDING"}</span></div>
      <div className="flex items-center gap-1">{reportSteps.map(([label,done],i)=><Fragment key={label}><div className="flex-1 min-w-0"><div className={`h-2 rounded-full ${done ? "bg-indigo-500" : "bg-slate-200"}`} /><div className={`mt-1 text-[9px] font-bold truncate ${done ? "text-slate-700" : "text-slate-400"}`}>{label}</div></div>{i<reportSteps.length-1&&<ChevronRight size={12} className="text-slate-300 shrink-0"/>}</Fragment>)}</div>
      {reportInfo.latest && <div className="mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1"><span>WA report: <b className="text-slate-700">{String(reportInfo.latest.Timestamp || reportInfo.latest.receivedAt || "").slice(0,16).replace("T"," ")}</b></span><span>{reportInfo.latest.rawCaption ? `“${String(reportInfo.latest.rawCaption).slice(0,80)}${String(reportInfo.latest.rawCaption).length>80?"…":""}”` : "Laporan diterima dari workflow n8n."}</span></div>}
    </div>
  );

  async function saveHasil() {
    setSavingHasil(true);
    const hasil = kategoriHasilAktif === "branding"
      ? {
          poster: Number(hasilPoster) || 0,
          shopblind: Number(hasilShopblind) || 0,
          vinil: Number(hasilVinil) || 0,
          spanduk: Number(hasilSpanduk) || 0,
          rontek: Number(hasilRontek) || 0,
        }
      : {
          spIM3: Number(hasilSpIM3) || 0,
          sp3ID: Number(hasilSp3ID) || 0,
          hifi: Number(hasilHifi) || 0,
        };
    await onEdit(activity.id, { hasil });
    setSavingHasil(false);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await resizeImage(file);
      onAddPhoto({ id: uid(), dataUrl, caption: "", uploadedBy: member?.name || "Web", uploadedAt: new Date().toISOString() });
    } catch (err) { console.error(err); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Modal onClose={onClose} width={760}>
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg,#EEF2FF 0%,#FFFFFF 58%,#F0FDFA 100%)" }} />
        <div className="relative px-5 pt-5 pb-4 border-b border-slate-200/80">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span style={{ width: 10, height: 10, borderRadius: 999, background: chipColor, display: "inline-block", boxShadow: `0 0 0 4px ${chipColor}18` }} />
                <span className="text-[11px] uppercase tracking-[0.16em] font-bold text-slate-500">{activity.jenisKegiatan || "Kegiatan"}</span>
                <StatusMarker status={activity.status} />
              </div>
              <h2 className="text-xl md:text-2xl font-black text-slate-900 leading-tight">{activity.title}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5 bg-white/80 border border-slate-200 rounded-full px-2.5 py-1">
                  <CalendarIcon size={13} />
                  {new Date(activity.date + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </span>
                {activity.time && <span className="inline-flex items-center gap-1.5 bg-white/80 border border-slate-200 rounded-full px-2.5 py-1"><Clock size={13} />{activity.time}</span>}
                {member && <span className="inline-flex items-center gap-1.5 bg-white/80 border border-slate-200 rounded-full px-2.5 py-1"><Users size={13} />{member.name}</span>}
              </div>
            </div>
            <button onClick={onClose} className="shrink-0 w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 flex items-center justify-center shadow-sm" aria-label="Tutup">
              <X size={17} />
            </button>
          </div>
        </div>
      </div>
      <div className="p-5 flex flex-col gap-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Status</div>
            <div className="mt-1 text-sm font-bold text-slate-900 flex items-center gap-1.5"><StatusMarker status={activity.status} />{activity.status === "selesai" ? "Selesai" : "Rencana"}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Dokumentasi</div>
            <div className="mt-1 text-sm font-bold text-slate-900 flex items-center gap-1.5"><ImageIcon size={14} />{activity.photos?.length || 0} foto</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Penanggung Jawab</div>
            <div className="mt-1 text-sm font-bold text-slate-900 truncate">{member?.name || "Belum ditentukan"}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Hasil</div>
            <div className="mt-1 text-sm font-bold text-slate-900">{kategoriHasilAktif ? "Siap diisi" : "Tidak ada form"}</div>
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2 rounded-xl bg-slate-900 p-3 shadow-sm">
          <div className="text-xs text-slate-300">Kontrol kegiatan</div>
          <div className="flex items-center gap-2">
            {activity.status === "selesai"
              ? <GhostBtn onClick={() => onToggleStatus(activity.id, "rencana")}>Tandai belum selesai</GhostBtn>
              : <PrimaryBtn onClick={() => onToggleStatus(activity.id, "selesai")}><Check size={13} />Tandai selesai</PrimaryBtn>}
          </div>
        </div>

        {activity.status !== "selesai" && (
          <div className="flex items-center gap-2 flex-wrap border-t border-dashed border-slate-200 pt-3">
            <GhostBtn onClick={() => {
              setShowEdit((v) => !v);
              setEditTitle(activity.title); setEditJenis(activity.jenisKegiatan || "");
              setEditDescription(activity.description || ""); setEditMemberId(activity.assignedMemberId || "");
              setShowReschedule(false); setConfirmDelete(false);
            }}>
              Edit Kegiatan
            </GhostBtn>
            <GhostBtn onClick={() => { setShowReschedule((v) => !v); setNewDate(activity.date); setNewTime(activity.time || ""); setShowEdit(false); setConfirmDelete(false); }}>
              Ubah jadwal
            </GhostBtn>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {!confirmDelete ? (
            <GhostBtn onClick={() => { setConfirmDelete(true); setShowReschedule(false); setShowEdit(false); }} style={{ borderColor: STATUS_COLORS.rencana, color: STATUS_COLORS.rencana }}>
              <Trash2 size={13} /> Batalkan / Hapus
            </GhostBtn>
          ) : (
            <span className="flex items-center gap-2 text-sm text-slate-800">
              Yakin dihapus?
              <PrimaryBtn onClick={() => onDelete(activity.id)} style={{ background: STATUS_COLORS.rencana }}>Ya, hapus</PrimaryBtn>
              <GhostBtn onClick={() => setConfirmDelete(false)}>Batal</GhostBtn>
            </span>
          )}
        </div>

        {showEdit && (
          <div className="flex flex-col gap-2 bg-slate-50 rounded-lg p-3">
            <Field label="Judul kegiatan" required>
              <input style={inputStyle} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </Field>
            <Field label="Jenis kegiatan" required>
              <select required style={inputStyle} value={JENIS_KEGIATAN_OPSI.includes(editJenis) ? editJenis : ""} onChange={(e) => setEditJenis(e.target.value)}>
                <option value="" disabled>Pilih jenis kegiatan…</option>
                {JENIS_KEGIATAN_OPSI.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
              {editJenis && !JENIS_KEGIATAN_OPSI.includes(editJenis) && (
                <p className="text-[11px] text-amber-600 mt-1">Kategori lama: "{editJenis}" — pilih salah satu kategori baku di atas untuk memperbaikinya.</p>
              )}
            </Field>
            <Field label="Deskripsi">
              <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </Field>
            {members && (
              <Field label="Penanggung jawab">
                <select style={inputStyle} value={editMemberId} onChange={(e) => setEditMemberId(e.target.value)}>
                  {members.filter((m) => (m.posisi || "RGE") === "RGE").map((m) => <option key={m.id} value={m.id}>{m.name} — {m.posisi}</option>)}
                </select>
              </Field>
            )}
            <PrimaryBtn
              disabled={!editTitle.trim() || !JENIS_KEGIATAN_OPSI.includes(editJenis)}
              onClick={() => { onEdit(activity.id, { title: editTitle.trim(), jenisKegiatan: editJenis, description: editDescription, assignedMemberId: editMemberId }); setShowEdit(false); }}
            >
              Simpan Perubahan
            </PrimaryBtn>
          </div>
        )}

        {showReschedule && (
          <div className="flex items-center gap-2 flex-wrap bg-slate-50 rounded-lg p-3">
            <input type="date" style={{ ...inputStyle, flex: 1, minWidth: 140 }} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            <input type="time" style={{ ...inputStyle, width: 110 }} value={newTime} onChange={(e) => setNewTime(e.target.value)} />
            <PrimaryBtn
              disabled={!newDate || (newDate === activity.date && newTime === (activity.time || ""))}
              onClick={() => { onReschedule(activity.id, newDate, newTime); setShowReschedule(false); }}
            >
              Simpan
            </PrimaryBtn>
          </div>
        )}

        {member && (
          <div className="flex items-center gap-2 text-sm text-slate-800">
            <span style={{ background: chipColor }} className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs text-white flex-shrink-0">{member.name[0]}</span>
            <span><b>{member.name}</b> · {member.posisi}</span>
          </div>
        )}

        {activity.description && <p className="text-sm text-slate-700 leading-relaxed">{activity.description}</p>}

        {reportChain}

        {normalizeJenisKegiatan(activity.jenisKegiatan) === "Req Branding" && (() => {
          const sla = reqBrandingSLA(activity);
          return (
            <div className="rounded-2xl border p-4" style={{ borderColor: sla.onTime === false ? "#FECACA" : "#FDE68A", background: sla.onTime === false ? "#FEF2F2" : "#FFFBEB" }}>
              <div className="flex items-center gap-2 mb-1"><Package size={15} style={{ color: sla.onTime === false ? "#DC2626" : "#B45309" }} /><span className="text-xs font-black" style={{ color: sla.onTime === false ? "#DC2626" : "#B45309" }}>SLA Req Branding — target {REQ_BRANDING_SLA_DAYS} hari</span></div>
              <div className="text-xs text-slate-600">Diserahkan ke: <b>{activity.handoverTo || "—"}</b></div>
              <div className="text-xs text-slate-600 mt-0.5">Status: <b>{sla.statusLabel}</b></div>
            </div>
          );
        })()}

        {kategoriHasilAktif && (
          <div className="bg-slate-50 rounded-lg p-3 flex flex-col gap-2">
            <span className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
              <BarChart2 size={15} /> Hasil Kegiatan {kategoriHasilAktif === "branding" ? "(Branding)" : "(Penjualan)"}
            </span>
            {kategoriHasilAktif === "branding" ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Pasang poster (outlet)">
                  <input type="number" min="0" inputMode="numeric" style={inputStyle} value={hasilPoster} onChange={(e) => setHasilPoster(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Pasang shopblind (outlet)">
                  <input type="number" min="0" inputMode="numeric" style={inputStyle} value={hasilShopblind} onChange={(e) => setHasilShopblind(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Branding vinil (outlet)">
                  <input type="number" min="0" inputMode="numeric" style={inputStyle} value={hasilVinil} onChange={(e) => setHasilVinil(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Pasang spanduk (titik)">
                  <input type="number" min="0" inputMode="numeric" style={inputStyle} value={hasilSpanduk} onChange={(e) => setHasilSpanduk(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Pasang rontek (titik)">
                  <input type="number" min="0" inputMode="numeric" style={inputStyle} value={hasilRontek} onChange={(e) => setHasilRontek(e.target.value)} placeholder="0" />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Field label="Jualan SP IM3">
                  <input type="number" min="0" inputMode="numeric" style={inputStyle} value={hasilSpIM3} onChange={(e) => setHasilSpIM3(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Jualan SP 3ID">
                  <input type="number" min="0" inputMode="numeric" style={inputStyle} value={hasilSp3ID} onChange={(e) => setHasilSp3ID(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Jualan Hifi">
                  <input type="number" min="0" inputMode="numeric" style={inputStyle} value={hasilHifi} onChange={(e) => setHasilHifi(e.target.value)} placeholder="0" />
                </Field>
              </div>
            )}
            <div className="flex justify-end">
              <PrimaryBtn onClick={saveHasil} disabled={savingHasil}>{savingHasil ? "Menyimpan…" : "Simpan Hasil"}</PrimaryBtn>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-sm text-slate-900 flex items-center gap-1.5"><ImageIcon size={15} /> Dokumentasi ({activity.photos?.length || 0})</span>
            <label className="cursor-pointer">
              <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
              <span className="text-xs text-indigo-600 font-semibold flex items-center gap-1">{uploading ? "Mengunggah…" : <><Upload size={13} />Unggah foto</>}</span>
            </label>
          </div>
          {activity.photos?.length > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {activity.photos.map((ph) => (
                  <PhotoThumb key={ph.id} photo={ph} onRemove={(photoId) => onRemovePhoto(activity.id, photoId)} />
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                Foto tidak relevan/salah kegiatan? Tap ikon 🗑️ di foto untuk menghapusnya, atau langsung unggah foto pengganti dari sini. Kalau foto terakhir dihapus, kegiatan otomatis dibuka lagi jadi "Rencana" supaya RGE bisa kirim ulang lewat WhatsApp.
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-400 italic">Belum ada foto hasil kegiatan.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Thumbnail dokumentasi dengan tombol hapus + konfirmasi ringkas (dibikin selalu terlihat, bukan
// cuma muncul saat hover, supaya enak dipakai lewat HP/tablet oleh HOA/GTM Region).
function PhotoThumb({ photo, onRemove }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="rounded-lg overflow-hidden border border-slate-200 relative">
      <img src={photo.dataUrl} alt={photo.caption || "dokumentasi"} className="w-full h-[90px] object-cover block" />
      <div className="text-[10px] text-slate-400 text-center py-0.5 font-mono truncate px-1">{photo.uploadedBy}</div>
      {!confirm ? (
        <button
          onClick={() => setConfirm(true)}
          title="Hapus foto ini (tidak relevan / salah kegiatan)"
          className="absolute top-1 right-1 bg-white/90 hover:bg-rose-50 text-rose-500 rounded-full p-1 shadow-sm"
        >
          <Trash2 size={12} />
        </button>
      ) : (
        <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center gap-1 p-1">
          <span className="text-[10px] text-slate-700 text-center leading-tight">Hapus foto ini?</span>
          <div className="flex gap-1">
            <button onClick={() => onRemove(photo.id)} className="text-[10px] bg-rose-500 text-white rounded px-1.5 py-0.5">Hapus</button>
            <button onClick={() => setConfirm(false)} className="text-[10px] bg-slate-200 text-slate-700 rounded px-1.5 py-0.5">Batal</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Members Modal ----------
// Baris anggota bisa masuk mode "edit" sendiri-sendiri (nama, no. HP, branch, posisi) — dipisah jadi
// komponen sendiri supaya tiap baris punya state form edit masing-masing tanpa saling bentrok.
function MemberRow({ member, onRemove, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.name || "");
  const [phone, setPhone] = useState(member.phone || "");
  const [branch, setBranch] = useState(member.branch || "");
  const [posisi, setPosisi] = useState(member.posisi || "RGE");
  const [saving, setSaving] = useState(false);
  const color = posisiColor(member.posisi);

  function startEdit() {
    setName(member.name || ""); setPhone(member.phone || "");
    setBranch(member.branch || ""); setPosisi(member.posisi || "RGE");
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    await onEdit(member.id, { name: name.trim(), phone: phone.trim(), branch: branch.trim(), posisi });
    setSaving(false);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2.5 flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Nama"><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="No. WhatsApp"><input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="62812..." /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Branch">
            <input style={inputStyle} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Cth: Flores Barat" />
          </Field>
          <Field label="Posisi">
            <select style={inputStyle} value={posisi} onChange={(e) => setPosisi(e.target.value)}>
              {!POSISI_OPSI.includes(posisi) && <option value={posisi}>{posisi} (lama)</option>}
              {POSISI_OPSI.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex items-center gap-2 justify-end">
          <GhostBtn onClick={() => setEditing(false)}>Batal</GhostBtn>
          <PrimaryBtn disabled={!name.trim() || !phone.trim() || saving} onClick={save}>{saving ? "Menyimpan…" : "Simpan"}</PrimaryBtn>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span style={{ background: color }} className="w-2.5 h-2.5 rounded-full flex-shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold text-sm text-slate-900 truncate">{member.name}</div>
          <div className="text-xs text-slate-500 flex items-center gap-1 font-mono flex-wrap">
            <Phone size={11} />{member.phone} · {member.posisi}
            {member.branch && <span className="flex items-center gap-0.5"><Building2 size={11} />{member.branch}</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center flex-shrink-0">
        <IconBtn onClick={startEdit} title="Edit anggota"><Pencil size={15} /></IconBtn>
        <IconBtn onClick={() => onRemove(member.id)} title="Hapus anggota"><Trash2 size={15} className="text-rose-500" /></IconBtn>
      </div>
    </div>
  );
}

function MembersModal({ members, onClose, onAdd, onRemove, onEdit, duplicateGroups = [], onMergeDuplicates }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [branch, setBranch] = useState("");
  const [posisi, setPosisi] = useState("RGE");
  return (
    <Modal onClose={onClose} width={460}>
      <ModalHeader title="Sheet Anggota Tim" onClose={onClose} icon={<Users size={18} />} />
      <div className="p-5 flex flex-col gap-4">
        {duplicateGroups.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 flex flex-col gap-2">
            <div className="text-sm font-bold text-amber-800">
              {duplicateGroups.length} nomor WA terdeteksi dobel ({duplicateGroups.reduce((n, g) => n + g.dups.length, 0)} data kelebihan)
            </div>
            <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: 120 }}>
              {duplicateGroups.map((g) => (
                <div key={g.key} className="text-xs text-amber-900">
                  <b>{g.keeper.phone}</b> — dipertahankan: {g.keeper.name || "-"} ({g.keeper.posisi || "RGE"}); dihapus: {g.dups.map((d) => `${d.name || "-"} (${d.phone})`).join(", ")}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-amber-700">Kegiatan & target KPI milik data dobel otomatis dipindah ke data yang dipertahankan. Pastikan baris dobel di Sheet MEMBER juga dihapus, kalau tidak bisa muncul lagi saat sinkron.</p>
            <PrimaryBtn onClick={() => { if (window.confirm("Hapus data anggota dobel ini? Kegiatan akan dipindah ke data yang dipertahankan.")) onMergeDuplicates?.(duplicateGroups); }}>
              <Trash2 size={15} />Hapus Duplikat
            </PrimaryBtn>
          </div>
        )}
        <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 320 }}>
          {members.map((m) => <MemberRow key={m.id} member={m} onRemove={onRemove} onEdit={onEdit} />)}
          {members.length === 0 && <p className="text-sm text-slate-400">Belum ada anggota.</p>}
        </div>
        <div className="border-t border-slate-200 pt-4 flex flex-col gap-2">
          <span className="font-bold text-sm text-slate-900">Tambah Anggota</span>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Nama"><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="No. WhatsApp"><input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="62812..." /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Branch">
              <input style={inputStyle} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Cth: Flores Barat" />
            </Field>
            <Field label="Posisi">
              <select style={inputStyle} value={posisi} onChange={(e) => setPosisi(e.target.value)}>
                <option value="RGE">RGE (eksekutor kegiatan &amp; dokumentasi)</option>
                <option value="HOA">HOA (membawahi 1 branch, biasanya 2 RGE)</option>
                <option value="GTM Region">GTM Region (membawahi semua RGE semua branch)</option>
              </select>
            </Field>
          </div>
          <p className="text-xs text-slate-400 -mt-1">
            Branch dipakai untuk mencocokkan notifikasi WhatsApp harian (kegiatan tiap RGE dilaporkan ke GTM Region <b>dan</b> ke HOA branch-nya). Untuk RGE &amp; HOA, isi nama branch yang sama persis (mis. "Flores Barat") supaya otomatis match satu sama lain. Untuk GTM Region, Branch boleh dikosongkan — perannya mencakup semua branch sekaligus.
          </p>
          <PrimaryBtn
            disabled={!name.trim() || !phone.trim()}
            onClick={() => { onAdd({ name: name.trim(), phone: phone.trim(), branch: branch.trim(), posisi }); setName(""); setPhone(""); setBranch(""); setPosisi("RGE"); }}
          >
            <Plus size={15} />Tambah
          </PrimaryBtn>
        </div>
      </div>
    </Modal>
  );
}

// ---------- WhatsApp Simulator Modal ----------
function WhatsAppSimModal({ members, activities, onClose, onNewSchedule, onUploadResult }) {
  const [tab, setTab] = useState("jadwal");
  const [senderId, setSenderId] = useState(members.find((m) => (m.posisi || "RGE") === "RGE")?.id || members[0]?.id || "");
  const [date, setDate] = useState(todayKey());
  const [time, setTime] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [jenisKegiatan, setJenisKegiatan] = useState("");
  const [activityId, setActivityId] = useState("");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);

  const sender = members.find((m) => m.id === senderId);
  const openActivities = activities.filter((a) => a.status !== "selesai");

  async function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(await resizeImage(f, 400, 0.7));
  }

  async function sendSchedule() {
    setSending(true);
    await new Promise((r) => setTimeout(r, 500));
    onNewSchedule({ id: uid(), date, time, title: title.trim(), description, jenisKegiatan, assignedMemberId: senderId, status: "rencana", createdVia: "whatsapp", photos: [] });
    setSending(false);
    setTitle(""); setDescription(""); setTime("");
    onClose();
  }
  async function sendUpload() {
    if (!activityId || !preview) return;
    setSending(true);
    await new Promise((r) => setTimeout(r, 500));
    onUploadResult(activityId, { id: uid(), dataUrl: preview, caption, uploadedBy: sender?.name || "?", uploadedAt: new Date().toISOString() });
    setSending(false);
    setCaption(""); setPreview(null); setFile(null);
    onClose();
  }

  return (
    <Modal onClose={onClose} width={440}>
      <ModalHeader title="Simulasi Pesan WhatsApp" onClose={onClose} icon={<MessageCircle size={18} />} />
      <div className="px-5 pt-3 flex gap-1">
        {[["jadwal", "Buat Jadwal"], ["upload", "Upload Hasil"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${tab === k ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="p-5 flex flex-col gap-3">
        <Field label="Nomor pengirim (mensimulasikan nomor WA)">
          <select style={inputStyle} value={senderId} onChange={(e) => setSenderId(e.target.value)}>
            {members.filter((m) => (m.posisi || "RGE") === "RGE").map((m) => <option key={m.id} value={m.id}>{m.phone} — {m.name} ({m.posisi})</option>)}
          </select>
        </Field>

        {tab === "jadwal" ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Tanggal kegiatan"><input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Jam"><input type="time" style={inputStyle} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
            </div>
            <Field label="Judul kegiatan"><input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Contoh: Attack Desa Wolomeze" /></Field>
            <Field label="Jenis kegiatan">
              <select style={inputStyle} value={jenisKegiatan} onChange={(e) => setJenisKegiatan(e.target.value)}>
                <option value="" disabled>Pilih jenis kegiatan…</option>
                {JENIS_KEGIATAN_OPSI.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            </Field>
            <Field label="Catatan (opsional)"><textarea style={{ ...inputStyle, minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <div className="bg-indigo-50 rounded-lg px-3 py-2 text-xs text-indigo-700 font-mono">
              Pesan terbaca: "JADWAL {date}{time ? ` ${time}` : ""} — {title || "…"}" dari {sender?.name}
            </div>
            <PrimaryBtn disabled={!title.trim() || !time || !jenisKegiatan || sending} onClick={sendSchedule}><Send size={15} />{sending ? "Mengirim…" : "Kirim ke Papan"}</PrimaryBtn>
          </>
        ) : (
          <>
            <Field label="Kegiatan terkait">
              <select style={inputStyle} value={activityId} onChange={(e) => setActivityId(e.target.value)}>
                <option value="">Pilih kegiatan…</option>
                {openActivities.map((a) => <option key={a.id} value={a.id}>{a.date} — {a.title}</option>)}
              </select>
            </Field>
            <Field label="Foto hasil kegiatan">
              <label className="border border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer text-slate-500 text-sm block">
                <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
                {preview ? <img src={preview} alt="preview" className="max-h-[120px] mx-auto rounded" /> : <>Tap untuk pilih foto</>}
              </label>
            </Field>
            <Field label="Keterangan foto"><input style={inputStyle} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Contoh: Kegiatan berjalan lancar" /></Field>
            <PrimaryBtn disabled={!activityId || !preview || sending} onClick={sendUpload}><Send size={15} />{sending ? "Mengirim…" : "Kirim ke Papan"}</PrimaryBtn>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------- Migrasi Kategori Lama ----------
// Alat bantu untuk merapikan kegiatan lama yang jenisKegiatan-nya belum sesuai 4 kategori baku
// (DTU / Attack Desa / Attack School / Branding) — misalnya kegiatan yang dulu diinput bebas lewat
// WhatsApp/web sebelum kategori ini dikunci, atau salah pilih kategori (mis. "Rapat", "Reskin",
// "Kunjungan Lapangan"). Kegiatan yang kata kuncinya cukup jelas (mis. "Reskin" -> Branding) otomatis
// ditebak lewat normalizeJenisKegiatan; sisanya wajib dipilih manual satu-satu supaya tidak ada data
// yang salah ditebak asal-asalan.
function MigrasiKategoriModal({ activities, onClose, onApply }) {
  const bermasalah = activities.filter((a) => !JENIS_KEGIATAN_OPSI.includes(a.jenisKegiatan));

  const [pilihan, setPilihan] = useState(() => {
    const awal = {};
    bermasalah.forEach((a) => {
      const tebakan = normalizeJenisKegiatan(a.jenisKegiatan);
      awal[a.id] = JENIS_KEGIATAN_OPSI.includes(tebakan) ? tebakan : "";
    });
    return awal;
  });
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(0);

  const sudahDiisi = bermasalah.filter((a) => pilihan[a.id]);
  const belumDiisi = bermasalah.filter((a) => !pilihan[a.id]);

  async function terapkanSemua() {
    setApplying(true);
    let count = 0;
    for (const a of sudahDiisi) {
      await onApply(a.id, { jenisKegiatan: pilihan[a.id] });
      count++;
      setDone(count);
    }
    setApplying(false);
  }

  return (
    <Modal onClose={onClose} width={560}>
      <ModalHeader title="Rapikan Kategori Kegiatan Lama" onClose={onClose} icon={<Wand2 size={18} />} />
      <div className="p-5 flex flex-col gap-3">
        {bermasalah.length === 0 ? (
          <p className="text-sm text-emerald-600 font-medium">✅ Semua kegiatan sudah pakai salah satu dari 4 kategori baku (DTU, Attack Desa, Attack School, Branding). Tidak ada yang perlu dirapikan.</p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Ditemukan <b>{bermasalah.length}</b> kegiatan dengan kategori di luar 4 kategori baku. Yang kata kuncinya cukup jelas (mis. "Reskin" → Branding) sudah ditebak otomatis di bawah — periksa dulu, ubah kalau kurang tepat, lalu klik "Terapkan". Yang belum ada tebakan wajib dipilih manual dulu sebelum bisa diterapkan.
            </p>
            <div className="flex flex-col gap-1.5 overflow-y-auto" style={{ maxHeight: 380 }}>
              {bermasalah
                .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
                .map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 truncate">{a.title}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{a.date || "(tanpa tanggal)"} · kategori lama: "{a.jenisKegiatan || "(kosong)"}"</div>
                    </div>
                    <select
                      style={{ ...inputStyle, width: 160, flexShrink: 0 }}
                      value={pilihan[a.id] || ""}
                      onChange={(e) => setPilihan((p) => ({ ...p, [a.id]: e.target.value }))}
                    >
                      <option value="">— pilih —</option>
                      {JENIS_KEGIATAN_OPSI.map((j) => <option key={j} value={j}>{j}</option>)}
                    </select>
                  </div>
                ))}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <span className="text-xs text-slate-500">
                {sudahDiisi.length} siap diterapkan{belumDiisi.length > 0 ? `, ${belumDiisi.length} belum dipilih` : ""}.
              </span>
              <PrimaryBtn disabled={sudahDiisi.length === 0 || applying} onClick={terapkanSemua}>
                {applying ? `Menerapkan… (${done}/${sudahDiisi.length})` : `Terapkan (${sudahDiisi.length})`}
              </PrimaryBtn>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------- Summary charts: by activity type & by member/posisi ----------
function SummaryCharts({ activities, members, cursor, onOpenActivity }) {
  const [selectedJenis, setSelectedJenis] = useState(null);
  useEffect(() => { setSelectedJenis(null); }, [cursor.y, cursor.m]);
  const monthPrefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
  const monthActs = activities.filter((a) => a.date && a.date.startsWith(monthPrefix));

  const byType = {};
  monthActs.forEach((a) => {
    // Dinormalisasi lagi di sini (bukan cuma saat disimpan) supaya data lama yang judul jenisnya
    // masih berantakan (mis. tersimpan sebelum aturan pengelompokan ini ada) tetap ikut terkelompok.
    const key = normalizeJenisKegiatan(a.jenisKegiatan);
    byType[key] ||= { name: key, Rencana: 0, Selesai: 0 };
    byType[key][a.status === "selesai" ? "Selesai" : "Rencana"]++;
  });
  const typeData = Object.values(byType);

  // GTM Region & HOA adalah pemberi perintah/pemantau, bukan eksekutor kegiatan — jadi tidak ikut
  // dihitung di grafik keaktifan maupun notice "belum ada kegiatan" di bawahnya. Yang muncul hanya RGE.
  const executorMembers = members.filter((m) => normalizePosisi(m.posisi || "RGE") === "RGE");
  const byMember = executorMembers.map((m) => {
    const mine = monthActs.filter((a) => a.assignedMemberId === m.id);
    return {
      name: m.name.split(" ")[0], fullName: m.name,
      Rencana: mine.filter((a) => a.status !== "selesai").length,
      Selesai: mine.filter((a) => a.status === "selesai").length,
      total: mine.length,
    };
  });
  const inactiveMembers = byMember.filter((m) => m.total === 0);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <BarChart2 size={17} className="text-indigo-600" />
        <h3 className="font-bold text-base text-slate-900">Ringkasan Kegiatan — {BULAN[cursor.m]} {cursor.y}</h3>
      </div>

      {monthActs.length === 0 ? (
        <p className="text-sm text-slate-400 italic">Belum ada kegiatan tercatat pada bulan ini.</p>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <div className="bg-slate-50 rounded-xl border border-slate-100 p-4">
            <div className="font-semibold text-sm text-slate-800 mb-2">Berdasarkan Jenis Kegiatan</div>
            <p className="text-[11px] text-slate-400 -mt-1 mb-2">Klik salah satu batang untuk lihat daftar kegiatannya — berguna kalau ada angka yang kelihatan janggal (mis. mungkin ada yang salah pilih jenis kegiatan saat input).</p>
            {/* Tinggi area dibatasi (maxHeight + overflow) supaya kartu tidak memanjang ke bawah
                walau jenis kegiatannya banyak — kalau melebihi, tinggal scroll di dalam kotak ini. */}
            <div style={{ maxHeight: 320, overflowY: typeData.length > 7 ? "auto" : "visible" }}>
              <ResponsiveContainer width="100%" height={Math.max(160, typeData.length * 40)}>
                <BarChart data={typeData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10.5, fill: COLORS.inkSoft }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: COLORS.ink }} width={110} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.border}` }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Rencana" fill={STATUS_COLORS.rencana} radius={[0, 4, 4, 0]} barSize={16} cursor="pointer" onClick={(d) => setSelectedJenis(d.name)} />
                  <Bar dataKey="Selesai" fill={STATUS_COLORS.selesai} radius={[0, 4, 4, 0]} barSize={16} cursor="pointer" onClick={(d) => setSelectedJenis(d.name)} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {selectedJenis && (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700">Daftar kegiatan "{selectedJenis}" — {BULAN[cursor.m]} {cursor.y}</span>
                  <button onClick={() => setSelectedJenis(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                </div>
                <div className="flex flex-col gap-1.5 overflow-y-auto" style={{ maxHeight: 260 }}>
                  {monthActs
                    .filter((a) => normalizeJenisKegiatan(a.jenisKegiatan) === selectedJenis)
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((a) => {
                      const mem = members.find((m) => m.id === a.assignedMemberId);
                      return (
                        <button
                          key={a.id}
                          onClick={() => onOpenActivity?.(a.id)}
                          className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-left hover:border-indigo-300 hover:bg-indigo-50 transition"
                        >
                          <span className="flex items-center gap-1.5 min-w-0">
                            <StatusMarker status={a.status} />
                            <span className="text-xs text-slate-800 truncate">{a.title}</span>
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">{a.date} · {mem?.name || a.memberName || "?"}</span>
                        </button>
                      );
                    })}
                  {monthActs.filter((a) => normalizeJenisKegiatan(a.jenisKegiatan) === selectedJenis).length === 0 && (
                    <p className="text-xs text-slate-400 italic">Tidak ada kegiatan.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="bg-slate-50 rounded-xl border border-slate-100 p-4">
            <div className="font-semibold text-sm text-slate-800 mb-2">Keaktifan per Anggota (RGE/CSE/RSE)</div>
            <div style={{ maxHeight: 320, overflowY: byMember.length > 7 ? "auto" : "visible" }}>
              <ResponsiveContainer width="100%" height={Math.max(160, byMember.length * 40)}>
                <BarChart data={byMember} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10.5, fill: COLORS.inkSoft }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: COLORS.ink }} width={90} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.border}` }} labelFormatter={(_, p) => p?.[0]?.payload?.fullName || ""} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Rencana" stackId="a" fill={STATUS_COLORS.rencana} barSize={16} />
                  <Bar dataKey="Selesai" stackId="a" fill={STATUS_COLORS.selesai} radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {inactiveMembers.length > 0 && (
        <div className="mt-3 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-sm text-slate-800 flex items-center gap-2 flex-wrap">
          <StatusMarker status="rencana" size={12} />
          <span><b>Belum ada kegiatan bulan ini:</b> {inactiveMembers.map((m) => m.fullName).join(", ")}</span>
        </div>
      )}
    </div>
  );
}

// ---------- Galeri Dokumentasi: post-it wall of photos from WA & web uploads ----------
function GaleriFoto({ activities, members, cursor, onOpen, branchFilter = null, jenisFilter = null }) {
  const monthPrefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
  const photos = [];
  activities.forEach((a) => {
    if (!a.date || !a.date.startsWith(monthPrefix)) return;
    if (branchFilter && members.find((m) => m.id === a.assignedMemberId)?.branch !== branchFilter) return;
    if (jenisFilter && normalizeJenisKegiatan(a.jenisKegiatan) !== jenisFilter) return;
    (a.photos || []).forEach((ph) => {
      photos.push({ ...ph, activityId: a.id, activityTitle: a.title, assignedMemberId: a.assignedMemberId, hasil: a.hasil, jenisKegiatan: normalizeJenisKegiatan(a.jenisKegiatan) });
    });
  });
  photos.sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""));

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Camera size={17} className="text-indigo-600" />
        <h3 className="font-bold text-base text-slate-900">Galeri Dokumentasi — {BULAN[cursor.m]} {cursor.y}{jenisFilter ? ` · ${jenisFilter}` : ""}</h3>
      </div>
      {photos.length === 0 ? (
        <p className="text-sm text-slate-400 italic">Belum ada foto dokumentasi {jenisFilter ? `kegiatan ${jenisFilter} ` : "kegiatan "}bulan ini{branchFilter ? ` di branch ${branchFilter}` : ""}.</p>
      ) : (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-8 p-4 rounded-xl"
          style={{ background: "#F1EDE4", backgroundImage: "repeating-linear-gradient(45deg, rgba(0,0,0,0.015) 0px, rgba(0,0,0,0.015) 1px, transparent 1px, transparent 12px)" }}
        >
          {photos.map((ph, i) => {
            const mem = members.find((m) => m.id === ph.assignedMemberId);
            const rotate = [-4, 3, -2, 5, -3, 2][i % 6];
            return (
              <div
                key={ph.id}
                onClick={() => onOpen(ph.activityId)}
                className="bg-white p-2 pb-3 cursor-pointer transition-transform hover:scale-105 hover:z-10 relative"
                style={{ transform: `rotate(${rotate}deg)`, boxShadow: "0 3px 8px rgba(0,0,0,0.18)" }}
              >
                <div
                  className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-10 h-4 opacity-80"
                  style={{ background: "#FDE68A", transform: "rotate(-3deg)" }}
                />
                <img src={ph.dataUrl} alt={ph.activityTitle} className="w-full h-28 object-cover" />
                <div className="mt-2 text-center px-0.5">
                  <div className="text-[11px] font-semibold text-slate-800 truncate">{ph.activityTitle}</div>
                  <div className="text-[10px] text-slate-400 truncate">{mem ? `${mem.posisi} ${mem.name}` : ph.uploadedBy}</div>
                  {(ph.hasil?.spIM3 > 0 || ph.hasil?.sp3ID > 0 || ph.hasil?.hifi > 0 ||
                    ph.hasil?.poster > 0 || ph.hasil?.shopblind > 0 || ph.hasil?.vinil > 0 ||
                    ph.hasil?.spanduk > 0 || ph.hasil?.rontek > 0) && (
                    <div className="text-[9.5px] text-emerald-700 font-semibold mt-1 flex flex-wrap justify-center gap-x-1.5 gap-y-0.5">
                      {ph.hasil.spIM3 > 0 && <span>SP IM3 {ph.hasil.spIM3}</span>}
                      {ph.hasil.sp3ID > 0 && <span>SP 3ID {ph.hasil.sp3ID}</span>}
                      {ph.hasil.hifi > 0 && <span>Hifi {ph.hasil.hifi}</span>}
                      {ph.hasil.poster > 0 && <span>Poster {ph.hasil.poster}</span>}
                      {ph.hasil.shopblind > 0 && <span>Shopblind {ph.hasil.shopblind}</span>}
                      {ph.hasil.vinil > 0 && <span>Vinil {ph.hasil.vinil}</span>}
                      {ph.hasil.spanduk > 0 && <span>Spanduk {ph.hasil.spanduk}</span>}
                      {ph.hasil.rontek > 0 && <span>Rontek {ph.hasil.rontek}</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
// ---------- Galeri per Branch: foto laporan RGE (posm/event/dtu/desa/school/fwa/nota) dari WA,
// dikelompokkan per branch (tab), sumber datanya koleksi Firestore "rgeReports" yang ditulis n8n. ----------
const KATEGORI_LABEL = {
  posm: "Branding", event: "Event", dtu: "DTU", desa: "Desa",
  school: "School", fwa: "FWA", nota: "Nota",
};
// Field di sini PERSIS mengikuti header yang ditulis n8n ke Sheets/Firestore (PascalCase):
// Kategori, NamaEvent, NamaLokasi, NamaDesa, SiteId, NamaSekolah, SP_IM3, SP_3ID, FWA, Msisdn,
// Imei, Nominal, PosmItems (disimpan sebagai STRING JSON, bukan object -- perlu JSON.parse).
function ringkasanLaporan(r) {
  const cat = r.Kategori || r.category;
  if (cat === "posm") {
    let items = {};
    try { items = typeof r.PosmItems === "string" ? JSON.parse(r.PosmItems || "{}") : (r.PosmItems || r.posmItems || {}); }
    catch { items = {}; }
    return Object.entries(items).map(([k, v]) => `${k} ${v}pcs`).join(", ");
  }
  const spIM3 = r.SP_IM3 ?? r.spIM3;
  const sp3ID = r.SP_3ID ?? r.sp3ID;
  const fwa = r.FWA ?? r.fwa;
  if (cat === "event") return [r.NamaEvent || r.namaEvent, spIM3 ? `SP IM3 ${spIM3}` : null, sp3ID ? `SP 3ID ${sp3ID}` : null, fwa ? `FWA ${fwa}` : null].filter(Boolean).join(" · ");
  if (cat === "dtu") return [r.NamaLokasi || r.namaLokasi, spIM3 ? `SP IM3 ${spIM3}` : null, sp3ID ? `SP 3ID ${sp3ID}` : null, fwa ? `FWA ${fwa}` : null].filter(Boolean).join(" · ");
  if (cat === "desa") return [r.NamaDesa || r.namaDesa, (r.SiteId || r.siteId) ? `Site ${r.SiteId || r.siteId}` : null, spIM3 ? `SP IM3 ${spIM3}` : null, sp3ID ? `SP 3ID ${sp3ID}` : null, fwa ? `FWA ${fwa}` : null].filter(Boolean).join(" · ");
  if (cat === "school") return [r.NamaSekolah || r.namaSekolah, spIM3 ? `SP IM3 ${spIM3}` : null, sp3ID ? `SP 3ID ${sp3ID}` : null, fwa ? `FWA ${fwa}` : null].filter(Boolean).join(" · ");
  if (cat === "fwa") return [r.Msisdn || r.msisdn, r.Imei || r.imei].filter(Boolean).join(" · ");
  if (cat === "nota") return [spIM3 ? `SP IM3 ${spIM3}` : null, sp3ID ? `SP 3ID ${sp3ID}` : null, (r.Nominal || r.nominal) ? `Rp${Number(r.Nominal || r.nominal).toLocaleString("id-ID")}` : null].filter(Boolean).join(" · ");
  return r.RawCaption || r.rawCaption || "";
}
// ---------- Laporan & Rekap: 2 tab -- Galeri Kegiatan (foto dokumentasi di activities[].photos, dari WA
// atau upload web) dan Laporan WA per Branch (rgeReports). Galeri Kegiatan bisa difilter per branch. ----------
function LaporanRekapPage({ activities, members, rgeReports, onOpenActivity }) {
  const [tab, setTab] = useState("kegiatan");
  const [cursor, setCursor] = useState(() => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() }; });
  const [branch, setBranch] = useState(null); // null = semua branch
  const [jenis, setJenis] = useState(null); // null = semua jenis kegiatan
  const branches = sortBranches(Array.from(new Set(members.filter((m) => (m.posisi || "RGE") === "RGE" && m.branch).map((m) => m.branch))));
  const prevMonth = () => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }));
  const nextMonth = () => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Laporan & Rekap</h1>
          <p className="text-sm text-slate-500 mt-1">Foto dokumentasi kegiatan dan laporan RGE dari grup WhatsApp.</p>
        </div>
        <div className="flex gap-1.5 bg-slate-100 border border-slate-200 rounded-xl p-1 self-start">
          {[["kegiatan", "Galeri Kegiatan"], ["laporan", "Laporan WA per Branch"]].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${tab === k ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{label}</button>
          ))}
        </div>
      </div>

      {tab === "kegiatan" ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="flex flex-wrap gap-1.5">
              {[null, ...branches].map((b) => (
                <button key={b || "all"} onClick={() => setBranch(b)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${b === branch ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{b || "Semua Branch"}</button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <IconBtn onClick={prevMonth} title="Bulan sebelumnya"><ChevronLeft size={16} /></IconBtn>
              <span className="text-xs font-bold text-slate-700 min-w-[110px] text-center">{BULAN[cursor.m]} {cursor.y}</span>
              <IconBtn onClick={nextMonth} title="Bulan berikutnya"><ChevronRight size={16} /></IconBtn>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 self-center mr-1">Jenis:</span>
            {[null, ...JENIS_KEGIATAN_OPSI].map((j) => (
              <button key={j || "all"} onClick={() => setJenis(j)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${j === jenis ? "bg-violet-600 border-violet-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{j || "Semua Jenis"}</button>
            ))}
          </div>
          <GaleriFoto activities={activities} members={members} cursor={cursor} onOpen={onOpenActivity} branchFilter={branch} jenisFilter={jenis} />
        </div>
      ) : (
        <GaleriPerBranch members={members} rgeReports={rgeReports} />
      )}
    </div>
  );
}

function GaleriPerBranch({ members, rgeReports }) {
  // Branch diambil dinamis dari data anggota RGE yang ada, bukan di-hardcode -- otomatis
  // menyesuaikan berapa pun jumlah branch yang sebenarnya ada di sheet Member.
  const branches = sortBranches(Array.from(
    new Set(members.filter((m) => (m.posisi || "RGE") === "RGE" && m.branch).map((m) => m.branch))
  ));
  const [activeBranch, setActiveBranch] = useState(null);
  const [activeKategori, setActiveKategori] = useState(null); // null = semua jenis kegiatan
  const effectiveBranch = activeBranch && branches.includes(activeBranch) ? activeBranch : branches[0];

  const photosBranch = rgeReports
    .filter((r) => r.Branch === effectiveBranch || r.branch === effectiveBranch)
    .filter((r) => r.FotoURL || r.fotoUrl);
  // Daftar kategori filter diambil dari kategori yang benar-benar ada di branch ini, jadi tidak ada
  // tombol filter untuk kategori yang kosong/tidak relevan.
  const kategoriTersedia = Array.from(new Set(photosBranch.map((r) => r.Kategori || r.category).filter(Boolean)));
  const photos = (activeKategori ? photosBranch.filter((r) => (r.Kategori || r.category) === activeKategori) : photosBranch)
    .sort((a, b) => String(b.Timestamp || b.receivedAt || "").localeCompare(String(a.Timestamp || a.receivedAt || "")));

  if (branches.length === 0) {
    return <p className="text-sm text-slate-400 italic">Belum ada data branch. Isi field "Branch" di Sheet Anggota terlebih dulu.</p>;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <LayoutGrid size={17} className="text-indigo-600" />
        <h3 className="font-bold text-base text-slate-900">Galeri Laporan per Branch</h3>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {branches.map((b) => (
          <button
            key={b}
            onClick={() => { setActiveBranch(b); setActiveKategori(null); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${b === effectiveBranch ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            {b}
          </button>
        ))}
      </div>
      {kategoriTersedia.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4 pt-3 border-t border-slate-100">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 self-center mr-1">Jenis:</span>
          {[null, ...kategoriTersedia].map((cat) => (
            <button
              key={cat || "all"}
              onClick={() => setActiveKategori(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${cat === activeKategori ? "bg-violet-600 border-violet-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              {cat ? (KATEGORI_LABEL[cat] || cat) : "Semua Jenis"}
            </button>
          ))}
        </div>
      )}

      {photos.length === 0 ? (
        <p className="text-sm text-slate-400 italic">Belum ada laporan foto{activeKategori ? ` untuk kategori ${KATEGORI_LABEL[activeKategori] || activeKategori}` : ""} dari branch ini.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {photos.map((r) => {
            const isLunas = r.StatusLunas === true || r.statusLunas === true;
            const cat = r.Kategori || r.category; // header asli n8n: "Kategori" (PascalCase)
            async function toggleLunas(e) {
              e.preventDefault();
              e.stopPropagation();
              try { await updateDoc(doc(db, "rgeReports", r.id), { StatusLunas: !isLunas }); }
              catch (err) { console.error("Gagal update status lunas", err); }
            }
            return (
              <div
                key={r.id}
                onClick={() => window.open(r.FotoURL || r.fotoUrl, "_blank")}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-indigo-300 hover:shadow-sm transition block cursor-pointer"
              >
                <div className="aspect-square bg-slate-100 flex items-center justify-center overflow-hidden">
                  <img src={r.FotoURL || r.fotoUrl} alt={cat} className="w-full h-full object-cover" />
                </div>
                <div className="p-2.5">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-[10px] font-bold uppercase text-indigo-600">{KATEGORI_LABEL[cat] || cat}</span>
                    <span className="text-[10px] text-slate-400">{String(r.Timestamp || r.receivedAt || "").slice(0, 10)}</span>
                  </div>
                  <div className="text-xs font-semibold text-slate-800 truncate">{r.NamaRGE || r.namaRGE || r.Sender || r.sender}</div>
                  <div className="text-[11px] text-slate-500 truncate">{ringkasanLaporan(r)}</div>
                  {cat === "nota" && (
                    <button
                      onClick={toggleLunas}
                      className={`mt-1.5 w-full text-[10px] font-semibold py-1 rounded-md border transition ${isLunas ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-amber-50 border-amber-300 text-amber-700"}`}
                    >
                      {isLunas ? "✓ Lunas" : "Tandai Lunas"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Rekap KPI RGE: target vs pencapaian bulanan per RGE, mirip format Excel yang dipakai
// tim (kolom Target SP/FWA/Desa/School + % Achv), bisa diatur targetnya & diexport ke Excel. ----------
function monthKeyOf(cursor) { return `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`; }
function pct(achv, target) { return target > 0 ? Math.round((achv / target) * 100) : 0; }

function hitungAchievement(memberId, monthKey, rgeReports) {
  const memberDigits = digitsOnly(memberId);
  const rows = rgeReports.filter((r) => {
    const senderDigits = reportSenderDigits(r);
    const ts = String(r.Timestamp || r.receivedAt || "");
    return senderDigits && memberDigits && senderDigits === memberDigits && ts.slice(0, 7) === monthKey;
  });
  let achvSP = 0, achvFWA = 0, achvDesa = 0, achvSchool = 0, achvNotaLunas = 0, achvNotaTotal = 0;
  rows.forEach((r) => {
    const cat = r.Kategori || r.category;
    const spIM3 = Number(r.SP_IM3 ?? r.spIM3 ?? 0);
    const sp3ID = Number(r.SP_3ID ?? r.sp3ID ?? 0);
    // SP (im3+3id) tetap ditotal dari SEMUA jenis kegiatan yang ada penjualannya.
    if (["event", "dtu", "desa", "school", "nota"].includes(cat)) achvSP += spIM3 + sp3ID;
    if (["event", "dtu", "desa", "school"].includes(cat)) {
      if (cat === "desa") achvDesa += 1;
      if (cat === "school") achvSchool += 1;
    }
    // FWA pencapaian HANYA dihitung dari laporan keyword "fwa" yang msisdn & imei-nya terisi
    // (bukan dijumlah dari field fwa di event/dtu/desa/school lagi).
    const msisdn = r.Msisdn ?? r.msisdn ?? "";
    const imei = r.Imei ?? r.imei ?? "";
    if (cat === "fwa" && String(msisdn).trim() && String(imei).trim()) achvFWA += 1;
    // Nota: dipakai untuk VERIFIKASI manual (bukan pengurang Achv SP) -- bandingkan jumlah nota
    // yang sudah ditandai Lunas dengan Achv SP di atas.
    if (cat === "nota") {
      achvNotaTotal += 1;
      if (r.StatusLunas === true || r.statusLunas === true) achvNotaLunas += 1;
    }
  });
  return { achvSP, achvFWA, achvDesa, achvSchool, achvNotaLunas, achvNotaTotal };
}

function TargetKPIModal({ member, monthKey, target, onClose, onSave }) {
  const [form, setForm] = useState({
    posmAchievementPercent: target?.posmAchievementPercent ?? "",
    targetSP: target?.targetSP ?? "",
    targetFWA: target?.targetFWA ?? "",
    targetDesa: target?.targetDesa ?? "",
    targetSchool: target?.targetSchool ?? "",
  });
  return (
    <Modal onClose={onClose} width={380}>
      <ModalHeader title={`Target KPI — ${member.name || member.fullName}`} onClose={onClose} />
      <div className="p-5 flex flex-col gap-3">
        <p className="text-xs text-slate-500 -mt-1">Bulan {monthKey}</p>
        <Field label="POSM End-to-End Process Control — Achievement (%)">
          <input type="number" style={inputStyle} value={form.posmAchievementPercent}
            onChange={(e) => setForm((f) => ({ ...f, posmAchievementPercent: e.target.value }))} placeholder="Cth: 80" />
        </Field>
        <Field label="Target SP (im3 + 3id)">
          <input type="number" style={inputStyle} value={form.targetSP}
            onChange={(e) => setForm((f) => ({ ...f, targetSP: e.target.value }))} />
        </Field>
        <Field label="Target FWA">
          <input type="number" style={inputStyle} value={form.targetFWA}
            onChange={(e) => setForm((f) => ({ ...f, targetFWA: e.target.value }))} />
        </Field>
        <Field label="Target Desa">
          <input type="number" style={inputStyle} value={form.targetDesa}
            onChange={(e) => setForm((f) => ({ ...f, targetDesa: e.target.value }))} />
        </Field>
        <Field label="Target School/Bimbel/University">
          <input type="number" style={inputStyle} value={form.targetSchool}
            onChange={(e) => setForm((f) => ({ ...f, targetSchool: e.target.value }))} />
        </Field>
        <PrimaryBtn onClick={() => { onSave({
          posmAchievementPercent: Number(form.posmAchievementPercent) || 0,
          targetSP: Number(form.targetSP) || 0,
          targetFWA: Number(form.targetFWA) || 0,
          targetDesa: Number(form.targetDesa) || 0,
          targetSchool: Number(form.targetSchool) || 0,
        }); onClose(); }}>
          Simpan Target
        </PrimaryBtn>
      </div>
    </Modal>
  );
}

function RekapKPI({ members, rgeReports, kpiTargets, onSaveTarget, activities = [], onOpenActivity }) {
  const [cursor, setCursor] = useState(() => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() }; });
  const [editMember, setEditMember] = useState(null);
  const monthKey = monthKeyOf(cursor);

  const rgeMembers = sortMembersByBranch(members.filter((m) => (m.posisi || "RGE") === "RGE"));

  // Item KPI ke-6: "Req Branding" -- permintaan cetak dari GTM Region/HOA sampai RGE serah-terima ke
  // DSE/RSE/Depo (dibuktikan foto). SLA 5 hari, dihitung dari activity.date s/d timestamp foto
  // terakhir (lihat reqBrandingSLA). Di-scope ke bulan yang sedang dilihat, sama seperti sisa
  // halaman ini, berdasarkan tanggal permintaannya.
  const reqBrandingRows = activities
    .filter((a) => normalizeJenisKegiatan(a.jenisKegiatan) === "Req Branding" && String(a.date || "").startsWith(monthKey))
    .map((a) => ({ activity: a, member: members.find((m) => m.id === a.assignedMemberId), sla: reqBrandingSLA(a) }))
    .sort((a, b) => String(a.activity.date).localeCompare(String(b.activity.date)));
  const reqBrandingLate = reqBrandingRows.filter((r) => r.sla.onTime === false).length;

  const rows = rgeMembers.map((m) => {
    const target = kpiTargets.find((t) => t.memberId === m.id && t.monthKey === monthKey) || {};
    const achv = hitungAchievement(m.id, monthKey, rgeReports);
    return {
      member: m,
      target,
      ...achv,
      pctSP: pct(achv.achvSP, Number(target.targetSP) || 0),
      pctFWA: pct(achv.achvFWA, Number(target.targetFWA) || 0),
      pctDesa: pct(achv.achvDesa, Number(target.targetDesa) || 0),
      pctSchool: pct(achv.achvSchool, Number(target.targetSchool) || 0),
    };
  });

  const totals = rows.reduce((acc, r) => ({
    targetSP: acc.targetSP + (Number(r.target.targetSP) || 0), achvSP: acc.achvSP + r.achvSP,
    targetFWA: acc.targetFWA + (Number(r.target.targetFWA) || 0), achvFWA: acc.achvFWA + r.achvFWA,
    targetDesa: acc.targetDesa + (Number(r.target.targetDesa) || 0), achvDesa: acc.achvDesa + r.achvDesa,
    targetSchool: acc.targetSchool + (Number(r.target.targetSchool) || 0), achvSchool: acc.achvSchool + r.achvSchool,
    achvNotaLunas: acc.achvNotaLunas + r.achvNotaLunas, achvNotaTotal: acc.achvNotaTotal + r.achvNotaTotal,
  }), { targetSP: 0, achvSP: 0, targetFWA: 0, achvFWA: 0, targetDesa: 0, achvDesa: 0, targetSchool: 0, achvSchool: 0, achvNotaLunas: 0, achvNotaTotal: 0 });

  function exportExcel() {
    const header = ["NO", "Nama RGE", "Branch", "POSM Achv (%)", "Target SP", "Achv SP", "%Achv SP", "Nota Lunas/Total", "Target FWA", "Achv FWA", "%Achv FWA", "Target Desa", "Achv Desa", "%Achv Desa", "Target School", "Achv School", "%Achv School"];
    const body = rows.map((r, i) => [
      i + 1, r.member.name || r.member.fullName, r.member.branch,
      r.target.posmAchievementPercent || 0,
      r.target.targetSP || 0, r.achvSP, `${r.pctSP}%`,
      `${r.achvNotaLunas}/${r.achvNotaTotal}`,
      r.target.targetFWA || 0, r.achvFWA, `${r.pctFWA}%`,
      r.target.targetDesa || 0, r.achvDesa, `${r.pctDesa}%`,
      r.target.targetSchool || 0, r.achvSchool, `${r.pctSchool}%`,
    ]);
    const totalRow = ["", "Total", "", "",
      totals.targetSP, totals.achvSP, `${pct(totals.achvSP, totals.targetSP)}%`,
      `${totals.achvNotaLunas}/${totals.achvNotaTotal}`,
      totals.targetFWA, totals.achvFWA, `${pct(totals.achvFWA, totals.targetFWA)}%`,
      totals.targetDesa, totals.achvDesa, `${pct(totals.achvDesa, totals.targetDesa)}%`,
      totals.targetSchool, totals.achvSchool, `${pct(totals.achvSchool, totals.targetSchool)}%`,
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, ...body, totalRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekap KPI");
    XLSX.writeFile(wb, `Rekap-KPI-RGE-${monthKey}.xlsx`);
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          <ClipboardList size={17} className="text-indigo-600" />
          <h3 className="font-bold text-base text-slate-900">Rekap KPI RGE</h3>
        </div>
        <div className="flex items-center gap-2">
          <IconBtn onClick={() => setCursor((c) => c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 })}><ChevronLeft size={16} /></IconBtn>
          <span className="text-sm font-semibold text-slate-700 min-w-[120px] text-center">{BULAN[cursor.m]} {cursor.y}</span>
          <IconBtn onClick={() => setCursor((c) => c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 })}><ChevronRight size={16} /></IconBtn>
          <GhostBtn onClick={exportExcel}><Download size={14} /> Excel</GhostBtn>
          <GhostBtn onClick={() => window.print()}><Download size={14} /> PDF (Print)</GhostBtn>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100 text-slate-600">
              <th className="border border-slate-200 px-2 py-1.5">NO</th>
              <th className="border border-slate-200 px-2 py-1.5 text-left">Nama RGE</th>
              <th className="border border-slate-200 px-2 py-1.5 text-left">Branch</th>
              <th className="border border-slate-200 px-2 py-1.5">POSM Achv</th>
              <th className="border border-slate-200 px-2 py-1.5" colSpan={3}>Target SP (40%)</th>
              <th className="border border-slate-200 px-2 py-1.5" title="Cek manual: jumlah nota yang sudah ditandai Lunas vs total nota masuk bulan ini">Verifikasi Nota</th>
              <th className="border border-slate-200 px-2 py-1.5" colSpan={3}>Target FWA (25%)</th>
              <th className="border border-slate-200 px-2 py-1.5" colSpan={3}>Target Desa (10%)</th>
              <th className="border border-slate-200 px-2 py-1.5" colSpan={3}>Target School (10%)</th>
              <th className="border border-slate-200 px-2 py-1.5"></th>
            </tr>
            <tr className="bg-slate-50 text-slate-500">
              <th className="border border-slate-200" colSpan={4}></th>
              {["Target", "Achv", "%"].map((h) => <th key={"sp" + h} className="border border-slate-200 px-1.5 py-1">{h}</th>)}
              <th className="border border-slate-200 px-1.5 py-1">Lunas/Total</th>
              {["Target", "Achv", "%"].map((h) => <th key={"fwa" + h} className="border border-slate-200 px-1.5 py-1">{h}</th>)}
              {["Target", "Achv", "%"].map((h) => <th key={"desa" + h} className="border border-slate-200 px-1.5 py-1">{h}</th>)}
              {["Target", "Achv", "%"].map((h) => <th key={"sch" + h} className="border border-slate-200 px-1.5 py-1">{h}</th>)}
              <th className="border border-slate-200"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.member.id} className="hover:bg-slate-50">
                <td className="border border-slate-200 text-center">{i + 1}</td>
                <td className="border border-slate-200 px-2 py-1 font-medium text-slate-800">{r.member.name || r.member.fullName}</td>
                <td className="border border-slate-200 px-2 py-1 text-slate-500">{r.member.branch}</td>
                <td className="border border-slate-200 text-center">{r.target.posmAchievementPercent ? `${r.target.posmAchievementPercent}%` : "-"}</td>
                <td className="border border-slate-200 text-center">{r.target.targetSP || 0}</td>
                <td className="border border-slate-200 text-center">{r.achvSP}</td>
                <td className="border border-slate-200 text-center font-semibold" style={{ color: r.pctSP >= 100 ? "#059669" : "#0F172A" }}>{r.pctSP}%</td>
                <td className="border border-slate-200 text-center text-slate-500" title="Jumlah nota Lunas / total nota masuk bulan ini">
                  {r.achvNotaLunas}/{r.achvNotaTotal}
                  {r.achvNotaTotal > 0 && r.achvNotaLunas < r.achvNotaTotal && <span className="text-amber-500 ml-0.5">⚠</span>}
                </td>
                <td className="border border-slate-200 text-center">{r.target.targetFWA || 0}</td>
                <td className="border border-slate-200 text-center">{r.achvFWA}</td>
                <td className="border border-slate-200 text-center font-semibold" style={{ color: r.pctFWA >= 100 ? "#059669" : "#0F172A" }}>{r.pctFWA}%</td>
                <td className="border border-slate-200 text-center">{r.target.targetDesa || 0}</td>
                <td className="border border-slate-200 text-center">{r.achvDesa}</td>
                <td className="border border-slate-200 text-center font-semibold" style={{ color: r.pctDesa >= 100 ? "#059669" : "#0F172A" }}>{r.pctDesa}%</td>
                <td className="border border-slate-200 text-center">{r.target.targetSchool || 0}</td>
                <td className="border border-slate-200 text-center">{r.achvSchool}</td>
                <td className="border border-slate-200 text-center font-semibold" style={{ color: r.pctSchool >= 100 ? "#059669" : "#0F172A" }}>{r.pctSchool}%</td>
                <td className="border border-slate-200 text-center">
                  <button onClick={() => setEditMember(r.member)} className="text-indigo-500 hover:text-indigo-700"><Pencil size={13} /></button>
                </td>
              </tr>
            ))}
            <tr className="bg-slate-100 font-bold text-slate-800">
              <td className="border border-slate-200 text-center" colSpan={4}>Total</td>
              <td className="border border-slate-200 text-center">{totals.targetSP}</td>
              <td className="border border-slate-200 text-center">{totals.achvSP}</td>
              <td className="border border-slate-200 text-center">{pct(totals.achvSP, totals.targetSP)}%</td>
              <td className="border border-slate-200 text-center">{totals.achvNotaLunas}/{totals.achvNotaTotal}</td>
              <td className="border border-slate-200 text-center">{totals.targetFWA}</td>
              <td className="border border-slate-200 text-center">{totals.achvFWA}</td>
              <td className="border border-slate-200 text-center">{pct(totals.achvFWA, totals.targetFWA)}%</td>
              <td className="border border-slate-200 text-center">{totals.targetDesa}</td>
              <td className="border border-slate-200 text-center">{totals.achvDesa}</td>
              <td className="border border-slate-200 text-center">{pct(totals.achvDesa, totals.targetDesa)}%</td>
              <td className="border border-slate-200 text-center">{totals.targetSchool}</td>
              <td className="border border-slate-200 text-center">{totals.achvSchool}</td>
              <td className="border border-slate-200 text-center">{pct(totals.achvSchool, totals.targetSchool)}%</td>
              <td className="border border-slate-200"></td>
            </tr>
          </tbody>
        </table>
      </div>
      {rgeMembers.length === 0 && <p className="text-sm text-slate-400 italic mt-3">Belum ada anggota dengan posisi RGE.</p>}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mt-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2"><Package size={16} className="text-amber-600" /><h3 className="font-bold text-slate-900">Req Branding — SLA Serah Terima</h3></div>
          {reqBrandingLate > 0 && <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-full">{reqBrandingLate} terlambat</span>}
        </div>
        <p className="text-[11px] text-slate-400 mb-3">Permintaan branding dari GTM Region/HOA ke RGE bulan ini. Target SLA {REQ_BRANDING_SLA_DAYS} hari sejak tanggal permintaan sampai foto serah terima ke DSE/RSE/Depo di-upload.</p>
        {reqBrandingRows.length === 0 ? (
          <p className="text-sm text-slate-400 italic">Belum ada permintaan Req Branding bulan ini.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-left">
                  <th className="border border-slate-200 px-2.5 py-2">Tgl Permintaan</th>
                  <th className="border border-slate-200 px-2.5 py-2">RGE</th>
                  <th className="border border-slate-200 px-2.5 py-2">Diserahkan ke</th>
                  <th className="border border-slate-200 px-2.5 py-2">Tgl Serah Terima</th>
                  <th className="border border-slate-200 px-2.5 py-2">Status SLA</th>
                </tr>
              </thead>
              <tbody>
                {reqBrandingRows.map(({ activity, member, sla }) => (
                  <tr key={activity.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => onOpenActivity?.(activity.id)}>
                    <td className="border border-slate-200 px-2.5 py-2">{activity.date}</td>
                    <td className="border border-slate-200 px-2.5 py-2 font-semibold text-slate-700">{member?.name || "—"}</td>
                    <td className="border border-slate-200 px-2.5 py-2">{activity.handoverTo || "—"}</td>
                    <td className="border border-slate-200 px-2.5 py-2">{sla.completedDate ? sla.completedDate.toISOString().slice(0, 10) : "—"}</td>
                    <td className="border border-slate-200 px-2.5 py-2 font-bold" style={{ color: sla.onTime === false ? "#DC2626" : sla.hasHandover ? "#059669" : "#B45309" }}>{sla.statusLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editMember && (
        <TargetKPIModal
          member={editMember}
          monthKey={monthKey}
          target={kpiTargets.find((t) => t.memberId === editMember.id && t.monthKey === monthKey)}
          onClose={() => setEditMember(null)}
          onSave={(patch) => onSaveTarget(editMember.id, monthKey, patch)}
        />
      )}
    </div>
  );
}

// ---------- Dashboard: ringkasan kondisi tim hari ini -- semua dihitung dari activities+members
// yang sudah ada (statusOf), tidak ada field/collection baru yang dibaca di sini. ----------
function greetingNow() {
  const h = new Date().getHours();
  if (h < 11) return "Selamat Pagi";
  if (h < 15) return "Selamat Siang";
  if (h < 18) return "Selamat Sore";
  return "Selamat Malam";
}
// "N menit/jam/hari yang lalu" sederhana -- dipakai di feed Aktivitas Terbaru.
function timeAgoID(date) {
  if (!date || isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "Baru saja";
  if (min < 60) return `${min} menit yang lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam yang lalu`;
  const day = Math.floor(hr / 24);
  return `${day} hari yang lalu`;
}

// ---------- Mini Jadwal Tim: versi ringkas WeeklyPlanner untuk kartu Beranda ----------
function WeeklyScheduleMini({ activities, members, weekCursor, setWeekCursor, onOpenActivity, onAddActivity, onGoFullSchedule }) {
  const [branchFilter, setBranchFilter] = useState("all");
  const weekStart = new Date(weekCursor); weekStart.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d; });
  const weekKeys = days.map((d) => dateKey(d.getFullYear(), d.getMonth(), d.getDate()));
  const today = todayKey();
  const teamMembers = members.filter((m) => (m.posisi || "RGE") === "RGE");
  const baseMembers = sortMembersByBranch(teamMembers.length ? teamMembers : members);
  // Filter branch supaya daftar anggota yang dirender lebih singkat dan muat tanpa scroll ke bawah.
  const branches = sortBranches(Array.from(new Set(baseMembers.filter((m) => m.branch).map((m) => m.branch))));
  const visibleMembers = branchFilter === "all" ? baseMembers : baseMembers.filter((m) => m.branch === branchFilter);
  const byMemberDay = (id, key) => activities.filter((a) => a.assignedMemberId === id && a.date === key).sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
  const moveWeek = (offset) => { const d = new Date(weekStart); d.setDate(d.getDate() + offset * 7); setWeekCursor(d); };
  const goToday = () => { const t = new Date(); const day = (t.getDay() + 6) % 7; t.setDate(t.getDate() - day); setWeekCursor(t); };
  const monthLabel = days[0].getMonth() === days[6].getMonth() ? `${days[0].getDate()} – ${days[6].getDate()} ${BULAN[days[0].getMonth()]} ${days[6].getFullYear()}` : `${days[0].getDate()} ${BULAN[days[0].getMonth()]} – ${days[6].getDate()} ${BULAN[days[6].getMonth()]} ${days[6].getFullYear()}`;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarIcon size={16} className="text-indigo-600" />
          <div>
            <h3 className="font-bold text-sm text-slate-900">Jadwal Tim</h3>
            <p className="text-[10px] text-slate-400">{monthLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {branches.length > 0 && (
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-[11px] font-semibold text-slate-600 bg-white">
              <option value="all">Semua branch</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <IconBtn onClick={() => moveWeek(-1)} title="Minggu sebelumnya"><ChevronLeft size={15} /></IconBtn>
          <GhostBtn onClick={goToday}>Hari ini</GhostBtn>
          <IconBtn onClick={() => moveWeek(1)} title="Minggu berikutnya"><ChevronRight size={15} /></IconBtn>
          <button onClick={onGoFullSchedule} className="hidden sm:inline-flex px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition">Minggu Ini</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className="grid grid-cols-[130px_repeat(7,minmax(96px,1fr))] border-b border-slate-100 bg-slate-50/60">
            <div className="p-2 text-[9px] font-black uppercase tracking-wider text-slate-400">{visibleMembers.length} Anggota Tim{branchFilter !== "all" ? ` · ${branchFilter}` : ""}</div>
            {days.map((d, i) => {
              const key = weekKeys[i]; const isToday = key === today;
              return (
                <div key={key} className={`p-1.5 border-l border-slate-100 text-center ${isToday ? "bg-indigo-50" : ""}`}>
                  <div className={`text-[8.5px] font-black uppercase ${isToday ? "text-indigo-600" : "text-slate-400"}`}>{HARI[i]}</div>
                  <div className={`text-[12px] font-black ${isToday ? "text-indigo-700" : "text-slate-700"}`}>{d.getDate()} {BULAN[d.getMonth()].slice(0, 3)}</div>
                </div>
              );
            })}
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {visibleMembers.map((m) => (
              <div key={m.id} className="grid grid-cols-[130px_repeat(7,minmax(96px,1fr))] border-b border-slate-50 last:border-b-0">
                <div className="p-1.5 flex items-center gap-1.5 sticky left-0 bg-white z-[1] border-r border-slate-100">
                  <span className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-[9px] font-black shrink-0" style={{ background: memberColor(m.id) }}>{(m.name || "?").slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0">
                    <div className="font-bold text-[10.5px] text-slate-800 truncate">{m.name}</div>
                    <div className="text-[8.5px] text-indigo-500 font-bold truncate">{m.posisi || "RGE"}</div>
                  </div>
                </div>
                {weekKeys.map((key) => {
                  const dayActs = byMemberDay(m.id, key);
                  const isToday = key === today;
                  return (
                    <button
                      key={key}
                      onClick={() => dayActs.length ? onOpenActivity(dayActs[0].id) : onAddActivity(key, m.id)}
                      className={`text-left border-l border-slate-50 p-1 min-h-[40px] hover:bg-indigo-50/30 transition ${isToday ? "bg-indigo-50/30" : ""}`}
                    >
                      {dayActs.length === 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="w-4 h-4 rounded flex items-center justify-center shrink-0" style={{ background: `${memberColor(m.id)}18`, color: memberColor(m.id) }}><Plus size={10} strokeWidth={3} /></span>
                          <span className="text-[9px] text-slate-500 italic">Free</span>
                        </span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {dayActs.slice(0, 1).map((a) => {
                            const cm = categoryMeta(normalizeJenisKegiatan(a.jenisKegiatan));
                            const Icon = cm.icon;
                            return (
                              <div key={a.id} className="rounded-md px-1 py-0.5" style={{ background: cm.bg }}>
                                <div className="flex items-center gap-1 text-[8.5px] font-black" style={{ color: cm.color }}><Icon size={9} /> {normalizeJenisKegiatan(a.jenisKegiatan)}</div>
                                <div className="text-[8.5px] text-slate-600 truncate">{a.title}</div>
                              </div>
                            );
                          })}
                          {dayActs.length > 1 && <span className="text-[7.5px] font-bold text-slate-400">+{dayActs.length - 1} lagi</span>}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            {visibleMembers.length === 0 && <div className="p-8 text-center text-sm text-slate-400">Belum ada anggota tim.</div>}
          </div>
        </div>
      </div>
      <button onClick={onGoFullSchedule} className="w-full sm:hidden py-3 text-center text-xs font-bold text-indigo-600 border-t border-slate-100">Lihat semua anggota (Minggu Ini) →</button>
    </section>
  );
}

function Dashboard({ activities, members, rgeReports, kpiTargets, weekCursor, setWeekCursor, onOpenActivity, onAddActivity, onGoFullSchedule }) {
  const today = todayKey();
  const now = new Date();
  const memberOf = (id) => members.find((m) => m.id === id);
  const withStatus = activities.map((a) => {
    const m = memberOf(a.assignedMemberId);
    const isReqBranding = normalizeJenisKegiatan(a.jenisKegiatan) === "Req Branding";
    const report = isReqBranding
      ? { ...reportInfoForActivity(a, m, rgeReports), received: Boolean(a.photos?.length) }
      : reportInfoForActivity(a, m, rgeReports);
    return { ...a, _status: statusOf(a, now), _report: report };
  });
  const todays = withStatus.filter((a) => a.date === today).sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
  const monthPrefix = today.slice(0, 7);

  const totalToday = todays.length;
  const doneToday = todays.filter((a) => a._status === "selesai").length;
  const pendingReport = todays.filter((a) => ["menunggu_report", "overdue"].includes(a._status) && !a._report.received).length;
  const completion = totalToday ? Math.round((doneToday / totalToday) * 100) : 0;

  // Donut "Ringkasan Kegiatan" sengaja di-scope ke MINGGU berjalan (bukan cuma hari ini) supaya
  // tidak kelihatan kosong kalau kebetulan hari ini belum ada jadwal, padahal minggu ini ada.
  // Pakai weekCursor yang sama dengan grid "Jadwal Tim" di bawahnya biar konsisten.
  const weekStartForStats = new Date(weekCursor); weekStartForStats.setHours(0, 0, 0, 0);
  const weekKeysForStats = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStartForStats); d.setDate(weekStartForStats.getDate() + i); return dateKey(d.getFullYear(), d.getMonth(), d.getDate()); });
  const weekActs = activities.filter((a) => weekKeysForStats.includes(a.date));
  const weekCategoryStats = JENIS_KEGIATAN_OPSI.map((label) => ({
    label,
    total: weekActs.filter((a) => normalizeJenisKegiatan(a.jenisKegiatan) === label).length,
  })).filter((x) => x.total > 0);

  const reportPendingList = todays.filter((a) => ["menunggu_report", "overdue"].includes(a._status) && !a._report.received);

  // ---- Pencapaian KPI (bulan berjalan): rata-rata tertimbang SP 40% + FWA 25% + Desa 10% +
  // School 10% + POSM 15% -- bobot yang sama seperti yang sudah ditampilkan di header tabel
  // Rekap KPI, jadi angkanya konsisten dengan tab "Pencapaian KPI". ----
  const rgeMembersAll = members.filter((m) => (m.posisi || "RGE") === "RGE");
  function kpiForMonth(mKey) {
    const totals = rgeMembersAll.reduce((acc, m) => {
      const target = kpiTargets.find((t) => t.memberId === m.id && t.monthKey === mKey) || {};
      const achv = hitungAchievement(m.id, mKey, rgeReports);
      return {
        targetSP: acc.targetSP + (Number(target.targetSP) || 0), achvSP: acc.achvSP + achv.achvSP,
        targetFWA: acc.targetFWA + (Number(target.targetFWA) || 0), achvFWA: acc.achvFWA + achv.achvFWA,
        targetDesa: acc.targetDesa + (Number(target.targetDesa) || 0), achvDesa: acc.achvDesa + achv.achvDesa,
        targetSchool: acc.targetSchool + (Number(target.targetSchool) || 0), achvSchool: acc.achvSchool + achv.achvSchool,
        posmSum: acc.posmSum + (Number(target.posmAchievementPercent) || 0),
        posmCount: acc.posmCount + (target.posmAchievementPercent ? 1 : 0),
        anyTarget: acc.anyTarget || Number(target.targetSP) > 0 || Number(target.targetFWA) > 0 || Number(target.targetDesa) > 0 || Number(target.targetSchool) > 0 || Number(target.posmAchievementPercent) > 0,
      };
    }, { targetSP: 0, achvSP: 0, targetFWA: 0, achvFWA: 0, targetDesa: 0, achvDesa: 0, targetSchool: 0, achvSchool: 0, posmSum: 0, posmCount: 0, anyTarget: false });
    const posmAvg = totals.posmCount ? Math.round(totals.posmSum / totals.posmCount) : 0;
    const overall = totals.anyTarget ? Math.round(
      pct(totals.achvSP, totals.targetSP) * 0.40 + pct(totals.achvFWA, totals.targetFWA) * 0.25 +
      pct(totals.achvDesa, totals.targetDesa) * 0.10 + pct(totals.achvSchool, totals.targetSchool) * 0.10 + posmAvg * 0.15
    ) : 0;
    return { overall, hasTarget: totals.anyTarget };
  }
  const monthKeyNow = monthPrefix;
  const kpiNow = kpiForMonth(monthKeyNow);
  const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const kpiPrev = kpiForMonth(`${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`);
  const kpiDelta = kpiNow.overall - kpiPrev.overall;

  // ---- Aktivitas Terbaru: gabungan kegiatan yang baru selesai + laporan foto WA terbaru,
  // diurutkan dari yang paling baru. Tidak ada log sistem tersendiri, jadi feed ini murni dari
  // data activities + rgeReports yang sudah ada. ----
  const recentDone = withStatus
    .filter((a) => a.status === "selesai")
    .map((a) => ({ key: `act-${a.id}`, ts: `${a.date}T${a.time || "00:00"}`, icon: CheckCircle2, tone: "#059669", text: `${memberOf(a.assignedMemberId)?.name || "Anggota"} menyelesaikan kegiatan`, sub: a.title }));
  const recentReports = [...rgeReports]
    .sort((a, b) => String(b.Timestamp || b.receivedAt || "").localeCompare(String(a.Timestamp || a.receivedAt || "")))
    .slice(0, 8)
    .map((r) => {
      const senderDigits = reportSenderDigits(r);
      const name = members.find((m) => digitsOnly(m.phone) && digitsOnly(m.phone) === senderDigits)?.name || "Tim RGE";
      return { key: `rep-${r.id}`, ts: r.Timestamp || r.receivedAt || "", icon: MessageCircle, tone: "#059669", text: `${name} mengirim report via WA`, sub: (r.Kategori || r.category || "").toUpperCase() || null };
    });
  const activityFeed = [...recentDone, ...recentReports]
    .filter((x) => x.ts)
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
    .slice(0, 5)
    .map((x) => ({ ...x, when: timeAgoID(new Date(x.ts.length <= 10 ? `${x.ts}T00:00:00` : x.ts)) }));

  const donutTotal = weekCategoryStats.reduce((s, x) => s + x.total, 0);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
      <div className="min-w-0 flex flex-col gap-5">
        {/* Banner sambutan */}
        <section className="relative overflow-hidden rounded-2xl px-5 py-4 sm:px-6 sm:py-5 text-white shadow-sm" style={{ background: "linear-gradient(135deg,#0F172A 0%,#312E81 55%,#4F46E5 100%)" }}>
          <div className="absolute -right-10 -top-16 w-56 h-56 rounded-full bg-white/10" />
          <div className="absolute right-16 -bottom-20 w-52 h-52 rounded-full bg-fuchsia-400/10" />
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "linear-gradient(to top, rgba(15,23,42,0.9), transparent 55%)" }} />
          <div className="relative">
            <h2 className="text-lg sm:text-xl font-extrabold tracking-tight">{greetingNow()}, GTM Region 👋</h2>
            <p className="text-indigo-100 text-xs sm:text-sm mt-1 max-w-md">Berikut adalah ringkasan aktivitas dan pencapaian tim hari ini.</p>
          </div>
        </section>

        {/* Stat cards */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Total Jadwal Hari Ini", value: totalToday, icon: CalendarIcon, tone: "#4F46E5", note: `dari ${rgeMembersAll.length} anggota tim`, up: true },
            { label: "Kegiatan Selesai", value: doneToday, icon: CheckCircle2, tone: "#059669", note: `dari ${totalToday} jadwal`, pctNote: `${completion}%`, up: completion >= 50 },
            { label: "Menunggu Report WA", value: pendingReport, icon: Clock, tone: "#DC2626", note: "belum mengirim", pctNote: totalToday ? `${Math.round((pendingReport / totalToday) * 100)}%` : "0%", up: false },
            { label: "Pencapaian KPI", value: `${kpiNow.overall}%`, icon: Award, tone: "#D97706", note: "bulan ini", pctNote: `${kpiDelta >= 0 ? "+" : ""}${kpiDelta}%`, up: kpiDelta >= 0 },
          ].map((k) => {
            const Icon = k.icon;
            return (
              <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${k.tone}18`, color: k.tone }}><Icon size={17} /></span>
                <div className="text-2xl font-extrabold text-slate-900 mt-3">{k.value}</div>
                <div className="text-[11px] font-bold text-slate-500 mt-0.5">{k.label}</div>
                <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-slate-400">
                  <span>{k.note}</span>
                  {k.pctNote && <span className={`inline-flex items-center gap-0.5 font-bold ${k.up ? "text-emerald-600" : "text-rose-500"}`}>{k.up ? "↑" : "↓"} {k.pctNote}</span>}
                </div>
              </div>
            );
          })}
        </section>

        {/* Jadwal Tim (mini weekly grid) */}
        <WeeklyScheduleMini activities={activities} members={members} weekCursor={weekCursor} setWeekCursor={setWeekCursor} onOpenActivity={onOpenActivity} onAddActivity={onAddActivity} onGoFullSchedule={onGoFullSchedule} />
      </div>

      <div className="flex flex-col gap-5">
        {/* Ringkasan Kegiatan (minggu ini) */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-1"><h3 className="font-bold text-slate-900">Ringkasan Kegiatan</h3><BarChart2 size={17} className="text-slate-300" /></div>
          <p className="text-[10px] text-slate-400 mb-3">Minggu ini, semua anggota tim</p>
          {weekCategoryStats.length === 0 ? <p className="text-sm text-slate-400 italic">Belum ada kegiatan terjadwal minggu ini.</p> : (
            <div className="flex items-center gap-5">
              <DonutChart
                segments={weekCategoryStats.map((x) => ({ label: x.label, value: x.total, color: categoryMeta(x.label).color }))}
                centerLabel={donutTotal} centerSub="Total Kegiatan"
              />
              <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                {weekCategoryStats.sort((a, b) => b.total - a.total).map((x) => (
                  <div key={x.label} className="flex items-center justify-between text-xs gap-2">
                    <span className="flex items-center gap-1.5 text-slate-600 truncate"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: categoryMeta(x.label).color }} /><span className="truncate">{x.label}</span></span>
                    <b className="text-slate-800 shrink-0">{x.total} <span className="text-slate-400 font-medium">({donutTotal ? Math.round((x.total / donutTotal) * 100) : 0}%)</span></b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Pencapaian KPI gauge */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-900">Pencapaian KPI</h3><Award size={17} className="text-amber-400" /></div>
          <div className="flex items-center gap-5">
            <DonutChart segments={[{ value: kpiNow.overall, color: "#4F46E5" }, { value: Math.max(0, 100 - kpiNow.overall), color: "#E2E8F0" }]} centerLabel={`${kpiNow.overall}%`} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-slate-400">Target Bulan Ini</div>
              <div className="text-lg font-extrabold text-slate-900">{kpiNow.overall}% <span className="text-xs font-semibold text-slate-400">dari 100%</span></div>
              <span className={`inline-flex items-center gap-1 text-[11px] font-bold mt-1 ${kpiDelta >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{kpiDelta >= 0 ? "↑" : "↓"} {Math.abs(kpiDelta)}% dari bulan lalu</span>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-2"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, kpiNow.overall)}%` }} /></div>
              {!kpiNow.hasTarget && <p className="text-[10px] text-slate-400 mt-2">Target KPI RGE belum diisi bulan ini.</p>}
            </div>
          </div>
        </section>

        {/* Pengiriman Report WA */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2"><MessageCircle size={16} className="text-emerald-500" /><h3 className="font-bold text-sm text-slate-900">Pengiriman Report WA</h3></div>
            <span className="text-[11px] font-bold text-rose-500">{reportPendingList.length} menunggu</span>
          </div>
          {reportPendingList.length === 0 ? (
            <p className="px-5 pb-4 text-xs text-slate-400 italic">Semua report hari ini sudah masuk.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {reportPendingList.slice(0, 4).map((a) => {
                const m = memberOf(a.assignedMemberId);
                return (
                  <button key={a.id} onClick={() => onOpenActivity(a.id)} className="w-full px-5 py-2.5 flex items-center gap-3 text-left hover:bg-slate-50 transition">
                    <span className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-black shrink-0" style={{ background: memberColor(a.assignedMemberId) }}>{(m?.name || "?").slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-bold text-slate-800 truncate">{m?.name || "Tanpa PIC"}</span>
                      <span className="block text-[10px] text-slate-400 truncate">{a.title} · {a.time || a.date}</span>
                    </span>
                    <span className="text-[10px] font-bold text-amber-600 shrink-0">Menunggu</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Aktivitas Terbaru */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-2"><Zap size={16} className="text-indigo-500" /><h3 className="font-bold text-sm text-slate-900">Aktivitas Terbaru</h3></div>
          {activityFeed.length === 0 ? (
            <p className="px-5 pb-4 text-xs text-slate-400 italic">Belum ada aktivitas terbaru.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {activityFeed.map((x) => {
                const Icon = x.icon;
                return (
                  <div key={x.key} className="px-5 py-2.5 flex items-start gap-3">
                    <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${x.tone}18`, color: x.tone }}><Icon size={13} /></span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-700 truncate">{x.text}</div>
                      {x.sub && <div className="text-[10px] text-slate-400 truncate">{x.sub}</div>}
                      <div className="text-[10px] text-slate-300 mt-0.5">{x.when}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------- Team Overview: ringkasan per anggota RGE hari ini + overdue keseluruhan. ----------
function TeamOverview({ activities, members }) {
  const today = todayKey();
  const rgeMembers = sortMembersByBranch(members.filter((m) => (m.posisi || "RGE") === "RGE"));
  const rows = rgeMembers.map((m) => {
    const todays = activities.filter((a) => a.assignedMemberId === m.id && a.date === today).map((a) => ({ ...a, _status: statusOf(a) }));
    const completed = todays.filter((a) => a._status === "selesai").length;
    const active = todays.filter((a) => ["hari_ini", "berjalan", "menunggu_report"].includes(a._status)).length;
    const overdueAll = activities.filter((a) => a.assignedMemberId === m.id && statusOf(a) === "overdue").length;
    return { member: m, total: todays.length, completed, active, overdue: overdueAll };
  });

  return (
    <div>
      <h3 className="font-bold text-base text-slate-900 mb-4">Tim — Hari Ini</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((r) => (
          <div key={r.member.id} className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: memberColor(r.member.id) }} />
              <span className="font-bold text-slate-800 truncate">{r.member.name}</span>
              <span className="text-[10px] text-slate-400 ml-auto shrink-0">{r.member.branch}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><div className="text-lg font-extrabold text-slate-800">{r.total}</div><div className="text-slate-400">Kegiatan hari ini</div></div>
              <div><div className="text-lg font-extrabold text-emerald-600">{r.completed}</div><div className="text-slate-400">Selesai</div></div>
              <div><div className="text-lg font-extrabold text-indigo-600">{r.active}</div><div className="text-slate-400">Aktif</div></div>
              <div><div className="text-lg font-extrabold text-red-600">{r.overdue}</div><div className="text-slate-400">Overdue (semua)</div></div>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-400 italic col-span-full">Belum ada anggota dengan posisi RGE.</p>}
      </div>
    </div>
  );
}
