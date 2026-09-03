'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { sitePath } from './sitePath';

type Status = 'idle' | 'running' | 'paused' | 'complete' | 'defeated';
type PresetKey = 'balanced' | 'gear' | 'spike' | 'runaway' | 'custom';

type Params = {
  baseAttack: number;
  attackGrowth: number;
  attackInterval: number;
  skillMultiplier: number;
  skillCooldown: number;
  baseHp: number;
  hpGrowth: number;
  gearBonus: number;
  gearEvery: number;
  recovery: number;
  enemyBaseHp: number;
  enemyHpGrowth: number;
  enemyBaseDamage: number;
  enemyDamageGrowth: number;
  enemyAttackInterval: number;
  spikeStage: number;
  spikeMultiplier: number;
};

type StageResult = { stage: number; ttk: number; damageTaken: number; ratio: number };

type GameState = {
  status: Status;
  stage: number;
  level: number;
  gear: number;
  playerHp: number;
  enemyHp: number;
  totalTime: number;
  stageTime: number;
  totalDamage: number;
  totalDamageTaken: number;
  stageDamageTaken: number;
  attackTimer: number;
  skillTimer: number;
  enemyTimer: number;
  transitionLeft: number;
  playerFlash: number;
  skillFlash: number;
  enemyFlash: number;
  stageResults: StageResult[];
  lastEvent: string;
};

type RunResult = {
  id: number;
  preset: string;
  result: 'CLEAR' | 'STUCK';
  cleared: number;
  avgTtk: number;
  finalPower: number;
  hardestStage: number;
  totalDamageTaken: number;
};

const stageCount = 10;

const presets: Record<Exclude<PresetKey, 'custom'>, Params> = {
  balanced: { baseAttack: 100, attackGrowth: 12, attackInterval: .75, skillMultiplier: 3, skillCooldown: 6, baseHp: 1000, hpGrowth: 10, gearBonus: 18, gearEvery: 3, recovery: 75, enemyBaseHp: 900, enemyHpGrowth: 14, enemyBaseDamage: 80, enemyDamageGrowth: 10, enemyAttackInterval: 1.4, spikeStage: 7, spikeMultiplier: 1.35 },
  gear: { baseAttack: 105, attackGrowth: 7, attackInterval: .78, skillMultiplier: 2.8, skillCooldown: 6.5, baseHp: 1050, hpGrowth: 7, gearBonus: 32, gearEvery: 2, recovery: 68, enemyBaseHp: 900, enemyHpGrowth: 15, enemyBaseDamage: 78, enemyDamageGrowth: 11, enemyAttackInterval: 1.35, spikeStage: 8, spikeMultiplier: 1.25 },
  spike: { baseAttack: 105, attackGrowth: 11, attackInterval: .75, skillMultiplier: 3, skillCooldown: 6, baseHp: 1050, hpGrowth: 9, gearBonus: 16, gearEvery: 3, recovery: 72, enemyBaseHp: 880, enemyHpGrowth: 13, enemyBaseDamage: 78, enemyDamageGrowth: 9, enemyAttackInterval: 1.4, spikeStage: 6, spikeMultiplier: 2.1 },
  runaway: { baseAttack: 110, attackGrowth: 16, attackInterval: .68, skillMultiplier: 3.4, skillCooldown: 5.5, baseHp: 1100, hpGrowth: 14, gearBonus: 26, gearEvery: 2, recovery: 85, enemyBaseHp: 920, enemyHpGrowth: 9, enemyBaseDamage: 80, enemyDamageGrowth: 7, enemyAttackInterval: 1.45, spikeStage: 7, spikeMultiplier: 1.2 },
};

const presetNames: Record<PresetKey, string> = { balanced: '平滑成長', gear: '裝備依賴', spike: '難度斷層', runaway: '成長失控', custom: '自訂參數' };

