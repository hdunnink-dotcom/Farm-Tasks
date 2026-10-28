import React, { useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Cloud,
  CloudRain,
  CloudSun,
  Clock3,
  FileText,
  Leaf,
  MapPin,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  SlidersHorizontal,
  SunMedium,
  Wind,
  X,
} from "lucide-react";

type TaskGroup = "Morning rounds" | "Keep an eye on" | "Before dusk";
type WeatherKind = "sun" | "cloudSun" | "wind" | "rain" | "cloud";

type Task = {
  id: number;
  title: string;
  note: string;
  group: TaskGroup;
  location: string;
  time: string;
  tag: string;
  color: string;
  done: boolean;
  attachment?: string;
};

type WeekDay = {
  day: string;
  date: string;
  month: string;
  weather: WeatherKind;
  high: string;
  low: string;
  detail: string;
  today?: boolean;
};

const weekDays: WeekDay[] = [
  { day: "MON", date: "15", month: "SEP", weather: "cloudSun", high: "19°", low: "11°", detail: "bright spells" },
  { day: "TUE", date: "16", month: "SEP", weather: "sun", high: "21°", low: "12°", detail: "clear and mild" },
  { day: "WED", date: "17", month: "SEP", weather: "wind", high: "18°", low: "10°", detail: "north wind" },
  { day: "THU", date: "18", month: "SEP", weather: "sun", high: "22°", low: "13°", detail: "warm afternoon", today: true },
  { day: "FRI", date: "19", month: "SEP", weather: "cloudSun", high: "20°", low: "12°", detail: "high cloud" },
  { day: "SAT", date: "20", month: "SEP", weather: "rain", high: "17°", low: "11°", detail: "light showers" },
  { day: "SUN", date: "21", month: "SEP", weather: "cloud", high: "18°", low: "10°", detail: "overcast" },
];

const initialTasks: Task[] = [
  {
    id: 1,
    title: "Check north orchard irrigation",
    note: "Listen for the pressure change at the old valve before opening the east line.",
    group: "Morning rounds",
    location: "North block",
    time: "08:30",
    tag: "priority",
    color: "#ba674d",
    done: false,
    attachment: "valve-map.pdf",
  },
  {
    id: 2,
    title: "Walk the young plum row",
    note: "Look for fresh leaf curl and mark trees that need a second pass.",
    group: "Morning rounds",
    location: "East orchard",
    time: "10:15",
    tag: "trees",
    color: "#547866",
    done: false,
  },
  {
    id: 3,
    title: "Clear the lower fence line",
    note: "The brambles are leaning into the south gate. Take the long-handled loppers.",
    group: "Keep an eye on",
    location: "South boundary",
    time: "13:00",
    tag: "property",
    color: "#9a7847",
    done: false,
  },
  {
    id: 4,
    title: "Walk west pasture water line",
    note: "A quiet check after the afternoon heat settles.",
    group: "Before dusk",
    location: "West pasture",
    time: "15:45",
    tag: "water",
    color: "#64867d",
    done: true,
  },
];

const groupDetails: Record<TaskGroup, { eyebrow: string; countLabel: string }> = {
  "Morning rounds": { eyebrow: "first light / 2 notes", countLabel: "02" },
  "Keep an eye on": { eyebrow: "soft reminders / 1 note", countLabel: "01" },
  "Before dusk": { eyebrow: "closing loop / 1 note", countLabel: "01" },
};

const weatherIcons: Record<WeatherKind, typeof SunMedium> = {
  sun: SunMedium,
  cloudSun: CloudSun,
  wind: Wind,
  rain: CloudRain,
  cloud: Cloud,
};

const weatherLabels: Record<WeatherKind, string> = {
  sun: "clear",
  cloudSun: "bright cloud",
  wind: "north wind",
  rain: "light showers",
  cloud: "overcast",
};

