import { useState, useEffect, useRef } from "react";
import {
  ChevronLeft, ChevronRight, Camera, Check, Plus, X, Users,
  MessageCircle, Upload, Phone, Trash2, Send, Image as ImageIcon,
  Info, Pin as PinIcon, Minus, BarChart2
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
  frame: "#6B4E33",      // corkboard wooden frame
  frameDark: "#503A26",
  board: "#F2ECDD",      // paper/board background
  boardShadow: "#E4DAC2",
  ink: "#2B2620",        // primary text
  inkSoft: "#6B6353",
  teal: "#1F6F5C",       // primary accent
  tealDark: "#164F42",
  coral: "#E8935A",      // today / highlight accent
  line: "#D8CDB0",
};
const CARD_PALETTE = [
  { bg: "#F6D776", tape: "#E8C24F" }, // yellow
  { bg: "#9FD8CB", tape: "#77BFAF" }, // mint
  { bg: "#F3B8C4", tape: "#E290A2" }, // pink
  { bg: "#B9CDEB", tape: "#93AEDA" }, // blue
  { bg: "#E3C6A8", tape: "#CBA57E" }, // tan
];
const STATUS_COLORS = { rencana: "#C1443B", selesai: "#3F9142" };
const JENIS_KEGIATAN_OPSI = ["Rapat", "Kunjungan Lapangan", "Pelatihan", "Distribusi Logistik", "Dokumentasi", "Briefing", "Lainnya"];

const BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const HARI = ["Sen","Sel","Rab","Kam","Jum","Sab","Min"];

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function todayKey() {
  const t = new Date();
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
}
function posisiColor(posisi) {
  let h = 0;
  for (let i = 0; i < (posisi || "").length; i++) h = (h * 31 + posisi.charCodeAt(i)) >>> 0;
  return CARD_PALETTE[h % CARD_PALETTE.length];
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
    <button onClick={onClick} title={title} style={{ border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.ink, ...style }} className="p-1 rounded">
      {children}
    </button>
  );
}
function PrimaryBtn({ onClick, children, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ background: disabled ? "#9BB8B0" : COLORS.teal, color: "#fff", border: "none", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, letterSpacing: "0.01em", ...style }} className="px-4 py-2 rounded-md text-sm flex items-center gap-2 justify-center">
      {children}
    </button>
  );
}
function GhostBtn({ onClick, children, style }) {
  return (
    <button onClick={onClick} style={{ background: "transparent", border: `1.5px solid ${COLORS.line}`, color: COLORS.ink, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, ...style }} className="px-4 py-2 rounded-md text-sm flex items-center gap-2 justify-center">
      {children}
    </button>
  );
}
function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.06em", color: COLORS.inkSoft, textTransform: "uppercase" }}>{label}</span>
      {children}
    </label>
  );
}
const inputStyle = {
  border: `1.5px solid ${COLORS.line}`, borderRadius: 8, padding: "8px 10px", fontFamily: "'Inter', sans-serif",
  fontSize: 14, color: COLORS.ink, background: "#fff", outline: "none",
};

