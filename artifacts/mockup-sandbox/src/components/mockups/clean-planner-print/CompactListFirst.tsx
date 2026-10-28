import React, { useMemo, useState } from "react";
import { Check, ChevronDown, MapPin, Plus, Printer, Search, SlidersHorizontal, Sprout } from "lucide-react";
import "./_group.css";

type Task = { id:number; title:string; group:string; priority:"Urgent"|"High"|"Medium"|"Low"; due:string; place:string; assignee:string; note?:string; done:boolean; overdue?:boolean; subtasks?:string };
const seed:Task[]=[
  {id:1,title:"Repair break in lower fence line",group:"Pasture",priority:"Urgent",due:"Sep 16",place:"South boundary",assignee:"Mara",note:"Bring post driver",done:false,overdue:true},
  {id:2,title:"Check north orchard irrigation",group:"Orchard",priority:"High",due:"Today",place:"North block",assignee:"Jon",note:"Valve 4 and east line",done:false,subtasks:"1/3 steps"},
  {id:3,title:"Sort windfall apples for cider",group:"Harvest",priority:"Medium",due:"Today",place:"Packing shed",assignee:"Mara",done:false},
  {id:4,title:"Walk young plum row for leaf curl",group:"Orchard",priority:"Medium",due:"Sep 19",place:"East orchard",assignee:"Unassigned",done:false,subtasks:"0/2 steps"},
  {id:5,title:"Move mineral tub to upper paddock",group:"Livestock",priority:"Low",due:"Sep 20",place:"Upper pasture",assignee:"Jon",done:false},
  {id:6,title:"Record weekly egg count",group:"Harvest",priority:"Low",due:"Sep 16",place:"Hen house",assignee:"Mara",done:true},
];
export default function CompactListFirst(){
 const [tasks,setTasks]=useState(seed),[query,setQuery]=useState(""),[view,setView]=useState<"open"|"all"|"done">("open");
 const shown=useMemo(()=>tasks.filter(t=>(view==="all"||view==="done"?t.done:!t.done)&&`${t.title} ${t.place} ${t.group}`.toLowerCase().includes(query.toLowerCase())),[tasks,query,view]);
 const toggle=(id:number)=>setTasks(x=>x.map(t=>t.id===id?{...t,done:!t.done}:t));
 return <main className="farm-print"><div className="fp-shell"><aside className="fp-rail"><div className="fp-mark"><span className="fp-mark-icon"><Sprout size={19}/></span><span><strong>Fieldbook</strong><small>Orchard + pasture</small></span></div><nav className="fp-nav"><button>Today</button><button className="active">All tasks</button><button>Assistant</button><button>Settings</button></nav><div className="fp-foot"><span className="fp-dot"/>Sheet connected<br/>Last update just now</div></aside><section className="fp-content">
 <header className="fp-top"><div><p className="fp-kicker">All tasks · September</p><h1>Work list</h1></div><div className="fp-actions"><button className="fp-button" onClick={()=>window.print()}><Printer size={15}/>Print</button><button className="fp-button primary" onClick={()=>setTasks(x=>[...x,{id:Date.now(),title:"New field task",group:"General",priority:"Low",due:"Unscheduled",place:"Add place",assignee:"Unassigned",done:false}])}><Plus size={15}/>Add task</button></div></header>
 <div className="fp-searchrow"><label className="fp-search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search task or place"/></label><button className="fp-filter"><SlidersHorizontal size={14}/> All groups <ChevronDown size={13}/></button><button className="fp-filter">September <ChevronDown size={13}/></button></div>
 <div className="fp-tabs">{(["open","all","done"] as const).map(x=><button key={x} className={view===x?"active":""} onClick={()=>setView(x)}>{x==="open"?"Open work":x==="all"?"Everything":"Completed"} {x==="open"&&`(${tasks.filter(t=>!t.done).length})`}</button>)}</div>
 <div className="fp-panel"><div className="fp-listhead"><span>Task</span><span>Priority</span><span>Due</span><span>Place</span><span>Assigned</span></div>{shown.map(t=><article className={`fp-task ${t.done?"done":""}`} key={t.id}><div className="fp-main"><button aria-label={`Complete ${t.title}`} className={`fp-check ${t.done?"checked":""}`} onClick={()=>toggle(t.id)}>{t.done&&<Check size={13}/>}</button><div><div className="fp-tasktitle">{t.title}</div><div className="fp-meta">{t.group}{t.note&&` · ${t.note}`}{t.subtasks&&` · ${t.subtasks}`}</div></div></div><div className={`fp-badge ${t.priority.toLowerCase()}`}>{t.priority}</div><div className={t.overdue&&!t.done?"fp-overdue fp-cell":"fp-cell"}>{t.overdue&&!t.done?"Overdue · ":""}{t.due}</div><div className="fp-cell fp-place"><MapPin size={12}/>{t.place}</div><div className="fp-cell">{t.assignee}</div></article>)}</div>
 <footer className="fp-printline"><span>{shown.length} tasks shown · Google Sheet source</span><span>Fieldbook / kept for the crew</span></footer>
 </section></div></main>
}