import{beforeEach,describe,expect,it,vi}from'vitest';
import{DEFAULT_RADIUS,EARTH_RADIUS,MAX_RADIUS,MIN_RADIUS,REVIEW_KEY,ReviewVerdictEntry,applyVerdict,clampRadius,fingerprint,findNearbyPairs,formatDistance,haversine,isValidRadius,loadReviewState,parseReviewState,reconcileVerdicts,saveReviewState}from'./proximity';
import{Specimen}from'./types';

const row=(x:Partial<Specimen>):Specimen=>({id:'r1',collectionNo:'A-001',species:'松 Pinus',collector:'甲',date:'2026-03-01',location:'北京',latitude:'39.9',longitude:'116.2',habitat:'',resolutions:{},...x});

beforeEach(()=>localStorage.clear());

describe('球面距离 haversine 与跨 180° 经线',()=>{
  it('同点距离为 0',()=>{
    expect(haversine(39.9,116.2,39.9,116.2)).toBe(0);
  });
  it('沿经线 1° 约为 111.195 km，对称性成立',()=>{
    const d=haversine(0,0,1,0);
    expect(d).toBeCloseTo(2*Math.PI*EARTH_RADIUS/360,-1);
    expect(d).toBeCloseTo(haversine(1,0,0,0),10);
  });
  it('179.9° 与 -179.9° 按 0.2° 最短经度差，而非绕地球 359.8°',()=>{
    const across=haversine(0,179.9,0,-179.9);
    expect(across).toBeCloseTo(haversine(0,0,0.2,0),8);
    expect(across).toBeLessThan(25000);
    // 反例：若按 359.8° 算会接近绕地球一周
    expect(across).not.toBeGreaterThan(40000000-25000);
  });
  it('恰在 ±180° 经线两侧也按最短弧计算',()=>{
    expect(haversine(10,180,10,-180)).toBeCloseTo(0,6);
    expect(haversine(10,180,10,-179.99)).toBeCloseTo(haversine(10,0,10,0.01),6);
  });
});

describe('findNearbyPairs：分组、编号不同、稳定排序与不传递',()=>{
  const a=()=>row({id:'a',collectionNo:'A-1'});
  it('仅坐标合法记录参与：非法坐标记录不产生对',()=>{
    const bad=row({id:'b',collectionNo:'A-2',latitude:'99',longitude:'1'});
    expect(findNearbyPairs([a(),bad],1000)).toEqual([]);
  });
  it('采集人、日期、物种任一不同都不配对（采集人/物种去首尾空格）',()=>{
    const close=row({id:'b',collectionNo:'A-2',latitude:'39.9001',longitude:'116.2'});
    expect(findNearbyPairs([a(),close],1000)).toHaveLength(1);
    expect(findNearbyPairs([a(),{...close,collector:'乙'}],1000)).toEqual([]);
    expect(findNearbyPairs([a(),{...close,date:'2026-03-02'}],1000)).toEqual([]);
    expect(findNearbyPairs([a(),{...close,species:'杉'}],1000)).toEqual([]);
    const spaced={...close,collector:' 甲 ',species:' 松 Pinus '};
    expect(findNearbyPairs([a(),spaced],1000)).toHaveLength(1);
  });
  it('编号相同（含都为空）不复核，交给“采集编号重复”问题',()=>{
    const sameNo=row({id:'b',collectionNo:'A-1',latitude:'39.9001'});
    expect(findNearbyPairs([a(),sameNo],1000)).toEqual([]);
  });
  it('每对只出现一次且 id 小者在前，按内部 ID 稳定排序',()=>{
    const aRec=row({id:'a',collectionNo:'A-1',latitude:'0',longitude:'0'});
    const bRec=row({id:'b',collectionNo:'A-2',latitude:'0.00005',longitude:'0'});
    const cRec=row({id:'c',collectionNo:'A-3',latitude:'0.00009',longitude:'0'});
    // 乱序传入，输出仍按 (a,b) (a,c) (b,c) 的 ID 全序
    const pairs=findNearbyPairs([cRec,aRec,bRec],50);
    const keys=pairs.map(p=>p.ids.join('-'));
    expect(new Set(keys).size).toBe(keys.length);
    expect(pairs.every(p=>p.ids[0]<p.ids[1])).toBe(true);
    expect(keys).toEqual([...keys].sort());
  });
  it('不把 A-B、B-C 自动推断成 A-C',()=>{
    const aRec=row({id:'a',collectionNo:'A-1',latitude:'0',longitude:'0'});
    const bRec=row({id:'b',collectionNo:'A-2',latitude:'0.00005',longitude:'0'});
    const cRec=row({id:'c',collectionNo:'A-3',latitude:'0.00010',longitude:'0'});
    // a-b≈5.6m、b-c≈5.6m、a-c≈11.1m
    const pairs=findNearbyPairs([aRec,bRec,cRec],10);
    expect(pairs.map(p=>p.ids.join('-'))).toEqual(['a-b','b-c']);
  });
  it('跨 180° 经线两侧、相同采集人/日期/物种时配对',()=>{
    const east=row({id:'e',collectionNo:'E-1',latitude:'0',longitude:'179.9999'});
    const west=row({id:'w',collectionNo:'W-9',latitude:'0',longitude:'-179.9999'});
    const pairs=findNearbyPairs([east,west],50);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].ids).toEqual(['e','w']);
    expect(pairs[0].distance).toBeLessThan(25);
  });
});

