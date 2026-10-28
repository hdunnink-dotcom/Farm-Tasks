import { useMemo, useState } from "react";
import {
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CloudOff,
  Edit3,
  Leaf,
  MapPin,
  MoreHorizontal,
  MoveRight,
  RefreshCw,
  UserPlus,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import "./TeamPlannerOverview.css";

type Mode = "manager" | "worker";
type Direction = "roster" | "board" | "week";
type TaskStatus = "open" | "overdue" | "unassigned" | "completed";

type PlannerTask = {
  id: number;
  day: string;
  date: string;
  title: string;
  owner: string;
  role: string;
  location: string;
  time: string;
  status: TaskStatus;
  priority?: boolean;
  note: string;
  offline?: boolean;
  pendingSync?: boolean;
  syncIssue?: "conflict" | "failed";
};

const days = [
  { day: "MON", short: "Mon", date: "16" },
  { day: "TUE", short: "Tue", date: "17" },
  { day: "WED", short: "Wed", date: "18" },
  { day: "THU", short: "Thu", date: "19" },
  { day: "FRI", short: "Fri", date: "20" },
];

const seedTasks: PlannerTask[] = [
  {
    id: 1,
    day: "MON",
    date: "16",
    title: "Repair break in lower fence line",
    owner: "Mara",
    role: "Field lead",
    location: "South boundary",
    time: "07:30",
    status: "overdue",
    priority: true,
    note: "The brambles are leaning into the south gate. Take the long-handled loppers.",
  },
  {
    id: 2,
    day: "MON",
    date: "16",
    title: "Record weekly egg count",
    owner: "Jon",
    role: "Livestock",
    location: "Hen house",
    time: "09:00",
    status: "completed",
    note: "Leave the count in the flock log before the first feed.",
  },
  {
    id: 3,
    day: "TUE",
    date: "17",
    title: "Check north orchard irrigation",
    owner: "Mara",
    role: "Field lead",
    location: "North block",
    time: "08:30",
    status: "open",
    priority: true,
    note: "Listen for the pressure change at the old valve before opening the east line.",
  },
  {
    id: 4,
    day: "TUE",
    date: "17",
    title: "Sort windfall apples for cider",
    owner: "Jon",
    role: "Harvest",
    location: "Packing shed",
    time: "11:15",
    status: "open",
    note: "Keep bruised fruit in the blue bins and set good fruit aside for the market.",
    pendingSync: true,
  },
  {
    id: 5,
    day: "WED",
    date: "18",
    title: "Walk young plum row for leaf curl",
    owner: "Mara",
    role: "Field lead",
    location: "East orchard",
    time: "10:15",
    status: "open",
    note: "Mark trees that need a second pass and add a close-up to the field note.",
    offline: true,
    pendingSync: true,
  },
  {
    id: 6,
    day: "WED",
    date: "18",
    title: "Move mineral tub to upper paddock",
    owner: "Jon",
    role: "Livestock",
    location: "Upper pasture",
    time: "13:00",
    status: "unassigned",
    note: "The empty tub is beside the feed room. Check the float valve after moving it.",
    syncIssue: "conflict",
  },
  {
    id: 7,
    day: "WED",
    date: "18",
    title: "Sharpen hedge trimmer blades",
    owner: "Unassigned",
    role: "Needs a hand",
    location: "Workshop",
    time: "15:30",
    status: "unassigned",
    note: "The trimmer is on the bench. Please leave the blades oiled when finished.",
    priority: true,
    pendingSync: true,
    syncIssue: "failed",
  },
  {
    id: 8,
    day: "THU",
    date: "19",
    title: "Clear brambles at south gate",
    owner: "Jon",
    role: "Livestock",
    location: "South boundary",
    time: "08:00",
    status: "open",
    priority: true,
    note: "Clear a safe two-metre approach to the gate before the trailer arrives.",
  },
  {
    id: 9,
    day: "FRI",
    date: "20",
    title: "Count feeder lambs",
    owner: "Mara",
    role: "Field lead",
    location: "West pasture",
    time: "07:45",
    status: "completed",
    note: "Cross-check the count against the Friday feed sheet.",
  },
];

const directionInfo: Record<Direction, { title: string; desc: string; blurb: string }> = {
  roster: {
    title: "Worker-by-day roster",
    desc: "Who is carrying what",
    blurb: "A people-first scan for the start-of-day huddle. Strongest when the manager needs to spot gaps by worker.",
  },
  board: {
    title: "Selected-day crew board",
    desc: "One day, split by person",
    blurb: "A focused dispatch view for a live workday. Strongest when the crew is already in motion and reassignment is common.",
  },
  week: {
    title: "Compact week summary",
    desc: "The whole week, at a glance",
    blurb: "A restrained planning ledger for handoff and print-like scanning. Strongest for a weekly rhythm, not task detail.",
  },
};

function statusLabel(status: TaskStatus): string {
  if (status === "overdue") return "Overdue";
  if (status === "unassigned") return "Unassigned";
  if (status === "completed") return "Done";
  return "Open";
}

function initials(name: string): string {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function DayNavigator({
  activeDay,
  setActiveDay,
  onNotice,
}: {
  activeDay: number;
  setActiveDay: (index: number) => void;
  onNotice: (message: string) => void;
}) {
  const moveDay = (amount: number) => {
    const next = Math.max(0, Math.min(days.length - 1, activeDay + amount));
    setActiveDay(next);
    onNotice(`${days[next].short} 18 September selected`);
  };

  return (
    <div className="team-daybar">
      <button type="button" aria-label="Previous day" onClick={() => moveDay(-1)}><ChevronLeft size={15} /></button>
      <div className="team-day-pills">
        {days.map((item, index) => (
          <button
            type="button"
            key={item.date}
            className={`team-day-pill ${activeDay === index ? "active" : ""}`}
            onClick={() => { setActiveDay(index); onNotice(`${item.short} 18 September selected`); }}
          >
            <span>{item.day}</span>
            <strong>{item.date}</strong>
          </button>
        ))}
      </div>
      <button type="button" aria-label="Next day" onClick={() => moveDay(1)}><ChevronRight size={15} /></button>
    </div>
  );
}

function SyncStatus({ tasks, mode }: { tasks: PlannerTask[]; mode: Mode }) {
  const hasPending = tasks.some((task) => task.pendingSync);
  const hasOffline = tasks.some((task) => task.offline);
  const hasConflict = tasks.some((task) => task.syncIssue === "conflict");
  const hasFailed = tasks.some((task) => task.syncIssue === "failed");
  if (mode === "worker" && hasOffline) {
    return <span className="team-sync offline"><WifiOff size={12} /> Working offline</span>;
  }
  if (hasConflict) {
    return <span className="team-sync issue"><CircleAlert size={12} /> Conflict to review</span>;
  }
  if (hasFailed) {
    return <span className="team-sync issue"><CloudOff size={12} /> Retry needed</span>;
  }
  if (hasPending) {
    return <span className="team-sync"><RefreshCw size={12} /> 2 pending sync</span>;
  }
  return <span className="team-sync"><Check size={12} /> Synced just now</span>;
}

function TaskCard({
  task,
  mode,
  onOpen,
  onToggle,
}: {
  task: PlannerTask;
  mode: Mode;
  onOpen: (task: PlannerTask) => void;
  onToggle: (id: number) => void;
}) {
  return (
    <button
      type="button"
      className={`team-task-card ${task.priority ? "priority" : ""} ${task.status === "completed" ? "completed" : ""}`}
      onClick={() => onOpen(task)}
    >
      <span className="team-task-top">
        <span className="team-task-title">{task.title}</span>
        <span className={`team-status ${task.status}`}>{statusLabel(task.status)}</span>
      </span>
      <span className="team-task-bottom">
        <span className="team-task-location"><MapPin size={10} />{task.location} · {task.time}</span>
        {task.priority && <span className="team-priority">Priority</span>}
      </span>
      {task.syncIssue && <span className="team-task-bottom team-task-sync-issue"><span>{task.syncIssue === "conflict" ? "Conflict to review" : "Sync failed · retry"}</span><CircleAlert size={11} /></span>}
      {!task.syncIssue && task.pendingSync && <span className="team-task-bottom"><span>{task.offline ? "Saved on device" : "Waiting to sync"}</span><CloudOff size={11} /></span>}
      {mode === "manager" && <span className="team-task-bottom"><span>{task.owner === "Unassigned" ? "Needs a hand" : task.owner}</span><MoveRight size={11} /></span>}
      <span className="sr-only">{task.status === "completed" ? "Open details to reopen" : "Open task details"}</span>
      <span
        role="checkbox"
        aria-checked={task.status === "completed"}
        aria-label={task.status === "completed" ? `Reopen ${task.title}` : `Complete ${task.title}`}
        tabIndex={0}
        onClick={(event) => { event.stopPropagation(); onToggle(task.id); }}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onToggle(task.id); } }}
        className={`team-card-check ${task.status === "completed" ? "checked" : ""}`}
      >
        {task.status === "completed" && <Check size={10} />}
      </span>
    </button>
  );
}