// ---------- Modal shell ----------
function Modal({ onClose, children, width = 480 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(43,38,32,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FFFDF8", borderRadius: 14, width: "100%", maxWidth: width, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
        {children}
      </div>
    </div>
  );
}
function ModalHeader({ title, onClose, icon }) {
  return (
    <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1.5px solid ${COLORS.line}` }}>
      <div className="flex items-center gap-2">
        {icon}
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17, color: COLORS.ink }}>{title}</h3>
      </div>
      <IconBtn onClick={onClose}><X size={18} /></IconBtn>
    </div>
  );
}

// ---------- Status marker: red "-" circle = rencana, green "✓" circle = selesai ----------
function StatusMarker({ status, size = 13 }) {
  const color = status === "selesai" ? STATUS_COLORS.selesai : STATUS_COLORS.rencana;
  return (
    <span style={{
      width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 1px rgba(0,0,0,0.25)",
    }} title={status === "selesai" ? "Sudah dilaksanakan" : "Rencana"}>
      {status === "selesai" ? <Check size={size * 0.68} color="#fff" strokeWidth={3} /> : <Minus size={size * 0.68} color="#fff" strokeWidth={3} />}
    </span>
  );
}

// ---------- Day activity card (pinned note) ----------
function MiniCard({ activity, rotate, palette }) {
  return (
    <div style={{
      background: palette.bg, borderRadius: 4, padding: "3px 6px", fontSize: 10.5,
      fontFamily: "'Inter', sans-serif", color: COLORS.ink, fontWeight: 600,
      transform: `rotate(${rotate}deg)`, boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", position: "relative",
    }}>
      <div style={{ position: "absolute", top: -4, left: "50%", transform: "translateX(-50%)", width: 16, height: 7, background: palette.tape, opacity: 0.85, borderRadius: 1 }} />
      <div className="flex items-center gap-1" style={{ overflow: "hidden" }}>
        <StatusMarker status={activity.status} size={11} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{activity.title}</span>
        {activity.photos?.length > 0 && <Camera size={10} style={{ flexShrink: 0, marginLeft: "auto" }} />}
      </div>
    </div>
  );
}

export default function PapanKegiatan() {
  const [ready, setReady] = useState(false);
  const [members, setMembers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [cursor, setCursor] = useState(() => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() }; });
  const [dayModal, setDayModal] = useState(null); // dateKey string
  const [detailId, setDetailId] = useState(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showSim, setShowSim] = useState(false);
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [toast, setToast] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);

  function notify(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  useEffect(() => {
    const unsubMembers = onSnapshot(
      collection(db, "members"),
      (snap) => {
        setMembers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => { console.error(err); notify("Gagal memuat data anggota dari Firestore."); }
    );
    const unsubActivities = onSnapshot(
      collection(db, "activities"),
      (snap) => {
        setActivities(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setReady(true);
      },
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
  async function addPhoto(activityId, photo) {
    try { await updateDoc(doc(db, "activities", activityId), { status: "selesai", photos: arrayUnion(photo) }); }
    catch (e) { console.error(e); notify("Gagal mengunggah foto."); }
  }

  const memberById = (id) => members.find((m) => m.id === id);

  // ---------- Calendar grid computation ----------
  const first = new Date(cursor.y, cursor.m, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const activitiesByDate = {};
  activities.forEach((a) => { (activitiesByDate[a.date] ||= []).push(a); });

  if (!ready) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, fontFamily: "'Space Grotesk', sans-serif", color: COLORS.inkSoft }}>
        Memuat papan kegiatan…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: COLORS.frame, borderRadius: 18, padding: 14, position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        .pk-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .pk-scroll::-webkit-scrollbar-thumb { background: ${COLORS.line}; border-radius: 4px; }
        .pk-cell:hover { filter: brightness(0.98); }
        button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid ${COLORS.teal}; outline-offset: 1px; }
      `}</style>

      {/* Frame texture rim */}
      <div style={{ background: `repeating-linear-gradient(135deg, ${COLORS.frameDark} 0px, ${COLORS.frameDark} 2px, ${COLORS.frame} 2px, ${COLORS.frame} 6px)`, position: "absolute", inset: 0, borderRadius: 18, opacity: 0.35, pointerEvents: "none" }} />

      <div style={{ background: COLORS.board, borderRadius: 12, padding: "18px 18px 14px", position: "relative", boxShadow: `inset 0 0 0 1px ${COLORS.boardShadow}` }}>

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div style={{ background: COLORS.teal, color: "#fff", width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15, transform: "rotate(-4deg)", boxShadow: "0 3px 6px rgba(0,0,0,0.2)" }}>
              <PinIcon size={18} />
            </div>
            <div>
              <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 21, color: COLORS.ink, lineHeight: 1.1 }}>Papan Kegiatan Tim</h1>
              <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: COLORS.inkSoft, letterSpacing: "0.03em" }}>terhubung ke WhatsApp gateway (WAHA)</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <GhostBtn onClick={() => setShowMembers(true)}><Users size={15} /> Anggota</GhostBtn>
            <PrimaryBtn onClick={() => setShowSim(true)}><MessageCircle size={15} /> Simulasi WhatsApp</PrimaryBtn>
            <IconBtn onClick={() => setInfoOpen(true)} title="Cara kerja"><Info size={18} color={COLORS.inkSoft} /></IconBtn>
          </div>
        </div>

        {/* Month nav */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1">
            <IconBtn onClick={() => setCursor((c) => c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 })}><ChevronLeft size={20} /></IconBtn>
            <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17, color: COLORS.ink, minWidth: 170, textAlign: "center" }}>{BULAN[cursor.m]} {cursor.y}</h2>
            <IconBtn onClick={() => setCursor((c) => c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 })}><ChevronRight size={20} /></IconBtn>
          </div>
          <GhostBtn onClick={() => { const t = new Date(); setCursor({ y: t.getFullYear(), m: t.getMonth() }); }} style={{ padding: "6px 12px" }}>Hari ini</GhostBtn>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 flex-wrap mb-3" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: COLORS.inkSoft }}>
          {members.map((m) => {
            const p = posisiColor(m.posisi);
            return <span key={m.id} className="flex items-center gap-1"><span style={{ width: 9, height: 9, borderRadius: 2, background: p.bg, display: "inline-block" }} />{m.posisi}</span>;
          })}
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {HARI.map((h) => (
            <div key={h} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: COLORS.inkSoft, textAlign: "center", fontWeight: 500 }}>{h}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1.5" style={{ marginBottom: 22 }}>
          {cells.map((d, i) => {
            if (d === null) return <div key={i} style={{ minHeight: 92 }} />;
            const key = dateKey(cursor.y, cursor.m, d);
            const dayActs = activitiesByDate[key] || [];
            const isToday = key === todayKey();
            return (
              <div key={i} onClick={() => setDayModal(key)} className="pk-cell" style={{
                minHeight: 92, background: "#FFFDF8", border: `1px solid ${COLORS.line}`, borderRadius: 8,
                padding: "5px 5px 6px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3, position: "relative", overflow: "hidden",
              }}>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <span style={{
                    fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600,
                    color: isToday ? "#fff" : COLORS.ink, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: "50%", background: isToday ? COLORS.coral : "transparent",
                    border: isToday ? `2px solid ${COLORS.coral}` : "none", transform: isToday ? "rotate(-6deg)" : "none",
                  }}>{d}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, overflow: "hidden" }}>
                  {dayActs.slice(0, 2).map((a, idx) => (
                    <MiniCard key={a.id} activity={a} rotate={idx % 2 === 0 ? -1.5 : 1.5} palette={posisiColor(memberById(a.assignedMemberId)?.posisi)} />
                  ))}
                  {dayActs.length > 2 && (
                    <span style={{ fontSize: 10, color: COLORS.inkSoft, fontFamily: "'IBM Plex Mono', monospace" }}>+{dayActs.length - 2} lagi</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <SummaryCharts activities={activities} members={members} cursor={cursor} />
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: COLORS.tealDark, color: "#fff", padding: "10px 18px", borderRadius: 8, fontFamily: "'Inter', sans-serif", fontSize: 13.5, fontWeight: 500, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", zIndex: 100, display: "flex", alignItems: "center", gap: 8 }}>
          <Check size={15} /> {toast}
        </div>
      )}

      {/* Day modal */}
      {dayModal && (
        <Modal onClose={() => setDayModal(null)} width={440}>
          <ModalHeader title={new Date(dayModal + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} onClose={() => setDayModal(null)} />
          <div className="p-5 flex flex-col gap-3">
            {(activitiesByDate[dayModal] || []).length === 0 && (
              <p style={{ color: COLORS.inkSoft, fontSize: 14 }}>Belum ada kegiatan pada tanggal ini.</p>
            )}
            {(activitiesByDate[dayModal] || []).map((a) => {
              const mem = memberById(a.assignedMemberId);
              const p = posisiColor(mem?.posisi);
              return (
                <div key={a.id} onClick={() => { setDetailId(a.id); setDayModal(null); }} style={{ background: p.bg + "55", border: `1.5px solid ${p.tape}`, borderRadius: 10, padding: 12, cursor: "pointer" }}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <StatusMarker status={a.status} />
                      <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 14.5, color: COLORS.ink }}>{a.title}</span>
                    </span>
                    <span style={{ fontSize: 11, color: a.status === "selesai" ? STATUS_COLORS.selesai : STATUS_COLORS.rencana, fontWeight: 700 }}>{a.status === "selesai" ? "Selesai" : "Rencana"}</span>
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.inkSoft, marginTop: 3 }}>{mem ? `${mem.name} · ${mem.posisi}` : "Belum ditugaskan"}</div>
                  {a.photos?.length > 0 && <div style={{ fontSize: 11.5, color: COLORS.inkSoft, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}><Camera size={12} />{a.photos.length} foto</div>}
                </div>
              );
            })}
            <PrimaryBtn onClick={() => { setShowAddActivity(dayModal); setDayModal(null); }}><Plus size={15} /> Tambah kegiatan</PrimaryBtn>
          </div>
        </Modal>
      )}

      {/* Add activity modal */}
      {showAddActivity && (
        <AddActivityModal
          date={showAddActivity}
          members={members}
          onClose={() => setShowAddActivity(false)}
          onSave={(a) => { addActivity({ ...a, date: showAddActivity, status: "rencana", createdVia: "web" }); setShowAddActivity(false); notify("Kegiatan ditambahkan ke papan."); }}
        />
      )}

      {/* Activity detail modal */}
      {detailId && (
        <ActivityDetailModal
          activity={activities.find((a) => a.id === detailId)}
          member={memberById(activities.find((a) => a.id === detailId)?.assignedMemberId)}
          onClose={() => setDetailId(null)}
          onToggleStatus={(id, status) => updateActivity(id, { status })}
          onAddPhoto={(photo) => addPhoto(detailId, photo)}
        />
      )}

      {/* Members panel */}
      {showMembers && (
        <MembersModal members={members} onClose={() => setShowMembers(false)} onAdd={addMember} onRemove={removeMember} />
      )}

      {/* WhatsApp simulator */}
      {showSim && (
        <WhatsAppSimModal
          members={members}
          activities={activities}
          onClose={() => setShowSim(false)}
          onNewSchedule={(a) => { addActivity(a); notify(`Jadwal baru diterima dari ${memberById(a.assignedMemberId)?.name} via WhatsApp.`); }}
          onUploadResult={(activityId, photo) => { addPhoto(activityId, photo); notify(`Foto hasil kegiatan diterima via WhatsApp.`); }}
        />
      )}

      {/* Info modal */}
      {infoOpen && (
        <Modal onClose={() => setInfoOpen(false)} width={480}>
          <ModalHeader title="Cara kerja sistem" onClose={() => setInfoOpen(false)} icon={<Info size={18} />} />
          <div className="p-5 flex flex-col gap-3" style={{ fontSize: 13.5, color: COLORS.ink, lineHeight: 1.6 }}>
            <p>Kalender ini terhubung <b>langsung ke Firestore</b> dan diperbarui secara real-time. Tombol "Simulasi WhatsApp" tetap tersedia untuk uji coba cepat dari web, tapi kegiatan sungguhan biasanya masuk lewat WhatsApp tim.</p>
            <p>Alur produksinya:</p>
            <ol style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, listStyle: "decimal" }}>
              <li>Anggota kirim pesan/foto ke nomor WhatsApp tim.</li>
              <li>WAHA menerima pesan lewat <i>webhook</i> dan mengirim ke n8n.</li>
              <li>n8n mencocokkan nomor pengirim dengan data anggota (nama + posisi).</li>
              <li>n8n memproses format pesan (mis. "JADWAL", foto dokumentasi) dan menyimpan ke Firestore.</li>
              <li>Web ini otomatis menampilkan perubahan itu tanpa perlu refresh.</li>
            </ol>
            <p style={{ color: COLORS.inkSoft }}>Data di papan ini dapat dilihat bersama oleh siapa pun yang membuka tautan web ini.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- Add Activity Modal ----------
function AddActivityModal({ date, members, onClose, onSave }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [jenisKegiatan, setJenisKegiatan] = useState(JENIS_KEGIATAN_OPSI[0]);
  const [assignedMemberId, setAssignedMemberId] = useState(members[0]?.id || "");
  return (
    <Modal onClose={onClose} width={420}>
      <ModalHeader title="Tambah Kegiatan" onClose={onClose} icon={<Plus size={18} />} />
      <div className="p-5 flex flex-col gap-3">
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
        <PrimaryBtn disabled={!title.trim()} onClick={() => onSave({ title: title.trim(), description, jenisKegiatan, assignedMemberId })}>Simpan Kegiatan</PrimaryBtn>
      </div>
    </Modal>
  );
}

// ---------- Activity Detail Modal ----------
function ActivityDetailModal({ activity, member, onClose, onToggleStatus, onAddPhoto }) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  if (!activity) return null;
  const p = posisiColor(member?.posisi);

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
        icon={<span style={{ width: 12, height: 12, borderRadius: 3, background: p.bg, display: "inline-block" }} />}
      />
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div style={{ fontSize: 13, color: COLORS.inkSoft, fontFamily: "'IBM Plex Mono', monospace" }}>
            {new Date(activity.date + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </div>
          <div className="flex items-center gap-2">
            {activity.status === "selesai"
              ? <GhostBtn onClick={() => onToggleStatus(activity.id, "rencana")} style={{ padding: "5px 10px", fontSize: 12 }}>Tandai belum selesai</GhostBtn>
              : <PrimaryBtn onClick={() => onToggleStatus(activity.id, "selesai")} style={{ padding: "5px 10px", fontSize: 12 }}><Check size={13} />Tandai selesai</PrimaryBtn>}
          </div>
        </div>

        {member && (
          <div className="flex items-center gap-2" style={{ fontSize: 13.5, color: COLORS.ink }}>
            <span style={{ background: p.bg, width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 12 }}>{member.name[0]}</span>
            <span><b>{member.name}</b> · {member.posisi}</span>
          </div>
        )}

        {activity.description && <p style={{ fontSize: 14, color: COLORS.ink, lineHeight: 1.5 }}>{activity.description}</p>}

        <div>
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 13.5, color: COLORS.ink, display: "flex", alignItems: "center", gap: 6 }}><ImageIcon size={15} /> Dokumentasi ({activity.photos?.length || 0})</span>
            <label style={{ cursor: "pointer" }}>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
              <span style={{ fontSize: 12.5, color: COLORS.teal, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>{uploading ? "Mengunggah…" : <><Upload size={13} />Unggah foto</>}</span>
            </label>
          </div>
          {activity.photos?.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {activity.photos.map((ph) => (
                <div key={ph.id} style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: `4px solid #fff`, boxShadow: "0 2px 6px rgba(0,0,0,0.2)", transform: `rotate(${(ph.id.charCodeAt(0) % 5) - 2}deg)` }}>
                  <img src={ph.dataUrl} alt={ph.caption || activity.title} style={{ width: "100%", height: 90, objectFit: "cover", display: "block" }} />
                  <div style={{ fontSize: 9.5, color: COLORS.inkSoft, textAlign: "center", padding: "2px 0", fontFamily: "'IBM Plex Mono', monospace" }}>{ph.uploadedBy}</div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: COLORS.inkSoft, fontStyle: "italic" }}>Belum ada foto hasil kegiatan.</p>
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
        <div className="flex flex-col gap-2 pk-scroll" style={{ maxHeight: 220, overflowY: "auto" }}>
          {members.map((m) => {
            const p = posisiColor(m.posisi);
            return (
              <div key={m.id} className="flex items-center justify-between" style={{ background: "#fff", border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "8px 10px" }}>
                <div className="flex items-center gap-2">
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: p.bg, display: "inline-block" }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: COLORS.ink }}>{m.name}</div>
                    <div style={{ fontSize: 11.5, color: COLORS.inkSoft, display: "flex", alignItems: "center", gap: 4, fontFamily: "'IBM Plex Mono', monospace" }}><Phone size={11} />{m.phone} · {m.posisi}</div>
                  </div>
                </div>
                <IconBtn onClick={() => onRemove(m.id)}><Trash2 size={15} color="#B4544A" /></IconBtn>
              </div>
            );
          })}
          {members.length === 0 && <p style={{ fontSize: 13, color: COLORS.inkSoft }}>Belum ada anggota.</p>}
        </div>
        <div style={{ borderTop: `1.5px solid ${COLORS.line}`, paddingTop: 14 }} className="flex flex-col gap-2">
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 13.5 }}>Tambah Anggota</span>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Nama"><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="No. WhatsApp"><input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="62812..." /></Field>
          </div>
          <Field label="Posisi"><select style={inputStyle} value={posisi} onChange={(e) => setPosisi(e.target.value)}><option value="RGE">RGE (eksekutor kegiatan &amp; dokumentasi)</option><option value="CSE">CSE (eksekutor kegiatan di outlet/toko)</option><option value="RSE">RSE (eksekutor kegiatan di outlet/toko)</option><option value="BSM">BSM (Manager / pimpinan branch)</option></select></Field>
          <PrimaryBtn disabled={!name.trim() || !phone.trim()} onClick={() => { onAdd({ name: name.trim(), phone: phone.trim(), posisi }); setName(""); setPhone(""); setPosisi("RGE"); }}><Plus size={15} />Tambah</PrimaryBtn>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Summary charts: by activity type & by member/posisi ----------