describe('边界距离判定使用未舍入值',()=>{
  const pairAt=(dMetres:number,radius:number)=>{
    const latDeg=dMetres/111195;
    const x=row({id:'x',collectionNo:'X-1',latitude:'0',longitude:'0'});
    const y=row({id:'y',collectionNo:'Y-2',latitude:String(latDeg),longitude:'0'});
    return findNearbyPairs([x,y],radius);
  };
  it('距离等于半径（≤）入选',()=>{
    expect(pairAt(10,10)).toHaveLength(1);
  });
  it('比半径小一点点（展示已四舍五入到同值）仍按未舍入值入选',()=>{
    // 9.999 米展示为 "10.00 米"，半径 10：入选
    const inPairs=pairAt(9.999,10);
    expect(inPairs).toHaveLength(1);
    expect(formatDistance(inPairs[0].distance)).toBe('10.00 米');
  });
  it('比半径大一点点（展示同为 10.00）按未舍入值排除',()=>{
    // 10.0049 米展示为 "10.00 米"，半径 10：不得因展示舍入而入选
    const out=pairAt(10.0049,10);
    expect(out).toEqual([]);
  });
  it('换半径后同一对按新阈值出入',()=>{
    expect(pairAt(10.0049,9)).toEqual([]);
    expect(pairAt(10.0049,11)).toHaveLength(1);
  });
});

describe('指纹结论：匹配沿用、编辑失效、互不株连',()=>{
  const setup=()=>{
    const a=row({id:'a',collectionNo:'A-1',latitude:'0',longitude:'0'});
    const b=row({id:'b',collectionNo:'A-2',latitude:'0.00005',longitude:'0'});
    const c=row({id:'c',collectionNo:'A-3',latitude:'0.00010',longitude:'0'});
    return{a,b,c};
  };
  const pairsOf=(rows:Specimen[],r=10)=>findNearbyPairs(rows,r);
  it('无结论时全部待复核',()=>{
    const{a,b,c}=setup();
    const out=reconcileVerdicts(pairsOf([a,b,c]),[a,b,c],[]);
    expect(out.map(p=>p.verdict)).toEqual([null,null]);
  });
  it('指纹匹配时结论恢复，并附带双方记录',()=>{
    const{a,b,c}=setup();
    const v=applyVerdict([a,b,c],[],['a','b'],'same');
    const out=reconcileVerdicts(pairsOf([a,b,c]),[a,b,c],v);
    expect(out.find(p=>p.ids.join('-')==='a-b')!.verdict?.verdict).toBe('same');
    expect(out.find(p=>p.ids.join('-')==='b-c')!.verdict).toBeNull();
  });
  it('任一方修改编号、物种、采集人、日期或坐标，仅对应结论失效',()=>{
    const{a,b,c}=setup();
    const v=[
      ...applyVerdict([a,b,c],[],['a','b'],'same'),
      ...applyVerdict([a,b,c],[],['b','c'],'separate'),
    ];
    // 改 a 的编号：a-b 失效；b-c 不受影响
    const edited=[{...a,collectionNo:'A-99'},b,c];
    let out=reconcileVerdicts(pairsOf(edited),edited,v);
    expect(out.find(p=>p.ids.join('-')==='a-b')!.verdict).toBeNull();
    expect(out.find(p=>p.ids.join('-')==='b-c')!.verdict?.verdict).toBe('separate');
    // 改 b 的坐标：涉及 b 的两对都失效
    const moved=[a,{...b,latitude:'0.00006'},c];
    out=reconcileVerdicts(pairsOf(moved),moved,v);
    expect(out.every(p=>p.verdict===null)).toBe(true);
    // 改 c 的物种：只有 b-c 失效（物种不同后该对直接消失），a-b 仍有效
    const reSp=[a,b,{...c,species:'杉'}];
    out=reconcileVerdicts(pairsOf(reSp),reSp,v);
    expect(out.map(p=>p.ids.join('-'))).toEqual(['a-b']);
    expect(out[0].verdict?.verdict).toBe('same');
  });
  it('修改地点、生境备注不影响结论（指纹不含这两列）',()=>{
    const{a,b,c}=setup();
    const v=applyVerdict([a,b,c],[],['a','b'],'same');
    const edited=[{...a,location:'新地点',habitat:'新备注'},b,c];
    const out=reconcileVerdicts(pairsOf(edited),edited,v);
    expect(out[0].verdict?.verdict).toBe('same');
  });
  it('再次标记会替换原结论；applyVerdict 顺带清理已失效条目',()=>{
    const{a,b,c}=setup();
    let v=applyVerdict([a,b,c],[],['a','b'],'same');
    v=applyVerdict([a,b,c],v,['a','b'],'separate');
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe('separate');
    // a 改编号后旧指纹条目在下次保存任一结论时被清理
    const edited=[{...a,collectionNo:'A-99'},b,c];
    const next=applyVerdict(edited,v,['b','c'],'same');
    expect(next.find(e=>e.ids.join('-')==='a-b')).toBeUndefined();
    expect(next.find(e=>e.ids.join('-')==='b-c')!.verdict).toBe('same');
  });
  it('记录删除后该对不再出现；对已不存在的记录下结论抛错',()=>{
    const{a,b}=setup();
    const v=applyVerdict([a,b],[],['a','b'],'same');
    const out=reconcileVerdicts(pairsOf([b]),[b],v);
    expect(out).toEqual([]);
    expect(()=>applyVerdict([b],v,['a','b'],'same')).toThrow();
  });
  it('指纹包含原始文本（坐标尾随空格属于变化）',()=>{
    const a=row({id:'a',latitude:'0',longitude:'0'});
    const b=row({id:'b',collectionNo:'A-2',latitude:'0',longitude:'0.00005'});
    const v=applyVerdict([a,b],[],['b','a'],'same');
    expect(v[0].ids).toEqual(['a','b']);
    const spaced:Specimen[]=[a,{...b,longitude:'0.00005 '}];
    // 坐标文本多了尾随空格：解析后位置相同，但文本指纹变化 → 失效
    const out=reconcileVerdicts(findNearbyPairs(spaced,10),spaced,v);
    expect(out).toHaveLength(1);
    expect(out[0].verdict).toBeNull();
    expect(fingerprint(a)).toContain('a');
  });
});

