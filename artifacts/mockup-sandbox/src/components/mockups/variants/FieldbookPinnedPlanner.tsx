import React, { useMemo, useState } from "react";
import {
  Archive,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Feather,
  FileText,
  MapPin,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Search,
  Sparkles,
  SunMedium,
  X,
} from "lucide-react";

type Note = {
  id: number;
  title: string;
  detail: string;
  time: string;
  place: string;
  label: string;
  color: string;
  rotation: string;
  done: boolean;
  pinned: boolean;
  attachment?: string;
};

const week = [
  { day: "MON", date: "15", weather: "mist" },
  { day: "TUE", date: "16", weather: "sun" },
  { day: "WED", date: "17", weather: "cloud" },
  { day: "THU", date: "18", weather: "sun", today: true },
  { day: "FRI", date: "19", weather: "sun" },
  { day: "SAT", date: "20", weather: "wind" },
  { day: "SUN", date: "21", weather: "cloud" },
];

const initialNotes: Note[] = [
  {
    id: 1,
    title: "North orchard irrigation",
    detail: "Listen for the pressure change at the old valve before opening the east line.",
    time: "08:30",
    place: "North block",
    label: "priority",
    color: "#b65f4c",
    rotation: "-1.2deg",
    done: false,
    pinned: true,
    attachment: "valve-map.pdf",
  },
  {
    id: 2,
    title: "Young plum row",
    detail: "Look for fresh leaf curl. Mark trees that need a second pass.",
    time: "10:15",
    place: "East orchard",
    label: "trees",
    color: "#507969",
    rotation: "0.8deg",
    done: false,
    pinned: true,
  },
  {
    id: 3,
    title: "Lower fence line",
    detail: "Brambles are leaning into the south gate. Take the long-handled loppers.",
    time: "13:00",
    place: "South boundary",
    label: "property",
    color: "#9a7549",
    rotation: "-0.4deg",
    done: false,
    pinned: false,
  },
  {
    id: 4,
    title: "Pasture water line",
    detail: "A quiet check after the afternoon heat settles.",
    time: "15:45",
    place: "West pasture",
    label: "water",
    color: "#667e76",
    rotation: "1.3deg",
    done: true,
    pinned: false,
  },
];

const weatherMarks: Record<string, React.ReactNode> = {
  mist: <span className="fpp-weather fpp-mist" aria-label="misty" />,
  sun: <SunMedium size={12} strokeWidth={1.8} />,
  cloud: <span className="fpp-weather fpp-cloud" aria-label="cloudy" />,
  wind: <span className="fpp-weather fpp-wind" aria-label="windy" />,
};