function AppHead({ title, subtitle, mode, onNotice }: { title: string; subtitle: string; mode: Mode; onNotice: (message: string) => void }) {
  return (
    <header className="team-app-head">
      <div>
        <h3 className="team-app-title">{title}</h3>
        <p className="team-app-subtitle">{mode === "manager" ? subtitle : "Your assigned work · private view"}</p>
      </div>
      <div className="team-app-actions">
        <button type="button" className="team-outline-btn" onClick={() => onNotice("Filters are ready for the next pass")}><Users size={13} /> Crew filters</button>
        <button type="button" className="team-icon-btn" aria-label="More overview actions" onClick={() => onNotice("Overview actions opened")}><MoreHorizontal size={15} /></button>
      </div>
    </header>
  );
}

function RosterView({
  tasks,
  mode,
  activeDay,
  setActiveDay,
  onOpen,
  onToggle,
  onNotice,
}: {
  tasks: PlannerTask[];
  mode: Mode;
  activeDay: number;
  setActiveDay: (index: number) => void;
  onOpen: (task: PlannerTask) => void;
  onToggle: (id: number) => void;
  onNotice: (message: string) => void;
}) {
  const rosterPeople = ["Mara", "Jon", "Unassigned"];
  const visiblePeople = mode === "worker" ? ["Mara"] : rosterPeople;
  return (
    <div className="team-app">
      <AppHead title="Crew roster" subtitle="Week 38 · 9 tasks across the farm" mode={mode} onNotice={onNotice} />
      <DayNavigator activeDay={activeDay} setActiveDay={setActiveDay} onNotice={onNotice} />
      <div className="team-summary">
        <span className="team-summary-text"><b>{days[activeDay].short} 18</b> · {mode === "manager" ? "crew load" : "your run"} for the day</span>
        <SyncStatus tasks={tasks} mode={mode} />
      </div>
      <div className="team-roster">
        <aside className="team-roster-side">
          <div className="team-roster-side-head">Crew member</div>
          {visiblePeople.map((person) => (
            <div className="team-roster-row-label" key={person}>
              <div className="team-person"><span className="team-avatar">{initials(person)}</span>{mode === "manager" ? person : "My work"}</div>
              {mode === "manager" && <p className="team-person-role">{person === "Unassigned" ? "Open assignment" : person === "Mara" ? "Field lead" : "Livestock"}</p>}
            </div>
          ))}
        </aside>
        <div className="team-roster-main">
          <div className="team-roster-main-head">
            {days.slice(0, 3).map((day, index) => <span key={day.date}>{day.short} {day.date}{index === activeDay ? " · today" : ""}</span>)}
          </div>
          {visiblePeople.map((person) => (
            <div className="team-roster-row" key={person}>
              <span className="team-mobile-person"><span className="team-avatar">{initials(person)}</span>{mode === "manager" ? person : "My work"}</span>
              {days.slice(0, 3).map((day) => {
                const task = tasks.find((item) => item.day === day.day && item.owner === person);
                return task ? <TaskCard key={task.id} task={task} mode={mode} onOpen={onOpen} onToggle={onToggle} /> : <span className="team-empty-cell" key={day.date} />;
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BoardView({
  tasks,
  mode,
  activeDay,
  setActiveDay,
  onOpen,
  onToggle,
  onNotice,
}: {
  tasks: PlannerTask[];
  mode: Mode;
  activeDay: number;
  setActiveDay: (index: number) => void;
  onOpen: (task: PlannerTask) => void;
  onToggle: (id: number) => void;
  onNotice: (message: string) => void;
}) {
  const today = days[activeDay].day;
  const people = mode === "worker" ? ["Mara"] : ["Mara", "Jon", "Unassigned"];
  return (
    <div className="team-app">
      <AppHead title={`${days[activeDay].short} crew board`} subtitle="Wednesday 18 September · live assignments" mode={mode} onNotice={onNotice} />
      <DayNavigator activeDay={activeDay} setActiveDay={setActiveDay} onNotice={onNotice} />
      <div className="team-summary">
        <span className="team-summary-text"><b>{tasks.filter((task) => task.day === today && task.status !== "completed").length} open</b> · {mode === "manager" ? "move work as the field changes" : "your field notes"}</span>
        <SyncStatus tasks={tasks.filter((task) => task.day === today)} mode={mode} />
      </div>
      <div className="team-board">
        {people.map((person) => {
          const personTasks = tasks.filter((task) => task.day === today && task.owner === person);
          return (
            <section className={`team-board-col ${person === "Mara" ? "active" : ""}`} key={person}>
              <header className="team-board-col-head">
                <div className="team-board-col-title"><span className="team-avatar">{initials(person)}</span>{mode === "manager" ? person : "My tasks"}</div>
                <span className="team-board-count">{String(personTasks.length).padStart(2, "0")}</span>
              </header>
              <div className="team-task-stack">
                {personTasks.map((task) => <TaskCard key={task.id} task={task} mode={mode} onOpen={onOpen} onToggle={onToggle} />)}
                {personTasks.length === 0 && <div className="team-empty-cell" />}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  tasks,
  mode,
  activeDay,
  setActiveDay,
  onOpen,
  onToggle,
  onNotice,
}: {
  tasks: PlannerTask[];
  mode: Mode;
  activeDay: number;
  setActiveDay: (index: number) => void;
  onOpen: (task: PlannerTask) => void;
  onToggle: (id: number) => void;
  onNotice: (message: string) => void;
}) {
  return (
    <div className="team-app">
      <AppHead title="Week at a glance" subtitle="Week 38 · 16–20 September" mode={mode} onNotice={onNotice} />
      <DayNavigator activeDay={activeDay} setActiveDay={setActiveDay} onNotice={onNotice} />
      <div className="team-summary">
        <span className="team-summary-text"><b>{tasks.filter((task) => task.status !== "completed").length} open tasks</b> · {mode === "manager" ? "a light weekly read" : "your assigned week"}</span>
        <SyncStatus tasks={tasks} mode={mode} />
      </div>
      <div className="team-week-grid">
        <div className="team-week-head"><span>Day</span><span>Workload</span><span>Open</span><span>Done</span></div>
        {days.map((day, index) => {
          const dayTasks = tasks.filter((task) => task.day === day.day);
          const open = dayTasks.filter((task) => task.status !== "completed");
          const done = dayTasks.filter((task) => task.status === "completed");
          return (
            <button type="button" className={`team-week-row ${index === activeDay ? "today" : ""}`} key={day.date} onClick={() => { setActiveDay(index); onNotice(`${day.short} summary selected`); }}>
              <span className="team-week-day"><b>{day.date}</b><span><strong>{day.short}</strong><small>{dayTasks.length} tasks</small></span></span>
              <span className="team-week-bars">
                {open.slice(0, 3).map((task) => <span className={`team-week-bar ${task.priority ? "clay" : task.status === "unassigned" ? "gold" : ""}`} key={task.id} onClick={(event) => { event.stopPropagation(); onOpen(task); }}>{mode === "manager" ? initials(task.owner) : "MY"}</span>)}
                {done.length > 0 && <span className="team-week-bar done"><Check size={11} /> {done.length}</span>}
              </span>
              <span className="team-week-stat"><strong>{open.length}</strong>open</span>
              <span className="team-week-stat"><strong>{done.length}</strong>done</span>
            </button>
          );
        })}
      </div>
      <div className="team-summary" style={{ paddingTop: 0 }}>
        <span className="team-summary-text">{mode === "manager" ? "Clay marks priority; gold marks a task that needs an owner." : "Your view keeps the rest of the crew out of sight."}</span>
        <button type="button" className="team-outline-btn" onClick={() => onNotice("Week export is ready")}><CalendarRange size={13} /> Export week</button>
      </div>
    </div>
  );
}

function MockupFrame({
  direction,
  phone,
  tasks,
  mode,
  activeDay,
  setActiveDay,
  onOpen,
  onToggle,
  onNotice,
}: {
  direction: Direction;
  phone?: boolean;
  tasks: PlannerTask[];
  mode: Mode;
  activeDay: number;
  setActiveDay: (index: number) => void;
  onOpen: (task: PlannerTask) => void;
  onToggle: (id: number) => void;
  onNotice: (message: string) => void;
}) {
  const props = { tasks, mode, activeDay, setActiveDay, onOpen, onToggle, onNotice };
  return (
    <div className={`team-frame ${phone ? "phone" : "desktop"}`}>
      {phone && <div className="team-phone-bar" />}
      {direction === "roster" && <RosterView {...props} />}
      {direction === "board" && <BoardView {...props} />}
      {direction === "week" && <WeekView {...props} />}
    </div>
  );
}

export function TeamPlannerOverview() {
  const [mode, setMode] = useState<Mode>("manager");
  const [direction, setDirection] = useState<Direction>("board");
  const [activeDay, setActiveDay] = useState(2);
  const [tasks, setTasks] = useState(seedTasks);
  const [selectedTask, setSelectedTask] = useState<PlannerTask | null>(null);
  const [notice, setNotice] = useState("");

  const visibleTasks = useMemo(
    () => mode === "worker" ? tasks.filter((task) => task.owner === "Mara") : tasks,
    [mode, tasks],
  );
  const openCount = visibleTasks.filter((task) => task.status !== "completed").length;

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  };

  const toggleTask = (id: number) => {
    setTasks((current) => current.map((task) => task.id === id
      ? { ...task, status: task.status === "completed" ? "open" : "completed", pendingSync: true }
      : task));
    flash("Saved on this device · waiting to sync");
  };

  const handleMode = (nextMode: Mode) => {
    setMode(nextMode);
    setSelectedTask(null);
    flash(nextMode === "worker" ? "Worker view · only your assigned work is shown" : "Manager view · crew assignments are visible");
  };

  const selectDirection = (next: Direction) => {
    setDirection(next);
    document.getElementById(`team-direction-${next}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="team-preview">
      <div className="team-shell">
        <header className="team-topbar">
          <div className="team-brand">
            <span className="team-brand-mark"><Leaf size={20} /></span>
            <span><strong>Fieldbook</strong><small>Team planner / decision preview</small></span>
          </div>
          <div className="team-mode">
            <span className="team-mode-label">Access mode</span>
            <div className="team-segment">
              <button type="button" className={mode === "manager" ? "active" : ""} onClick={() => handleMode("manager")}>Manager</button>
              <button type="button" className={mode === "worker" ? "active" : ""} onClick={() => handleMode("worker")}>Worker · Mara</button>
            </div>
          </div>
        </header>

        <section className="team-intro">
          <div>
            <p className="team-kicker">Oakhaven farm · Wednesday 18 September</p>
            <h1>See the whole crew.<br /><em>Give each person one clear next step.</em></h1>
          </div>
          <p className="team-intro-copy"><strong>Three ways to hold the working day.</strong> Compare the manager’s wide view with the worker’s quieter, private run. Every surface below is interactive.</p>
        </section>

        <nav className="team-tabs" aria-label="Overview directions">
          {(Object.keys(directionInfo) as Direction[]).map((item, index) => (
            <button type="button" className={`team-tab ${direction === item ? "active" : ""}`} key={item} onClick={() => selectDirection(item)}>
              <span className="team-tab-index">0{index + 1} / direction</span>
              <span className="team-tab-title">{directionInfo[item].title}</span>
              <span className="team-tab-desc">{directionInfo[item].desc}</span>
            </button>
          ))}
        </nav>

        <div className="team-decision">
          <p><b>{openCount} open tasks</b> in {mode === "manager" ? "the crew plan" : "your private plan"} · Click a task to inspect it, or use the small square to log it complete.</p>
          <span className="team-decision-note"><CircleAlert size={13} /> Recommended: selected-day board</span>
        </div>

        {(Object.keys(directionInfo) as Direction[]).map((item, index) => (
          <section className="team-direction" id={`team-direction-${item}`} key={item}>
            <header className="team-direction-head">
              <div>
                <p className="team-direction-number">Direction 0{index + 1}</p>
                <h2>{directionInfo[item].title}</h2>
              </div>
              <p className="team-direction-blurb">{directionInfo[item].blurb}</p>
            </header>
            <div className="team-treatments">
              <div className="team-treatment">
                <p className="team-treatment-label"><span>Chrome desktop</span><span>wide scan / manager-ready</span></p>
                <MockupFrame direction={item} tasks={visibleTasks} mode={mode} activeDay={activeDay} setActiveDay={setActiveDay} onOpen={setSelectedTask} onToggle={toggleTask} onNotice={flash} />
              </div>
              <div className="team-treatment">
                <p className="team-treatment-label"><span>Phone / home screen</span><span>thumb-first</span></p>
                <MockupFrame direction={item} phone tasks={visibleTasks} mode={mode} activeDay={activeDay} setActiveDay={setActiveDay} onOpen={setSelectedTask} onToggle={toggleTask} onNotice={flash} />
              </div>
            </div>
          </section>
        ))}

        <footer className="team-footer">
          <span><b>Fieldbook team overview</b> · a design exploration, not a production route</span>
          <span>Clay = priority · gold = needs an owner · line = synced state</span>
        </footer>
      </div>

      {notice && <div className="team-notice" role="status">{notice}</div>}

      {selectedTask && (
        <div className="team-drawer-backdrop" role="presentation" onClick={() => setSelectedTask(null)}>
          <aside className="team-drawer" role="dialog" aria-modal="true" aria-label="Task details" onClick={(event) => event.stopPropagation()}>
            <div className="team-drawer-top">
              <div>
                <p className="team-kicker">{selectedTask.day} {selectedTask.date} · task detail</p>
                <h3>{selectedTask.title}</h3>
              </div>
              <button type="button" className="team-icon-btn" aria-label="Close task details" onClick={() => setSelectedTask(null)}><X size={16} /></button>
            </div>
            <div className="team-drawer-meta">
              <div><span>When</span><b>{selectedTask.time}</b></div>
              <div><span>Place</span><b>{selectedTask.location}</b></div>
              <div><span>Status</span><b>{statusLabel(selectedTask.status)}</b></div>
            </div>
            <p>{selectedTask.note}</p>
            {mode === "manager" && <div className="team-drawer-meta"><div><span>Assigned to</span><b>{selectedTask.owner}</b></div><div><span>Access</span><b>Manager edit</b></div><div><span>Sync</span><b>{selectedTask.pendingSync ? "Pending" : "Current"}</b></div></div>}
            <div className="team-drawer-actions">
              <button type="button" onClick={() => { toggleTask(selectedTask.id); setSelectedTask(null); }}>{selectedTask.status === "completed" ? "Reopen task" : "Mark complete"}</button>
              {mode === "manager" && <>
                <button type="button" onClick={() => { setSelectedTask(null); flash("Move task drawer opened"); }}><MoveRight size={14} /> Move</button>
                <button type="button" onClick={() => { setSelectedTask(null); flash("Task editor opened"); }}><Edit3 size={14} /> Edit</button>
                <button type="button" onClick={() => { setSelectedTask(null); flash("Choose a crew member to assign"); }}><UserPlus size={14} /> Assign</button>
              </>}
              {mode === "worker" && <button type="button" onClick={() => { setSelectedTask(null); flash("Note saved to this task"); }}>Add note</button>}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

export default TeamPlannerOverview;