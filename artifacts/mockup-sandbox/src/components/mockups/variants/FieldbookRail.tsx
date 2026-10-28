import React, { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileText,
  Leaf,
  MapPin,
  MoreHorizontal,
  Paperclip,
  Plus,
  Settings2,
  SlidersHorizontal,
  SunMedium,
  X,
} from "lucide-react";

type Urgency = "Urgent" | "High" | "Medium" | "Low";

type FieldTask = {
  id: number;
  title: string;
  group: string;
  location: string;
  month: string;
  time: string;
  urgency: Urgency;
  steps: number;
  attachment?: string;
  done: boolean;
};

const initialTasks: FieldTask[] = [
  {
    id: 1,
    title: "Check north orchard irrigation",
    group: "Orchard",
    location: "North block",
    month: "September",
    time: "08:30",
    urgency: "Urgent",
    steps: 3,
    attachment: "valve-map.pdf",
    done: false,
  },
  {
    id: 2,
    title: "Clear brambles along lower fence",
    group: "Property maintenance",
    location: "South boundary",
    month: "September",
    time: "10:00",
    urgency: "High",
    steps: 2,
    done: false,
  },
  {
    id: 3,
    title: "Top-dress young plum trees",
    group: "Tree care",
    location: "East orchard",
    month: "October",
    time: "11:30",
    urgency: "Medium",
    steps: 4,
    done: false,
  },
  {
    id: 4,
    title: "Walk the west pasture water line",
    group: "Pasture",
    location: "West pasture",
    month: "September",
    time: "15:45",
    urgency: "Low",
    steps: 1,
    done: true,
  },
];

const urgencyOrder: Urgency[] = ["Urgent", "High", "Medium", "Low"];

const priorityColor: Record<Urgency, string> = {
  Urgent: "#c64b3e",
  High: "#d97845",
  Medium: "#a27a3f",
  Low: "#5c8371",
};