export function FieldbookPinnedPlanner() {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [activeDate, setActiveDate] = useState("18");
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [showArchive, setShowArchive] = useState(false);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  };

  const filteredNotes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return notes.filter((note) => {
      const matchesSearch = !normalized || `${note.title} ${note.detail} ${note.place} ${note.label}`.toLowerCase().includes(normalized);
      return matchesSearch && (showArchive || !note.done);
    });
  }, [notes, query, showArchive]);

  const toggleNote = (id: number) => {
    setNotes((current) => current.map((note) => note.id === id ? { ...note, done: !note.done } : note));
    setSelectedNote((current) => current?.id === id ? { ...current, done: !current.done } : current);
  };

  const togglePin = (id: number) => {
    setNotes((current) => current.map((note) => note.id === id ? { ...note, pinned: !note.pinned } : note));
    flash("Pin placement updated");
  };

  const createNote = () => {
    const title = newTitle.trim();
    if (!title) return;
    const created: Note = {
      id: Date.now(),
      title,
      detail: "Leave the useful detail here while it is still close.",
      time: "Open",
      place: "Add a place",
      label: "new note",
      color: "#a3614d",
      rotation: `${(Math.random() * 2 - 1).toFixed(1)}deg`,
      done: false,
      pinned: true,
    };
    setNotes((current) => [created, ...current]);
    setNewTitle("");
    setAddOpen(false);
    flash("Pinned to today’s page");
  };

  return (
    <main className="fpp-root">
      <style>{`
        .fpp-root {
          --ink: #31443b;
          --muted: #819087;
          --paper: #f8f3e8;
          --paper-deep: #eee6d6;
          --desk: #d9d2c2;
          --green: #3e6958;
          --red: #b65f4c;
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
          color: var(--ink);
          background: #d8d1c0;
          font-family: "DM Sans", "Avenir Next", sans-serif;
        }
        .fpp-root::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: .3;
          background-image: radial-gradient(#8a9588 .7px, transparent .7px);
          background-size: 11px 11px;
          mask-image: linear-gradient(to bottom, black 0%, transparent 92%);
        }
        .fpp-scroll {
          position: relative;
          height: 100%;
          overflow-y: auto;
          padding-bottom: 92px;
          scrollbar-width: none;
        }
        .fpp-scroll::-webkit-scrollbar { display: none; }
        .fpp-display { font-family: Georgia, "Times New Roman", serif; }
        .fpp-mono { font-family: "Space Mono", "SFMono-Regular", monospace; }
        .fpp-sheet {
          position: relative;
          min-height: 100%;
          background:
            linear-gradient(90deg, rgba(93,73,49,.045) 1px, transparent 1px) 0 0 / 17px 17px,
            #f2ecdf;
          box-shadow: 0 0 0 1px rgba(103,85,61,.08), -9px 0 24px rgba(74,62,42,.08);
        }
        .fpp-weather {
          display: inline-block;
          position: relative;
          width: 13px;
          height: 12px;
          color: #7e9182;
        }
        .fpp-mist::before, .fpp-mist::after {
          content: ""; position: absolute; left: 1px; width: 11px; height: 1px;
          background: #8d9a8c; transform: rotate(-4deg);
        }
        .fpp-mist::before { top: 3px; }
        .fpp-mist::after { top: 8px; left: 3px; width: 8px; }
        .fpp-cloud::before {
          content: ""; position: absolute; left: 1px; top: 4px; width: 11px; height: 6px;
          border: 1px solid #819287; border-radius: 6px 6px 3px 3px;
        }
        .fpp-cloud::after {
          content: ""; position: absolute; left: 4px; top: 2px; width: 5px; height: 5px;
          border: 1px solid #819287; border-bottom: 0; border-radius: 50%;
        }
        .fpp-wind::before, .fpp-wind::after {
          content: ""; position: absolute; left: 1px; height: 1px; background: #829386; transform: rotate(-8deg);
        }
        .fpp-wind::before { top: 4px; width: 11px; }
        .fpp-wind::after { top: 8px; width: 7px; left: 4px; }
        .fpp-card {
          position: relative;
          border: 1px solid rgba(142,126,99,.38);
          background: var(--paper);
          box-shadow: 2px 4px 0 rgba(118,91,59,.06), 0 8px 17px rgba(73,61,44,.08);
          transition: transform .18s ease, opacity .18s ease;
        }
        .fpp-card:hover { transform: translateY(-2px) rotate(0deg); }
        .fpp-card::after {
          content: "";
          position: absolute;
          right: 10px;
          bottom: 8px;
          width: 34px;
          height: 1px;
          background: rgba(89,112,97,.25);
          transform: rotate(-7deg);
        }
        .fpp-pencil-line {
          display: inline-block;
          width: 25px;
          height: 1px;
          background: currentColor;
          opacity: .65;
          transform: rotate(-7deg);
        }
        .fpp-tack {
          position: absolute;
          top: -8px;
          left: 18px;
          width: 15px;
          height: 15px;
          border-radius: 50%;
          border: 1px solid rgba(102,65,47,.35);
          background: #bd7058;
          box-shadow: 1px 2px 2px rgba(73,52,39,.25), inset 2px 2px 2px rgba(255,240,224,.25);
          z-index: 2;
        }
        .fpp-tack::after {
          content: "";
          position: absolute;
          top: 11px;
          left: 6px;
          width: 3px;
          height: 7px;
          background: #876250;
          transform: rotate(16deg);
          transform-origin: top;
        }
        .fpp-bottom-nav {
          position: absolute;
          z-index: 20;
          right: 0;
          bottom: 0;
          left: 0;
          border-top: 1px solid rgba(133,112,84,.28);
          background: rgba(239,233,220,.95);
          backdrop-filter: blur(9px);
        }
        @keyframes fpp-rise {
          from { opacity: 0; transform: translateY(7px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fpp-stagger { animation: fpp-rise .38s ease both; }
        .fpp-stagger-2 { animation-delay: .06s; }
        .fpp-stagger-3 { animation-delay: .12s; }
        .fpp-stagger-4 { animation-delay: .18s; }
      `}</style>

      <div className="fpp-scroll">
        <div className="fpp-sheet">
          <header className="px-5 pb-4 pt-5">
            <div className="mb-5 flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-[#3e6958] text-[#f7f0e4] shadow-[2px_3px_0_rgba(52,75,59,.13)]">
                  <Feather size={17} strokeWidth={1.8} />
                </div>
                <div>
                  <p className="fpp-mono text-[9px] font-bold uppercase tracking-[0.2em] text-[#788a7f]">Oakhaven / fieldbook</p>
                  <p className="fpp-mono mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#3b5548]">desk spread no. 04</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" aria-label={searchOpen ? "Close search" : "Search notes"} onClick={() => { setSearchOpen((open) => !open); if (searchOpen) setQuery(""); }} className={`flex h-9 w-9 items-center justify-center rounded-full border ${searchOpen ? "border-[#3e6958] bg-[#e2eadf] text-[#3e6958]" : "border-[#d2c6b3] bg-[#f8f3e8] text-[#728379]"}`}>
                  <Search size={15} />
                </button>
                <button type="button" aria-label="Open planner options" onClick={() => flash("Page options are ready")} className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d2c6b3] bg-[#f8f3e8] text-[#728379]">
                  <MoreHorizontal size={17} />
                </button>
              </div>
            </div>

            {searchOpen && (
              <div className="mb-4 flex items-center gap-2 rounded-[12px] border border-[#cabfac] bg-[#fbf7ed] px-3 py-2">
                <Search size={14} className="text-[#7d8e82]" />
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a pinned note" className="min-w-0 flex-1 bg-transparent text-[12px] text-[#31443b] outline-none placeholder:text-[#9aa497]" />
                {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} className="text-[#7d8e82]" /></button>}
              </div>
            )}

            <div className="flex items-end justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[#7e9183]">
                  <Pencil size={14} strokeWidth={1.8} />
                  <p className="fpp-mono text-[9px] font-bold uppercase tracking-[0.16em]">Thursday · 18 September</p>
                </div>
                <h1 className="fpp-display text-[38px] leading-[.91] tracking-[-0.055em] text-[#31443b]">
                  Keep the useful<br /><em className="text-[#b65f4c]">bits close.</em>
                </h1>
              </div>
              <div className="mb-1 text-right">
                <p className="fpp-mono text-[24px] font-bold leading-none text-[#3e6958]">{String(notes.filter((note) => !note.done).length).padStart(2, "0")}</p>
                <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[#849287]">to tend</p>
              </div>
            </div>
          </header>

          <section className="border-y border-[#d3c8b5] bg-[#e8e1d2] px-5 py-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="fpp-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#7d8b80]">September / week 38</p>
              <button type="button" onClick={() => flash("Week picker opened")} className="fpp-mono flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#b65f4c]">this week <ChevronRight size={12} /></button>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {week.map((item) => (
                <button key={item.date} type="button" onClick={() => { setActiveDate(item.date); flash(item.today ? "Today’s page" : `September ${item.date} selected`); }} className={`relative flex h-[70px] min-w-[47px] flex-1 flex-col items-center justify-center rounded-[8px] border transition-colors ${activeDate === item.date ? "border-[#3e6958] bg-[#3e6958] text-[#f8f2e7] shadow-[2px_3px_0_rgba(56,82,66,.16)]" : "border-[#d1c5b2] bg-[#f4eee1] text-[#75877b] hover:bg-[#fbf7ed]"}`}>
                  <span className="fpp-mono text-[8px] font-bold tracking-[0.12em] opacity-75">{item.day}</span>
                  <span className="fpp-display mt-1 text-[24px] leading-none">{item.date}</span>
                  <span className={`mt-1 ${activeDate === item.date ? "text-[#d9bba2]" : "text-[#849588]"}`}>{weatherMarks[item.weather]}</span>
                  {item.today && <span className={`absolute bottom-1 h-1 w-1 rounded-full ${activeDate === item.date ? "bg-[#d39a7e]" : "bg-[#b65f4c]"}`} />}
                </button>
              ))}
            </div>
          </section>

          <section className="px-5 pb-3 pt-4">
            <div className="fpp-card flex items-center justify-between rounded-[4px] px-4 py-3" style={{ transform: "rotate(-.45deg)" }}>
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#e0e9dd] text-[#4e7766]"><MapPin size={15} /></div>
                <div className="min-w-0">
                  <p className="fpp-mono text-[8px] font-bold uppercase tracking-[0.17em] text-[#89968b]">Today’s route</p>
                  <p className="fpp-display truncate text-[18px] leading-none text-[#31443b]">North block <span className="px-1 text-[#b65f4c]">→</span> West pasture</p>
                </div>
              </div>
              <button type="button" aria-label="Open route notes" onClick={() => flash("Route card opened")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#b65f4c] hover:bg-[#f1e6d8]"><ChevronRight size={17} /></button>
            </div>
          </section>

          <section className="px-5 pb-6 pt-1">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <div className="flex items-center gap-2 text-[#3e6958]"><Pin size={14} fill="currentColor" /><h2 className="fpp-mono text-[11px] font-bold uppercase tracking-[0.18em]">Pinned notes</h2></div>
                <p className="fpp-display mt-1 text-[18px] italic text-[#758579]">the things worth carrying</p>
              </div>
              <button type="button" onClick={() => { setShowArchive((show) => !show); flash(showArchive ? "Open notes only" : "Showing completed notes"); }} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.08em] ${showArchive ? "border-[#3e6958] bg-[#e3eadf] text-[#3e6958]" : "border-[#d2c6b3] bg-[#f8f3e8] text-[#7b897e]"}`}>
                <Archive size={12} /> {showArchive ? "Open" : "Archive"}
              </button>
            </div>

            {filteredNotes.length === 0 ? (
              <div className="rounded-[5px] border border-dashed border-[#c2bfad] bg-[#f8f3e8] px-6 py-10 text-center">
                <Pencil size={22} className="mx-auto mb-3 text-[#7e9585]" />
                <p className="fpp-display text-[21px] text-[#31443b]">A clean patch of paper.</p>
                <p className="mx-auto mt-2 max-w-[240px] text-[12px] leading-5 text-[#7f8d82]">Nothing matches this page yet. Write down the next useful thing.</p>
                <button type="button" onClick={() => setAddOpen(true)} className="mt-4 text-[10px] font-bold uppercase tracking-[0.13em] text-[#b65f4c]">Add a note</button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredNotes.map((note, index) => (
                  <article key={note.id} className={`fpp-card fpp-stagger ${index > 3 ? "" : `fpp-stagger-${index + 1}`} rounded-[4px] px-4 pb-3.5 pt-4 ${note.done ? "opacity-65" : ""}`} style={{ transform: `rotate(${note.rotation})` }}>
                    {note.pinned && <span className="fpp-tack" aria-hidden="true" />}
                    <div className="flex items-start gap-3">
                      <button type="button" aria-label={note.done ? `Reopen ${note.title}` : `Complete ${note.title}`} onClick={() => toggleNote(note.id)} className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] border-2 transition-colors ${note.done ? "border-[#3e6958] bg-[#3e6958] text-[#f7f0e3]" : "border-[#a5b3a5] text-transparent hover:border-[#3e6958]"}`}><Check size={13} strokeWidth={3} /></button>
                      <button type="button" onClick={() => setSelectedNote(note)} className="min-w-0 flex-1 text-left">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-[14px] font-bold leading-[1.2] text-[#31443b] ${note.done ? "line-through decoration-[#809285]" : ""}`}>{note.title}</p>
                          <span className="fpp-mono mt-0.5 shrink-0 rounded-[2px] px-1.5 py-1 text-[8px] font-bold uppercase tracking-[0.08em]" style={{ color: note.color, backgroundColor: `${note.color}18` }}>{note.label}</span>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-[1.4] text-[#78887c]">{note.detail}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[#859287]">
                          <span className="flex items-center gap-1 text-[9px]"><MapPin size={11} />{note.place}</span>
                          <span className="flex items-center gap-1 text-[9px]"><Clock3 size={11} />{note.time}</span>
                          {note.attachment && <span className="flex items-center gap-1 text-[9px]"><Paperclip size={11} />1 file</span>}
                        </div>
                      </button>
                      <button type="button" aria-label={note.pinned ? `Unpin ${note.title}` : `Pin ${note.title}`} onClick={() => togglePin(note.id)} className={`mt-0.5 ${note.pinned ? "text-[#b65f4c]" : "text-[#b3b7aa]"}`}><Pin size={14} fill={note.pinned ? "currentColor" : "none"} /></button>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div className="mt-6 flex items-center gap-2 px-1 text-[#829087]">
              <span className="fpp-pencil-line" />
              <p className="fpp-display text-[14px] italic">small steps still count</p>
              <span className="fpp-pencil-line" />
              <Sparkles size={13} className="text-[#b65f4c]" />
            </div>
          </section>
        </div>
      </div>

      <nav className="fpp-bottom-nav px-5 pb-4 pt-3">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => { setActiveDate("18"); flash("Back to today"); }} className={`flex min-w-[56px] flex-col items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] ${activeDate === "18" ? "text-[#3e6958]" : "text-[#8a948a]"}`}><SunMedium size={18} strokeWidth={activeDate === "18" ? 2.3 : 1.7} />Today</button>
          <button type="button" onClick={() => flash("All field notes opened")} className="flex min-w-[56px] flex-col items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a948a]"><FileText size={18} strokeWidth={1.7} />Notes</button>
          <button type="button" aria-label="Add a new pinned note" onClick={() => setAddOpen(true)} className="flex h-12 w-12 -translate-y-4 items-center justify-center rounded-[5px] bg-[#b65f4c] text-[#fff6e8] shadow-[3px_5px_0_rgba(118,70,54,.16)] transition-transform hover:-translate-y-[18px]"><Plus size={22} /></button>
          <button type="button" onClick={() => flash("Calendar view opened")} className="flex min-w-[56px] flex-col items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a948a]"><CalendarDays size={18} strokeWidth={1.7} />Calendar</button>
          <button type="button" onClick={() => flash("Planner settings opened")} className="flex min-w-[56px] flex-col items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a948a]"><MoreHorizontal size={18} strokeWidth={1.7} />More</button>
        </div>
      </nav>

      {notice && <div className="absolute bottom-[82px] left-1/2 z-30 -translate-x-1/2 rounded-[3px] bg-[#31443b] px-4 py-2 text-[11px] font-bold text-[#f7f0e3] shadow-[2px_3px_0_rgba(49,68,59,.15)]">{notice}</div>}

      {selectedNote && (
        <div className="absolute inset-0 z-40 flex items-end bg-[#2b3c33]/35">
          <div className="w-full border-t border-[#d2c6b3] bg-[#f8f3e8] px-5 pb-8 pt-5 shadow-[0_-12px_35px_rgba(58,53,41,.18)]">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="fpp-mono mb-2 text-[9px] font-bold uppercase tracking-[0.18em] text-[#7f9184]">Pinned / field note</p>
                <h2 className="fpp-display max-w-[300px] text-[27px] leading-[1.02] text-[#31443b]">{selectedNote.title}</h2>
              </div>
              <button type="button" aria-label="Close note details" onClick={() => setSelectedNote(null)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eee6d7] text-[#6f8175]"><X size={17} /></button>
            </div>
            <p className="mb-5 text-[12px] leading-5 text-[#6d7d73]">{selectedNote.detail}</p>
            <div className="mb-5 grid grid-cols-3 gap-2">
              {[
                { icon: MapPin, label: "Place", value: selectedNote.place },
                { icon: Clock3, label: "Start", value: selectedNote.time },
                { icon: Pin, label: "Pin", value: selectedNote.pinned ? "On page" : "Loose" },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-[4px] bg-[#eee6d7] px-3 py-2">
                  <Icon size={13} className="mb-1 text-[#b65f4c]" />
                  <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#879388]">{label}</p>
                  <p className="mt-0.5 truncate text-[11px] font-bold text-[#31443b]">{value}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { toggleNote(selectedNote.id); setSelectedNote(null); }} className="flex flex-1 items-center justify-center gap-2 rounded-[4px] bg-[#3e6958] py-3 text-[12px] font-bold text-[#f7f0e3]"><Check size={15} />{selectedNote.done ? "Reopen note" : "Mark complete"}</button>
              <button type="button" aria-label="Edit note" onClick={() => { setSelectedNote(null); flash("Pencil mode is ready"); }} className="flex h-11 w-11 items-center justify-center rounded-[4px] border border-[#d2c6b3] text-[#3e6958]"><Pencil size={17} /></button>
              <button type="button" aria-label="More note actions" onClick={() => { setSelectedNote(null); flash("More note actions"); }} className="flex h-11 w-11 items-center justify-center rounded-[4px] border border-[#d2c6b3] text-[#7b897e]"><MoreHorizontal size={17} /></button>
            </div>
          </div>
        </div>
      )}

      {addOpen && (
        <div className="absolute inset-0 z-40 flex items-end bg-[#2b3c33]/35">
          <div className="w-full border-t border-[#d2c6b3] bg-[#f8f3e8] px-5 pb-8 pt-5 shadow-[0_-12px_35px_rgba(58,53,41,.18)]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="fpp-mono mb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-[#7f9184]">Loose leaf / new pin</p>
                <h2 className="fpp-display text-[27px] leading-none text-[#31443b]">What belongs here?</h2>
              </div>
              <button type="button" aria-label="Close add note" onClick={() => setAddOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eee6d7] text-[#6f8175]"><X size={17} /></button>
            </div>
            <input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createNote(); }} placeholder="e.g. Restock the wash station" className="mb-3 w-full rounded-[4px] border border-[#d2c6b3] bg-[#eee6d7] px-4 py-3 text-[14px] text-[#31443b] outline-none placeholder:text-[#9ba195] focus:border-[#3e6958]" />
            <p className="mb-4 text-[11px] leading-5 text-[#849187]">It will pin itself to today’s page. Add the place and time from its note later.</p>
            <button type="button" disabled={!newTitle.trim()} onClick={createNote} className="flex w-full items-center justify-center gap-2 rounded-[4px] bg-[#b65f4c] py-3 text-[12px] font-bold text-[#fff7e9] disabled:cursor-not-allowed disabled:opacity-40"><Pin size={15} fill="currentColor" />Pin to page</button>
          </div>
        </div>
      )}
    </main>
  );
}