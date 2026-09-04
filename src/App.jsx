import { useState, useEffect, useRef } from "react";
import {
  ChevronLeft, ChevronRight, Camera, Check, Plus, X, Users,
  MessageCircle, Upload, Phone, Trash2, Send, Image as ImageIcon,
  Info, Calendar as CalendarIcon, Minus, BarChart2, Smartphone
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid
} from "recharts";
import { db } from "./firebase.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, arrayUnion
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
const CHIP_PALETTE = [
  "#4F46E5", // indigo
  "#059669", // emerald
  "#D97706", // amber
  "#DB2777", // pink
  "#0891B2", // cyan
];

const BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const HARI = ["Sen","Sel","Rab","Kam","Jum","Sab","Min"];
const JENIS_KEGIATAN_OPSI = ["Rapat", "Kunjungan Lapangan", "Pelatihan", "Distribusi Logistik", "Dokumentasi", "Briefing", "Lainnya"];

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function dateKey(y, m, d) { return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function todayKey() { const t = new Date(); return dateKey(t.getFullYear(), t.getMonth(), t.getDate()); }
function posisiColor(posisi) {
  let h = 0;
  for (let i = 0; i < (posisi || "").length; i++) h = (h * 31 + posisi.charCodeAt(i)) >>> 0;
  return CHIP_PALETTE[h % CHIP_PALETTE.length];
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
function EventChip({ activity }) {
  const color = posisiColor(activity._posisi);
  return (
    <div
      className="text-[10px] text-white px-1.5 py-0.5 rounded truncate flex items-center gap-1"
      style={{ background: color, opacity: activity.status === "selesai" ? 0.55 : 1 }}
      title={activity.title}
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
  const [dayModal, setDayModal] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showSim, setShowSim] = useState(false);
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [toast, setToast] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);

  function notify(msg) { setToast(msg); setTimeout(() => setToast(null), 2600); }

  useEffect(() => {
    const unsubMembers = onSnapshot(
      collection(db, "members"),
      (snap) => setMembers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => { console.error(err); notify("Gagal memuat data anggota dari Firestore."); }
    );
    const unsubActivities = onSnapshot(
      collection(db, "activities"),
      (snap) => { setActivities(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setReady(true); },
      (err) => { console.error(err); notify("Gagal memuat data kegiatan dari Firestore."); setReady(true); }
    );
    return () => { unsubMembers(); unsubActivities(); };
  }, []);

  async function addMember(member) {
    try { await addDoc(collection(db, "members"), member); }
    catch (e) { console.error(e); notify("Gagal menyimpan anggota baru."); }
  }
  async function removeMember(id) {
    try { await deleteDoc(doc(db, "members", id)); }
    catch (e) { console.error(e); notify("Gagal menghapus anggota."); }
  }
  async function addActivity(activity) {
    try { await addDoc(collection(db, "activities"), { ...activity, photos: activity.photos || [] }); }
    catch (e) { console.error(e); notify("Gagal menyimpan kegiatan baru."); }
  }
  async function updateActivity(id, patch) {
    try { await updateDoc(doc(db, "activities", id), patch); }
    catch (e) { console.error(e); notify("Gagal memperbarui kegiatan."); }
  }
  async function deleteActivity(id) {
    try { await deleteDoc(doc(db, "activities", id)); }
    catch (e) { console.error(e); notify("Gagal menghapus kegiatan."); }
  }
  async function addPhoto(activityId, photo) {
    try { await updateDoc(doc(db, "activities", activityId), { status: "selesai", photos: arrayUnion(photo) }); }
    catch (e) { console.error(e); notify("Gagal mengunggah foto."); }
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
      {/* Nav bar */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📅</span>
              <span className="font-bold text-lg sm:text-xl tracking-tight text-indigo-600">Papan Kegiatan Tim</span>
            </div>
            <div className="flex items-center gap-2">
              <IconBtn onClick={() => setShowMembers(true)} title="Sheet Anggota"><Users size={19} /></IconBtn>
              <IconBtn onClick={() => setShowSim(true)} title="Simulasi WhatsApp"><Smartphone size={19} /></IconBtn>
              <IconBtn onClick={() => setInfoOpen(true)} title="Cara kerja"><Info size={19} /></IconBtn>
              <PrimaryBtn onClick={() => setShowAddActivity(todayKey())} className="ml-1">
                <Plus size={16} /> <span className="hidden sm:inline">Tambah Kegiatan</span>
              </PrimaryBtn>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* LEFT: Calendar */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 shadow-sm">
            <div className="flex justify-between items-center mb-5 flex-wrap gap-2">
              <div className="flex items-center gap-1">
                <IconBtn onClick={() => setCursor((c) => c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 })}><ChevronLeft size={18} /></IconBtn>
                <h2 className="text-lg font-bold text-slate-900 min-w-[150px] text-center">{BULAN[cursor.m]} {cursor.y}</h2>
                <IconBtn onClick={() => setCursor((c) => c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 })}><ChevronRight size={18} /></IconBtn>
              </div>
              <GhostBtn onClick={() => { const t = new Date(); setCursor({ y: t.getFullYear(), m: t.getMonth() }); }}>Hari ini</GhostBtn>
            </div>

            <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-slate-400 mb-2">
              {HARI.map((h) => <div key={h}>{h}</div>)}
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {cells.map((d, i) => {
                if (d === null) return <div key={i} style={{ minHeight: 88 }} />;
                const key = dateKey(cursor.y, cursor.m, d);
                const dayActs = activitiesByDate[key] || [];
                const isToday = key === todayKey();
                return (
                  <div
                    key={i}
                    onClick={() => setDayModal(key)}
                    className={`rounded-lg p-1.5 text-left cursor-pointer transition flex flex-col gap-1 ${isToday ? "bg-indigo-50 border-2 border-indigo-500" : "bg-slate-50 hover:bg-slate-100 border border-transparent"}`}
                    style={{ minHeight: 88 }}
                  >
                    <span className={`text-xs font-semibold ${isToday ? "text-indigo-700" : "text-slate-600"}`}>{d}</span>
                    <div className="flex flex-col gap-1 overflow-hidden">
                      {dayActs.slice(0, 2).map((a) => <EventChip key={a.id} activity={a} />)}
                      {dayActs.length > 2 && <span className="text-[10px] text-slate-400 font-medium">+{dayActs.length - 2} lagi</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT: sidebar */}
          <div className="space-y-6">
            <AgendaHariIni activities={todaysActivities} members={members} onOpen={(id) => setDetailId(id)} />
            <ResumeAnggota members={members} activities={activities} cursor={cursor} />
          </div>
        </div>

        {/* Full width summary charts */}
        <div className="mt-6 bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 shadow-sm">
          <SummaryCharts activities={activities} members={members} cursor={cursor} />
        </div>
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
          onClose={() => setDetailId(null)}
          onToggleStatus={(id, status) => updateActivity(id, { status })}
          onReschedule={(id, date, time) => updateActivity(id, { date, time })}
          onEdit={(id, patch) => { updateActivity(id, patch); notify("Kegiatan diperbarui."); }}
          onDelete={(id) => { deleteActivity(id); setDetailId(null); notify("Kegiatan dihapus."); }}
          onAddPhoto={(photo) => addPhoto(detailId, photo)}
        />
      )}

      {showMembers && (
        <MembersModal members={members} onClose={() => setShowMembers(false)} onAdd={addMember} onRemove={removeMember} />
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

  const rows = members.map((m) => {
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
  const [jenisKegiatan, setJenisKegiatan] = useState(JENIS_KEGIATAN_OPSI[0]);
  const [assignedMemberId, setAssignedMemberId] = useState(members[0]?.id || "");
  return (
    <Modal onClose={onClose} width={420}>
      <ModalHeader title="Tambah Kegiatan" onClose={onClose} icon={<Plus size={18} />} />
      <div className="p-5 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tanggal"><input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Jam (opsional)"><input type="time" style={inputStyle} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        <Field label="Judul kegiatan">
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Contoh: Rapat evaluasi mingguan" />
        </Field>
        <Field label="Jenis kegiatan">
          <input style={inputStyle} list="jenis-list" value={jenisKegiatan} onChange={(e) => setJenisKegiatan(e.target.value)} />
          <datalist id="jenis-list">{JENIS_KEGIATAN_OPSI.map((j) => <option key={j} value={j} />)}</datalist>
        </Field>
        <Field label="Deskripsi (opsional)">
          <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Penanggung jawab">
          <select style={inputStyle} value={assignedMemberId} onChange={(e) => setAssignedMemberId(e.target.value)}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.posisi}</option>)}
          </select>
        </Field>
        <PrimaryBtn disabled={!title.trim() || !date} onClick={() => onSave({ title: title.trim(), date, time, description, jenisKegiatan, assignedMemberId })}>Simpan Kegiatan</PrimaryBtn>
      </div>
    </Modal>
  );
}

// ---------- Activity Detail Modal ----------
function ActivityDetailModal({ activity, member, members, onClose, onToggleStatus, onReschedule, onEdit, onDelete, onAddPhoto }) {
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
  const fileRef = useRef(null);
  if (!activity) return null;
  const chipColor = posisiColor(member?.posisi);

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
    <Modal onClose={onClose} width={520}>
      <ModalHeader
        title={<span className="flex items-center gap-2"><StatusMarker status={activity.status} /> {activity.title}</span>}
        onClose={onClose}
        icon={<span style={{ width: 12, height: 12, borderRadius: 4, background: chipColor, display: "inline-block" }} />}
      />
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-slate-500 font-mono">
            {new Date(activity.date + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            {activity.time && ` · ${activity.time}`}
          </div>
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
        )}

        {showEdit && (
          <div className="flex flex-col gap-2 bg-slate-50 rounded-lg p-3">
            <Field label="Judul kegiatan">
              <input style={inputStyle} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </Field>
            <Field label="Jenis kegiatan">
              <input style={inputStyle} list="jenis-list-edit" value={editJenis} onChange={(e) => setEditJenis(e.target.value)} />
              <datalist id="jenis-list-edit">{JENIS_KEGIATAN_OPSI.map((j) => <option key={j} value={j} />)}</datalist>
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
              disabled={!editTitle.trim()}
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

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-sm text-slate-900 flex items-center gap-1.5"><ImageIcon size={15} /> Dokumentasi ({activity.photos?.length || 0})</span>
            <label className="cursor-pointer">
              <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
              <span className="text-xs text-indigo-600 font-semibold flex items-center gap-1">{uploading ? "Mengunggah…" : <><Upload size={13} />Unggah foto</>}</span>
            </label>
          </div>
          {activity.photos?.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {activity.photos.map((ph) => (
                <div key={ph.id} className="rounded-lg overflow-hidden border border-slate-200">
                  <img src={ph.dataUrl} alt={ph.caption || activity.title} className="w-full h-[90px] object-cover block" />
                  <div className="text-[10px] text-slate-400 text-center py-0.5 font-mono truncate px-1">{ph.uploadedBy}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 italic">Belum ada foto hasil kegiatan.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------- Members Modal ----------
function MembersModal({ members, onClose, onAdd, onRemove }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [posisi, setPosisi] = useState("RGE");
  return (
    <Modal onClose={onClose} width={460}>
      <ModalHeader title="Sheet Anggota Tim" onClose={onClose} icon={<Users size={18} />} />
      <div className="p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 220 }}>
          {members.map((m) => {
            const color = posisiColor(m.posisi);
            return (
              <div key={m.id} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span style={{ background: color }} className="w-2.5 h-2.5 rounded-full flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-slate-900 truncate">{m.name}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-1 font-mono"><Phone size={11} />{m.phone} · {m.posisi}</div>
                  </div>
                </div>
                <IconBtn onClick={() => onRemove(m.id)}><Trash2 size={15} className="text-rose-500" /></IconBtn>
              </div>
            );
          })}
          {members.length === 0 && <p className="text-sm text-slate-400">Belum ada anggota.</p>}
        </div>
        <div className="border-t border-slate-200 pt-4 flex flex-col gap-2">
          <span className="font-bold text-sm text-slate-900">Tambah Anggota</span>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Nama"><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="No. WhatsApp"><input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="62812..." /></Field>
          </div>
          <Field label="Posisi">
            <select style={inputStyle} value={posisi} onChange={(e) => setPosisi(e.target.value)}>
              <option value="RGE">RGE (eksekutor kegiatan &amp; dokumentasi)</option>
              <option value="CSE">CSE (eksekutor kegiatan di outlet/toko)</option>
              <option value="RSE">RSE (eksekutor kegiatan di outlet/toko)</option>
              <option value="BSM">BSM (Manager / pimpinan branch)</option>
            </select>
          </Field>
          <PrimaryBtn disabled={!name.trim() || !phone.trim()} onClick={() => { onAdd({ name: name.trim(), phone: phone.trim(), posisi }); setName(""); setPhone(""); setPosisi("RGE"); }}><Plus size={15} />Tambah</PrimaryBtn>
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
  const [jenisKegiatan, setJenisKegiatan] = useState(JENIS_KEGIATAN_OPSI[0]);
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
              <Field label="Jam (opsional)"><input type="time" style={inputStyle} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
            </div>
            <Field label="Judul kegiatan"><input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Contoh: Kunjungan lapangan" /></Field>
            <Field label="Jenis kegiatan">
              <input style={inputStyle} list="jenis-list-sim" value={jenisKegiatan} onChange={(e) => setJenisKegiatan(e.target.value)} />
              <datalist id="jenis-list-sim">{JENIS_KEGIATAN_OPSI.map((j) => <option key={j} value={j} />)}</datalist>
            </Field>
            <Field label="Catatan (opsional)"><textarea style={{ ...inputStyle, minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <div className="bg-indigo-50 rounded-lg px-3 py-2 text-xs text-indigo-700 font-mono">
              Pesan terbaca: "JADWAL {date}{time ? ` ${time}` : ""} — {title || "…"}" dari {sender?.name}
            </div>
            <PrimaryBtn disabled={!title.trim() || sending} onClick={sendSchedule}><Send size={15} />{sending ? "Mengirim…" : "Kirim ke Papan"}</PrimaryBtn>
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

// ---------- Summary charts: by activity type & by member/posisi ----------
function SummaryCharts({ activities, members, cursor }) {
  const monthPrefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
  const monthActs = activities.filter((a) => a.date && a.date.startsWith(monthPrefix));

  const byType = {};
  monthActs.forEach((a) => {
    const key = a.jenisKegiatan || "Lainnya";
    byType[key] ||= { name: key, Rencana: 0, Selesai: 0 };
    byType[key][a.status === "selesai" ? "Selesai" : "Rencana"]++;
  });
  const typeData = Object.values(byType);

  const byMember = members.map((m) => {
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
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={typeData} margin={{ left: -18, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: COLORS.inkSoft }} interval={0} angle={-15} textAnchor="end" height={40} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10.5, fill: COLORS.inkSoft }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.border}` }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Rencana" fill={STATUS_COLORS.rencana} radius={[4, 4, 0, 0]} />
                <Bar dataKey="Selesai" fill={STATUS_COLORS.selesai} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-slate-50 rounded-xl border border-slate-100 p-4">
            <div className="font-semibold text-sm text-slate-800 mb-2">Keaktifan per Anggota (Posisi)</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byMember} margin={{ left: -18, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: COLORS.inkSoft }} interval={0} angle={-15} textAnchor="end" height={40} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10.5, fill: COLORS.inkSoft }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.border}` }} labelFormatter={(_, p) => p?.[0]?.payload?.fullName || ""} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Rencana" stackId="a" fill={STATUS_COLORS.rencana} />
                <Bar dataKey="Selesai" stackId="a" fill={STATUS_COLORS.selesai} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
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
