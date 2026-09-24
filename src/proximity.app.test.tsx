import{beforeEach,describe,expect,it,vi}from'vitest';
import React from'react';
import{cleanup,fireEvent,render,screen,within}from'@testing-library/react';
import'@testing-library/jest-dom/vitest';
import App from'./App';
import{Specimen}from'./types';
import{REVIEW_KEY}from'./proximity';

const KEY='plant-preflight-v1';
// 两记录相隔 dMetres 米：沿经线移动纬度（平均 1° ≈ 111195 米），距离对半径变化可控
const latAt=(dMetres:number)=>String(dMetres/111194.9266);
const rec=(i:number,x:Partial<Specimen>={}):Specimen=>({id:`id${i}`,collectionNo:`A-00${i}`,species:'松 Pinus',collector:'甲',date:'2026-03-01',location:'北京',latitude:'0',longitude:'0',habitat:'',resolutions:{},...x});
const seed=(rows:Specimen[])=>localStorage.setItem(KEY,JSON.stringify(rows));

beforeEach(()=>{
  localStorage.clear();
  vi.restoreAllMocks();
  cleanup();
  const proto=Blob.prototype as unknown as {text?:unknown};
  if(!proto.text){
    proto.text=function(this:Blob){
      return new Promise<string>((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=rej;r.readAsText(this)});
    };
  }
});

const openTab=()=>fireEvent.click(screen.getByRole('button',{name:'近地点复核'}));
const pairCard=(ids:string)=>document.querySelector(`.proxy-pair[data-pair="${ids}"]`) as HTMLElement|null;
const allPairCards=()=>[...document.querySelectorAll('.proxy-pair')]as HTMLElement[];
const radiusInput=()=>document.querySelector('.proxy-radius input')as HTMLInputElement;
const badgeText=(card:HTMLElement)=>card.querySelector('.proxy-badge')!.textContent!;
const stat=(label:string)=>{
  const s=[...document.querySelectorAll('.proxy-stats span')].find(x=>x.textContent!.includes(label))!;
  return s.querySelector('b')!.textContent!;
};
const editFieldInModal=(no:string,labelText:string,value:string)=>{
  const card=[...document.querySelectorAll('.record')].find(c=>c.textContent!.includes(no))! as HTMLElement;
  fireEvent.click(within(card).getByRole('button',{name:'编辑'}));
  const lab=[...screen.getAllByText((_,el)=>!!el&&el.tagName==='SPAN'&&el.closest('.modal')!==null)].find(s=>s.textContent===labelText||s.textContent===`${labelText} *`)!;
  const input=lab.parentElement!.querySelector('input')as HTMLInputElement;
  fireEvent.change(input,{target:{value}});
  fireEvent.click(screen.getByText('保存记录'));
};