function SummaryCharts({ activities, members, cursor }) {
  const monthPrefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
  const monthActs = activities.filter((a) => a.date.startsWith(monthPrefix));

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
      name: m.name.split(" ")[0],
      fullName: m.name,
      Rencana: mine.filter((a) => a.status !== "selesai").length,
      Selesai: mine.filter((a) => a.status === "selesai").length,
      total: mine.length,
    };
  });
  const inactiveMembers = byMember.filter((m) => m.total === 0);

  const chartWrap = { background: "#FFFDF8", border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: "14px 14px 6px" };
  const chartTitle = { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 13.5, color: COLORS.ink, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 };

  return (
    <div style={{ borderTop: `1.5px dashed ${COLORS.line}`, paddingTop: 16 }}>
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 size={17} color={COLORS.ink} />
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, color: COLORS.ink }}>
          Ringkasan Kegiatan — {BULAN[cursor.m]} {cursor.y}
        </h3>
      </div>

      {monthActs.length === 0 ? (
        <p style={{ fontSize: 13, color: COLORS.inkSoft, fontStyle: "italic" }}>Belum ada kegiatan tercatat pada bulan ini.</p>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div style={chartWrap}>
            <div style={chartTitle}>Berdasarkan Jenis Kegiatan</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={typeData} margin={{ left: -18, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: COLORS.inkSoft }} interval={0} angle={-15} textAnchor="end" height={40} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10.5, fill: COLORS.inkSoft }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.line}` }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Rencana" fill={STATUS_COLORS.rencana} radius={[4, 4, 0, 0]} />
                <Bar dataKey="Selesai" fill={STATUS_COLORS.selesai} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={chartWrap}>
            <div style={chartTitle}>Keaktifan per Anggota (Posisi)</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byMember} margin={{ left: -18, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: COLORS.inkSoft }} interval={0} angle={-15} textAnchor="end" height={40} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10.5, fill: COLORS.inkSoft }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.line}` }} labelFormatter={(_, p) => p?.[0]?.payload?.fullName || ""} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Rencana" stackId="a" fill={STATUS_COLORS.rencana} radius={[0, 0, 0, 0]} />
                <Bar dataKey="Selesai" stackId="a" fill={STATUS_COLORS.selesai} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {inactiveMembers.length > 0 && (
        <div style={{ marginTop: 10, background: "#FBEAE8", border: `1px solid ${STATUS_COLORS.rencana}55`, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: COLORS.ink, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <StatusMarker status="rencana" size={12} />
          <span><b>Belum ada kegiatan bulan ini:</b> {inactiveMembers.map((m) => m.fullName).join(", ")}</span>
        </div>
      )}
    </div>
  );
}