describe('本地存储：解析、刷新恢复与写入失败不留假象',()=>{
  it('首次加载为默认半径与空结论',()=>{
    expect(loadReviewState()).toEqual({radius:DEFAULT_RADIUS,verdicts:[]});
    expect(localStorage.getItem(REVIEW_KEY)).toBeNull();
  });
  it('保存后可解析恢复，结论按对键排序且键顺序被规范化',()=>{
    const a=row({id:'a'}),b=row({id:'b',collectionNo:'A-2',latitude:'0.00005'});
    const verdicts=applyVerdict([a,b],[],['b','a'],'same');
    const state={radius:123,verdicts};
    expect(saveReviewState(state)).toBe(true);
    const parsed=parseReviewState(localStorage.getItem(REVIEW_KEY));
    expect(parsed&&parsed!=='invalid'?parsed.radius:null).toBe(123);
    expect(parsed&&parsed!=='invalid'?parsed.verdicts[0].ids:null).toEqual(['a','b']);
    expect(loadReviewState().verdicts[0].verdict).toBe('same');
  });
  it('损坏 JSON、结构非法、半径越界一律视为无效并回退默认',()=>{
    expect(parseReviewState('{坏')).toBe('invalid');
    expect(parseReviewState(JSON.stringify({radius:'10',verdicts:[]}))).toBe('invalid');
    expect(parseReviewState(JSON.stringify({radius:0,verdicts:[]}))).toBe('invalid');
    expect(parseReviewState(JSON.stringify({radius:1001,verdicts:[]}))).toBe('invalid');
    expect(parseReviewState(JSON.stringify({radius:50,verdicts:[{}]}))).toBe('invalid');
    expect(loadReviewState()).toEqual({radius:DEFAULT_RADIUS,verdicts:[]});
  });
  it('同一对重复载入时按键去重',()=>{
    const a=row({id:'a'}),b=row({id:'b',collectionNo:'A-2',latitude:'0.00005'});
    const fp=fingerprint(a);
    const dup:ReviewVerdictEntry[]=[
      {ids:['b','a'],verdict:'same',fpA:fp,fpB:fp,decidedAt:'1'},
      {ids:['a','b'],verdict:'separate',fpA:fp,fpB:fp,decidedAt:'2'},
    ];
    localStorage.setItem(REVIEW_KEY,JSON.stringify({radius:50,verdicts:dup}));
    const s=loadReviewState();
    expect(s.verdicts).toHaveLength(1);
  });
  it('setItem 抛错时 saveReviewState 返回 false，存储不被改动',()=>{
    const before=localStorage.getItem(REVIEW_KEY);
    const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('QuotaExceededError')});
    expect(saveReviewState({radius:10,verdicts:[]})).toBe(false);
    spy.mockRestore();
    expect(localStorage.getItem(REVIEW_KEY)).toBe(before);
  });
});

describe('半径与展示工具',()=>{
  it('合法半径边界为 1～1000，越界用默认值钳制',()=>{
    expect([MIN_RADIUS,MAX_RADIUS].every(isValidRadius)).toBe(true);
    expect(isValidRadius(0.5)).toBe(false);
    expect(isValidRadius(NaN)).toBe(false);
    expect(clampRadius(0)).toBe(DEFAULT_RADIUS);
    expect(clampRadius(1001)).toBe(DEFAULT_RADIUS);
    expect(clampRadius(250)).toBe(250);
  });
  it('距离只在展示时保留两位小数',()=>{
    expect(formatDistance(10.0049)).toBe('10.00 米');
    expect(formatDistance(0)).toBe('0.00 米');
  });
});