export function FieldbookWeekWeatherPlanner() {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [activeDate, setActiveDate] = useState("18");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [notice, setNotice] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const activeDay = weekDays.find((day) => day.date === activeDate) ?? weekDays[3];
  const openCount = tasks.filter((task) => !task.done).length;

  const visibleTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return tasks;
    return tasks.filter((task) =>
      `${task.title} ${task.location} ${task.tag}`.toLowerCase().includes(normalized),
    );
  }, [query, tasks]);

  const groupedTasks = useMemo(() => {
    return (Object.keys(groupDetails) as TaskGroup[])
      .map((group) => ({
        group,
        tasks: visibleTasks.filter((task) => task.group === group),
      }))
      .filter((section) => section.tasks.length > 0);
  }, [visibleTasks]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  };

  const toggleTask = (id: number) => {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, done: !task.done } : task)),
    );
    setSelectedTask((current) =>
      current?.id === id ? { ...current, done: !current.done } : current,
    );
  };

  const createTask = () => {
    const title = newTask.trim();
    if (!title) return;
    const created: Task = {
      id: Date.now(),
      title,
      note: "A fresh note for the fieldbook. Add the detail while it is still close.",
      group: "Keep an eye on",
      location: "Add a location",
      time: "Open",
      tag: "new",
      color: "#ba674d",
      done: false,
    };
    setTasks((current) => [...current, created]);
    setNewTask("");
    setAddOpen(false);
    flash("Added to Thursday’s desk");
  };

  return (
    <main
      className="relative h-full w-full overflow-hidden"
      style={{
        background: "#f1eee6",
        color: "#2e433a",
        fontFamily: "'DM Sans', 'Avenir Next', sans-serif",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage: "radial-gradient(#788e7f 0.65px, transparent 0.65px)",
          backgroundSize: "12px 12px",
          maskImage: "linear-gradient(to bottom, black 0%, transparent 95%)",
        }}
      />

      <div className="relative h-full overflow-y-auto pb-[90px]">
        <header className="px-5 pb-4 pt-5">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#315f50] text-[#f7f2e7]">
                <Leaf size={16} strokeWidth={2.2} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#71857a]">Oakhaven</p>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#2e433a]">
                  week desk / 04
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={searchOpen ? "Close search" : "Search notes"}
                onClick={() => {
                  setSearchOpen((current) => !current);
                  if (searchOpen) setQuery("");
                }}
                className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
                  searchOpen
                    ? "border-[#315f50] bg-[#e5ece1] text-[#315f50]"
                    : "border-[#d6cfbf] bg-[#f9f5eb] text-[#728379]"
                }`}
              >
                <Search size={16} />
              </button>
              <button
                type="button"
                aria-label="Open week settings"
                onClick={() => flash("Week settings are ready")}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d6cfbf] bg-[#f9f5eb] text-[#728379]"
              >
                <MoreHorizontal size={17} />
              </button>
            </div>
          </div>

          {searchOpen && (
            <div className="mb-4 flex items-center gap-2 rounded-[13px] border border-[#d3cbb9] bg-[#faf7ef] px-3 py-2">
              <Search size={14} className="text-[#829187]" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a note or place"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-[#2e433a] outline-none placeholder:text-[#a2aa9e]"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                  <X size={14} className="text-[#829187]" />
                </button>
              )}
            </div>
          )}

          <div className="flex items-end justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[#75897d]">
                <SunMedium size={15} />
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.17em]">
                  {activeDay.day} · {activeDay.date} September
                </p>
              </div>
              <h1 className="font-serif text-[38px] leading-[0.92] tracking-[-0.055em] text-[#2e433a]">
                Keep pace
                <br />
                <em className="text-[#ba674d]">with the week.</em>
              </h1>
            </div>
            <div className="mb-1 text-right">
              <p className="font-mono text-[25px] font-bold leading-none text-[#315f50]">
                {String(openCount).padStart(2, "0")}
              </p>
              <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[#829187]">open notes</p>
            </div>
          </div>
        </header>

        <section className="border-y border-[#d7d0c1] bg-[#ebe6d9] py-3">
          <div className="mb-2 flex items-center justify-between px-5">
            <div>
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.19em] text-[#839087]">
                September / week 38
              </p>
              <p className="mt-1 text-[10px] text-[#8a968b]">A small weather window for the work ahead</p>
            </div>
            <button
              type="button"
              onClick={() => flash("Month view is ready")}
              className="flex items-center gap-1 text-[10px] font-bold text-[#ba674d]"
            >
              Month view <ChevronDown size={13} />
            </button>
          </div>

          <div className="flex gap-1.5 overflow-x-auto px-5 pb-1">
            {weekDays.map((item) => {
              const WeatherIcon = weatherIcons[item.weather];
              const isActive = activeDate === item.date;
              return (
                <button
                  key={`${item.day}-${item.date}`}
                  type="button"
                  aria-label={`${item.day} ${item.date} September, ${weatherLabels[item.weather]}`}
                  onClick={() => {
                    setActiveDate(item.date);
                    flash(item.today ? "Today’s notes" : `${item.day} ${item.date} selected`);
                  }}
                  className={`relative flex h-[94px] min-w-[47px] flex-1 flex-col items-center justify-center rounded-[13px] border transition-all ${
                    isActive
                      ? "border-[#315f50] bg-[#315f50] text-[#f8f2e6] shadow-[0_5px_12px_rgba(49,95,80,0.16)]"
                      : "border-transparent text-[#7c8b80] hover:border-[#c3cdbf] hover:bg-[#f5f0e5]"
                  }`}
                >
                  <span className="font-mono text-[8px] font-bold uppercase tracking-[0.08em] opacity-75">
                    {item.day}
                  </span>
                  <span className="mt-1 font-serif text-[24px] leading-none">{item.date}</span>
                  <WeatherIcon
                    size={15}
                    strokeWidth={1.8}
                    className={`my-1 ${isActive ? "text-[#e6b894]" : "text-[#ba674d]"}`}
                  />
                  <span className="font-mono text-[8px] font-bold tracking-[-0.02em] opacity-65">
                    {item.high} / {item.low}
                  </span>
                  {item.today && (
                    <span
                      className={`absolute bottom-1 h-1 w-1 rounded-full ${
                        isActive ? "bg-[#d89b78]" : "bg-[#ba674d]"
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="px-5 pb-2 pt-4">
          <div className="flex items-center justify-between rounded-[15px] border border-[#d8d0c0] bg-[#faf7ef] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[#e1eadd] text-[#4e7b68]">
                <MapPin size={15} />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[9px] font-bold uppercase tracking-[0.17em] text-[#88968b]">
                  Today’s flow
                </p>
                <p className="truncate font-serif text-[18px] leading-none text-[#2e433a]">
                  North block <span className="px-1 text-[#ba674d]">→</span> West pasture
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => flash("Route notes opened")}
              aria-label="Open route notes"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#ba674d] hover:bg-[#f0e7d9]"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </section>

        <section className="px-5 pb-5 pt-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardList size={15} className="text-[#315f50]" />
              <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[#52695d]">
                Desk notes
              </h2>
            </div>
            <button
              type="button"
              onClick={() => flash("Filters are ready")}
              aria-label="Filter desk notes"
              className="flex items-center gap-1.5 rounded-full border border-[#d5cdbd] bg-[#f9f5eb] px-2.5 py-1.5 text-[10px] font-bold text-[#77877c]"
            >
              <SlidersHorizontal size={12} /> Filter
            </button>
          </div>

          {groupedTasks.length === 0 && (
            <div className="rounded-[17px] border border-dashed border-[#c8cbbd] bg-[#faf7ef] px-6 py-10 text-center">
              <Leaf size={22} className="mx-auto mb-3 text-[#789481]" />
              <p className="font-serif text-[21px] text-[#2e433a]">A clear desk.</p>
              <p className="mx-auto mt-2 max-w-[230px] text-[12px] leading-5 text-[#7b897e]">
                No note matches this view. Add the next thing while it’s fresh.
              </p>
            </div>
          )}

          <div className="space-y-5">
            {groupedTasks.map(({ group, tasks: sectionTasks }) => (
              <div key={group}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <div>
                    <p className="font-serif text-[19px] leading-none text-[#2e433a]">{group}</p>
                    <p className="mt-1 font-mono text-[8px] font-bold uppercase tracking-[0.16em] text-[#909b90]">
                      {groupDetails[group].eyebrow}
                    </p>
                  </div>
                  <span className="font-mono text-[10px] font-bold text-[#ba674d]">
                    {String(sectionTasks.length).padStart(2, "0")}
                  </span>
                </div>
                <div className="space-y-2">
                  {sectionTasks.map((task) => (
                    <article
                      key={task.id}
                      className={`rounded-[16px] border bg-[#faf7ef] p-3.5 transition-opacity ${
                        task.done ? "border-[#c9d6c8] opacity-65" : "border-[#d8d0c0]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`}
                          onClick={() => toggleTask(task.id)}
                          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] border-2 transition-colors ${
                            task.done
                              ? "border-[#315f50] bg-[#315f50] text-[#f5f0e5]"
                              : "border-[#acb8a9] text-transparent hover:border-[#315f50]"
                          }`}
                        >
                          <Check size={13} strokeWidth={3} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedTask(task)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="mb-1.5 flex items-start justify-between gap-2">
                            <p
                              className={`text-[13px] font-bold leading-[1.25] text-[#2e433a] ${
                                task.done ? "line-through decoration-[#83978a]" : ""
                              }`}
                            >
                              {task.title}
                            </p>
                            <span
                              className="mt-0.5 shrink-0 rounded-full px-2 py-1 text-[8px] font-bold uppercase tracking-[0.09em]"
                              style={{ color: task.color, background: `${task.color}18` }}
                            >
                              {task.tag}
                            </span>
                          </div>
                          <p className="line-clamp-1 text-[11px] leading-[1.45] text-[#829087]">{task.note}</p>
                          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[#849289]">
                            <span className="flex items-center gap-1 text-[9px]">
                              <MapPin size={11} /> {task.location}
                            </span>
                            <span className="flex items-center gap-1 text-[9px]">
                              <Clock3 size={11} /> {task.time}
                            </span>
                            {task.attachment && (
                              <span className="flex items-center gap-1 text-[9px]">
                                <Paperclip size={11} /> 1 file
                              </span>
                            )}
                          </div>
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <nav className="absolute bottom-0 left-0 right-0 z-20 border-t border-[#d5ccbb] bg-[#f1eee6]/95 px-5 pb-4 pt-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setActiveDate("18");
              flash("Back to today");
            }}
            className={`flex min-w-[64px] flex-col items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] ${
              activeDate === "18" ? "text-[#315f50]" : "text-[#8a948a]"
            }`}
          >
            <SunMedium size={18} strokeWidth={activeDate === "18" ? 2.4 : 1.8} /> Today
          </button>
          <button
            type="button"
            onClick={() => flash("All field notes opened")}
            className="flex min-w-[64px] flex-col items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a948a]"
          >
            <FileText size={18} strokeWidth={1.8} /> Notes
          </button>
          <button
            type="button"
            aria-label="Add a new desk note"
            onClick={() => setAddOpen(true)}
            className="flex h-12 w-12 -translate-y-4 items-center justify-center rounded-[16px] bg-[#ba674d] text-[#fff7e9] shadow-[0_8px_18px_rgba(126,73,49,0.22)] transition-transform hover:-translate-y-[18px]"
          >
            <Plus size={22} />
          </button>
          <button
            type="button"
            onClick={() => flash("Calendar view opened")}
            className="flex min-w-[64px] flex-col items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a948a]"
          >
            <CalendarDays size={18} strokeWidth={1.8} /> Calendar
          </button>
          <button
            type="button"
            onClick={() => flash("Planner preferences opened")}
            className="flex min-w-[64px] flex-col items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a948a]"
          >
            <MoreHorizontal size={18} strokeWidth={1.8} /> More
          </button>
        </div>
      </nav>

      {notice && (
        <div className="absolute bottom-[82px] left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#2e433a] px-4 py-2 text-[11px] font-bold text-[#f7f0e6] shadow-lg">
          {notice}
        </div>
      )}

      {selectedTask && (
        <div className="absolute inset-0 z-40 flex items-end bg-[#25362f]/35">
          <div className="w-full rounded-t-[25px] border-t border-[#d6cfbf] bg-[#faf7ef] px-5 pb-8 pt-5 shadow-[0_-12px_35px_rgba(42,53,44,0.16)]">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#7f9184]">
                  {selectedTask.group} / desk note
                </p>
                <h2 className="max-w-[310px] font-serif text-[26px] leading-[1.05] text-[#2e433a]">
                  {selectedTask.title}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close note details"
                onClick={() => setSelectedTask(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eee8da] text-[#6f8175]"
              >
                <X size={17} />
              </button>
            </div>
            <p className="mb-5 text-[12px] leading-5 text-[#6d7d73]">{selectedTask.note}</p>
            <div className="mb-5 grid grid-cols-3 gap-2">
              {[
                { icon: MapPin, label: "Place", value: selectedTask.location },
                { icon: Clock3, label: "Start", value: selectedTask.time },
                { icon: ClipboardList, label: "Group", value: selectedTask.group.split(" ")[0] },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-[13px] bg-[#f0ebdf] px-3 py-2">
                  <Icon size={13} className="mb-1 text-[#ba674d]" />
                  <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#879388]">{label}</p>
                  <p className="mt-0.5 truncate text-[11px] font-bold text-[#2e433a]">{value}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  toggleTask(selectedTask.id);
                  setSelectedTask(null);
                }}
                className="flex flex-1 items-center justify-center gap-2 rounded-[13px] bg-[#315f50] py-3 text-[12px] font-bold text-[#f7f0e6]"
              >
                <Check size={15} /> {selectedTask.done ? "Reopen note" : "Mark complete"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedTask(null);
                  flash("Note editor is ready");
                }}
                aria-label="Edit note"
                className="flex h-11 w-11 items-center justify-center rounded-[13px] border border-[#d7d0c1] text-[#315f50]"
              >
                <FileText size={17} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedTask(null);
                  flash("More note actions");
                }}
                aria-label="More note actions"
                className="flex h-11 w-11 items-center justify-center rounded-[13px] border border-[#d7d0c1] text-[#7b897e]"
              >
                <MoreHorizontal size={17} />
              </button>
            </div>
          </div>
        </div>
      )}

      {addOpen && (
        <div className="absolute inset-0 z-40 flex items-end bg-[#25362f]/35">
          <div className="w-full rounded-t-[25px] border-t border-[#d6cfbf] bg-[#faf7ef] px-5 pb-8 pt-5 shadow-[0_-12px_35px_rgba(42,53,44,0.16)]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#7f9184]">
                  Inbox / new desk note
                </p>
                <h2 className="font-serif text-[27px] leading-none text-[#2e433a]">What belongs here?</h2>
              </div>
              <button
                type="button"
                aria-label="Close add note"
                onClick={() => setAddOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eee8da] text-[#6f8175]"
              >
                <X size={17} />
              </button>
            </div>
            <input
              autoFocus
              value={newTask}
              onChange={(event) => setNewTask(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createTask();
              }}
              placeholder="e.g. Restock the wash station"
              className="mb-3 w-full rounded-[14px] border border-[#d6cfbf] bg-[#f0ebdf] px-4 py-3 text-[14px] text-[#2e433a] outline-none placeholder:text-[#9ba195] focus:border-[#315f50]"
            />
            <p className="mb-4 text-[11px] leading-5 text-[#849187]">
              It will land in Keep an eye on. Add the place and time from its note later.
            </p>
            <button
              type="button"
              disabled={!newTask.trim()}
              onClick={createTask}
              className="flex w-full items-center justify-center gap-2 rounded-[13px] bg-[#ba674d] py-3 text-[12px] font-bold text-[#fff7e9] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={16} /> Add to desk
            </button>
          </div>
        </div>
      )}
    </main>
  );
}