// ---------- WhatsApp Simulator Modal ----------
function WhatsAppSimModal({ members, activities, onClose, onNewSchedule, onUploadResult }) {
  const [tab, setTab] = useState("jadwal");
  const [senderId, setSenderId] = useState(members[0]?.id || "");
  const [date, setDate] = useState(todayKey());
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
    onNewSchedule({ id: uid(), date, title: title.trim(), description, jenisKegiatan, assignedMemberId: senderId, status: "rencana", createdVia: "whatsapp", photos: [] });
    setSending(false);
    setTitle(""); setDescription("");
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
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer",
            background: tab === k ? COLORS.teal : "transparent", color: tab === k ? "#fff" : COLORS.inkSoft,
            fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 13,
          }}>{label}</button>
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
            <Field label="Tanggal kegiatan"><input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Judul kegiatan"><input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Contoh: Kunjungan lapangan" /></Field>
            <Field label="Jenis kegiatan">
              <input style={inputStyle} list="jenis-list-sim" value={jenisKegiatan} onChange={(e) => setJenisKegiatan(e.target.value)} />
              <datalist id="jenis-list-sim">{JENIS_KEGIATAN_OPSI.map((j) => <option key={j} value={j} />)}</datalist>
            </Field>
            <Field label="Catatan (opsional)"><textarea style={{ ...inputStyle, minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <div style={{ background: "#DDF3EC", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: COLORS.tealDark, fontFamily: "'IBM Plex Mono', monospace" }}>
              Pesan terbaca: "JADWAL {date} — {title || "…"}" dari {sender?.name}
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
              <label style={{ border: `1.5px dashed ${COLORS.line}`, borderRadius: 8, padding: 14, textAlign: "center", cursor: "pointer", color: COLORS.inkSoft, fontSize: 13 }}>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
                {preview ? <img src={preview} alt="preview" style={{ maxHeight: 120, margin: "0 auto", borderRadius: 6 }} /> : <>Tap untuk pilih foto</>}
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
