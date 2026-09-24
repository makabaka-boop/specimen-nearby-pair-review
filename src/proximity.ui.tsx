import{useState}from'react';
import{Specimen}from'./types';
import{validCoords}from'./data';
import{ReconciledPair,ReviewVerdict,formatDistance,MAX_RADIUS,MIN_RADIUS,isValidRadius}from'./proximity';

export type ProximityWorkspaceProps={
  rows:Specimen[];
  pairs:ReconciledPair[];
  radius:number;
  onRadius:(r:number)=>boolean;
  onDecide:(ids:[string,string],verdict:ReviewVerdict)=>void;
};

const verdictLabel:Record<ReviewVerdict,string>={same:'同点复采',separate:'确为两份'};
const verdictBadge:Record<ReviewVerdict,string>={same:'同点复采',separate:'确为两份'};
const fmtTime=(iso:string)=>{const d=new Date(iso);return Number.isNaN(d.getTime())?iso:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`};

function PairCard({p,onDecide}:{p:ReconciledPair;onDecide:ProximityWorkspaceProps['onDecide']}){
  const{a,b}=p;
  const side=(r:Specimen)=><div className="proxy-side">
    <div><span>编号</span><b className="number">{r.collectionNo}</b></div>
    <div><span>内部 ID</span><code>{r.id}</code></div>
    <div><span>物种</span>{r.species||<em>（空）</em>}</div>
    <div><span>采集人 / 日期</span>{r.collector} · {r.date}</div>
    <div><span>地点</span>{r.location||'—'}</div>
    <div><span>坐标</span>{r.latitude}, {r.longitude}</div>
  </div>;
  return <article className={`proxy-pair${p.verdict?` decided ${p.verdict.verdict}`:''}`} data-pair={`${p.ids[0]} ${p.ids[1]}`}>
    <div className="proxy-pair-head">
      <span className="proxy-dist">{formatDistance(p.distance)}</span>
      {p.verdict
        ?<span className="proxy-badge">{verdictBadge[p.verdict.verdict]}<small>（{fmtTime(p.verdict.decidedAt)} 确认）</small></span>
        :<span className="proxy-badge pending">待复核</span>}
    </div>
    <div className="proxy-sides">{side(a)}<i>↔</i>{side(b)}</div>
    <div className="proxy-actions">
      {(['same','separate']as ReviewVerdict[]).map(v=><button key={v} type="button" className={p.verdict?.verdict===v?'primary':''} aria-pressed={p.verdict?.verdict===v} onClick={()=>onDecide(p.ids,v)}>{verdictLabel[v]}</button>)}
    </div>
  </article>;
}

export default function ProximityWorkspace({rows,pairs,radius,onRadius,onDecide}:ProximityWorkspaceProps){
  const[text,setText]=useState(String(radius));
  const commit=(v:string)=>{
    setText(v);
    if(v.trim()!==''&&isValidRadius(Number(v))&&!onRadius(Number(v)))setText(String(radius));
  };
  const pending=pairs.filter(p=>!p.verdict).length;
  const same=pairs.filter(p=>p.verdict?.verdict==='same').length;
  const separate=pairs.filter(p=>p.verdict?.verdict==='separate').length;
  const validCount=rows.filter(r=>validCoords(r.latitude,r.longitude)).length;
  const textValid=text.trim()===''||isValidRadius(Number(text));
  return <section className="proxy" aria-label="近地点复核">
    <div className="proxy-bar">
      <label className="proxy-radius"><b>复核半径</b><input inputMode="numeric" value={text} aria-invalid={!textValid} onChange={e=>commit(e.target.value)}/><span>米（{MIN_RADIUS}～{MAX_RADIUS}）</span></label>
      <div className="proxy-stats"><span>有效坐标记录 <b>{validCount}</b></span><span>候选对 <b>{pairs.length}</b></span><span>待复核 <b>{pending}</b></span><span>同点复采 <b>{same}</b></span><span>确为两份 <b>{separate}</b></span></div>
    </div>
    {!textValid&&<p className="proxy-hint">半径需为 {MIN_RADIUS}～{MAX_RADIUS} 之间的数值（米），当前仍按 {radius} 米计算。</p>}
    <p className="proxy-note">按相同采集人、日期与物种分组，用球面距离（跨 180° 经线按最短经度差）筛选距离 ≤ {radius} 米、且编号不同的记录对；只逐对列出，不做传递推断。结论绑定双方编号、物种、采集人、日期与坐标的指纹，任一字段修改后该对自动回到待复核。</p>
    {!pairs.length
      ? <div className="empty"><div>❧</div><h2>当前半径内没有需要复核的记录对</h2><p>尝试加大半径，或导入带有效坐标、相同采集人/日期/物种的记录。</p></div>
      : <div className="proxy-list">{pairs.map((p)=><PairCard key={`${p.ids[0]} ${p.ids[1]}`} p={p} onDecide={onDecide}/>)}</div>}
  </section>;
}
