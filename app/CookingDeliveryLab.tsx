'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { sitePath } from './sitePath';

type Status = 'idle' | 'running' | 'paused' | 'complete';
type PresetKey = 'balanced' | 'kitchen' | 'delivery' | 'rush' | 'custom';
type Station = 'prep' | 'cook' | 'pack' | 'delivery';

type Params = {
  orderRate: number;
  prepTime: number;
  prepWorkers: number;
  cookTime: number;
  cookWorkers: number;
  packTime: number;
  packWorkers: number;
  deliveryTime: number;
  couriers: number;
  patience: number;
  price: number;
  materialCost: number;
  timeoutPenalty: number;
};

type Order = {
  id: number;
  bornAt: number;
  queueEntered: number;
  stage: Station;
  remaining: number;
  waitTime: number;
};

type SimState = {
  status: Status;
  elapsed: number;
  nextOrderAt: number;
  nextOrderId: number;
  queues: Record<Station, Order[]>;
  active: Record<Station, Order[]>;
  busyTime: Record<Station, number>;
  created: number;
  completed: number;
  failed: number;
  totalCycleTime: number;
  totalSatisfaction: number;
  revenue: number;
  materialSpend: number;
  penalties: number;
  lastEvent: string;
};

type RunResult = {
  id: number;
  preset: string;
  throughput: number;
  avgCycle: number;
  satisfaction: number;
  completionRate: number;
  net: number;
  bottleneck: string;
  completed: number;
  failed: number;
};

const stations: Station[] = ['prep', 'cook', 'pack', 'delivery'];
const stationNames: Record<Station, string> = { prep: '備料', cook: '烹飪', pack: '包裝', delivery: '配送' };
const duration = 180;

const presets: Record<Exclude<PresetKey, 'custom'>, Params> = {
  balanced: { orderRate: 6, prepTime: 5, prepWorkers: 1, cookTime: 16, cookWorkers: 2, packTime: 4, packWorkers: 1, deliveryTime: 24, couriers: 3, patience: 90, price: 180, materialCost: 65, timeoutPenalty: 50 },
  kitchen: { orderRate: 7, prepTime: 5, prepWorkers: 1, cookTime: 24, cookWorkers: 2, packTime: 4, packWorkers: 1, deliveryTime: 22, couriers: 3, patience: 95, price: 180, materialCost: 65, timeoutPenalty: 50 },
  delivery: { orderRate: 7, prepTime: 5, prepWorkers: 1, cookTime: 15, cookWorkers: 2, packTime: 4, packWorkers: 1, deliveryTime: 38, couriers: 3, patience: 100, price: 180, materialCost: 65, timeoutPenalty: 50 },
  rush: { orderRate: 10, prepTime: 6, prepWorkers: 1, cookTime: 18, cookWorkers: 2, packTime: 5, packWorkers: 1, deliveryTime: 30, couriers: 3, patience: 75, price: 200, materialCost: 70, timeoutPenalty: 80 },
};

const presetNames: Record<PresetKey, string> = { balanced: '均衡營運', kitchen: '廚房瓶頸', delivery: '配送瓶頸', rush: '尖峰時段', custom: '自訂參數' };

function emptyStations<T>(): Record<Station, T[]> {
  return { prep: [], cook: [], pack: [], delivery: [] };
}

function emptyBusy(): Record<Station, number> {
  return { prep: 0, cook: 0, pack: 0, delivery: 0 };
}

function createSim(status: Status = 'idle'): SimState {
  return { status, elapsed: 0, nextOrderAt: 0, nextOrderId: 1, queues: emptyStations<Order>(), active: emptyStations<Order>(), busyTime: emptyBusy(), created: 0, completed: 0, failed: 0, totalCycleTime: 0, totalSatisfaction: 0, revenue: 0, materialSpend: 0, penalties: 0, lastEvent: '等待開始模擬' };
}

