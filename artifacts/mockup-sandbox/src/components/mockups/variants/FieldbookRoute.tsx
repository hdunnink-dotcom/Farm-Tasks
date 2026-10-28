import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Leaf,
  MapPin,
  Plus,
  Route,
  Sun,
  X,
} from "lucide-react";

type Part = "Dawn" | "Midday" | "Late light";
type Priority = "Critical" | "Keep close" | "Steady" | "If time";

type RouteTask = {
  id: number;
  time: string;
  end: string;
  part: Part;
  title: string;
  place: string;
  detail: string;
  priority: Priority;
  done: boolean;
  stop: string;
};

const initialRoute: RouteTask[] = [
  {
    id: 1,
    time: "06:40",
    end: "07:10",
    part: "Dawn",
    title: "Open the north orchard",
    place: "North block · gate 02",
    detail: "Walk the irrigation line before the pumps warm up.",
    priority: "Critical",
    done: false,
    stop: "01",
  },
  {
    id: 2,
    time: "07:25",
    end: "08:05",
    part: "Dawn",
    title: "Check plum row pressure",
    place: "East orchard · row 4",
    detail: "Listen for the soft split in the second valve.",
    priority: "Keep close",
    done: false,
    stop: "02",
  },
  {
    id: 3,
    time: "11:30",
    end: "12:00",
    part: "Midday",
    title: "Top-dress young trees",
    place: "East orchard · young stock",
    detail: "Four trees marked with blue tape.",
    priority: "Steady",
    done: false,
    stop: "03",
  },
  {
    id: 4,
    time: "15:45",
    end: "16:15",
    part: "Late light",
    title: "Walk the west water line",
    place: "West pasture · lower trough",
    detail: "Leave the final reading in the field note.",
    priority: "If time",
    done: true,
    stop: "04",
  },
];

const priorityTone: Record<Priority, { text: string; bg: string }> = {
  Critical: { text: "#bd5c42", bg: "#f6e1d6" },
  "Keep close": { text: "#a16e35", bg: "#f3ead3" },
  Steady: { text: "#3e7567", bg: "#dfebe2" },
  "If time": { text: "#78867b", bg: "#e9ece3" },
};

const parts: Part[] = ["Dawn", "Midday", "Late light"];

