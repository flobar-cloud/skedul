import { useState, useEffect, useRef, Fragment } from "react";
import {
  ChevronLeft, ChevronRight, Camera, Check, Plus, X, Users,
  MessageCircle, Upload, Phone, Trash2, Send, Image as ImageIcon,
  Info, Calendar as CalendarIcon, Minus, BarChart2, Smartphone, Pencil, Building2, Wand2,
  Download, LayoutGrid, ClipboardList, LayoutDashboard, Bell, Search, Wifi, ArrowUpRight, CheckCircle2, AlertTriangle, Clock, Zap
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
];

const BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

// Pemetaan region REGB (Regional Bali) / REGN (Regional Nusra) ke branch di bawahnya. Dipakai
// sebagai acuan kalau nanti Rekap KPI / notifikasi WA butuh menampilkan gabungan beberapa branch
// per regional head. Member dengan posisi REGB/REGN sebaiknya isi Branch = "BALI" atau "NUSRA".
const REGION_BRANCHES = {
  BALI: ["Bali Barat", "Bali Timur"],
  NUSRA: ["Lombok Barat", "Lombok Timur", "Sumbawa", "Flores Barat", "Flores Timur", "Sumba", "Timor"],
};
const HARI = ["Sen","Sel","Rab","Kam","Jum","Sab","Min"];
const JENIS_KEGIATAN_OPSI = ["DTU", "Attack Desa", "Attack School", "Branding", "Event", "FWA"];

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
function dateKey(y, m, d) { return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function todayKey() { const t = new Date(); return dateKey(t.getFullYear(), t.getMonth(), t.getDate()); }
function posisiColor(posisi) {
  let h = 0;
  for (let i = 0; i < (posisi || "").length; i++) h = (h * 31 + posisi.charCodeAt(i)) >>> 0;
  return CHIP_PALETTE[h % CHIP_PALETTE.length];
}
// Warna per-ORANG (bukan per-posisi seperti posisiColor) -- dipakai di Dashboard/Planner/Team supaya
// tiap anggota punya 1 warna konsisten sendiri (mis. selalu biru buat Andi, hijau buat Budi, dst).
function memberColor(memberIdOrName) {
  const s = String(memberIdOrName || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CHIP_PALETTE[h % CHIP_PALETTE.length];
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
function reportInfoForActivity(activity, member, rgeReports = []) {
  const categoryMap = { branding: "posm", posm: "posm", event: "event", dtu: "dtu", desa: "desa", school: "school", fwa: "fwa", nota: "nota" };
  const wanted = categoryMap[String(activity?.jenisKegiatan || "").toLowerCase()];
  const memberId = activity?.assignedMemberId;

  // Prioritas baru: n8n menyimpan hubungan eksplisit activityId pada rgeReports.
  // Ini menghilangkan ambiguitas ketika satu RGE punya beberapa kegiatan pada tanggal/kategori yang sama.
  const directRows = rgeReports.filter((r) => String(r.activityId || r.ActivityId || "") === String(activity?.id || ""));

  // Fallback legacy: tetap mendukung laporan lama yang belum memiliki activityId.
  const rows = directRows.length > 0 ? directRows : rgeReports.filter((r) => {
    const mid = r.memberId || r.MemberId;
    const cat = String(r.category || r.Kategori || "").toLowerCase();
    const ts = String(r.Timestamp || r.receivedAt || r.timestamp || "");
    const date = ts.slice(0, 10);
    const memberMatch = !memberId || !mid || String(mid) === String(memberId) || String(r.phone || r.Phone || r.nomor || "") === String(member?.phone || "");
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
function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}
const inputStyle = {
  border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "8px 10px",
  fontSize: 14, color: COLORS.ink, background: "#fff", outline: "none", width: "100%",
};

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
  const [showAddActivity, setShowAddActivity] = useState(false);
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

  function notify(msg) { setToast(msg); setTimeout(() => setToast(null), 2600); }

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

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400 font-medium">Memuat papan kegiatan…</div>;
  }

  return (
    <div className="min-h-screen" style={{ background: COLORS.bg }}>
      {/* Modern application shell — fungsi tombol lama tetap sama */}
      <nav className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200 shadow-[0_1px_12px_rgba(15,23,42,0.04)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="min-h-16 flex items-center justify-between gap-4 py-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-sm" style={{ background: "linear-gradient(135deg,#4F46E5,#7C3AED)" }}><LayoutDashboard size={19} /></div>
              <div className="min-w-0">
                <div className="font-extrabold text-slate-900 tracking-tight truncate">Team Planner</div>
                <div className="text-[10px] text-slate-400 font-semibold tracking-wide">PLAN · EXECUTE · ACHIEVE</div>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> WA Gateway</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-violet-50 text-violet-700 text-[10px] font-bold"><span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> n8n Automation</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <IconBtn onClick={() => setShowMembers(true)} title="Sheet Anggota"><Users size={18} /></IconBtn>
              <IconBtn onClick={() => setShowSim(true)} title="Simulasi WhatsApp"><Smartphone size={18} /></IconBtn>
              <div className="relative">
                <IconBtn onClick={() => setShowMigrasi(true)} title="Rapikan kategori kegiatan lama"><Wand2 size={18} /></IconBtn>
                {activities.some((a) => !JENIS_KEGIATAN_OPSI.includes(a.jenisKegiatan)) && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 border-2 border-white" />}
              </div>
              <IconBtn onClick={() => setInfoOpen(true)} title="Cara kerja"><Info size={18} /></IconBtn>
              <PrimaryBtn onClick={() => setShowAddActivity(todayKey())} className="ml-1"><Plus size={16} /><span className="hidden sm:inline">Tambah Jadwal</span></PrimaryBtn>
            </div>
          </div>
        </div>
      </nav>

      {/* Primary navigation */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1.5 bg-slate-100/80 border border-slate-200 rounded-2xl p-1.5 overflow-x-auto max-w-full">
            {[
              { k: "dashboard", label: "Beranda", icon: LayoutDashboard },
              { k: "kalender", label: "Jadwal Tim", icon: CalendarIcon },
              { k: "galeriBranch", label: "Laporan & Galeri", icon: LayoutGrid },
              { k: "rekapKPI", label: "Pencapaian KPI", icon: ClipboardList },
              { k: "team", label: "Anggota Tim", icon: Users },
            ].map(({ k, label, icon: Icon }) => (
              <button key={k} onClick={() => setMainTab(k)} className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition whitespace-nowrap ${mainTab === k ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800 hover:bg-white/70"}`}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
          <div className="hidden xl:flex items-center gap-2 text-[10px] font-bold text-slate-400 shrink-0"><Bell size={14} /> Live Firestore</div>
        </div>
      </div>

      {mainTab === "dashboard" && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Dashboard activities={activities} members={members} rgeReports={rgeReports} onOpenActivity={(id) => setDetailId(id)} />
        </div>
      )}

      {mainTab === "team" && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <TeamOverview activities={activities} members={members} />
        </div>
      )}

      {mainTab === "galeriBranch" && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <GaleriPerBranch members={members} rgeReports={rgeReports} />
        </div>
      )}

      {mainTab === "rekapKPI" && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <RekapKPI members={members} rgeReports={rgeReports} kpiTargets={kpiTargets} onSaveTarget={saveKpiTarget} />
        </div>
      )}

      {mainTab === "kalender" && (
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {plannerView === "weekly" ? (
            <WeeklyPlanner activities={activities} members={members} rgeReports={rgeReports} weekCursor={weekCursor} setWeekCursor={setWeekCursor} onOpenActivity={(id) => setDetailId(id)} onAddActivity={(date) => setShowAddActivity(date)} onViewChange={setPlannerView} />
          ) : (
            <MonthlyPlanner activities={activities} members={members} cursor={cursor} setCursor={setCursor} onOpenActivity={(id) => setDetailId(id)} onAddActivity={(date) => setShowAddActivity(date)} onViewChange={setPlannerView} />
          )}
        </div>
      )}

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
            <PrimaryBtn onClick={() => { setShowAddActivity(dayModal); setDayModal(null); }}><Plus size={15} /> Tambah kegiatan</PrimaryBtn>
          </div>
        </Modal>
      )}

      {showAddActivity && (
        <AddActivityModal
          initialDate={showAddActivity}
          members={members}
          onClose={() => setShowAddActivity(false)}
          onSave={(a) => { addActivity({ ...a, status: "rencana", createdVia: "web" }); setShowAddActivity(false); notify("Kegiatan ditambahkan ke kalender."); }}
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
        <MembersModal members={members} onClose={() => setShowMembers(false)} onAdd={addMember} onRemove={removeMember} onEdit={updateMember} />
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
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const weekStart = new Date(weekCursor); weekStart.setHours(0,0,0,0);
  const days = Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(weekStart.getDate()+i);return d;});
  const weekKeys=days.map(d=>dateKey(d.getFullYear(),d.getMonth(),d.getDate())); const today=todayKey();
  const teamMembers=members.filter(m=>(m.posisi||"RGE")==="RGE"); const visibleMembers=teamMembers.length?teamMembers:members;
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
    <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm"><div className="flex flex-col lg:flex-row gap-2"><div className="relative flex-1 min-w-[220px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cari kegiatan, PIC, lokasi…" className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"/></div><select value={memberFilter} onChange={e=>setMemberFilter(e.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 bg-white"><option value="all">Semua anggota</option>{visibleMembers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select><select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 bg-white"><option value="all">Semua kegiatan</option>{JENIS_KEGIATAN_OPSI.map(x=><option key={x} value={x}>{x}</option>)}</select><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 bg-white">{statusOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div></div>
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"><div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/70"><div><div className="font-extrabold text-slate-900">{monthLabel}</div><div className="text-[10px] text-slate-400 font-semibold">{weekKeys[0]} — {weekKeys[6]}</div></div><div className="flex items-center gap-3 text-[10px] font-bold text-slate-400"><span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-emerald-500"/> Selesai</span><span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-amber-500"/> Berjalan</span><span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-rose-500"/> Perhatian</span></div></div>
      <div className="overflow-x-auto"><div className="min-w-[1180px]"><div className="grid grid-cols-[190px_repeat(7,minmax(140px,1fr))] border-b border-slate-200 bg-white sticky top-0 z-10"><div className="p-3 text-[10px] font-black uppercase tracking-wider text-slate-400">Anggota Tim</div>{days.map((d,i)=>{const key=weekKeys[i];const isToday=key===today;const count=weekActivities.filter(a=>a.date===key).length;return <div key={key} className={`p-2.5 border-l border-slate-100 ${isToday?"bg-indigo-50":""}`}><div className={`text-[10px] font-black uppercase ${isToday?"text-indigo-600":"text-slate-400"}`}>{HARI[i]}</div><div className={`text-base font-black ${isToday?"text-indigo-700":"text-slate-800"}`}>{d.getDate()}</div><div className="text-[9px] text-slate-400">{count} kegiatan</div></div>})}</div>
      {visibleMembers.map(m=><div key={m.id} className="grid grid-cols-[190px_repeat(7,minmax(140px,1fr))] border-b border-slate-100 last:border-b-0 min-h-[122px]"><div className="p-3 bg-slate-50/60 flex items-start gap-2.5 sticky left-0 z-[1] border-r border-slate-100"><span className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-black shrink-0" style={{background:memberColor(m.id)}}>{(m.name||"?").slice(0,1).toUpperCase()}</span><div className="min-w-0"><div className="font-extrabold text-xs text-slate-800 truncate">{m.name}</div><div className="text-[9px] text-slate-400 truncate mt-0.5">{m.branch||"Tanpa branch"}</div><div className="text-[9px] text-indigo-500 font-bold mt-1">{m.posisi||"RGE"}</div></div></div>{weekKeys.map((key)=>{const dayActs=byMemberDay(m.id,key);const isToday=key===today;return <div key={key} className={`border-l border-slate-100 p-1.5 space-y-1 ${isToday?"bg-indigo-50/40":"bg-white"}`}>{dayActs.map(a=>{const st=statusOf(a);const meta=STATUS_META[st];return <button key={a.id} onClick={()=>onOpenActivity(a.id)} title={`${a.title} · ${meta.label}`} className="w-full text-left rounded-xl border p-2 hover:shadow-sm transition bg-white" style={{borderColor:`${meta.color}40`,borderLeftWidth:3,borderLeftColor:meta.color}}><div className="flex items-center justify-between gap-1"><span className="text-[9px] font-black" style={{color:meta.color}}>{a.time||"—"}</span>{a.photos?.length>0&&<Camera size={10} className="text-slate-400"/>}</div><div className="text-[10px] font-bold text-slate-700 leading-tight mt-1">{a.title}</div><div className="mt-1.5 flex items-center gap-1"><span className="text-[8px] px-1.5 py-0.5 rounded-full font-bold" style={{color:meta.color,background:meta.bg}}>{meta.label}</span></div></button>})}<button onClick={()=>onAddActivity(key)} className="w-full h-7 rounded-lg border border-dashed border-slate-200 text-slate-300 hover:text-indigo-500 hover:border-indigo-300 hover:bg-indigo-50/40 transition flex items-center justify-center"><Plus size={13}/></button></div>})}</div>)}
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

  // BSM tidak ikut direkap sebagai eksekutor — resume ini hanya untuk RGE/CSE/RSE.
  const executorMembers = members.filter((m) => String(m.posisi || "").toUpperCase() !== "BSM");
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
function AddActivityModal({ initialDate, members, onClose, onSave }) {
  const [date, setDate] = useState(initialDate || todayKey());
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [description, setDescription] = useState("");
  const [jenisKegiatan, setJenisKegiatan] = useState("");
  const [assignedMemberId, setAssignedMemberId] = useState(members[0]?.id || "");
  return (
    <Modal onClose={onClose} width={420}>
      <ModalHeader title="Tambah Kegiatan" onClose={onClose} icon={<Plus size={18} />} />
      <div className="p-5 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tanggal *"><input type="date" required style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Jam *"><input type="time" required style={inputStyle} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        <Field label="Judul kegiatan">
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Contoh: Attack Desa Wolomeze" />
        </Field>
        <Field label="Jenis kegiatan *">
          <select required style={inputStyle} value={jenisKegiatan} onChange={(e) => setJenisKegiatan(e.target.value)}>
            <option value="" disabled>Pilih jenis kegiatan…</option>
            {JENIS_KEGIATAN_OPSI.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </Field>
        <Field label="Deskripsi (opsional)">
          <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Penanggung jawab">
          <select style={inputStyle} value={assignedMemberId} onChange={(e) => setAssignedMemberId(e.target.value)}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.posisi}</option>)}
          </select>
        </Field>
        <PrimaryBtn disabled={!title.trim() || !date || !time || !jenisKegiatan} onClick={() => onSave({ title: title.trim(), date, time, description, jenisKegiatan, assignedMemberId })}>Simpan Kegiatan</PrimaryBtn>
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
  const reportInfo = reportInfoForActivity(activity, member, rgeReports);
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
            <Field label="Judul kegiatan">
              <input style={inputStyle} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </Field>
            <Field label="Jenis kegiatan *">
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
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.posisi}</option>)}
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
// cuma muncul saat hover, supaya enak dipakai lewat HP/tablet oleh BSM).
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
            <input style={inputStyle} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Cth: Flores Barat IM3 (CSE/RSE/BSM) atau Flores Barat saja (RGE dual-brand)" />
          </Field>
          <Field label="Posisi">
            <select style={inputStyle} value={posisi} onChange={(e) => setPosisi(e.target.value)}>
              <option value="RGE">RGE</option>
              <option value="CSE">CSE</option>
              <option value="RSE">RSE</option>
              <option value="BSM">BSM</option>
              <option value="REGB">REGB</option>
              <option value="REGN">REGN</option>
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

function MembersModal({ members, onClose, onAdd, onRemove, onEdit }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [branch, setBranch] = useState("");
  const [posisi, setPosisi] = useState("RGE");
  return (
    <Modal onClose={onClose} width={460}>
      <ModalHeader title="Sheet Anggota Tim" onClose={onClose} icon={<Users size={18} />} />
      <div className="p-5 flex flex-col gap-4">
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
              <input style={inputStyle} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Cth: Flores Barat IM3 (CSE/RSE/BSM) atau Flores Barat saja (RGE dual-brand)" />
            </Field>
            <Field label="Posisi">
              <select style={inputStyle} value={posisi} onChange={(e) => setPosisi(e.target.value)}>
                <option value="RGE">RGE (eksekutor kegiatan &amp; dokumentasi)</option>
                <option value="CSE">CSE (eksekutor kegiatan di outlet/toko)</option>
                <option value="RSE">RSE (eksekutor kegiatan di outlet/toko)</option>
                <option value="BSM">BSM (Manager / pimpinan branch)</option>
                <option value="REGB">REGB (Regional Head — wilayah Bali)</option>
                <option value="REGN">REGN (Regional Head — wilayah Nusra)</option>
              </select>
            </Field>
          </div>
          <p className="text-xs text-slate-400 -mt-1">
            Branch dipakai untuk mencocokkan notifikasi WhatsApp harian. Untuk CSE/RSE/BSM, isi lengkap wilayah + brand (mis. "Flores Barat IM3") — cuma cocok ke BSM brand itu saja. Untuk RGE yang merangkap 2 brand, isi nama wilayah saja (mis. "Flores Barat" tanpa brand) — otomatis cocok ke SEMUA BSM di wilayah itu (mis. BSM Flores Barat IM3 dan BSM Flores Barat 3ID sekaligus). Untuk REGB, isi Branch dengan <b>BALI</b> (mencakup branch Bali Barat &amp; Bali Timur). Untuk REGN, isi Branch dengan <b>NUSRA</b> (mencakup Lombok Barat, Lombok Timur, Sumbawa, Flores Barat, Flores Timur, Sumba, Timor).
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
  const [senderId, setSenderId] = useState(members[0]?.id || "");
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
            {members.map((m) => <option key={m.id} value={m.id}>{m.phone} — {m.name} ({m.posisi})</option>)}
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

  // BSM adalah pemberi perintah/manager, bukan eksekutor kegiatan — jadi tidak ikut dihitung di
  // grafik keaktifan maupun notice "belum ada kegiatan" di bawahnya. Yang muncul hanya RGE/CSE/RSE.
  const executorMembers = members.filter((m) => String(m.posisi || "").toUpperCase() !== "BSM");
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
function GaleriFoto({ activities, members, cursor, onOpen }) {
  const monthPrefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
  const photos = [];
  activities.forEach((a) => {
    if (!a.date || !a.date.startsWith(monthPrefix)) return;
    (a.photos || []).forEach((ph) => {
      photos.push({ ...ph, activityId: a.id, activityTitle: a.title, assignedMemberId: a.assignedMemberId, hasil: a.hasil });
    });
  });
  photos.sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""));

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Camera size={17} className="text-indigo-600" />
        <h3 className="font-bold text-base text-slate-900">Galeri Dokumentasi — {BULAN[cursor.m]} {cursor.y}</h3>
      </div>
      {photos.length === 0 ? (
        <p className="text-sm text-slate-400 italic">Belum ada foto dokumentasi kegiatan bulan ini.</p>
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
function ringkasanLaporan(r) {
  if (r.category === "posm" && r.posmItems) {
    return Object.entries(r.posmItems).map(([k, v]) => `${k} ${v}pcs`).join(", ");
  }
  if (r.category === "event") return [r.namaEvent, r.spIM3 ? `SP IM3 ${r.spIM3}` : null, r.sp3ID ? `SP 3ID ${r.sp3ID}` : null, r.fwa ? `FWA ${r.fwa}` : null].filter(Boolean).join(" · ");
  if (r.category === "dtu") return [r.namaLokasi, r.spIM3 ? `SP IM3 ${r.spIM3}` : null, r.sp3ID ? `SP 3ID ${r.sp3ID}` : null, r.fwa ? `FWA ${r.fwa}` : null].filter(Boolean).join(" · ");
  if (r.category === "desa") return [r.namaDesa, r.siteId ? `Site ${r.siteId}` : null, r.spIM3 ? `SP IM3 ${r.spIM3}` : null, r.sp3ID ? `SP 3ID ${r.sp3ID}` : null, r.fwa ? `FWA ${r.fwa}` : null].filter(Boolean).join(" · ");
  if (r.category === "school") return [r.namaSekolah, r.spIM3 ? `SP IM3 ${r.spIM3}` : null, r.sp3ID ? `SP 3ID ${r.sp3ID}` : null, r.fwa ? `FWA ${r.fwa}` : null].filter(Boolean).join(" · ");
  if (r.category === "fwa") return [r.msisdn, r.imei].filter(Boolean).join(" · ");
  if (r.category === "nota") return [r.spIM3 ? `SP IM3 ${r.spIM3}` : null, r.sp3ID ? `SP 3ID ${r.sp3ID}` : null, r.nominal ? `Rp${Number(r.nominal).toLocaleString("id-ID")}` : null].filter(Boolean).join(" · ");
  return r.rawCaption || "";
}
function GaleriPerBranch({ members, rgeReports }) {
  // Branch diambil dinamis dari data anggota RGE yang ada, bukan di-hardcode -- otomatis
  // menyesuaikan berapa pun jumlah branch yang sebenarnya ada di sheet Member.
  const branches = Array.from(
    new Set(members.filter((m) => (m.posisi || "RGE") === "RGE" && m.branch).map((m) => m.branch))
  ).sort();
  const [activeBranch, setActiveBranch] = useState(null);
  const effectiveBranch = activeBranch && branches.includes(activeBranch) ? activeBranch : branches[0];

  const photos = rgeReports
    .filter((r) => r.Branch === effectiveBranch || r.branch === effectiveBranch)
    .filter((r) => r.FotoURL || r.fotoUrl)
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
      <div className="flex flex-wrap gap-1.5 mb-4">
        {branches.map((b) => (
          <button
            key={b}
            onClick={() => setActiveBranch(b)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${b === effectiveBranch ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            {b}
          </button>
        ))}
      </div>

      {photos.length === 0 ? (
        <p className="text-sm text-slate-400 italic">Belum ada laporan foto dari branch ini.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {photos.map((r) => {
            const isLunas = r.StatusLunas === true || r.statusLunas === true;
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
                  <img src={r.FotoURL || r.fotoUrl} alt={r.category} className="w-full h-full object-cover" />
                </div>
                <div className="p-2.5">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-[10px] font-bold uppercase text-indigo-600">{KATEGORI_LABEL[r.category] || r.category}</span>
                    <span className="text-[10px] text-slate-400">{String(r.Timestamp || r.receivedAt || "").slice(0, 10)}</span>
                  </div>
                  <div className="text-xs font-semibold text-slate-800 truncate">{r.NamaRGE || r.namaRGE || r.sender}</div>
                  <div className="text-[11px] text-slate-500 truncate">{ringkasanLaporan(r)}</div>
                  {r.category === "nota" && (
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
  const rows = rgeReports.filter((r) => {
    const mid = r.memberId || r.MemberId;
    const ts = String(r.Timestamp || r.receivedAt || "");
    return mid === memberId && ts.slice(0, 7) === monthKey;
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

function RekapKPI({ members, rgeReports, kpiTargets, onSaveTarget }) {
  const [cursor, setCursor] = useState(() => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() }; });
  const [editMember, setEditMember] = useState(null);
  const monthKey = monthKeyOf(cursor);

  const rgeMembers = members.filter((m) => (m.posisi || "RGE") === "RGE");

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
function StatCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="text-2xl font-extrabold" style={{ color }}>{value}</div>
      <div className="text-[11px] font-semibold text-slate-400 uppercase mt-1">{label}</div>
    </div>
  );
}
function greetingNow() {
  const h = new Date().getHours();
  if (h < 11) return "Selamat Pagi";
  if (h < 15) return "Selamat Siang";
  if (h < 18) return "Selamat Sore";
  return "Selamat Malam";
}
function Dashboard({ activities, members, rgeReports, onOpenActivity }) {
  const today = todayKey();
  const now = new Date();
  const memberOf = (id) => members.find((m) => m.id === id);
  const withStatus = activities.map((a) => {
    const m = memberOf(a.assignedMemberId);
    const report = reportInfoForActivity(a, m, rgeReports);
    return { ...a, _status: statusOf(a, now), _report: report };
  });
  const todays = withStatus.filter((a) => a.date === today).sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
  const monthPrefix = today.slice(0, 7);

  const totalToday = todays.length;
  const doneToday = todays.filter((a) => a._status === "selesai").length;
  const pendingReport = todays.filter((a) => ["menunggu_report", "overdue"].includes(a._status) && !a._report.received).length;
  const overdue = withStatus.filter((a) => a._status === "overdue").length;
  const completion = totalToday ? Math.round((doneToday / totalToday) * 100) : 0;

  const monthActs = withStatus.filter((a) => String(a.date || "").startsWith(monthPrefix));
  const monthDone = monthActs.filter((a) => a._status === "selesai").length;
  const monthRate = monthActs.length ? Math.round((monthDone / monthActs.length) * 100) : 0;

  const categoryStats = JENIS_KEGIATAN_OPSI.map((label) => ({
    label,
    total: todays.filter((a) => normalizeJenisKegiatan(a.jenisKegiatan) === label).length,
  })).filter((x) => x.total > 0);

  const teamStats = members
    .filter((m) => String(m.posisi || "").toUpperCase() !== "BSM")
    .map((m) => {
      const mine = monthActs.filter((a) => a.assignedMemberId === m.id);
      const done = mine.filter((a) => a._status === "selesai").length;
      return { member: m, total: mine.length, done, pct: mine.length ? Math.round((done / mine.length) * 100) : 0 };
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);

  const attention = withStatus
    .filter((a) => a._status === "overdue" || (["menunggu_report"].includes(a._status) && !a._report.received))
    .sort((a, b) => `${a.date}${a.time || ""}`.localeCompare(`${b.date}${b.time || ""}`))
    .slice(0, 6);

  const topCategory = categoryStats.sort((a, b) => b.total - a.total)[0];
  const dayLabel = new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="flex flex-col gap-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl p-6 sm:p-7 text-white shadow-sm" style={{ background: "linear-gradient(135deg,#312E81 0%,#4F46E5 52%,#7C3AED 100%)" }}>
        <div className="absolute -right-10 -top-16 w-56 h-56 rounded-full bg-white/10" />
        <div className="absolute right-24 -bottom-24 w-64 h-64 rounded-full bg-fuchsia-400/10" />
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-indigo-100 text-[11px] font-semibold mb-3">
              <span className="w-2 h-2 rounded-full bg-emerald-300" /> Team operation center
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{greetingNow()} 👋</h2>
            <p className="text-indigo-100 text-sm mt-1">Pantau jadwal, eksekusi, report WhatsApp, dan pencapaian tim dalam satu layar.</p>
            <p className="text-indigo-200 text-xs mt-3">{dayLabel}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 min-w-[260px]">
            <div className="rounded-2xl bg-white/10 border border-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wider text-indigo-200 font-bold">Execution hari ini</div>
              <div className="text-2xl font-extrabold mt-1">{completion}%</div>
            </div>
            <div className="rounded-2xl bg-white/10 border border-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wider text-indigo-200 font-bold">Bulan berjalan</div>
              <div className="text-2xl font-extrabold mt-1">{monthRate}%</div>
            </div>
          </div>
        </div>
      </section>

      {/* KPI cards */}
      <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { label: "Jadwal Hari Ini", value: totalToday, icon: CalendarIcon, tone: "#4F46E5", note: `${doneToday} selesai` },
          { label: "Selesai", value: doneToday, icon: CheckCircle2, tone: "#059669", note: `${completion}% dari hari ini` },
          { label: "Menunggu Report", value: pendingReport, icon: MessageCircle, tone: "#DB2777", note: "Follow-up via WA" },
          { label: "Overdue", value: overdue, icon: AlertTriangle, tone: "#DC2626", note: overdue ? "Perlu ditindaklanjuti" : "Tidak ada overdue" },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${k.tone}14`, color: k.tone }}><Icon size={18} /></span>
                <ArrowUpRight size={15} className="text-slate-300" />
              </div>
              <div className="text-2xl font-extrabold text-slate-900 mt-3">{k.value}</div>
              <div className="text-xs font-bold text-slate-600 mt-0.5">{k.label}</div>
              <div className="text-[10px] text-slate-400 mt-1">{k.note}</div>
            </div>
          );
        })}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Agenda */}
        <section className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900">Agenda Hari Ini</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Urutan aktivitas berdasarkan jam dan status aktual.</p>
            </div>
            <button onClick={() => onOpenActivity(todays[0]?.id)} disabled={!todays[0]} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 disabled:text-slate-300">Lihat detail →</button>
          </div>
          <div className="p-4 sm:p-5">
            {todays.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400">Belum ada kegiatan terjadwal hari ini.</div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {todays.slice(0, 7).map((a) => {
                  const m = memberOf(a.assignedMemberId);
                  const meta = STATUS_META[a._status];
                  const pct = progressOf(a._status);
                  return (
                    <button key={a.id} onClick={() => onOpenActivity(a.id)} className="w-full text-left group rounded-xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 p-3 transition">
                      <div className="flex items-center gap-3">
                        <div className="w-12 text-center shrink-0">
                          <div className="text-xs font-extrabold text-slate-700">{a.time || "--:--"}</div>
                          <div className="text-[9px] text-slate-400">WIB</div>
                        </div>
                        <div className="w-px h-9 bg-slate-200" />
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: memberColor(a.assignedMemberId) }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-800 truncate">{a.title}</span>
                            {a.photos?.length > 0 && <Camera size={12} className="text-slate-400 shrink-0" />}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate mt-0.5">{m?.name || "Tanpa PIC"} · {normalizeJenisKegiatan(a.jenisKegiatan)}</div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-2 max-w-[360px]"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: meta.color }} /></div>
                        </div>
                        <span className="hidden sm:inline-flex text-[10px] font-bold px-2 py-1 rounded-full shrink-0" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Automation */}
        <section className="bg-slate-950 rounded-2xl p-5 text-white shadow-sm overflow-hidden relative">
          <div className="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-indigo-500/20" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><Zap size={17} className="text-amber-300" /><h3 className="font-bold">Automation Center</h3></div>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-400/10 text-emerald-300"><span className="w-1.5 h-1.5 rounded-full bg-emerald-300" /> Active</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">Alur operasional yang terhubung ke reminder dan report WhatsApp.</p>
            <div className="grid grid-cols-2 gap-2 mt-5">
              <div className="rounded-xl bg-white/5 border border-white/10 p-3"><Wifi size={15} className="text-emerald-300" /><div className="text-xs font-bold mt-2">WA Gateway</div><div className="text-[10px] text-slate-500 mt-0.5">Connected</div></div>
              <div className="rounded-xl bg-white/5 border border-white/10 p-3"><Zap size={15} className="text-violet-300" /><div className="text-xs font-bold mt-2">n8n Flow</div><div className="text-[10px] text-slate-500 mt-0.5">Automation</div></div>
            </div>
            <div className="mt-3 rounded-xl bg-white/5 border border-white/10 p-3">
              <div className="flex items-center justify-between text-xs"><span className="text-slate-400">Report pending</span><b className="text-white">{pendingReport}</b></div>
              <div className="h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden"><div className="h-full rounded-full bg-pink-400" style={{ width: `${totalToday ? Math.min(100, (pendingReport / totalToday) * 100) : 0}%` }} /></div>
            </div>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Team progress */}
        <section className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4"><div><h3 className="font-bold text-slate-900">Progress Tim</h3><p className="text-[11px] text-slate-400">6 anggota teratas berdasarkan eksekusi bulan ini.</p></div><Users size={18} className="text-slate-300" /></div>
          {teamStats.length === 0 ? <p className="text-sm text-slate-400 italic">Belum ada data kegiatan bulan ini.</p> : <div className="grid sm:grid-cols-2 gap-x-5 gap-y-4">
            {teamStats.map((t) => <div key={t.member.id}>
              <div className="flex items-center justify-between text-xs mb-1.5"><span className="font-bold text-slate-700 truncate pr-2">{t.member.name}</span><span className="font-extrabold text-slate-500">{t.pct}%</span></div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${t.pct}%`, background: memberColor(t.member.id) }} /></div>
              <div className="text-[10px] text-slate-400 mt-1">{t.done}/{t.total} kegiatan selesai · {t.member.branch || "Branch belum diisi"}</div>
            </div>)}
          </div>}
        </section>

        {/* Distribution */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between"><div><h3 className="font-bold text-slate-900">Distribusi Kegiatan</h3><p className="text-[11px] text-slate-400">Hari ini berdasarkan kategori.</p></div><BarChart2 size={18} className="text-slate-300" /></div>
          <div className="flex items-center gap-5 mt-5">
            <div className="relative w-28 h-28 shrink-0 rounded-full" style={{ background: categoryStats.length ? `conic-gradient(#4F46E5 0 ${categoryStats.reduce((s,x)=>s+x.total,0) ? (categoryStats[0].total / totalToday) * 360 : 0}deg, #E2E8F0 0)` : "#F1F5F9" }}>
              <div className="absolute inset-4 bg-white rounded-full flex flex-col items-center justify-center"><span className="text-xl font-extrabold text-slate-900">{totalToday}</span><span className="text-[9px] text-slate-400">kegiatan</span></div>
            </div>
            <div className="flex-1 flex flex-col gap-2">
              {categoryStats.slice(0, 5).map((x, i) => <div key={x.label} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-slate-600"><span className="w-2 h-2 rounded-full" style={{ background: CHIP_PALETTE[i % CHIP_PALETTE.length] }} />{x.label}</span><b className="text-slate-800">{x.total}</b></div>)}
              {topCategory && <div className="pt-2 mt-1 border-t border-slate-100 text-[10px] text-slate-400">Terbanyak: <b className="text-slate-600">{topCategory.label}</b></div>}
            </div>
          </div>
        </section>
      </div>

      {/* Attention */}
      {attention.length > 0 && <section className="bg-white rounded-2xl border border-rose-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-rose-50/50 border-b border-rose-100 flex items-center gap-2"><AlertTriangle size={16} className="text-rose-600" /><div><h3 className="font-bold text-sm text-rose-700">Perlu Perhatian</h3><p className="text-[10px] text-rose-500">Overdue dan report yang belum diterima.</p></div></div>
        <div className="divide-y divide-slate-100">{attention.map((a) => { const m = memberOf(a.assignedMemberId); const meta = STATUS_META[a._status]; return <button key={a.id} onClick={() => onOpenActivity(a.id)} className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-slate-50 transition"><span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: meta.bg, color: meta.color }}>{a._status === "overdue" ? <Clock size={15} /> : <MessageCircle size={15} />}</span><span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-700 truncate">{a.title}</span><span className="block text-[10px] text-slate-400 truncate">{m?.name || "Tanpa PIC"} · {a.date}{a.time ? ` · ${a.time}` : ""}</span></span><span className="text-[10px] font-bold shrink-0" style={{ color: meta.color }}>{meta.label}</span><ArrowUpRight size={14} className="text-slate-300" /></button>; })}</div>
      </section>}
    </div>
  );
}

// ---------- Team Overview: ringkasan per anggota RGE hari ini + overdue keseluruhan. ----------
function TeamOverview({ activities, members }) {
  const today = todayKey();
  const rgeMembers = members.filter((m) => (m.posisi || "RGE") === "RGE");
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
