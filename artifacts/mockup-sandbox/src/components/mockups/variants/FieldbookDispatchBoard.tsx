import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Compass,
  FileText,
  Filter,
  Leaf,
  MapPin,
  MoreHorizontal,
  Navigation,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

type Task = {
  id: number;
  title: string;
  note: string;
  location: string;
  time: string;
  tag: string;
  color: string;
  done: boolean;
  step: number;
};

const week = [
  { day: "MON", date: "15", tone: "quiet" },
  { day: "TUE", date: "16", tone: "quiet" },
  { day: "WED", date: "17", tone: "quiet" },
  { day: "THU", date: "18", tone: "today" },
  { day: "FRI", date: "19", tone: "quiet" },
  { day: "SAT", date: "20", tone: "quiet" },
  { day: "SUN", date: "21", tone: "quiet" },
];

const initialTasks: Task[] = [
  {
    id: 1,
    title: "Check north orchard irrigation",
    note: "Listen for the pressure change at the old valve before opening the east line.",
    location: "North block",
    time: "08:30",
    tag: "priority",
    color: "#b85f45",
    done: false,
    step: 1,
  },
  {
    id: 2,
    title: "Walk the young plum row",
    note: "Look for fresh leaf curl and mark trees that need a second pass.",
    location: "East orchard",
    time: "10:15",
    tag: "trees",
    color: "#4e7663",
    done: false,
    step: 2,
  },
  {
    id: 3,
    title: "Clear the lower fence line",
    note: "The brambles are leaning into the south gate. Take the long-handled loppers.",
    location: "South boundary",
    time: "13:00",
    tag: "property",
    color: "#9d7944",
    done: false,
    step: 3,
  },
  {
    id: 4,
    title: "Walk west pasture water line",
    note: "A quiet check after the afternoon heat settles.",
    location: "West pasture",
    time: "15:45",
    tag: "water",
    color: "#64857a",
    done: true,
    step: 4,
  },
];