function fmt(value: number, decimals = 0) {
  return value.toLocaleString('zh-TW', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function playerStats(params: Params, level: number, gear: number) {
  const gearFactor = 1 + gear * params.gearBonus / 100;
  const attack = params.baseAttack * Math.pow(1 + params.attackGrowth / 100, level - 1) * gearFactor;
  const maxHp = params.baseHp * Math.pow(1 + params.hpGrowth / 100, level - 1) * gearFactor;
  const dps = attack / params.attackInterval + attack * params.skillMultiplier / params.skillCooldown;
  return { attack, maxHp, dps, power: dps * maxHp / 100 };
}

function enemyStats(params: Params, stage: number) {
  const spike = stage === params.spikeStage ? params.spikeMultiplier : 1;
  const hp = params.enemyBaseHp * Math.pow(1 + params.enemyHpGrowth / 100, stage - 1) * spike;
  const damage = params.enemyBaseDamage * Math.pow(1 + params.enemyDamageGrowth / 100, stage - 1) * spike;
  const dps = damage / params.enemyAttackInterval;
  return { hp, damage, dps, threat: hp * dps / 100 };
}

function gearAtStage(params: Params, stage: number) {
  return Math.floor((stage - 1) / params.gearEvery);
}

function createGame(params: Params, status: Status = 'idle'): GameState {
  const player = playerStats(params, 1, 0);
  const enemy = enemyStats(params, 1);
  return { status, stage: 1, level: 1, gear: 0, playerHp: player.maxHp, enemyHp: enemy.hp, totalTime: 0, stageTime: 0, totalDamage: 0, totalDamageTaken: 0, stageDamageTaken: 0, attackTimer: .35, skillTimer: 1.2, enemyTimer: .9, transitionLeft: 0, playerFlash: 0, skillFlash: 0, enemyFlash: 0, stageResults: [], lastEvent: '等待開始成長測試' };
}

type RangeProps = { label: string; hint: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void };

function RangeControl({ label, hint, value, min, max, step = 1, suffix = '', onChange }: RangeProps) {
  const fill = (value - min) / (max - min) * 100;
  const decimals = step < 1 ? (step < .1 ? 2 : 1) : 0;
  return <label className="range-control"><span className="range-heading"><b>{label}</b><output>{fmt(value, decimals)}{suffix}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} style={{ '--range-fill': `${fill}%` } as React.CSSProperties} onChange={(event) => onChange(Number(event.target.value))} /><small>{hint}</small></label>;
}

export default function ArpgGrowthLab() {
  const [params, setParams] = useState<Params>(presets.balanced);
  const [presetKey, setPresetKey] = useState<PresetKey>('balanced');
  const [controlTab, setControlTab] = useState<'player' | 'growth' | 'enemy'>('player');
  const [simSpeed, setSimSpeed] = useState(4);
  const [game, setGame] = useState<GameState>(() => createGame(presets.balanced));
  const [history, setHistory] = useState<RunResult[]>([]);
  const [comparison, setComparison] = useState<{ A?: RunResult; B?: RunResult }>({});
  const [eventLog, setEventLog] = useState<string[]>(['調整角色與敵人成長後，開始十關連續測試。']);

  const paramsRef = useRef(params);
  const gameRef = useRef(game);
  const runId = useRef(1);
  useEffect(() => { paramsRef.current = params; }, [params]);
  const addLog = (message: string) => setEventLog((current) => [message, ...current].slice(0, 5));

  const growthCurve = useMemo(() => {
    const values = Array.from({ length: stageCount }, (_, index) => {
      const stage = index + 1;
      const player = playerStats(params, stage, gearAtStage(params, stage));
      const enemy = enemyStats(params, stage);
      return { stage, player: player.power, enemy: enemy.threat, ratio: player.power / enemy.threat };
    });
    const max = Math.max(...values.flatMap((value) => [value.player, value.enemy]));
    return { values, max, hardest: values.reduce((worst, value) => value.ratio < worst.ratio ? value : worst, values[0]) };
  }, [params]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let lastPaint = 0;

    const finish = (state: GameState, result: 'CLEAR' | 'STUCK') => {
      if (state.status === 'complete' || state.status === 'defeated') return;
      state.status = result === 'CLEAR' ? 'complete' : 'defeated';
      const currentPlayer = playerStats(paramsRef.current, state.level, state.gear);
      const allResults = state.stageResults;
      const run: RunResult = { id: runId.current++, preset: presetNames[presetKey], result, cleared: result === 'CLEAR' ? stageCount : Math.max(0, state.stage - 1), avgTtk: allResults.length ? allResults.reduce((sum, value) => sum + value.ttk, 0) / allResults.length : 0, finalPower: currentPlayer.power, hardestStage: growthCurve.hardest.stage, totalDamageTaken: state.totalDamageTaken };
      setHistory((current) => [run, ...current].slice(0, 8));
      addLog(result === 'CLEAR' ? `全數通關：總戰鬥時間 ${state.totalTime.toFixed(1)} 秒。` : `成長受阻：角色倒在第 ${state.stage} 關。`);
    };

    const enterNextStage = (state: GameState) => {
      const current = paramsRef.current;
      const oldPlayer = playerStats(current, state.level, state.gear);
      const clearedStage = state.stage;
      state.level += 1;
      if (clearedStage % current.gearEvery === 0) {
        state.gear += 1;
        addLog(`第 ${clearedStage} 關掉落裝備，裝備階級提升至 +${state.gear}。`);
      }
      state.stage += 1;
      const nextPlayer = playerStats(current, state.level, state.gear);
      const nextEnemy = enemyStats(current, state.stage);
      const maxHpGain = Math.max(0, nextPlayer.maxHp - oldPlayer.maxHp);
      state.playerHp = Math.min(nextPlayer.maxHp, state.playerHp + maxHpGain + nextPlayer.maxHp * current.recovery / 100);
      state.enemyHp = nextEnemy.hp;
      state.stageTime = 0;
      state.stageDamageTaken = 0;
      state.attackTimer = .35;
      state.skillTimer = 1.1;
      state.enemyTimer = .8;
      state.transitionLeft = .65;
      state.lastEvent = `進入第 ${state.stage} 關 · Lv.${state.level} · 裝備 +${state.gear}`;
    };

    const loop = (now: number) => {
      const state = gameRef.current;
      const current = paramsRef.current;
      const dt = Math.min((now - last) / 1000, .05) * simSpeed;
      last = now;

      if (state.status === 'running') {
        state.playerFlash = Math.max(0, state.playerFlash - dt);
        state.skillFlash = Math.max(0, state.skillFlash - dt);
        state.enemyFlash = Math.max(0, state.enemyFlash - dt);

        if (state.transitionLeft > 0) {
          state.transitionLeft = Math.max(0, state.transitionLeft - dt);
        } else {
          const player = playerStats(current, state.level, state.gear);
          const enemy = enemyStats(current, state.stage);
          state.totalTime += dt;
          state.stageTime += dt;
          state.attackTimer -= dt;
          state.skillTimer -= dt;
          state.enemyTimer -= dt;

          while (state.attackTimer <= 0 && state.enemyHp > 0) {
            state.enemyHp = Math.max(0, state.enemyHp - player.attack);
            state.totalDamage += player.attack;
            state.attackTimer += current.attackInterval;
            state.playerFlash = .12;
            state.lastEvent = `普通攻擊造成 ${fmt(player.attack)} 傷害`;
          }
          if (state.skillTimer <= 0 && state.enemyHp > 0) {
            const skillDamage = player.attack * current.skillMultiplier;
            state.enemyHp = Math.max(0, state.enemyHp - skillDamage);
            state.totalDamage += skillDamage;
            state.skillTimer += current.skillCooldown;
            state.skillFlash = .25;
            state.lastEvent = `技能爆發造成 ${fmt(skillDamage)} 傷害`;
          }
          while (state.enemyTimer <= 0 && state.playerHp > 0 && state.enemyHp > 0) {
            state.playerHp = Math.max(0, state.playerHp - enemy.damage);
            state.totalDamageTaken += enemy.damage;
            state.stageDamageTaken += enemy.damage;
            state.enemyTimer += current.enemyAttackInterval;
            state.enemyFlash = .18;
            state.lastEvent = `敵人攻擊造成 ${fmt(enemy.damage)} 傷害`;
          }

          if (state.enemyHp <= 0) {
            const ratio = player.power / enemy.threat;
            state.stageResults = [...state.stageResults, { stage: state.stage, ttk: state.stageTime, damageTaken: state.stageDamageTaken, ratio }];
            addLog(`第 ${state.stage} 關完成，TTK ${state.stageTime.toFixed(1)} 秒。`);
            if (state.stage >= stageCount) finish(state, 'CLEAR');
            else enterNextStage(state);
          } else if (state.playerHp <= 0) {
            finish(state, 'STUCK');
          }
        }
      }

      if (now - lastPaint > 45) {
        setGame({ ...state, stageResults: [...state.stageResults] });
        lastPaint = now;
      }
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [simSpeed, presetKey, growthCurve.hardest.stage]);

  const reset = (status: Status = 'idle') => {
    const next = createGame(paramsRef.current, status);
    gameRef.current = next; setGame({ ...next });
    setEventLog([status === 'running' ? '十關成長測試開始。' : '測試已重置。']);
  };

  const toggle = () => {
    if (gameRef.current.status === 'running') { gameRef.current.status = 'paused'; addLog('成長測試暫停。'); }
    else if (gameRef.current.status === 'paused') { gameRef.current.status = 'running'; addLog('成長測試繼續。'); }
    else { reset('running'); return; }
    setGame({ ...gameRef.current });
  };

  const updateParam = <K extends keyof Params>(key: K, value: Params[K]) => {
    setPresetKey('custom');
    setParams((current) => {
      const next = { ...current, [key]: value }; paramsRef.current = next;
      if (gameRef.current.status !== 'running' && gameRef.current.status !== 'paused') { const fresh = createGame(next); gameRef.current = fresh; setGame({ ...fresh }); }
      return next;
    });
  };

  const applyPreset = (key: Exclude<PresetKey, 'custom'>) => {
    const next = { ...presets[key] }; setParams(next); paramsRef.current = next; setPresetKey(key);
    const fresh = createGame(next); gameRef.current = fresh; setGame({ ...fresh });
    setEventLog([`已套用「${presetNames[key]}」成長情境。`]);
  };

  const player = playerStats(params, game.level, game.gear);
  const enemy = enemyStats(params, game.stage);
  const playerHpRatio = Math.max(0, game.playerHp / player.maxHp * 100);
  const enemyHpRatio = Math.max(0, game.enemyHp / enemy.hp * 100);
  const projectedTtk = enemy.hp / player.dps;
  const projectedDamage = projectedTtk * enemy.dps;
  const powerRatio = player.power / enemy.threat;
  const avgTtk = game.stageResults.length ? game.stageResults.reduce((sum, result) => sum + result.ttk, 0) / game.stageResults.length : 0;
  const latest = history[0];

  const compareRows = useMemo(() => {
    if (!comparison.A || !comparison.B) return [];
    return [['結果', comparison.A.result, comparison.B.result], ['通過關卡', `${comparison.A.cleared}/10`, `${comparison.B.cleared}/10`], ['平均 TTK', `${comparison.A.avgTtk.toFixed(1)}s`, `${comparison.B.avgTtk.toFixed(1)}s`], ['最終戰力', fmt(comparison.A.finalPower), fmt(comparison.B.finalPower)], ['最大難關', `第 ${comparison.A.hardestStage} 關`, `第 ${comparison.B.hardestStage} 關`], ['總承傷', fmt(comparison.A.totalDamageTaken), fmt(comparison.B.totalDamageTaken)]];
  }, [comparison]);

  return <main className="lab-shell arpg-lab">
    <header className="lab-header"><div className="lab-brand-stack"><a href={sitePath('/')} className="lab-breadcrumb">← 返回模式首頁</a><div className="brand-lockup"><div className="brand-badge">A</div><div><p className="eyebrow">AVIX · GAME BALANCING LAB</p><h1>ARPG 成長曲線實驗室</h1></div></div></div><div className="header-tools"><a href={sitePath('/cooking-delivery')} className="mode-jump">Cooking Delivery →</a><div className="stage-pill"><span />SCENARIO 03 · {presetNames[presetKey]}</div></div></header>

    <section className="workspace arpg-workspace"><div className="arena-panel growth-panel"><div className="panel-heading"><div><p className="section-label">POWER PROGRESSION</p><h2>十關成長測試</h2></div><p className="keyboard-hint">角色成長 × 裝備節點 × 敵人曲線</p></div>
      <div className={`growth-board ${game.status}`}><div className="board-grid" /><div className="growth-topline"><span>PLAYER POWER</span><span>STAGE {game.stage.toString().padStart(2, '0')} / 10</span><span>ENEMY THREAT</span></div>
        <div className="curve-chart"><div className="curve-axis"><span>高</span><span>戰力指數</span><span>低</span></div><div className="curve-columns">{growthCurve.values.map((value) => <div className={`curve-column ${value.stage === game.stage ? 'current' : ''} ${value.stage === params.spikeStage ? 'spike' : ''}`} key={value.stage}><div className="curve-bars"><i className="player-bar" style={{ height: `${Math.max(4, value.player / growthCurve.max * 100)}%` }} /><i className="enemy-bar" style={{ height: `${Math.max(4, value.enemy / growthCurve.max * 100)}%` }} /></div><span>{value.stage}</span></div>)}</div></div>
        <div className="growth-legend"><span><i className="player-key" />角色戰力</span><span><i className="enemy-key" />敵人威脅</span><span><i className="spike-key" />尖峰關卡</span></div>
        <div className="battle-strip"><div className={`growth-fighter growth-player ${game.playerFlash > 0 ? 'hit' : ''} ${game.skillFlash > 0 ? 'skill' : ''}`}><span>Lv.{game.level}</span><strong>P</strong><small>裝備 +{game.gear}</small></div><div className="growth-health player-growth-health"><span>HP {fmt(game.playerHp)} / {fmt(player.maxHp)}</span><div><i style={{ width: `${playerHpRatio}%` }} /></div></div><div className="growth-versus"><span>STAGE {game.stage}</span><strong>{game.transitionLeft > 0 ? 'NEXT' : 'VS'}</strong><small>{game.stageTime.toFixed(1)}s</small></div><div className="growth-health enemy-growth-health"><span>HP {fmt(game.enemyHp)} / {fmt(enemy.hp)}</span><div><i style={{ width: `${enemyHpRatio}%` }} /></div></div><div className={`growth-fighter growth-enemy ${game.enemyFlash > 0 ? 'hit' : ''}`}><span>{game.stage === params.spikeStage ? 'ELITE' : 'ENEMY'}</span><strong>E</strong><small>威脅 {fmt(enemy.threat)}</small></div></div>
        <div className="stage-track">{Array.from({ length: stageCount }, (_, index) => index + 1).map((stage) => <i key={stage} className={stage < game.stage || game.status === 'complete' ? 'cleared' : stage === game.stage ? 'current' : ''}><span>{stage}</span></i>)}</div>
        {game.status === 'idle' && <div className="growth-message"><span>READY TO GROW</span><strong>曲線平滑，不代表每一關都平滑</strong><p>開始後連續模擬十關戰鬥與裝備節點</p></div>}
        {game.status === 'paused' && <div className="growth-message"><span>SIMULATION PAUSED</span><strong>成長測試已暫停</strong><p>可調整曲線後繼續觀察</p></div>}
        {(game.status === 'complete' || game.status === 'defeated') && <div className={`growth-message result ${game.status}`}><span>{game.status === 'complete' ? 'ALL STAGES CLEARED' : 'PROGRESSION BLOCKED'}</span><strong>{game.status === 'complete' ? '角色完成十關成長' : `角色倒在第 ${game.stage} 關`}</strong><p>預測最大難關：第 {growthCurve.hardest.stage} 關</p></div>}
        <div className="board-event"><span>最新事件</span>{game.lastEvent}</div>
      </div>
      <div className="arena-actions"><button className="primary-action" onClick={toggle}><span>{game.status === 'running' ? 'Ⅱ' : '▶'}</span>{game.status === 'running' ? '暫停測試' : game.status === 'paused' ? '繼續測試' : '開始測試'}</button><button className="secondary-action" onClick={() => reset()}>↺ 重置</button><div className="speed-control"><span>速度</span>{[1, 4, 12].map((speed) => <button key={speed} className={simSpeed === speed ? 'selected' : ''} onClick={() => setSimSpeed(speed)}>{speed}×</button>)}</div><div className="run-note"><span className={game.status === 'running' ? 'active-dot' : ''} />{game.status === 'running' ? '成長模擬中' : '等待測試'}</div></div>
    </div>

      <aside className="control-panel"><div className="panel-heading compact"><div><p className="section-label">PARAMETERS</p><h2>成長控制台</h2></div><select aria-label="成長情境預設" value={presetKey} onChange={(event) => event.target.value !== 'custom' && applyPreset(event.target.value as Exclude<PresetKey, 'custom'>)}><option value="balanced">平滑成長</option><option value="gear">裝備依賴</option><option value="spike">難度斷層</option><option value="runaway">成長失控</option>{presetKey === 'custom' && <option value="custom">自訂參數</option>}</select></div>
        <div className="control-tabs three"><button className={controlTab === 'player' ? 'active' : ''} onClick={() => setControlTab('player')}><span className="player-swatch" />角色</button><button className={controlTab === 'growth' ? 'active' : ''} onClick={() => setControlTab('growth')}><span className="gear-swatch" />成長</button><button className={controlTab === 'enemy' ? 'active' : ''} onClick={() => setControlTab('enemy')}><span className="boss-swatch" />敵人</button></div>
        <div className="controls-scroll">{controlTab === 'player' ? <div className="control-group"><RangeControl label="初始攻擊" hint="第一關普通攻擊的基礎傷害" value={params.baseAttack} min={50} max={220} step={5} onChange={(value) => updateParam('baseAttack', value)} /><RangeControl label="攻擊成長率" hint="每升一級增加的攻擊比例" value={params.attackGrowth} min={0} max={25} suffix="%" onChange={(value) => updateParam('attackGrowth', value)} /><RangeControl label="攻擊間隔" hint="普通攻擊的出手頻率" value={params.attackInterval} min={.35} max={1.4} step={.05} suffix="s" onChange={(value) => updateParam('attackInterval', value)} /><RangeControl label="技能倍率" hint="每次技能爆發相對於攻擊力的倍率" value={params.skillMultiplier} min={1} max={6} step={.1} suffix="×" onChange={(value) => updateParam('skillMultiplier', value)} /><RangeControl label="技能冷卻" hint="技能爆發之間的等待時間" value={params.skillCooldown} min={2} max={12} step={.5} suffix="s" onChange={(value) => updateParam('skillCooldown', value)} /><RangeControl label="初始生命" hint="第一關的最大生命值" value={params.baseHp} min={500} max={2200} step={50} onChange={(value) => updateParam('baseHp', value)} /><RangeControl label="生命成長率" hint="每升一級增加的生命比例" value={params.hpGrowth} min={0} max={22} suffix="%" onChange={(value) => updateParam('hpGrowth', value)} /></div> : controlTab === 'growth' ? <div className="control-group"><RangeControl label="裝備增幅" hint="每一階裝備同時增加攻擊與生命" value={params.gearBonus} min={0} max={50} suffix="%" onChange={(value) => updateParam('gearBonus', value)} /><RangeControl label="裝備取得間隔" hint="每通過幾關取得一階裝備" value={params.gearEvery} min={1} max={5} suffix="關" onChange={(value) => updateParam('gearEvery', value)} /><RangeControl label="關後恢復" hint="通關後回復最大生命的比例" value={params.recovery} min={0} max={100} step={5} suffix="%" onChange={(value) => updateParam('recovery', value)} /><div className="formula-note"><span>角色戰力</span><strong>DPS × 最大生命 ÷ 100</strong><p>用同一指標觀察輸出與生存如何共同成長。</p></div></div> : <div className="control-group"><RangeControl label="敵人初始生命" hint="第一關敵人的生命值" value={params.enemyBaseHp} min={400} max={2200} step={50} onChange={(value) => updateParam('enemyBaseHp', value)} /><RangeControl label="敵人生命成長" hint="每一關增加的生命比例" value={params.enemyHpGrowth} min={0} max={28} suffix="%" onChange={(value) => updateParam('enemyHpGrowth', value)} /><RangeControl label="敵人初始傷害" hint="第一關敵人的單次傷害" value={params.enemyBaseDamage} min={30} max={220} step={5} onChange={(value) => updateParam('enemyBaseDamage', value)} /><RangeControl label="敵人傷害成長" hint="每一關增加的傷害比例" value={params.enemyDamageGrowth} min={0} max={25} suffix="%" onChange={(value) => updateParam('enemyDamageGrowth', value)} /><RangeControl label="敵人攻擊間隔" hint="敵人的出手頻率" value={params.enemyAttackInterval} min={.6} max={2.5} step={.05} suffix="s" onChange={(value) => updateParam('enemyAttackInterval', value)} /><RangeControl label="尖峰關卡" hint="指定一關套用額外威脅倍率" value={params.spikeStage} min={2} max={10} suffix="關" onChange={(value) => updateParam('spikeStage', value)} /><RangeControl label="尖峰倍率" hint="同時放大該關敵人生命與傷害" value={params.spikeMultiplier} min={1} max={3} step={.05} suffix="×" onChange={(value) => updateParam('spikeMultiplier', value)} /></div>}</div>
        <div className="curve-summary"><div><span>預測最大難關</span><strong>第 {growthCurve.hardest.stage} 關</strong></div><div><span>最低戰力比</span><strong className={growthCurve.hardest.ratio < 1 ? 'danger' : ''}>{growthCurve.hardest.ratio.toFixed(2)}×</strong></div></div>
      </aside>
    </section>

    <section className="metrics-section"><div className="metrics-heading"><div><p className="section-label">GROWTH METRICS</p><h2>成長讀數</h2></div><p>成長設計的重點，不是數字變大，而是玩家感受到的相對優勢如何改變。</p></div><div className="metrics-grid six"><div className="metric-card primary"><span>目前關卡</span><strong>{game.stage}<i>/10</i></strong><small>角色 Lv.{game.level} · 裝備 +{game.gear}</small></div><div className="metric-card"><span>角色戰力</span><strong>{fmt(player.power)}</strong><small>DPS × 最大生命</small></div><div className="metric-card"><span>預估 TTK</span><strong>{projectedTtk.toFixed(1)}<i>s</i></strong><small>本關擊殺時間</small></div><div className="metric-card"><span>預估承傷</span><strong>{fmt(projectedDamage)}</strong><small>不含關後恢復</small></div><div className="metric-card"><span>相對戰力比</span><strong>{powerRatio.toFixed(2)}<i>×</i></strong><small>角色戰力 ÷ 敵人威脅</small></div><div className="metric-card warning"><span>已通過關卡</span><strong>{game.stageResults.length}</strong><small>平均 TTK {avgTtk.toFixed(1)} 秒</small></div></div></section>

    <section className="analysis-grid"><div className="history-panel"><div className="analysis-heading"><div><p className="section-label">RUN HISTORY</p><h2>成長測試紀錄</h2></div><span>保留最近 8 輪</span></div>{history.length === 0 ? <div className="empty-state"><strong>尚無完成紀錄</strong><p>完成或卡關後，整輪成長結果會出現在這裡。</p></div> : <div className="history-table"><div className="table-row arpg-row table-head"><span>輪次</span><span>情境</span><span>結果</span><span>通關</span><span>平均TTK</span><span>最大難關</span></div>{history.map((run) => <div className="table-row arpg-row" key={run.id}><span>#{run.id.toString().padStart(2, '0')}</span><span>{run.preset}</span><span className={run.result === 'CLEAR' ? 'win' : 'lose'}>{run.result}</span><span>{run.cleared}/10</span><span>{run.avgTtk.toFixed(1)}s</span><span>第 {run.hardestStage} 關</span></div>)}</div>}</div>
      <div className="compare-panel"><div className="analysis-heading"><div><p className="section-label">A / B COMPARE</p><h2>曲線比較</h2></div></div><div className="compare-slots"><button disabled={!latest} className={comparison.A ? 'filled' : ''} onClick={() => latest && setComparison((current) => ({ ...current, A: latest }))}><span>A</span><b>{comparison.A ? `#${comparison.A.id.toString().padStart(2, '0')} ${comparison.A.preset}` : '存入最新結果'}</b></button><div className="versus">VS</div><button disabled={!latest} className={comparison.B ? 'filled' : ''} onClick={() => latest && setComparison((current) => ({ ...current, B: latest }))}><span>B</span><b>{comparison.B ? `#${comparison.B.id.toString().padStart(2, '0')} ${comparison.B.preset}` : '存入最新結果'}</b></button></div>{compareRows.length === 0 ? <div className="compare-hint">先跑一輪基準曲線存入 A，再改動成長率或尖峰倍率，完成第二輪後存入 B。</div> : <div className="compare-table">{compareRows.map(([label, a, b]) => <div key={label}><span>{label}</span><b>{a}</b><b>{b}</b></div>)}</div>}</div>
    </section>
    <section className="event-panel"><div><p className="section-label">PROGRESSION LOG</p><h2>成長紀錄</h2></div><div className="event-list">{eventLog.map((item, index) => <p key={`${item}-${index}`}><span>{index === 0 ? 'NOW' : `-${index}`}</span>{item}</p>)}</div></section>
    <footer><span>AVIX GAME DESIGN ACADEMY</span><p>玩家感受到的，是相對成長，不是單一數字。</p><span>MICROGAME TOOL · V0.3</span></footer>
  </main>;
}