function fmt(value: number, decimals = 0) {
  return value.toLocaleString('zh-TW', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function timeLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

function stageCapacity(params: Params, station: Station) {
  const times = { prep: params.prepTime, cook: params.cookTime, pack: params.packTime, delivery: params.deliveryTime };
  const workers = { prep: params.prepWorkers, cook: params.cookWorkers, pack: params.packWorkers, delivery: params.couriers };
  return workers[station] * 60 / times[station];
}

function bottleneckOf(state: SimState, params: Params) {
  let selected: Station = 'prep';
  let score = -1;
  stations.forEach((station) => {
    const utilization = state.elapsed > 0 ? state.busyTime[station] / state.elapsed : params.orderRate / stageCapacity(params, station);
    const pressure = utilization + state.queues[station].length * .12;
    if (pressure > score) { score = pressure; selected = station; }
  });
  return stationNames[selected];
}

type RangeProps = { label: string; hint: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void };

function RangeControl({ label, hint, value, min, max, step = 1, suffix = '', onChange }: RangeProps) {
  const fill = ((value - min) / (max - min)) * 100;
  const decimals = step < 1 ? 1 : 0;
  return <label className="range-control"><span className="range-heading"><b>{label}</b><output>{fmt(value, decimals)}{suffix}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} style={{ '--range-fill': `${fill}%` } as React.CSSProperties} onChange={(event) => onChange(Number(event.target.value))} /><small>{hint}</small></label>;
}

export default function CookingDeliveryLab() {
  const [params, setParams] = useState<Params>(presets.balanced);
  const [presetKey, setPresetKey] = useState<PresetKey>('balanced');
  const [controlTab, setControlTab] = useState<'flow' | 'economy'>('flow');
  const [simSpeed, setSimSpeed] = useState(4);
  const [sim, setSim] = useState<SimState>(() => createSim());
  const [history, setHistory] = useState<RunResult[]>([]);
  const [comparison, setComparison] = useState<{ A?: RunResult; B?: RunResult }>({});
  const [eventLog, setEventLog] = useState<string[]>(['調整流程參數後，開始三分鐘營運模擬。']);

  const paramsRef = useRef(params);
  const simRef = useRef(sim);
  const runId = useRef(1);
  useEffect(() => { paramsRef.current = params; }, [params]);

  const addLog = (message: string) => setEventLog((current) => [message, ...current].slice(0, 5));

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let lastPaint = 0;

    const finish = (state: SimState) => {
      if (state.status === 'complete') return;
      state.status = 'complete';
      const completed = state.completed;
      const result: RunResult = {
        id: runId.current++, preset: presetNames[presetKey],
        throughput: state.elapsed > 0 ? completed * 60 / state.elapsed : 0,
        avgCycle: completed > 0 ? state.totalCycleTime / completed : 0,
        satisfaction: completed > 0 ? state.totalSatisfaction / completed : 0,
        completionRate: state.created > 0 ? completed / state.created * 100 : 0,
        net: state.revenue - state.materialSpend - state.penalties,
        bottleneck: bottleneckOf(state, paramsRef.current), completed, failed: state.failed,
      };
      setHistory((current) => [result, ...current].slice(0, 8));
      addLog(`模擬完成：${completed} 筆完成、${state.failed} 筆逾時。`);
    };

    const failOrder = (state: SimState, order: Order) => {
      state.failed += 1;
      state.penalties += paramsRef.current.timeoutPenalty;
      state.lastEvent = `訂單 #${order.id} 逾時取消`;
    };

    const loop = (now: number) => {
      const state = simRef.current;
      const current = paramsRef.current;
      const dt = Math.min((now - last) / 1000, .05) * simSpeed;
      last = now;

      if (state.status === 'running') {
        state.elapsed = Math.min(duration, state.elapsed + dt);

        const interval = 60 / current.orderRate;
        while (state.nextOrderAt <= state.elapsed && state.nextOrderAt < duration) {
          const order: Order = { id: state.nextOrderId++, bornAt: state.nextOrderAt, queueEntered: state.nextOrderAt, stage: 'prep', remaining: 0, waitTime: 0 };
          state.queues.prep.push(order);
          state.created += 1;
          state.materialSpend += current.materialCost;
          state.nextOrderAt += interval;
          state.lastEvent = `新訂單 #${order.id} 進入備料佇列`;
        }

        stations.forEach((station) => {
          state.queues[station] = state.queues[station].filter((order) => {
            if (state.elapsed - order.bornAt > current.patience) { failOrder(state, order); return false; }
            return true;
          });
          state.active[station] = state.active[station].filter((order) => {
            if (state.elapsed - order.bornAt > current.patience) { failOrder(state, order); return false; }
            return true;
          });
        });

        const times: Record<Station, number> = { prep: current.prepTime, cook: current.cookTime, pack: current.packTime, delivery: current.deliveryTime };
        const capacities: Record<Station, number> = { prep: current.prepWorkers, cook: current.cookWorkers, pack: current.packWorkers, delivery: current.couriers };

        stations.forEach((station, index) => {
          while (state.active[station].length < capacities[station] && state.queues[station].length > 0) {
            const order = state.queues[station].shift()!;
            order.waitTime += Math.max(0, state.elapsed - order.queueEntered);
            order.remaining = times[station];
            state.active[station].push(order);
          }

          state.busyTime[station] += state.active[station].length / capacities[station] * dt;
          const stillActive: Order[] = [];
          state.active[station].forEach((order) => {
            order.remaining -= dt;
            if (order.remaining > 0) { stillActive.push(order); return; }
            if (station === 'delivery') {
              const cycle = state.elapsed - order.bornAt;
              const satisfaction = Math.max(0, Math.min(100, 100 - cycle / current.patience * 55 - order.waitTime / current.patience * 25));
              state.completed += 1;
              state.totalCycleTime += cycle;
              state.totalSatisfaction += satisfaction;
              state.revenue += current.price;
              state.lastEvent = `訂單 #${order.id} 完成，週期 ${cycle.toFixed(1)} 秒`;
            } else {
              const next = stations[index + 1];
              order.stage = next;
              order.queueEntered = state.elapsed;
              state.queues[next].push(order);
            }
          });
          state.active[station] = stillActive;
        });

        if (state.elapsed >= duration) finish(state);
      }

      if (now - lastPaint > 65) {
        setSim({ ...state, queues: { ...state.queues }, active: { ...state.active }, busyTime: { ...state.busyTime } });
        lastPaint = now;
      }
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [simSpeed, presetKey]);

  const reset = (status: Status = 'idle') => {
    const next = createSim(status);
    simRef.current = next;
    setSim({ ...next });
    setEventLog([status === 'running' ? '新的三分鐘營運模擬開始。' : '模擬已重置。']);
  };

  const toggle = () => {
    if (simRef.current.status === 'running') { simRef.current.status = 'paused'; addLog('營運模擬暫停。'); }
    else if (simRef.current.status === 'paused') { simRef.current.status = 'running'; addLog('營運模擬繼續。'); }
    else { reset('running'); return; }
    setSim({ ...simRef.current });
  };

  const finishNow = () => {
    const state = simRef.current;
    if (state.status !== 'running' && state.status !== 'paused') return;
    state.elapsed = duration;
    state.status = 'running';
  };

  const updateParam = <K extends keyof Params>(key: K, value: Params[K]) => {
    setPresetKey('custom');
    setParams((current) => {
      const next = { ...current, [key]: value };
      paramsRef.current = next;
      if (simRef.current.status !== 'running' && simRef.current.status !== 'paused') {
        const fresh = createSim(); simRef.current = fresh; setSim({ ...fresh });
      }
      return next;
    });
  };

  const applyPreset = (key: Exclude<PresetKey, 'custom'>) => {
    const next = { ...presets[key] };
    setParams(next); paramsRef.current = next; setPresetKey(key);
    const fresh = createSim(); simRef.current = fresh; setSim({ ...fresh });
    setEventLog([`已套用「${presetNames[key]}」情境。`]);
  };

  const activeCount = stations.reduce((sum, station) => sum + sim.active[station].length, 0);
  const queuedCount = stations.reduce((sum, station) => sum + sim.queues[station].length, 0);
  const throughput = sim.elapsed > 0 ? sim.completed * 60 / sim.elapsed : 0;
  const avgCycle = sim.completed > 0 ? sim.totalCycleTime / sim.completed : 0;
  const satisfaction = sim.completed > 0 ? sim.totalSatisfaction / sim.completed : 100;
  const completionRate = sim.created > 0 ? sim.completed / sim.created * 100 : 0;
  const net = sim.revenue - sim.materialSpend - sim.penalties;
  const bottleneck = bottleneckOf(sim, params);
  const latest = history[0];

  const compareRows = useMemo(() => {
    if (!comparison.A || !comparison.B) return [];
    return [
      ['產能', `${comparison.A.throughput.toFixed(1)}/min`, `${comparison.B.throughput.toFixed(1)}/min`],
      ['平均週期', `${comparison.A.avgCycle.toFixed(1)}s`, `${comparison.B.avgCycle.toFixed(1)}s`],
      ['滿意度', `${comparison.A.satisfaction.toFixed(0)}%`, `${comparison.B.satisfaction.toFixed(0)}%`],
      ['完成率', `${comparison.A.completionRate.toFixed(0)}%`, `${comparison.B.completionRate.toFixed(0)}%`],
      ['淨收益', `$${fmt(comparison.A.net)}`, `$${fmt(comparison.B.net)}`],
      ['瓶頸', comparison.A.bottleneck, comparison.B.bottleneck],
    ];
  }, [comparison]);

  const stationWorkers = (station: Station) => ({ prep: params.prepWorkers, cook: params.cookWorkers, pack: params.packWorkers, delivery: params.couriers }[station]);

  return <main className="lab-shell cooking-lab">
    <header className="lab-header">
      <div className="lab-brand-stack"><a href={sitePath('/')} className="lab-breadcrumb">← 返回模式首頁</a><div className="brand-lockup"><div className="brand-badge">A</div><div><p className="eyebrow">AVIX · GAME BALANCING LAB</p><h1>Cooking Delivery 產能實驗室</h1></div></div></div>
      <div className="header-tools"><a href={sitePath('/boss-rush')} className="mode-jump">Boss Rush →</a><div className="stage-pill"><span />SCENARIO 02 · {presetNames[presetKey]}</div></div>
    </header>

    <section className="workspace cooking-workspace">
      <div className="arena-panel flow-panel">
        <div className="panel-heading"><div><p className="section-label">LIVE OPERATION</p><h2>訂單流程模擬</h2></div><p className="keyboard-hint">每輪模擬 3 分鐘營運 · 加速播放</p></div>

        <div className={`production-board ${sim.status}`}>
          <div className="board-grid" />
          <div className="production-topline"><span>TIME {timeLabel(sim.elapsed)} / 03:00</span><span>DEMAND {params.orderRate.toFixed(1)} ORDERS / MIN</span><span>IN SYSTEM {activeCount + queuedCount}</span></div>
          <div className="arrival-node"><b>新訂單</b><strong>{sim.created}</strong><span>{(60 / params.orderRate).toFixed(1)} 秒／單</span></div>
          <div className="station-flow">
            {stations.map((station, index) => {
              const utilization = sim.elapsed > 0 ? Math.min(100, sim.busyTime[station] / sim.elapsed * 100) : Math.min(100, params.orderRate / stageCapacity(params, station) * 100);
              const isBottleneck = stationNames[station] === bottleneck;
              return <div className="station-wrap" key={station}>
                <div className={`station-card ${isBottleneck ? 'bottleneck' : ''}`}>
                  <div className="station-number">0{index + 1}</div><p>{stationNames[station]}</p><strong>{sim.active[station].length}<small> / {stationWorkers(station)} 忙碌</small></strong>
                  <div className="station-util"><i style={{ width: `${utilization}%` }} /></div><span>利用率 {utilization.toFixed(0)}%</span>
                  <div className="order-dots active-dots">{sim.active[station].slice(0, 6).map((order) => <i key={order.id} title={`訂單 #${order.id}`} />)}</div>
                </div>
                <div className="queue-box"><span>等待</span><strong>{sim.queues[station].length}</strong><div className="order-dots">{sim.queues[station].slice(0, 8).map((order) => <i key={order.id} />)}</div></div>
                {index < stations.length - 1 && <div className="flow-arrow">→</div>}
              </div>;
            })}
          </div>
          <div className="completed-node"><b>完成配送</b><strong>{sim.completed}</strong><span>逾時 {sim.failed}</span></div>

          {sim.status === 'idle' && <div className="production-message"><span>READY FOR SERVICE</span><strong>一個局部變快，不代表整體變快</strong><p>觀察訂單在哪一站開始堆積</p></div>}
          {sim.status === 'paused' && <div className="production-message"><span>SIMULATION PAUSED</span><strong>流程已暫停</strong><p>可調整參數後繼續觀察</p></div>}
          {sim.status === 'complete' && <div className="production-message result"><span>SHIFT COMPLETE</span><strong>{sim.completed} 筆完成 · {sim.failed} 筆逾時</strong><p>主要瓶頸：{bottleneck}</p></div>}
          <div className="board-event"><span>最新事件</span>{sim.lastEvent}</div>
        </div>

        <div className="arena-actions"><button className="primary-action" onClick={toggle}><span>{sim.status === 'running' ? 'Ⅱ' : '▶'}</span>{sim.status === 'running' ? '暫停模擬' : sim.status === 'paused' ? '繼續模擬' : '開始模擬'}</button><button className="secondary-action" onClick={() => reset()}>↺ 重置</button><button className="secondary-action finish-action" disabled={sim.status !== 'running' && sim.status !== 'paused'} onClick={finishNow}>結束本輪</button><div className="speed-control"><span>速度</span>{[1, 4, 12].map((speed) => <button key={speed} className={simSpeed === speed ? 'selected' : ''} onClick={() => setSimSpeed(speed)}>{speed}×</button>)}</div><div className="run-note"><span className={sim.status === 'running' ? 'active-dot' : ''} />{sim.status === 'running' ? '流程運轉中' : sim.status === 'paused' ? '暫停' : '等待模擬'}</div></div>
      </div>

      <aside className="control-panel"><div className="panel-heading compact"><div><p className="section-label">PARAMETERS</p><h2>營運控制台</h2></div><select aria-label="情境預設" value={presetKey} onChange={(event) => event.target.value !== 'custom' && applyPreset(event.target.value as Exclude<PresetKey, 'custom'>)}><option value="balanced">均衡營運</option><option value="kitchen">廚房瓶頸</option><option value="delivery">配送瓶頸</option><option value="rush">尖峰時段</option>{presetKey === 'custom' && <option value="custom">自訂參數</option>}</select></div>
        <div className="control-tabs"><button className={controlTab === 'flow' ? 'active' : ''} onClick={() => setControlTab('flow')}><span className="flow-swatch" />流程產能</button><button className={controlTab === 'economy' ? 'active' : ''} onClick={() => setControlTab('economy')}><span className="money-swatch" />收益體驗</button></div>
        <div className="controls-scroll">{controlTab === 'flow' ? <div className="control-group"><RangeControl label="訂單到達率" hint="每分鐘進入系統的需求量" value={params.orderRate} min={2} max={14} step={.5} suffix="/min" onChange={(value) => updateParam('orderRate', value)} /><RangeControl label="備料時間" hint="單筆訂單的備料處理時間" value={params.prepTime} min={2} max={15} suffix="s" onChange={(value) => updateParam('prepTime', value)} /><RangeControl label="備料人力" hint="可同時處理的訂單數" value={params.prepWorkers} min={1} max={4} onChange={(value) => updateParam('prepWorkers', value)} /><RangeControl label="烹飪時間" hint="通常是最容易形成瓶頸的站點" value={params.cookTime} min={6} max={40} suffix="s" onChange={(value) => updateParam('cookTime', value)} /><RangeControl label="爐台數量" hint="可同時烹飪的訂單數" value={params.cookWorkers} min={1} max={5} onChange={(value) => updateParam('cookWorkers', value)} /><RangeControl label="包裝時間" hint="完成品轉為可配送狀態的時間" value={params.packTime} min={2} max={15} suffix="s" onChange={(value) => updateParam('packTime', value)} /><RangeControl label="包裝人力" hint="可同時包裝的訂單數" value={params.packWorkers} min={1} max={4} onChange={(value) => updateParam('packWorkers', value)} /><RangeControl label="配送時間" hint="外送員往返一筆訂單的時間" value={params.deliveryTime} min={10} max={60} suffix="s" onChange={(value) => updateParam('deliveryTime', value)} /><RangeControl label="外送員數量" hint="可同時進行的配送數" value={params.couriers} min={1} max={6} onChange={(value) => updateParam('couriers', value)} /></div> : <div className="control-group"><RangeControl label="顧客耐心" hint="超過此總時間，訂單將逾時取消" value={params.patience} min={45} max={180} step={5} suffix="s" onChange={(value) => updateParam('patience', value)} /><RangeControl label="訂單售價" hint="每筆完成訂單帶來的收入" value={params.price} min={100} max={350} step={10} suffix="$" onChange={(value) => updateParam('price', value)} /><RangeControl label="材料成本" hint="訂單建立時即產生的成本" value={params.materialCost} min={30} max={150} step={5} suffix="$" onChange={(value) => updateParam('materialCost', value)} /><RangeControl label="逾時懲罰" hint="取消、退款與品牌損失的簡化成本" value={params.timeoutPenalty} min={0} max={180} step={10} suffix="$" onChange={(value) => updateParam('timeoutPenalty', value)} /></div>}</div>
        <div className="capacity-summary"><p>理論站點產能 <span>單／分鐘</span></p>{stations.map((station) => <div className={stationNames[station] === bottleneck ? 'lowest' : ''} key={station}><span>{stationNames[station]}</span><strong>{stageCapacity(params, station).toFixed(1)}</strong></div>)}</div>
      </aside>
    </section>

    <section className="metrics-section"><div className="metrics-heading"><div><p className="section-label">OPERATION METRICS</p><h2>營運讀數</h2></div><p>只看單站速度不夠，重點是整條流程的輸出與等待。</p></div><div className="metrics-grid six"><div className="metric-card primary"><span>實際產能</span><strong>{throughput.toFixed(1)}<i>/min</i></strong><small>每分鐘完成訂單</small></div><div className="metric-card"><span>平均週期</span><strong>{avgCycle.toFixed(1)}<i>s</i></strong><small>從下單到送達</small></div><div className="metric-card"><span>顧客滿意度</span><strong>{satisfaction.toFixed(0)}<i>%</i></strong><small>等待與總時間綜合</small></div><div className="metric-card"><span>訂單完成率</span><strong>{completionRate.toFixed(0)}<i>%</i></strong><small>{sim.failed} 筆逾時取消</small></div><div className="metric-card"><span>目前淨收益</span><strong>${fmt(net)}</strong><small>收入－材料－懲罰</small></div><div className="metric-card warning"><span>主要瓶頸</span><strong>{bottleneck}</strong><small>利用率與排隊壓力最高</small></div></div></section>

    <section className="analysis-grid"><div className="history-panel"><div className="analysis-heading"><div><p className="section-label">RUN HISTORY</p><h2>營運測試紀錄</h2></div><span>保留最近 8 輪</span></div>{history.length === 0 ? <div className="empty-state"><strong>尚無完成紀錄</strong><p>完成或提早結束一輪模擬後，結果會出現在這裡。</p></div> : <div className="history-table"><div className="table-row cooking-row table-head"><span>輪次</span><span>情境</span><span>產能</span><span>週期</span><span>滿意</span><span>淨收益</span></div>{history.map((run) => <div className="table-row cooking-row" key={run.id}><span>#{run.id.toString().padStart(2, '0')}</span><span>{run.preset}</span><span>{run.throughput.toFixed(1)}/m</span><span>{run.avgCycle.toFixed(1)}s</span><span>{run.satisfaction.toFixed(0)}%</span><span>${fmt(run.net)}</span></div>)}</div>}</div>
      <div className="compare-panel"><div className="analysis-heading"><div><p className="section-label">A / B COMPARE</p><h2>方案比較</h2></div></div><div className="compare-slots"><button disabled={!latest} className={comparison.A ? 'filled' : ''} onClick={() => latest && setComparison((current) => ({ ...current, A: latest }))}><span>A</span><b>{comparison.A ? `#${comparison.A.id.toString().padStart(2, '0')} ${comparison.A.preset}` : '存入最新結果'}</b></button><div className="versus">VS</div><button disabled={!latest} className={comparison.B ? 'filled' : ''} onClick={() => latest && setComparison((current) => ({ ...current, B: latest }))}><span>B</span><b>{comparison.B ? `#${comparison.B.id.toString().padStart(2, '0')} ${comparison.B.preset}` : '存入最新結果'}</b></button></div>{compareRows.length === 0 ? <div className="compare-hint">先完成一輪基準測試，存入 A；改動一項參數完成第二輪，再存入 B。</div> : <div className="compare-table">{compareRows.map(([label, a, b]) => <div key={label}><span>{label}</span><b>{a}</b><b>{b}</b></div>)}</div>}</div>
    </section>

    <section className="event-panel"><div><p className="section-label">OPERATION LOG</p><h2>流程紀錄</h2></div><div className="event-list">{eventLog.map((item, index) => <p key={`${item}-${index}`}><span>{index === 0 ? 'NOW' : `-${index}`}</span>{item}</p>)}</div></section>
    <footer><span>AVIX GAME DESIGN ACADEMY</span><p>瓶頸決定產能，等待塑造體驗。</p><span>MICROGAME TOOL · V0.2</span></footer>
  </main>;
}