export function FieldbookRoute() {
  const [route, setRoute] = useState(initialRoute);
  const [activePart, setActivePart] = useState<Part | "All">("All");
  const [selected, setSelected] = useState<RouteTask | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [notice, setNotice] = useState("");

  const openCount = route.filter((item) => !item.done).length;
  const completedCount = route.length - openCount;
  const visibleRoute = useMemo(
    () => activePart === "All" ? route : route.filter((item) => item.part === activePart),
    [activePart, route],
  );

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  };

  const toggle = (id: number) => {
    setRoute((current) => current.map((item) => item.id === id ? { ...item, done: !item.done } : item));
    setSelected((current) => current?.id === id ? { ...current, done: !current.done } : current);
  };

  const addStop = () => {
    const title = newTitle.trim();
    if (!title) return;
    const created: RouteTask = {
      id: Date.now(),
      time: "NEW",
      end: "—",
      part: "Late light",
      title,
      place: "Choose a field block",
      detail: "Add a location when the route is confirmed.",
      priority: "Steady",
      done: false,
      stop: String(route.length + 1).padStart(2, "0"),
    };
    setRoute((current) => [...current, created]);
    setNewTitle("");
    setAdding(false);
    flash("Stop added to the route");
  };

  return (
    <main
      className="relative h-full w-full overflow-hidden"
      style={{
        background: "#f3efe6",
        color: "#263b35",
        fontFamily: "'DM Sans', 'Avenir Next', sans-serif",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage: "radial-gradient(#849186 0.65px, transparent 0.65px)",
          backgroundSize: "12px 12px",
          maskImage: "linear-gradient(to bottom, black, transparent 82%)",
        }}
      />

      <div className="relative h-full overflow-y-auto pb-24">
        <header className="border-b border-[#d9d1c3] px-5 pb-4 pt-5">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#2f6656] text-[#f5efdf]">
                <Leaf size={16} strokeWidth={2.2} />
              </div>
              <div>
                <p className="font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-[#708177]">Oakhaven</p>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#263b35]">route / 04</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => flash("Route settings are ready")}
              aria-label="Open route settings"
              className="rounded-full border border-[#d6cebf] bg-[#faf6ec] p-2 text-[#71857a] transition-transform hover:-translate-y-0.5"
            >
              <Route size={16} />
            </button>
          </div>

          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[#718278]">
                <Sun size={14} />
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">Thursday · 18 Sep</span>
              </div>
              <h1 className="font-serif text-[32px] leading-[0.94] tracking-[-0.045em] text-[#263b35]">
                The day,<br /><em className="text-[#bd6c49]">in order.</em>
              </h1>
            </div>
            <div className="mb-0.5 text-right">
              <p className="font-mono text-[27px] font-bold leading-none text-[#2f6656]">{String(openCount).padStart(2, "0")}</p>
              <p className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#819086]">stops left</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-[14px] border border-[#d8d0c0] bg-[#faf6ec]">
            <div className="px-3 py-2.5">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#8a958b]">Route</p>
              <p className="mt-1 text-[12px] font-bold text-[#2f6656]">North → West</p>
            </div>
            <div className="border-x border-[#e0d8c9] px-3 py-2.5">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#8a958b]">Window</p>
              <p className="mt-1 text-[12px] font-bold text-[#263b35]">06:40–16:15</p>
            </div>
            <button type="button" onClick={() => setActivePart("All")} className="px-3 py-2.5 text-left transition-colors hover:bg-[#f2ecdf]">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#8a958b]">Done</p>
              <p className="mt-1 text-[12px] font-bold text-[#bd6c49]">{completedCount} of {route.length}</p>
            </button>
          </div>
        </header>

        <section className="px-5 pb-3 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardCheck size={15} className="text-[#2f6656]" />
              <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[#52695e]">Field rounds</h2>
            </div>
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#91998e]">in sequence</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {(["All", ...parts] as const).map((part) => (
              <button
                type="button"
                key={part}
                onClick={() => setActivePart(part)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[10px] font-bold transition-colors ${activePart === part ? "border-[#2f6656] bg-[#2f6656] text-[#f6efdf]" : "border-[#d4ccbd] bg-[#faf6ec] text-[#75847a] hover:border-[#9cac9c]"}`}
              >
                {part}
              </button>
            ))}
          </div>
        </section>

        <section className="relative px-5">
          <div className="absolute bottom-7 left-[68px] top-2 w-px bg-[#d6cdbc]" />
          <div className="space-y-4">
            {visibleRoute.map((task, index) => {
              const tone = priorityTone[task.priority];
              const previous = visibleRoute[index - 1];
              const showPart = !previous || previous.part !== task.part;
              return (
                <div key={task.id}>
                  {showPart && (
                    <div className="relative mb-2 flex items-center gap-3 pl-[49px]">
                      <span className="bg-[#f3efe6] pr-1 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-[#8b9589]">{task.part}</span>
                      <span className="h-px flex-1 bg-[#dfd7c8]" />
                    </div>
                  )}
                  <article className="relative grid grid-cols-[44px_1fr] gap-3">
                    <div className="pt-1 text-right">
                      <p className={`font-mono text-[11px] font-bold ${task.done ? "text-[#9aa39a]" : "text-[#2f6656]"}`}>{task.time}</p>
                      <p className="mt-0.5 font-mono text-[9px] text-[#9aa39a]">{task.end}</p>
                    </div>
                    <span className={`absolute left-[38px] top-1.5 z-10 h-[13px] w-[13px] rounded-full border-[3px] border-[#f3efe6] ${task.done ? "bg-[#7c9b86]" : "bg-[#bd6c49]"}`} />
                    <div className={`rounded-[16px] border bg-[#faf7ef] p-3.5 shadow-[0_5px_16px_rgba(69,73,56,0.045)] ${task.done ? "border-[#c5d2c5] opacity-70" : "border-[#d9d1c1]"}`}>
                      <div className="flex items-start justify-between gap-2.5">
                        <button type="button" onClick={() => setSelected(task)} className="min-w-0 text-left">
                          <p className={`text-[13px] font-bold leading-[1.3] text-[#263b35] ${task.done ? "line-through decoration-[#87988c]" : ""}`}>{task.title}</p>
                          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-[#7e8b80]"><MapPin size={11} />{task.place}</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggle(task.id)}
                          aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`}
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border-2 transition-colors ${task.done ? "border-[#2f6656] bg-[#2f6656] text-[#f5efdf]" : "border-[#b0b9ad] text-transparent hover:border-[#2f6656]"}`}
                        >
                          <Check size={13} strokeWidth={3} />
                        </button>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-[#e8e1d4] pt-2.5">
                        <span className="flex items-center gap-1 text-[10px] text-[#89948a]"><Clock3 size={11} />{task.detail}</span>
                        <span className="shrink-0 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: tone.text, background: tone.bg }}>{task.priority}</span>
                      </div>
                    </div>
                  </article>
                </div>
              );
            })}
            {visibleRoute.length === 0 && (
              <div className="rounded-[17px] border border-dashed border-[#c9cdbf] bg-[#faf6ec] px-5 py-9 text-center">
                <Leaf size={21} className="mx-auto mb-2 text-[#769180]" />
                <p className="font-serif text-[21px] text-[#263b35]">This part is clear.</p>
                <p className="mt-1 text-[11px] text-[#849087]">No field rounds are scheduled here yet.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <nav className="absolute bottom-0 left-0 right-0 z-20 border-t border-[#d7cfbf] bg-[#f3efe6]/95 px-6 pb-4 pt-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => { setActivePart("All"); flash("Showing the full route"); }} className="flex flex-col items-center gap-1 text-[#2f6656]">
            <CalendarDays size={18} />
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em]">Today</span>
          </button>
          <button type="button" onClick={() => flash("Route is already in sequence")} className="flex flex-col items-center gap-1 text-[#8a958b]">
            <Route size={18} />
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em]">Route</span>
          </button>
          <button type="button" onClick={() => setAdding(true)} aria-label="Add route stop" className="flex h-11 w-11 -translate-y-3 items-center justify-center rounded-[14px] bg-[#bd6c49] text-[#fff6e6] shadow-[0_8px_18px_rgba(126,73,49,0.2)] transition-transform hover:-translate-y-4">
            <Plus size={21} />
          </button>
          <button type="button" onClick={() => flash("Completed rounds are noted")} className="flex flex-col items-center gap-1 text-[#8a958b]">
            <ClipboardCheck size={18} />
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em]">Log</span>
          </button>
          <button type="button" onClick={() => flash("Planner settings are ready")} className="flex flex-col items-center gap-1 text-[#8a958b]">
            <ArrowDownRight size={18} />
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em]">More</span>
          </button>
        </div>
      </nav>

      {notice && <div className="absolute bottom-[77px] left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#263b35] px-4 py-2 text-[11px] font-bold text-[#f6efdf] shadow-lg">{notice}</div>}

      {selected && (
        <div className="absolute inset-0 z-40 flex items-end bg-[#263b35]/35">
          <div className="w-full rounded-t-[25px] border-t border-[#d8d0c0] bg-[#faf7ef] px-5 pb-8 pt-5 shadow-[0_-12px_35px_rgba(42,53,44,0.16)]">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#829187]">{selected.part} / stop {selected.stop}</p>
                <h2 className="max-w-[310px] font-serif text-[26px] leading-[1.05] text-[#263b35]">{selected.title}</h2>
              </div>
              <button type="button" aria-label="Close route stop" onClick={() => setSelected(null)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eee8da] text-[#718177]"><X size={16} /></button>
            </div>
            <div className="mb-5 grid grid-cols-3 gap-2">
              <div className="rounded-[12px] bg-[#f0ebdf] px-3 py-2"><Clock3 size={13} className="mb-1 text-[#bd6c49]" /><p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[#879388]">Time</p><p className="mt-0.5 text-[11px] font-bold text-[#263b35]">{selected.time}</p></div>
              <div className="rounded-[12px] bg-[#f0ebdf] px-3 py-2"><MapPin size={13} className="mb-1 text-[#bd6c49]" /><p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[#879388]">Block</p><p className="mt-0.5 truncate text-[11px] font-bold text-[#263b35]">{selected.place.split(" · ")[0]}</p></div>
              <div className="rounded-[12px] bg-[#f0ebdf] px-3 py-2"><CalendarDays size={13} className="mb-1 text-[#bd6c49]" /><p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[#879388]">Status</p><p className="mt-0.5 text-[11px] font-bold text-[#263b35]">{selected.done ? "Done" : "Open"}</p></div>
            </div>
            <p className="mb-5 text-[12px] leading-5 text-[#718177]">{selected.detail}</p>
            <button type="button" onClick={() => { toggle(selected.id); setSelected(null); }} className="flex w-full items-center justify-center gap-2 rounded-[13px] bg-[#2f6656] py-3 text-[12px] font-bold text-[#f5efdf]"><Check size={15} />{selected.done ? "Reopen stop" : "Mark stop complete"}</button>
          </div>
        </div>
      )}

      {adding && (
        <div className="absolute inset-0 z-40 flex items-end bg-[#263b35]/35">
          <div className="w-full rounded-t-[25px] border-t border-[#d8d0c0] bg-[#faf7ef] px-5 pb-8 pt-5 shadow-[0_-12px_35px_rgba(42,53,44,0.16)]">
            <div className="mb-5 flex items-center justify-between"><div><p className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#829187]">Route inbox / new stop</p><h2 className="font-serif text-[26px] leading-none text-[#263b35]">Add the next thing.</h2></div><button type="button" aria-label="Close add stop" onClick={() => setAdding(false)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eee8da] text-[#718177]"><X size={16} /></button></div>
            <input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addStop(); }} placeholder="e.g. Inspect the south gate hinge" className="mb-3 w-full rounded-[13px] border border-[#d7d0c1] bg-[#f0ebdf] px-4 py-3 text-[13px] text-[#263b35] outline-none placeholder:text-[#9ba195] focus:border-[#2f6656]" />
            <p className="mb-4 text-[11px] leading-5 text-[#849087]">New stops land in Late light until you place them on the route.</p>
            <button type="button" disabled={!newTitle.trim()} onClick={addStop} className="flex w-full items-center justify-center gap-2 rounded-[13px] bg-[#bd6c49] py-3 text-[12px] font-bold text-[#fff6e6] disabled:cursor-not-allowed disabled:opacity-40"><Plus size={16} />Add to route</button>
          </div>
        </div>
      )}
    </main>
  );
}