export function FieldbookRail() {
  const [tasks, setTasks] = useState(initialTasks);
  const [filter, setFilter] = useState("Open");
  const [selectedTask, setSelectedTask] = useState<FieldTask | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [activeTab, setActiveTab] = useState("Fieldwork");
  const [notice, setNotice] = useState("");

  const openCount = tasks.filter((task) => !task.done).length;
  const urgentCount = tasks.filter((task) => !task.done && (task.urgency === "Urgent" || task.urgency === "High")).length;
  const filteredTasks = useMemo(() => {
    if (filter === "Done") return tasks.filter((task) => task.done);
    if (filter === "All") return tasks;
    return tasks.filter((task) => !task.done);
  }, [filter, tasks]);

  const toggleTask = (id: number) => {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, done: !task.done } : task));
    setSelectedTask((current) => current?.id === id ? { ...current, done: !current.done } : current);
  };

  const cycleUrgency = (id: number) => {
    setTasks((current) => current.map((task) => {
      if (task.id !== id) return task;
      const next = urgencyOrder[(urgencyOrder.indexOf(task.urgency) + 1) % urgencyOrder.length];
      return { ...task, urgency: next };
    }));
    setSelectedTask((current) => {
      if (!current || current.id !== id) return current;
      const next = urgencyOrder[(urgencyOrder.indexOf(current.urgency) + 1) % urgencyOrder.length];
      return { ...current, urgency: next };
    });
  };

  const createTask = () => {
    const title = newTask.trim();
    if (!title) return;
    const created: FieldTask = {
      id: Date.now(),
      title,
      group: "General",
      location: "Add a location",
      month: "September",
      time: "New",
      urgency: "Medium",
      steps: 0,
      done: false,
    };
    setTasks((current) => [created, ...current]);
    setNewTask("");
    setAddOpen(false);
    setNotice("Added to the shared fieldbook");
    window.setTimeout(() => setNotice(""), 2300);
  };

  return (
    <main
      className="relative h-full w-full overflow-hidden"
      style={{
        background: "#f1ede3",
        color: "#293c34",
        fontFamily: "'DM Sans', 'Avenir Next', sans-serif",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage: "radial-gradient(#8d927f 0.7px, transparent 0.7px)",
          backgroundSize: "11px 11px",
          maskImage: "linear-gradient(to bottom, black, transparent 88%)",
        }}
      />

      <div className="relative h-full overflow-y-auto pb-24">
        <header className="px-5 pb-5 pt-6">
          <div className="mb-7 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#2f6856] text-[#f7f0df]">
                <Leaf size={16} strokeWidth={2.2} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#6e8175]">Oakhaven</p>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#293c34]">fieldbook / 04</p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Open planner settings"
              onClick={() => { setActiveTab("Planner"); setNotice("Planner settings are ready"); window.setTimeout(() => setNotice(""), 2200); }}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d4cdbd] bg-[#f8f4e9] text-[#668072] transition-transform hover:-translate-y-0.5"
            >
              <Settings2 size={16} />
            </button>
          </div>

          <div className="grid grid-cols-[1fr_112px] gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[#708478]">
                <SunMedium size={15} />
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">Thursday · 18 Sep</p>
              </div>
              <h1 className="max-w-[230px] font-serif text-[39px] leading-[0.9] tracking-[-0.055em] text-[#293c34]">
                Work with<br /><em className="text-[#bd6c49]">the land.</em>
              </h1>
              <p className="mt-4 max-w-[220px] text-[12px] leading-[1.55] text-[#6c7d73]">
                A clear route through the farm, before the day gets loud.
              </p>
            </div>
            <div className="relative flex h-[112px] w-[112px] items-center justify-center rounded-full border-[7px] border-[#d5dece] bg-[#e5ecdf]">
              <div className="absolute inset-[-7px] rounded-full border-[7px] border-transparent border-r-[#bd6c49] border-t-[#bd6c49] rotate-[20deg]" />
              <div className="text-center">
                <p className="font-mono text-[28px] font-bold leading-none text-[#2f6856]">{String(openCount).padStart(2, "0")}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#6c7d73]">open</p>
              </div>
            </div>
          </div>
        </header>

        <section className="mx-5 mb-5 grid grid-cols-[1.1fr_0.9fr] overflow-hidden rounded-[18px] border border-[#d6cfbf] bg-[#f8f4e9]">
          <div className="border-r border-[#d6cfbf] px-4 py-3">
            <p className="mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.17em] text-[#819085]">Today&apos;s route</p>
            <div className="flex items-end gap-2">
              <p className="font-serif text-[22px] leading-none text-[#293c34]">North → East</p>
              <ArrowUpRight size={16} className="mb-0.5 text-[#bd6c49]" />
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setFilter("Done"); setNotice("Showing finished work"); window.setTimeout(() => setNotice(""), 2200); }}
            className="group px-4 py-3 text-left transition-colors hover:bg-[#f2ecdd]"
          >
            <p className="mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.17em] text-[#819085]">Watch closely</p>
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-bold text-[#bd6c49]">{urgentCount} priority {urgentCount === 1 ? "item" : "items"}</p>
              <ChevronRight size={15} className="text-[#bd6c49] transition-transform group-hover:translate-x-0.5" />
            </div>
          </button>
        </section>

        <section className="mb-5">
          <div className="mb-3 flex items-center justify-between px-5">
            <div className="flex items-center gap-2">
              <ClipboardList size={15} className="text-[#2f6856]" />
              <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[#52695d]">Field rounds</h2>
            </div>
            <button
              type="button"
              onClick={() => setFilter("All")}
              className="text-[11px] font-bold text-[#bd6c49] underline decoration-[#d9ad94] underline-offset-4"
            >
              View all
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto px-5 pb-1">
            {["Open", "All", "Done"].map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => setFilter(item)}
                className={`shrink-0 rounded-full border px-4 py-2 text-[11px] font-bold transition-all ${filter === item ? "border-[#2f6856] bg-[#2f6856] text-[#f7f0df]" : "border-[#d1c9b8] bg-[#f8f4e9] text-[#718177] hover:border-[#9caf9c]"}`}
              >
                {item} <span className="ml-1 opacity-60">{item === "Open" ? openCount : item === "Done" ? tasks.length - openCount : tasks.length}</span>
              </button>
            ))}
            <button
              type="button"
              aria-label="Open more filters"
              onClick={() => setNotice("Month filters are available in Planner")}
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-[#d1c9b8] bg-[#f8f4e9] text-[#718177]"
            >
              <SlidersHorizontal size={14} />
            </button>
          </div>
        </section>

        <section className="relative px-5">
          <div className="absolute bottom-4 left-[33px] top-1 w-px bg-[#d5ccbb]" />
          <div className="space-y-3">
            {filteredTasks.map((task, index) => (
              <article key={task.id} className="relative pl-5">
                <div className="absolute left-[-1px] top-5 z-10 flex h-[17px] w-[17px] items-center justify-center rounded-full border-[3px] border-[#f1ede3] bg-[#bd6c49]">
                  <span className="h-[4px] w-[4px] rounded-full bg-[#f8f4e9]" />
                </div>
                <div className={`rounded-[18px] border bg-[#faf7ef] p-4 shadow-[0_6px_18px_rgba(69,73,56,0.05)] ${task.done ? "border-[#bfd0bf] opacity-70" : "border-[#d8d0c0]"}`}>
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <button
                        type="button"
                        aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`}
                        onClick={() => toggleTask(task.id)}
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] border-2 transition-all ${task.done ? "border-[#2f6856] bg-[#2f6856] text-[#f7f0df]" : "border-[#a9b2a4] bg-transparent text-transparent hover:border-[#2f6856]"}`}
                      >
                        <Check size={14} strokeWidth={3} />
                      </button>
                      <button type="button" onClick={() => setSelectedTask(task)} className="text-left">
                        <p className={`text-[14px] font-bold leading-[1.3] text-[#293c34] ${task.done ? "line-through decoration-[#83978a]" : ""}`}>{task.title}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[#7a897e]">
                          <span className="flex items-center gap-1 text-[10px]"><MapPin size={11} />{task.location}</span>
                          <span className="flex items-center gap-1 text-[10px]"><Clock3 size={11} />{task.time}</span>
                        </div>
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label={`Change ${task.title} priority`}
                      onClick={() => cycleUrgency(task.id)}
                      className="shrink-0 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em]"
                      style={{ color: priorityColor[task.urgency], background: `${priorityColor[task.urgency]}18` }}
                    >
                      {task.urgency}
                    </button>
                  </div>
                  <div className="flex items-center justify-between border-t border-[#e7e0d2] pt-3">
                    <div className="flex items-center gap-3 text-[10px] font-semibold text-[#859288]">
                      <span className="flex items-center gap-1"><CalendarDays size={12} />{task.month}</span>
                      {task.steps > 0 && <span className="flex items-center gap-1"><ClipboardList size={12} />{task.steps} steps</span>}
                      {task.attachment && <span className="flex items-center gap-1"><Paperclip size={12} />1</span>}
                    </div>
                    <button type="button" onClick={() => setSelectedTask(task)} className="flex items-center gap-1 text-[10px] font-bold text-[#2f6856]">
                      Open note <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
                {index === 1 && filteredTasks.length > 2 && (
                  <div className="my-4 flex items-center gap-2 pl-1 text-[#9a9c8b]">
                    <span className="h-px flex-1 bg-[#ddd5c5]" />
                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em]">later, if there&apos;s light</span>
                    <span className="h-px flex-1 bg-[#ddd5c5]" />
                  </div>
                )}
              </article>
            ))}
            {filteredTasks.length === 0 && (
              <div className="rounded-[18px] border border-dashed border-[#c8cbbd] bg-[#f8f4e9] px-6 py-10 text-center">
                <Leaf size={22} className="mx-auto mb-3 text-[#789481]" />
                <p className="font-serif text-[21px] text-[#293c34]">A quiet patch of ground.</p>
                <p className="mx-auto mt-2 max-w-[220px] text-[12px] leading-5 text-[#7b897e]">Nothing in this view. Add the next thing while it&apos;s fresh.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <nav className="absolute bottom-0 left-0 right-0 z-20 border-t border-[#d5ccbb] bg-[#f1ede3]/95 px-5 pb-4 pt-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          {[
            { label: "Today", icon: SunMedium },
            { label: "Fieldwork", icon: ClipboardList },
            { label: "Planner", icon: Settings2 },
          ].map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => { setActiveTab(label); if (label === "Today") setFilter("Open"); if (label === "Planner") setNotice("Planner settings are ready"); }}
              className={`flex min-w-[70px] flex-col items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] transition-colors ${activeTab === label ? "text-[#2f6856]" : "text-[#8a948a]"}`}
            >
              <Icon size={18} strokeWidth={activeTab === label ? 2.4 : 1.8} />
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-label="Add a task"
            onClick={() => setAddOpen(true)}
            className="flex h-12 w-12 -translate-y-4 items-center justify-center rounded-[16px] bg-[#bd6c49] text-[#fff7e9] shadow-[0_8px_18px_rgba(126,73,49,0.22)] transition-transform hover:-translate-y-[18px]"
          >
            <Plus size={22} />
          </button>
        </div>
      </nav>

      {notice && (
        <div className="absolute bottom-[82px] left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#293c34] px-4 py-2 text-[11px] font-bold text-[#f7f0df] shadow-lg">
          {notice}
        </div>
      )}

      {selectedTask && (
        <div className="absolute inset-0 z-40 flex items-end bg-[#25362f]/35">
          <div className="w-full rounded-t-[26px] border-t border-[#d6cfbf] bg-[#faf7ef] px-5 pb-8 pt-5 shadow-[0_-12px_35px_rgba(42,53,44,0.16)]">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#7f9184]">{selectedTask.group} / field note</p>
                <h2 className="max-w-[320px] font-serif text-[26px] leading-[1.05] text-[#293c34]">{selectedTask.title}</h2>
              </div>
              <button type="button" aria-label="Close task details" onClick={() => setSelectedTask(null)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eee8da] text-[#6f8175]">
                <X size={17} />
              </button>
            </div>
            <div className="mb-5 grid grid-cols-3 gap-2">
              {[
                { icon: MapPin, label: "Block", value: selectedTask.location },
                { icon: Clock3, label: "Start", value: selectedTask.time },
                { icon: CalendarDays, label: "Month", value: selectedTask.month },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-[13px] bg-[#f0ebdf] px-3 py-2">
                  <Icon size={13} className="mb-1 text-[#bd6c49]" />
                  <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#879388]">{label}</p>
                  <p className="mt-0.5 truncate text-[11px] font-bold text-[#293c34]">{value}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { toggleTask(selectedTask.id); setSelectedTask(null); }} className="flex flex-1 items-center justify-center gap-2 rounded-[13px] bg-[#2f6856] py-3 text-[12px] font-bold text-[#f7f0df]">
                <Check size={15} /> {selectedTask.done ? "Reopen task" : "Mark complete"}
              </button>
              <button type="button" onClick={() => { setNotice("Note editor is ready"); setSelectedTask(null); window.setTimeout(() => setNotice(""), 2200); }} className="flex h-11 w-11 items-center justify-center rounded-[13px] border border-[#d7d0c1] text-[#2f6856]" aria-label="Edit task note">
                <FileText size={17} />
              </button>
              <button type="button" onClick={() => { setNotice("More task actions"); setSelectedTask(null); window.setTimeout(() => setNotice(""), 2200); }} className="flex h-11 w-11 items-center justify-center rounded-[13px] border border-[#d7d0c1] text-[#7b897e]" aria-label="More task actions">
                <MoreHorizontal size={17} />
              </button>
            </div>
          </div>
        </div>
      )}

      {addOpen && (
        <div className="absolute inset-0 z-40 flex items-end bg-[#25362f]/35">
          <div className="w-full rounded-t-[26px] border-t border-[#d6cfbf] bg-[#faf7ef] px-5 pb-8 pt-5 shadow-[0_-12px_35px_rgba(42,53,44,0.16)]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#7f9184]">Inbox / new note</p>
                <h2 className="font-serif text-[27px] leading-none text-[#293c34]">What needs doing?</h2>
              </div>
              <button type="button" aria-label="Close add task" onClick={() => setAddOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eee8da] text-[#6f8175]">
                <X size={17} />
              </button>
            </div>
            <input
              autoFocus
              value={newTask}
              onChange={(event) => setNewTask(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") createTask(); }}
              placeholder="e.g. Prune the south apple row"
              className="mb-3 w-full rounded-[14px] border border-[#d6cfbf] bg-[#f0ebdf] px-4 py-3 text-[14px] text-[#293c34] outline-none placeholder:text-[#9ba195] focus:border-[#2f6856]"
            />
            <p className="mb-4 text-[11px] leading-5 text-[#849187]">It will land in General. You can add the block, month, and steps from the note.</p>
            <button type="button" disabled={!newTask.trim()} onClick={createTask} className="flex w-full items-center justify-center gap-2 rounded-[13px] bg-[#bd6c49] py-3 text-[12px] font-bold text-[#fff7e9] disabled:cursor-not-allowed disabled:opacity-40">
              <Plus size={16} /> Add to fieldbook
            </button>
          </div>
        </div>
      )}
    </main>
  );
}