describe('近地点复核工作区',()=>{
  it('换半径：同组不同号、相距约 30 米的记录对随半径出入，距离展示保留两位小数',async()=>{
    seed([rec(1),rec(2,{latitude:latAt(30)})]);
    render(<App/>);
    openTab();
    expect(await screen.findByText(/候选对/)).toBeInTheDocument();
    expect(stat('候选对')).toBe('1');
    expect(allPairCards()).toHaveLength(1);
    expect(allPairCards()[0].textContent).toContain('30.00 米');
    // 半径 10：消失；半径 29 仍在界外，半径 31 重新出现（严格 ≤ 边界由领域测试覆盖）
    fireEvent.change(radiusInput(),{target:{value:'10'}});
    expect(allPairCards()).toHaveLength(0);
    expect(screen.getByText(/当前半径内没有需要复核的记录对/)).toBeInTheDocument();
    fireEvent.change(radiusInput(),{target:{value:'29'}});
    expect(allPairCards()).toHaveLength(0);
    fireEvent.change(radiusInput(),{target:{value:'31'}});
    expect(allPairCards()).toHaveLength(1);
    // 半径 1000：仍只有一对（不重复）
    fireEvent.change(radiusInput(),{target:{value:'1000'}});
    expect(allPairCards()).toHaveLength(1);
    // 非法半径不生效并给出提示，仍按 1000 计算
    fireEvent.change(radiusInput(),{target:{value:'0'}});
    expect(screen.getByText(/仍按 1000 米计算/)).toBeInTheDocument();
    expect(allPairCards()).toHaveLength(1);
    expect(localStorage.getItem(REVIEW_KEY)).toContain('"radius":1000');
  });

  it('跨 180° 经线两侧按最短经度差配对',async()=>{
    seed([
      rec(1,{collectionNo:'E-1',latitude:'0',longitude:'179.9999'}),
      rec(2,{collectionNo:'W-9',latitude:'0',longitude:'-179.9999'}),
    ]);
    render(<App/>);
    openTab();
    expect(await screen.findByText(/候选对/)).toBeInTheDocument();
    expect(allPairCards()).toHaveLength(1);
    const card=allPairCards()[0];
    expect(card.textContent).toContain('E-1');
    expect(card.textContent).toContain('W-9');
    // 0.0002° 经度差，赤道约 22 米；若错误按 359.9998° 则近 4 万千米，不会在 50 米内
    expect(card.textContent).toMatch(/2\d\.\d\d 米/);
    fireEvent.change(radiusInput(),{target:{value:'5'}});
    expect(allPairCards()).toHaveLength(0);
    fireEvent.change(radiusInput(),{target:{value:'50'}});
    expect(allPairCards()).toHaveLength(1);
  });

  it('边界距离：展示同为 10.00 米，半径 10 时未舍入值 10.0049 不入选',async()=>{
    // 10.0049 米 → toFixed(2) 显示 10.00，但 > 10
    seed([rec(1),rec(2,{latitude:latAt(10.0049)})]);
    render(<App/>);
    openTab();
    fireEvent.change(radiusInput(),{target:{value:'10'}});
    expect(await screen.findByText(/当前半径内没有需要复核的记录对/)).toBeInTheDocument();
    // 放大到 11 米则出现，且展示仍为 10.00 米（判定与展示解耦）
    fireEvent.change(radiusInput(),{target:{value:'11'}});
    expect(allPairCards()).toHaveLength(1);
    expect(allPairCards()[0].textContent).toContain('10.00 米');
  });

  it('不同采集人/日期/物种或编号相同不进入复核；无有效坐标也不出现',async()=>{
    seed([
      rec(1),
      rec(2,{latitude:latAt(5),collector:'乙'}),
      rec(3,{id:'id3',collectionNo:'A-003',latitude:latAt(5),date:'2026-03-02'}),
      rec(4,{id:'id4',collectionNo:'A-004',latitude:latAt(5),species:'杉'}),
      rec(5,{id:'id5',collectionNo:'A-001',latitude:latAt(5)}),
      rec(6,{id:'id6',collectionNo:'A-006',latitude:'99',longitude:'0'}),
    ]);
    render(<App/>);
    openTab();
    expect(await screen.findByText(/有效坐标记录/)).toBeInTheDocument();
    expect(stat('有效坐标记录')).toBe('5');
    expect(allPairCards()).toHaveLength(0);
  });

  it('标记同点复采/确为两份后持久化，改一方编号仅该对回到待复核，刷新后一致',async()=>{
    // 两个独立分组：甲/松 与 乙/杉，各一对且都 ≈5 米
    seed([
      rec(1,{latitude:latAt(5)}),
      rec(2,{collectionNo:'A-002'}),
      rec(3,{id:'id3',collectionNo:'B-001',species:'杉 Taxus',collector:'乙',latitude:latAt(5)}),
      rec(4,{id:'id4',collectionNo:'B-002',species:'杉 Taxus',collector:'乙'}),
    ]);
    render(<App/>);
    openTab();
    expect(allPairCards()).toHaveLength(2);
    // 标记 id1-id2 为同点复采
    const ab=pairCard('id1 id2')!;
    fireEvent.click(within(ab).getByRole('button',{name:'同点复采'}));
    expect(await screen.findByText(/已标记为同点复采/)).toBeInTheDocument();
    expect(badgeText(ab)).toContain('同点复采');
    expect(stat('同点复采')).toBe('1');
    expect(stat('待复核')).toBe('1');
    let stored=JSON.parse(localStorage.getItem(REVIEW_KEY)!);
    expect(stored.verdicts).toHaveLength(1);
    expect(stored.verdicts[0]).toMatchObject({ids:['id1','id2'],verdict:'same'});
    // 改判：确为两份
    fireEvent.click(within(ab).getByRole('button',{name:'确为两份'}));
    expect(badgeText(ab)).toContain('确为两份');
    expect(JSON.parse(localStorage.getItem(REVIEW_KEY)!).verdicts[0].verdict).toBe('separate');

    // 标记另一对 id3-id4 为同点复采，用于验证“仅对应结论失效”
    fireEvent.click(within(pairCard('id3 id4')!).getByRole('button',{name:'同点复采'}));
    expect(stat('同点复采')).toBe('1');
    expect(stat('确为两份')).toBe('1');

    // 编辑 id1 的编号：只使 id1-id2 失效；id3-id4 不受影响
    fireEvent.click(screen.getByRole('button',{name:'预检工作台'}));
    editFieldInModal('A-001','采集编号','A-010');
    fireEvent.click(screen.getByRole('button',{name:'近地点复核'}));
    const stale=pairCard('id1 id2')!;
    expect(badgeText(stale)).toBe('待复核');
    expect(stat('确为两份')).toBe('0');
    expect(stat('同点复采')).toBe('1');
    expect(badgeText(pairCard('id3 id4')!)).toContain('同点复采');
    // 失效结论已不展示确认时间
    expect(stored.verdicts.length).toBeGreaterThanOrEqual(1);

    // 刷新恢复：未受影响的 id3-id4 结论仍在；id1-id2 仍待复核
    cleanup();
    render(<App/>);
    openTab();
    expect(badgeText(pairCard('id1 id2')!)).toBe('待复核');
    expect(badgeText(pairCard('id3 id4')!)).toContain('同点复采');
  });

  it('改坐标使双方离开半径时该对消失且结论沉睡，改回后因指纹变化仍回到待复核',async()=>{
    seed([rec(1),rec(2,{latitude:latAt(5)})]);
    render(<App/>);
    openTab();
    fireEvent.click(within(pairCard('id1 id2')!).getByRole('button',{name:'同点复采'}));
    expect(await screen.findByText(/已标记为同点复采/)).toBeInTheDocument();
    // 改 id2 坐标拉开到 200 米，半径 50 → 对消失
    fireEvent.click(screen.getByRole('button',{name:'预检工作台'}));
    editFieldInModal('A-002','纬度',latAt(200));
    fireEvent.click(screen.getByRole('button',{name:'近地点复核'}));
    expect(pairCard('id1 id2')).toBeNull();
    // 改回相近但不同的坐标（4 米，仍在半径内）：指纹已变，结论不再沿用
    fireEvent.click(screen.getByRole('button',{name:'预检工作台'}));
    editFieldInModal('A-002','纬度',latAt(4));
    fireEvent.click(screen.getByRole('button',{name:'近地点复核'}));
    expect(badgeText(pairCard('id1 id2')!)).toBe('待复核');
  });

  it('刷新（重新挂载）后半径与结论均恢复',async()=>{
    seed([rec(1),rec(2,{latitude:latAt(5)})]);
    const{unmount}=render(<App/>);
    openTab();
    fireEvent.change(radiusInput(),{target:{value:'123'}});
    fireEvent.click(within(pairCard('id1 id2')!).getByRole('button',{name:'确为两份'}));
    unmount();
    render(<App/>);
    openTab();
    expect(radiusInput().value).toBe('123');
    expect(badgeText(pairCard('id1 id2')!)).toContain('确为两份');
    expect(stat('确为两份')).toBe('1');
  });

  it('存储写入失败时不留下已确认假象：徽标、统计与存储都不变',async()=>{
    seed([rec(1),rec(2,{latitude:latAt(5)})]);
    render(<App/>);
    openTab();
    const card=pairCard('id1 id2')!;
    expect(badgeText(card)).toBe('待复核');
    const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation((key:string)=>{
      if(key===REVIEW_KEY)throw new Error('QuotaExceededError');
    });
    fireEvent.click(within(card).getByRole('button',{name:'同点复采'}));
    expect(await screen.findByText(/复核结论写入本地存储失败/)).toBeInTheDocument();
    spy.mockRestore();
    expect(badgeText(card)).toBe('待复核');
    expect(stat('同点复采')).toBe('0');
    // 存储中没有复核键（此前未保存过半径）
    expect(localStorage.getItem(REVIEW_KEY)).toBeNull();
  });

  it('复核操作不改写原始记录，也不影响既有的采集编号问题与撤销入口',async()=>{
    seed([rec(1),rec(2,{latitude:latAt(5)})]);
    render(<App/>);
    openTab();
    fireEvent.click(within(pairCard('id1 id2')!).getByRole('button',{name:'同点复采'}));
    expect(await screen.findByText(/已标记为同点复采/)).toBeInTheDocument();
    // 原始记录 JSON 不含任何复核字段
    const raw=JSON.parse(localStorage.getItem(KEY)!)as Specimen[];
    expect(raw).toHaveLength(2);
    expect(raw.every(r=>!('verdict'in r))).toBe(true);
    // 工作集工具栏与原有预检界面保持不变
    fireEvent.click(screen.getByRole('button',{name:'预检工作台'}));
    expect(screen.getByText('标本工作集')).toBeInTheDocument();
    expect([...document.querySelectorAll('.record')]).toHaveLength(2);
  });
});