export function FieldbookDispatchBoard() {
  const [tasks, setTasks] = useState(initialTasks);
  const [activeDate, setActiveDate] = useState("18");
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [routeStarted, setRouteStarted] = useState(false);
  const [notice, setNotice] = useState("");

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  };

  const visibleTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return tasks;
    return tasks.filter((task) =>
      `${task.title} ${task.location} ${task.tag}`.toLowerCase().includes(normalized),
    );
  }, [query, tasks]);

  const focusedTask = visibleTasks.find((task) => task.id === focusedId) ?? null;
  const openTasks = tasks.filter((task) => !task.done);
  const completedCount = tasks.filter((task) => task.done).length;
  const nextTask = openTasks[0] ?? tasks[0];

  const toggleTask = (id: number) => {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, done: !task.done } : task)),
    );
    flash("Route ledger updated");
  };

  const createTask = () => {
    const title = newTask.trim();
    if (!title) return;
    const created: Task = {
      id: Date.now(),
      title,
      note: "Capture the detail while it is still close.",
      location: "Add a place",
      time: "Open",
      tag: "new",
      color: "#b85f45",
      done: false,
      step: tasks.length + 1,
    };
    setTasks((current) => [...current, created]);
    setFocusedId(created.id);
    setNewTask("");
    setAddOpen(false);
    flash("New stop added to the route");
  };

  return (
    <main
      className="relative h-full w-full overflow-hidden"
      style={{
        background: "#eee9dd",
        color: "#293d35",
        fontFamily: "'DM Sans', 'Avenir Next', sans-serif",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(rgba(94,116,101,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(94,116,101,.12) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage: "linear-gradient(to bottom, black 0%, transparent 88%)",
        }}
      />

      <div className="relative h-full overflow-y-auto pb-[90px]">
        <header className="px-5 pb-3 pt-5">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#315f50] text-[#f7f1e5]">
                <Compass size={16} strokeWidth={2.1} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#788a7f]">Oakhaven</p>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#293d35]">field dispatch / 04</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={searchOpen ? "Close search" : "Search route"}
                onClick={() => {
                  setSearchOpen((current) => !current);
                  if (searchOpen) setQuery("");
                }}
                className={`flex h-9 w-9 items-center justify-center rounded-full border ${
                  searchOpen
                    ? "border-[#315f50] bg-[#e0e9df] text-[#315f50]"
                    : "border-[#d3cbbc] bg-[#f8f4e9] text-[#78887e]"
                }`}
              >
                <Search size={16} />
              </button>
              <button
                type="button"
                aria-label="Open route menu"
                onClick={() => flash("Route menu is ready")}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d3cbbc] bg-[#f8f4e9] text-[#78887e]"
              >
                <MoreHorizontal size={17} />
              </button>
            </div>
          </div>

          {searchOpen && (
            <div className="mb-4 flex items-center gap-2 rounded-[13px] border border-[#d1c8b7] bg-[#faf7ed] px-3 py-2">
              <Search size={14} className="text-[#809086]" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a stop or place"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-[#293d35] outline-none placeholder:text-[#a0a89d]"
              />
              {query && (
                <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                  <X size={14} className="text-[#809086]" />
                </button>
              )}
            </div>
          )}

          <div className="flex items-end justify-between">
            <div>
              <p className="mb-2 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.17em] text-[#788a7f]">
                <Leaf size={14} /> Thursday · 18 September
              </p>
              <h1 className="font-serif text-[37px] leading-[0.93] tracking-[-0.055em] text-[#293d35]">
                The route<br />
                <em className="text-[#b85f45]">in front of you.</em>
              </h1>
            </div>
            <div className="mb-1 text-right">
              <p className="font-mono text-[24px] font-bold leading-none text-[#315f50]">
                {String(openTasks.length).padStart(2, "0")}
              </p>
              <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[#829087]">stops left</p>
            </div>
          </div>
        </header>

        <section className="border-y border-[#d4cdbc] bg-[#e7e2d4] py-3">
          <div className="mb-2 flex items-center justify-between px-5">
            <button
              type="button"
              onClick={() => flash("Previous week")}
              aria-label="Previous week"
              className="flex h-6 w-6 items-center justify-center text-[#87938a]"
            >
              <ChevronLeft size={15} />
            </button>
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.19em] text-[#839087]">
              September / week 38
            </p>
            <button
              type="button"
              onClick={() => flash("Next week")}
              aria-label="Next week"
              className="flex h-6 w-6 items-center justify-center text-[#87938a]"
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto px-5 pb-1">
            {week.map((item) => (
              <button
                key={item.date}
                type="button"
                onClick={() => {
                  setActiveDate(item.date);
                  flash(item.date === "18" ? "Today’s dispatch" : `September ${item.date} selected`);
                }}
                className={`relative flex h-[55px] min-w-[48px] flex-1 flex-col items-center justify-center rounded-[12px] border transition-colors ${
                  activeDate === item.date
                    ? "border-[#315f50] bg-[#315f50] text-[#f8f2e6]"
                    : "border-transparent text-[#7d8b81] hover:border-[#c4cdbf] hover:bg-[#f3eee3]"
                }`}
              >
                <span className="font-mono text-[8px] font-bold tracking-[0.12em] opacity-75">{item.day}</span>
                <span className="mt-0.5 font-serif text-[23px] leading-none">{item.date}</span>
                {item.tone === "today" && (
                  <span className={`absolute bottom-1 h-1 w-1 rounded-full ${activeDate === item.date ? "bg-[#d59a76]" : "bg-[#b85f45]"}`} />
                )}
              </button>
            ))}
          </div>
        </section>

        <section className="px-5 pb-2 pt-4">
          <div className="relative overflow-hidden rounded-[18px] border border-[#cfbca4] bg-[#dce4d8] px-4 py-4">
            <div className="absolute -right-5 -top-9 h-28 w-28 rounded-full border border-[#b9cdbb] opacity-70" />
            <div className="absolute -right-1 -top-2 h-16 w-16 rounded-full border border-[#b9cdbb] opacity-70" />
            <div className="relative flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="mb-1 flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.17em] text-[#6b8272]">
                  <Navigation size={12} /> next dispatch
                </p>
                <p className="truncate font-serif text-[22px] leading-none text-[#293d35]">
                  {nextTask?.location ?? "Clear route"}
                </p>
                <p className="mt-1.5 text-[11px] text-[#6f8276]">
                  {nextTask ? `${nextTask.time} · ${nextTask.title}` : "All field stops are complete"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (nextTask) setFocusedId(nextTask.id);
                  setRouteStarted((current) => !current);
                  flash(routeStarted ? "Route paused" : "Route started");
                }}
                className={`flex h-11 shrink-0 items-center gap-1.5 rounded-[13px] px-3 text-[10px] font-bold uppercase tracking-[0.08em] ${
                  routeStarted ? "bg-[#b85f45] text-[#fff7e9]" : "bg-[#315f50] text-[#f8f2e6]"
                }`}
              >
                {routeStarted ? "Pause" : "Start"} <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </section>

        <section className="px-5 pb-6 pt-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CircleDot size={15} className="text-[#315f50]" />
              <div>
                <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[#52695d]">Route ledger</h2>
                <p className="mt-0.5 text-[10px] text-[#8a968d]">{completedCount} logged · {openTasks.length} remaining</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFilterOpen((current) => !current)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-bold ${
                filterOpen
                  ? "border-[#315f50] bg-[#e1eadd] text-[#315f50]"
                  : "border-[#d4cdbd] bg-[#f8f4e9] text-[#78877d]"
              }`}
            >
              <SlidersHorizontal size={12} /> {filterOpen ? "Open only" : "All stops"}
            </button>
          </div>

          {filterOpen && (
            <div className="mb-3 flex items-center gap-2 rounded-[12px] border border-[#d7cfbd] bg-[#f9f5ea] px-3 py-2 text-[10px] text-[#7d8b81]">
              <Filter size={13} className="text-[#b85f45]" />
              Showing the route sequence; completed stops stay visible for context.
            </div>
          )}

          <div className="relative">
            <div className="absolute bottom-5 left-[15px] top-5 w-px bg-[#c9cbbb]" />
            <div className="space-y-2.5">
              {visibleTasks.length === 0 && (
                <div className="rounded-[16px] border border-dashed border-[#c5cabd] bg-[#faf7ed] px-6 py-9 text-center">
                  <Search size={21} className="mx-auto mb-2 text-[#7e9485]" />
                  <p className="font-serif text-[20px] text-[#293d35]">Nothing on this route.</p>
                  <p className="mt-1 text-[11px] text-[#869188]">Try another place, tag, or stop name.</p>
                </div>
              )}
              {visibleTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setFocusedId(task.id)}
                  className={`relative flex w-full items-center gap-3 rounded-[16px] border p-3 text-left transition-colors ${
                    focusedTask?.id === task.id
                      ? "border-[#bfcbbd] bg-[#faf7ed] shadow-[0_4px_12px_rgba(67,79,66,0.07)]"
                      : "border-transparent bg-[#e9e4d8]/70"
                  }`}
                >
                  <span
                    className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold ${
                      task.done
                        ? "border-[#315f50] bg-[#315f50] text-[#f8f2e6]"
                        : "border-[#b7c1b2] bg-[#eee9dd] text-[#6d8476]"
                    }`}
                  >
                    {task.done ? <Check size={13} strokeWidth={3} /> : String(task.step).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className={`text-[12px] font-bold leading-[1.25] text-[#293d35] ${task.done ? "line-through decoration-[#7c9384]" : ""}`}>
                        {task.title}
                      </span>
                      <span className="font-mono text-[10px] font-bold text-[#b85f45]">{task.time}</span>
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-[10px] text-[#829087]">
                      <MapPin size={10} /> {task.location}
                    </span>
                  </span>
                  <ChevronRight size={15} className="shrink-0 text-[#a2aa9f]" />
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      <nav className="absolute bottom-0 left-0 right-0 z-20 border-t border-[#d4cdbc] bg-[#eee9dd]/95 px-5 pb-4 pt-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => { setActiveDate("18"); flash("Back to today"); }} className={`flex min-w-[64px] flex-col items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] ${activeDate === "18" ? "text-[#315f50]" : "text-[#8b968c]"}`}>
            <Navigation size={18} strokeWidth={activeDate === "18" ? 2.4 : 1.8} />Route
          </button>
          <button type="button" onClick={() => { setSearchOpen(true); flash("Search your fieldbook"); }} className="flex min-w-[64px] flex-col items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b968c]">
            <Search size={18} strokeWidth={1.8} />Find
          </button>
          <button type="button" aria-label="Add a new route stop" onClick={() => setAddOpen(true)} className="flex h-12 w-12 -translate-y-4 items-center justify-center rounded-[16px] bg-[#b85f45] text-[#fff7e9] shadow-[0_8px_18px_rgba(126,73,49,0.2)] transition-transform hover:-translate-y-[18px]">
            <Plus size={22} />
          </button>
          <button type="button" onClick={() => flash("Field notes opened")} className="flex min-w-[64px] flex-col items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b968c]">
            <FileText size={18} strokeWidth={1.8} />Notes
          </button>
          <button type="button" onClick={() => flash("Reminder preferences opened")} className="flex min-w-[64px] flex-col items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b968c]">
            <Bell size={18} strokeWidth={1.8} />Remind
          </button>
        </div>
      </nav>

      {notice && (
        <div className="absolute bottom-[82px] left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#293d35] px-4 py-2 text-[11px] font-bold text-[#f7f0e6] shadow-lg">
          {notice}
        </div>
      )}

      {focusedTask && (
        <div className="absolute inset-0 z-40 flex items-end bg-[#25362f]/35">
          <div className="w-full rounded-t-[25px] border-t border-[#d4cdbc] bg-[#faf7ed] px-5 pb-8 pt-5 shadow-[0_-12px_35px_rgba(42,53,44,0.16)]">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#7f9184]">
                  stop {String(focusedTask.step).padStart(2, "0")} / route ledger
                </p>
                <h2 className="max-w-[310px] font-serif text-[26px] leading-[1.05] text-[#293d35]">{focusedTask.title}</h2>
              </div>
              <button type="button" aria-label="Close stop details" onClick={() => setFocusedId(0)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eee8da] text-[#6f8175]">
                <X size={17} />
              </button>
            </div>
            <p className="mb-5 text-[12px] leading-5 text-[#6d7d73]">{focusedTask.note}</p>
            <div className="mb-5 grid grid-cols-3 gap-2">
              {[
                { icon: MapPin, label: "Place", value: focusedTask.location },
                { icon: Clock3, label: "Start", value: focusedTask.time },
                { icon: CircleDot, label: "Stop", value: `0${focusedTask.step}` },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-[13px] bg-[#f0ebdf] px-3 py-2">
                  <Icon size={13} className="mb-1 text-[#b85f45]" />
                  <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#879388]">{label}</p>
                  <p className="mt-0.5 truncate text-[11px] font-bold text-[#293d35]">{value}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { toggleTask(focusedTask.id); setFocusedId(0); }} className="flex flex-1 items-center justify-center gap-2 rounded-[13px] bg-[#315f50] py-3 text-[12px] font-bold text-[#f7f0e6]">
                <Check size={15} /> {focusedTask.done ? "Reopen stop" : "Log stop complete"}
              </button>
              <button type="button" onClick={() => flash("Reminder set for this stop")} aria-label="Set reminder" className="flex h-11 w-11 items-center justify-center rounded-[13px] border border-[#d7d0c1] text-[#b85f45]">
                <Bell size={17} />
              </button>
              <button type="button" onClick={() => flash("Stop actions opened")} aria-label="More stop actions" className="flex h-11 w-11 items-center justify-center rounded-[13px] border border-[#d7d0c1] text-[#7b897e]">
                <MoreHorizontal size={17} />
              </button>
            </div>
          </div>
        </div>
      )}

      {addOpen && (
        <div className="absolute inset-0 z-40 flex items-end bg-[#25362f]/35">
          <div className="w-full rounded-t-[25px] border-t border-[#d4cdbc] bg-[#faf7ed] px-5 pb-8 pt-5 shadow-[0_-12px_35px_rgba(42,53,44,0.16)]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#7f9184]">Dispatch / new stop</p>
                <h2 className="font-serif text-[27px] leading-none text-[#293d35]">What comes next?</h2>
              </div>
              <button type="button" aria-label="Close add stop" onClick={() => setAddOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eee8da] text-[#6f8175]">
                <X size={17} />
              </button>
            </div>
            <input autoFocus value={newTask} onChange={(event) => setNewTask(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createTask(); }} placeholder="e.g. Restock the wash station" className="mb-3 w-full rounded-[14px] border border-[#d6cfbf] bg-[#f0ebdf] px-4 py-3 text-[14px] text-[#293d35] outline-none placeholder:text-[#9ba195] focus:border-[#315f50]" />
            <p className="mb-4 text-[11px] leading-5 text-[#849187]">It will be added as the final stop. Add place and timing when you reach it.</p>
            <button type="button" disabled={!newTask.trim()} onClick={createTask} className="flex w-full items-center justify-center gap-2 rounded-[13px] bg-[#b85f45] py-3 text-[12px] font-bold text-[#fff7e9] disabled:cursor-not-allowed disabled:opacity-40">
              <Plus size={16} /> Add to route
            </button>
          </div>
        </div>
      )}
    </main>
  );
}