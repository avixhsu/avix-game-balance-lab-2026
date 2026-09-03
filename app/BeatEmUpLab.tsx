'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { sitePath } from './sitePath';

type Status = 'idle' | 'running' | 'paused' | 'complete' | 'defeated';
type PresetKey = 'arcade' | 'crowd' | 'elite' | 'collapse' | 'custom';

type Params = {
  playerMaxHp: number;
  hitDamage: number;
  attackInterval: number;
  accuracy: number;
  comboHits: number;
  finisherMultiplier: number;
  cleaveTargets: number;
  hitStun: number;
  specialMultiplier: number;
  specialCooldown: number;
  dodgeRate: number;
  baseWaveSize: number;
  waveGrowth: number;
  spawnInterval: number;
  enemyHp: number;
  enemyHpGrowth: number;
  enemyDamage: number;
  enemyAttackInterval: number;
  aggressionSlots: number;
  eliteRatio: number;
  eliteHpMultiplier: number;
  intermission: number;
  recovery: number;
};

type Enemy = { id: number; hp: number; maxHp: number; elite: boolean; stun: number };
type WaveResult = { wave: number; duration: number; damageTaken: number; peakCrowd: number; enemies: number };

type GameState = {
  status: Status;
  wave: number;
  playerHp: number;
  active: Enemy[];
  spawnRemaining: number;
  spawnedThisWave: number;
  nextEnemyId: number;
  nextSpawn: number;
  totalTime: number;
  waveTime: number;
  totalDamage: number;
  totalDamageTaken: number;
  waveDamageTaken: number;
  defeatedEnemies: number;
  comboStep: number;
  attackTimer: number;
  specialTimer: number;
  enemyTimer: number;
  intermissionLeft: number;
  attackFlash: number;
  specialFlash: number;
  hurtFlash: number;
  peakCrowd: number;
  wavePeak: number;
  waveResults: WaveResult[];
  lastEvent: string;
};

type RunResult = { id: number; preset: string; result: 'CLEAR' | 'OVERWHELMED'; waves: number; clearTime: number; avgWave: number; damageTaken: number; peakCrowd: number; combatRatio: number };

const waveCount = 5;

const presets: Record<Exclude<PresetKey, 'custom'>, Params> = {
  arcade: { playerMaxHp: 1800, hitDamage: 110, attackInterval: .45, accuracy: 90, comboHits: 4, finisherMultiplier: 1.8, cleaveTargets: 2, hitStun: .5, specialMultiplier: 3.2, specialCooldown: 8, dodgeRate: 25, baseWaveSize: 5, waveGrowth: 2, spawnInterval: 1, enemyHp: 320, enemyHpGrowth: 12, enemyDamage: 70, enemyAttackInterval: 1.3, aggressionSlots: 2, eliteRatio: 20, eliteHpMultiplier: 2, intermission: 5, recovery: 35 },
  crowd: { playerMaxHp: 1900, hitDamage: 115, attackInterval: .42, accuracy: 88, comboHits: 4, finisherMultiplier: 1.7, cleaveTargets: 3, hitStun: .55, specialMultiplier: 3.4, specialCooldown: 7.5, dodgeRate: 22, baseWaveSize: 7, waveGrowth: 3, spawnInterval: .55, enemyHp: 285, enemyHpGrowth: 10, enemyDamage: 65, enemyAttackInterval: 1.25, aggressionSlots: 4, eliteRatio: 10, eliteHpMultiplier: 1.8, intermission: 4, recovery: 30 },
  elite: { playerMaxHp: 1900, hitDamage: 120, attackInterval: .46, accuracy: 92, comboHits: 5, finisherMultiplier: 2, cleaveTargets: 2, hitStun: .42, specialMultiplier: 3.6, specialCooldown: 9, dodgeRate: 28, baseWaveSize: 5, waveGrowth: 2, spawnInterval: 1.15, enemyHp: 310, enemyHpGrowth: 12, enemyDamage: 72, enemyAttackInterval: 1.35, aggressionSlots: 3, eliteRatio: 45, eliteHpMultiplier: 2.6, intermission: 5, recovery: 38 },
  collapse: { playerMaxHp: 1750, hitDamage: 105, attackInterval: .48, accuracy: 82, comboHits: 5, finisherMultiplier: 1.65, cleaveTargets: 2, hitStun: .35, specialMultiplier: 3, specialCooldown: 10, dodgeRate: 18, baseWaveSize: 8, waveGrowth: 3, spawnInterval: .35, enemyHp: 300, enemyHpGrowth: 14, enemyDamage: 74, enemyAttackInterval: 1.15, aggressionSlots: 5, eliteRatio: 25, eliteHpMultiplier: 2.2, intermission: 1, recovery: 15 },
};

const presetNames: Record<PresetKey, string> = { arcade: '街機標準', crowd: '群體壓力', elite: '菁英突襲', collapse: '節奏崩潰', custom: '自訂參數' };

function fmt(value: number, decimals = 0) { return value.toLocaleString('zh-TW', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }); }
function waveSize(params: Params, wave: number) { return Math.max(1, Math.round(params.baseWaveSize + (wave - 1) * params.waveGrowth)); }
function enemyBaseHp(params: Params, wave: number) { return params.enemyHp * Math.pow(1 + params.enemyHpGrowth / 100, wave - 1); }
function enemyHit(params: Params, wave: number, elite = false) { return params.enemyDamage * Math.pow(1 + params.enemyHpGrowth / 200, wave - 1) * (elite ? 1.5 : 1); }

function createGame(params: Params, status: Status = 'idle'): GameState {
  return { status, wave: 1, playerHp: params.playerMaxHp, active: [], spawnRemaining: waveSize(params, 1), spawnedThisWave: 0, nextEnemyId: 1, nextSpawn: 0, totalTime: 0, waveTime: 0, totalDamage: 0, totalDamageTaken: 0, waveDamageTaken: 0, defeatedEnemies: 0, comboStep: 0, attackTimer: .35, specialTimer: 2.5, enemyTimer: 1, intermissionLeft: 0, attackFlash: 0, specialFlash: 0, hurtFlash: 0, peakCrowd: 0, wavePeak: 0, waveResults: [], lastEvent: '等待開始清版測試' };
}

type RangeProps = { label: string; hint: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void };
function RangeControl({ label, hint, value, min, max, step = 1, suffix = '', onChange }: RangeProps) {
  const fill = (value - min) / (max - min) * 100;
  const decimals = step < 1 ? (step < .1 ? 2 : 1) : 0;
  return <label className="range-control"><span className="range-heading"><b>{label}</b><output>{fmt(value, decimals)}{suffix}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} style={{ '--range-fill': `${fill}%` } as React.CSSProperties} onChange={(event) => onChange(Number(event.target.value))} /><small>{hint}</small></label>;
}

export default function BeatEmUpLab() {
  const [params, setParams] = useState<Params>(presets.arcade);
  const [presetKey, setPresetKey] = useState<PresetKey>('arcade');
  const [controlTab, setControlTab] = useState<'player' | 'crowd' | 'pacing'>('player');
  const [simSpeed, setSimSpeed] = useState(4);
  const [game, setGame] = useState<GameState>(() => createGame(presets.arcade));
  const [history, setHistory] = useState<RunResult[]>([]);
  const [comparison, setComparison] = useState<{ A?: RunResult; B?: RunResult }>({});
  const [eventLog, setEventLog] = useState<string[]>(['調整玩家能力與波次構成後，開始五波清版測試。']);
  const paramsRef = useRef(params);
  const gameRef = useRef(game);
  const runId = useRef(1);
  useEffect(() => { paramsRef.current = params; }, [params]);
  const addLog = (message: string) => setEventLog((current) => [message, ...current].slice(0, 5));

  const projected = useMemo(() => {
    const accuracy = params.accuracy / 100;
    const comboAverage = ((params.comboHits - 1) + params.finisherMultiplier) / params.comboHits;
    const basicDps = params.hitDamage * accuracy * comboAverage * params.cleaveTargets / params.attackInterval;
    const specialDps = params.hitDamage * params.specialMultiplier * accuracy * (params.cleaveTargets + 3) / params.specialCooldown;
    const output = basicDps + specialDps;
    const pressure = params.aggressionSlots * params.enemyDamage / params.enemyAttackInterval * (1 - params.dodgeRate / 100);
    return { output, pressure };
  }, [params]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let lastPaint = 0;

    const finish = (state: GameState, result: 'CLEAR' | 'OVERWHELMED') => {
      if (state.status === 'complete' || state.status === 'defeated') return;
      state.status = result === 'CLEAR' ? 'complete' : 'defeated';
      const combatTime = state.waveResults.reduce((sum, value) => sum + value.duration, 0);
      const run: RunResult = { id: runId.current++, preset: presetNames[presetKey], result, waves: result === 'CLEAR' ? waveCount : Math.max(0, state.wave - 1), clearTime: state.totalTime, avgWave: state.waveResults.length ? combatTime / state.waveResults.length : 0, damageTaken: state.totalDamageTaken, peakCrowd: state.peakCrowd, combatRatio: state.totalTime > 0 ? combatTime / state.totalTime * 100 : 0 };
      setHistory((current) => [run, ...current].slice(0, 8));
      addLog(result === 'CLEAR' ? `五波清場完成，總時間 ${state.totalTime.toFixed(1)} 秒。` : `玩家在第 ${state.wave} 波被群體壓制。`);
    };

    const removeDefeated = (state: GameState) => {
      const defeated = state.active.filter((enemy) => enemy.hp <= 0).length;
      if (defeated > 0) {
        state.defeatedEnemies += defeated;
        state.lastEvent = `擊倒 ${defeated} 名敵人 · 場上剩餘 ${state.active.length - defeated}`;
      }
      state.active = state.active.filter((enemy) => enemy.hp > 0);
    };

    const beginNextWave = (state: GameState, current: Params) => {
      state.wave += 1;
      state.playerHp = Math.min(current.playerMaxHp, state.playerHp + current.playerMaxHp * current.recovery / 100);
      state.active = [];
      state.spawnRemaining = waveSize(current, state.wave);
      state.spawnedThisWave = 0;
      state.nextSpawn = 0;
      state.waveTime = 0;
      state.waveDamageTaken = 0;
      state.wavePeak = 0;
      state.attackTimer = .3;
      state.specialTimer = 2;
      state.enemyTimer = .9;
      state.comboStep = 0;
      state.lastEvent = `第 ${state.wave} 波開始 · 敵人 ${state.spawnRemaining} 名`;
      addLog(`第 ${state.wave} 波開始，敵人共 ${state.spawnRemaining} 名。`);
    };

    const loop = (now: number) => {
      const state = gameRef.current;
      const current = paramsRef.current;
      const dt = Math.min((now - last) / 1000, .05) * simSpeed;
      last = now;
      if (state.status === 'running') {
        state.totalTime += dt;
        state.attackFlash = Math.max(0, state.attackFlash - dt);
        state.specialFlash = Math.max(0, state.specialFlash - dt);
        state.hurtFlash = Math.max(0, state.hurtFlash - dt);

        if (state.intermissionLeft > 0) {
          state.intermissionLeft = Math.max(0, state.intermissionLeft - dt);
          if (state.intermissionLeft <= 0) beginNextWave(state, current);
        } else {
          state.waveTime += dt;
          state.nextSpawn -= dt;
          while (state.nextSpawn <= 0 && state.spawnRemaining > 0) {
            const total = waveSize(current, state.wave);
            const eliteCount = Math.round(total * current.eliteRatio / 100);
            const elite = state.spawnedThisWave < eliteCount;
            const baseHp = enemyBaseHp(current, state.wave);
            const maxHp = baseHp * (elite ? current.eliteHpMultiplier : 1);
            state.active.push({ id: state.nextEnemyId++, hp: maxHp, maxHp, elite, stun: 0 });
            state.spawnRemaining -= 1;
            state.spawnedThisWave += 1;
            state.nextSpawn += current.spawnInterval;
            state.lastEvent = `${elite ? '菁英' : '一般'}敵人加入戰場`;
          }

          state.active.forEach((enemy) => { enemy.stun = Math.max(0, enemy.stun - dt); });
          state.attackTimer -= dt;
          state.specialTimer -= dt;
          state.enemyTimer -= dt;

          while (state.attackTimer <= 0 && state.active.length > 0) {
            state.comboStep += 1;
            const finisher = state.comboStep >= current.comboHits;
            const damage = current.hitDamage * current.accuracy / 100 * (finisher ? current.finisherMultiplier : 1);
            const targets = state.active.slice(0, current.cleaveTargets);
            targets.forEach((enemy) => { enemy.hp -= damage; enemy.stun = current.hitStun; state.totalDamage += Math.min(damage, enemy.maxHp); });
            state.attackFlash = .13;
            state.lastEvent = finisher ? `連段終結命中 ${targets.length} 人，造成 ${fmt(damage)} 傷害` : `連段第 ${state.comboStep} 擊命中 ${targets.length} 人`;
            if (finisher) state.comboStep = 0;
            state.attackTimer += current.attackInterval;
            removeDefeated(state);
          }

          if (state.specialTimer <= 0 && state.active.length > 0) {
            const damage = current.hitDamage * current.specialMultiplier * current.accuracy / 100;
            const targets = state.active.slice(0, current.cleaveTargets + 3);
            targets.forEach((enemy) => { enemy.hp -= damage; enemy.stun = current.hitStun * 2; state.totalDamage += Math.min(damage, enemy.maxHp); });
            state.specialTimer += current.specialCooldown;
            state.specialFlash = .3;
            state.lastEvent = `必殺技命中 ${targets.length} 人，造成 ${fmt(damage)} 傷害`;
            removeDefeated(state);
          }

          while (state.enemyTimer <= 0 && state.active.length > 0 && state.playerHp > 0) {
            const attackers = state.active.filter((enemy) => enemy.stun <= 0).slice(0, current.aggressionSlots);
            const raw = attackers.reduce((sum, enemy) => sum + enemyHit(current, state.wave, enemy.elite), 0);
            const damage = raw * (1 - current.dodgeRate / 100);
            state.playerHp = Math.max(0, state.playerHp - damage);
            state.totalDamageTaken += damage;
            state.waveDamageTaken += damage;
            state.enemyTimer += current.enemyAttackInterval;
            if (damage > 0) { state.hurtFlash = .18; state.lastEvent = `${attackers.length} 名敵人進攻，玩家承受 ${fmt(damage)} 傷害`; }
          }

          state.peakCrowd = Math.max(state.peakCrowd, state.active.length);
          state.wavePeak = Math.max(state.wavePeak, state.active.length);
          if (state.playerHp <= 0) finish(state, 'OVERWHELMED');
          else if (state.spawnRemaining === 0 && state.active.length === 0) {
            state.waveResults = [...state.waveResults, { wave: state.wave, duration: state.waveTime, damageTaken: state.waveDamageTaken, peakCrowd: state.wavePeak, enemies: waveSize(current, state.wave) }];
            addLog(`第 ${state.wave} 波清場，耗時 ${state.waveTime.toFixed(1)} 秒。`);
            if (state.wave >= waveCount) finish(state, 'CLEAR');
            else { state.intermissionLeft = current.intermission; state.lastEvent = `清場完成 · ${current.intermission.toFixed(1)} 秒後下一波`; }
          }
        }
      }
      if (now - lastPaint > 45) {
        setGame({ ...state, active: state.active.map((enemy) => ({ ...enemy })), waveResults: [...state.waveResults] });
        lastPaint = now;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [simSpeed, presetKey]);

  const reset = (status: Status = 'idle') => { const next = createGame(paramsRef.current, status); gameRef.current = next; setGame({ ...next }); setEventLog([status === 'running' ? '五波清版測試開始。' : '測試已重置。']); };
  const toggle = () => { if (gameRef.current.status === 'running') { gameRef.current.status = 'paused'; addLog('清版測試暫停。'); } else if (gameRef.current.status === 'paused') { gameRef.current.status = 'running'; addLog('清版測試繼續。'); } else { reset('running'); return; } setGame({ ...gameRef.current }); };
  const updateParam = <K extends keyof Params>(key: K, value: Params[K]) => { setPresetKey('custom'); setParams((current) => { const next = { ...current, [key]: value }; paramsRef.current = next; if (gameRef.current.status !== 'running' && gameRef.current.status !== 'paused') { const fresh = createGame(next); gameRef.current = fresh; setGame({ ...fresh }); } return next; }); };
  const applyPreset = (key: Exclude<PresetKey, 'custom'>) => { const next = { ...presets[key] }; setParams(next); paramsRef.current = next; setPresetKey(key); const fresh = createGame(next); gameRef.current = fresh; setGame({ ...fresh }); setEventLog([`已套用「${presetNames[key]}」遭遇情境。`]); };

  const activeAttackers = Math.min(params.aggressionSlots, game.active.filter((enemy) => enemy.stun <= 0).length);
  const crowdPressure = activeAttackers * params.enemyDamage / params.enemyAttackInterval * (1 - params.dodgeRate / 100);
  const playerHpRatio = Math.max(0, game.playerHp / params.playerMaxHp * 100);
  const averageWave = game.waveResults.length ? game.waveResults.reduce((sum, value) => sum + value.duration, 0) / game.waveResults.length : 0;
  const combatTime = game.waveResults.reduce((sum, value) => sum + value.duration, 0) + (game.intermissionLeft === 0 ? game.waveTime : 0);
  const combatRatio = game.totalTime > 0 ? combatTime / game.totalTime * 100 : 0;
  const latest = history[0];

  const compareRows = useMemo(() => {
    if (!comparison.A || !comparison.B) return [];
    return [['結果', comparison.A.result, comparison.B.result], ['完成波次', `${comparison.A.waves}/5`, `${comparison.B.waves}/5`], ['總時間', `${comparison.A.clearTime.toFixed(1)}s`, `${comparison.B.clearTime.toFixed(1)}s`], ['平均波長', `${comparison.A.avgWave.toFixed(1)}s`, `${comparison.B.avgWave.toFixed(1)}s`], ['最高人群', `${comparison.A.peakCrowd} 人`, `${comparison.B.peakCrowd} 人`], ['總承傷', fmt(comparison.A.damageTaken), fmt(comparison.B.damageTaken)]];
  }, [comparison]);

  return <main className="lab-shell brawler-lab"><header className="lab-header"><div className="lab-brand-stack"><a href={sitePath('/')} className="lab-breadcrumb">← 返回模式首頁</a><div className="brand-lockup"><div className="brand-badge">A</div><div><p className="eyebrow">AVIX · GAME BALANCING LAB</p><h1>Beat’em Up 關卡節奏實驗室</h1></div></div></div><div className="header-tools"><a href={sitePath('/tower-defense')} className="mode-jump">Tower Defense →</a><div className="stage-pill"><span />SCENARIO 04 · {presetNames[presetKey]}</div></div></header>

    <section className="workspace brawler-workspace"><div className="arena-panel brawler-panel"><div className="panel-heading"><div><p className="section-label">ENCOUNTER FLOW</p><h2>五波清版測試</h2></div><p className="keyboard-hint">增援速度 × 群體壓力 × 連段效率</p></div>
      <div className={`brawler-board ${game.status} ${game.hurtFlash > 0 ? 'is-hurt' : ''}`}><div className="board-grid" /><div className="brawler-topline"><span>WAVE {game.wave.toString().padStart(2, '0')} / 05</span><span>ON SCREEN {game.active.length}</span><span>REINFORCEMENTS {game.spawnRemaining}</span></div>
        <div className="street-lane"><div className="lane-lines" /><div className={`brawler-player ${game.attackFlash > 0 ? 'attack' : ''} ${game.specialFlash > 0 ? 'special' : ''}`}><span>P</span><small>PLAYER</small></div><div className={`attack-sweep ${game.attackFlash > 0 ? 'active' : ''}`} /><div className={`special-sweep ${game.specialFlash > 0 ? 'active' : ''}`} />
          <div className="enemy-crowd">{game.active.slice(0, 14).map((enemy, index) => <div key={enemy.id} className={`crowd-enemy ${enemy.elite ? 'elite' : ''} ${enemy.stun > 0 ? 'stunned' : ''}`} style={{ '--enemy-x': `${8 + index % 7 * 13}%`, '--enemy-y': `${index < 7 ? 8 + index % 3 * 18 : 54 + index % 2 * 17}%` } as React.CSSProperties}><span>{enemy.elite ? 'E+' : 'E'}</span><i><b style={{ width: `${Math.max(0, enemy.hp / enemy.maxHp * 100)}%` }} /></i></div>)}</div>
          <div className="spawn-gate"><span>增援</span><strong>{game.spawnRemaining}</strong></div>
          <div className="aggression-meter"><span>同時進攻</span><div>{Array.from({ length: params.aggressionSlots }, (_, index) => <i className={index < activeAttackers ? 'active' : ''} key={index} />)}</div></div>
        </div>
        <div className="brawler-hud"><div className="brawler-hp"><span>PLAYER HP</span><strong>{fmt(game.playerHp)} / {fmt(params.playerMaxHp)}</strong><div><i style={{ width: `${playerHpRatio}%` }} /></div></div><div className="combo-meter"><span>COMBO</span><strong>{game.comboStep}<small> / {params.comboHits}</small></strong><div>{Array.from({ length: params.comboHits }, (_, index) => <i className={index < game.comboStep ? 'active' : ''} key={index} />)}</div></div><div className="special-meter"><span>SPECIAL</span><strong>{Math.max(0, game.specialTimer).toFixed(1)}s</strong><small>{game.specialTimer <= 0 ? 'READY' : '冷卻中'}</small></div></div>
        <div className="wave-track">{Array.from({ length: waveCount }, (_, index) => index + 1).map((wave) => <div key={wave} className={wave < game.wave || game.status === 'complete' ? 'cleared' : wave === game.wave ? 'current' : ''}><i /><span>W{wave}</span><small>{waveSize(params, wave)} 人</small></div>)}</div>
        {game.status === 'idle' && <div className="brawler-message"><span>READY TO BRAWL</span><strong>敵人越多，不一定代表壓力越高</strong><p>同時進攻數與增援節奏才決定場面壓力</p></div>}
        {game.status === 'paused' && <div className="brawler-message"><span>SIMULATION PAUSED</span><strong>清版測試已暫停</strong><p>可調整遭遇參數後繼續觀察</p></div>}
        {game.intermissionLeft > 0 && game.status === 'running' && <div className="brawler-message intermission"><span>AREA CLEAR</span><strong>{game.intermissionLeft.toFixed(1)} 秒後下一波</strong><p>波次間回復 {params.recovery}% 最大生命</p></div>}
        {(game.status === 'complete' || game.status === 'defeated') && <div className={`brawler-message result ${game.status}`}><span>{game.status === 'complete' ? 'STAGE CLEAR' : 'PLAYER OVERWHELMED'}</span><strong>{game.status === 'complete' ? '五波敵人全部擊倒' : `玩家倒在第 ${game.wave} 波`}</strong><p>最高同屏敵人：{game.peakCrowd} 人</p></div>}
        <div className="board-event"><span>最新事件</span>{game.lastEvent}</div>
      </div>
      <div className="arena-actions"><button className="primary-action" onClick={toggle}><span>{game.status === 'running' ? 'Ⅱ' : '▶'}</span>{game.status === 'running' ? '暫停測試' : game.status === 'paused' ? '繼續測試' : '開始測試'}</button><button className="secondary-action" onClick={() => reset()}>↺ 重置</button><div className="speed-control"><span>速度</span>{[1, 4, 12].map((speed) => <button key={speed} className={simSpeed === speed ? 'selected' : ''} onClick={() => setSimSpeed(speed)}>{speed}×</button>)}</div><div className="run-note"><span className={game.status === 'running' ? 'active-dot' : ''} />{game.status === 'running' ? '遭遇模擬中' : '等待測試'}</div></div>
    </div>

      <aside className="control-panel"><div className="panel-heading compact"><div><p className="section-label">PARAMETERS</p><h2>遭遇控制台</h2></div><select aria-label="遭遇情境預設" value={presetKey} onChange={(event) => event.target.value !== 'custom' && applyPreset(event.target.value as Exclude<PresetKey, 'custom'>)}><option value="arcade">街機標準</option><option value="crowd">群體壓力</option><option value="elite">菁英突襲</option><option value="collapse">節奏崩潰</option>{presetKey === 'custom' && <option value="custom">自訂參數</option>}</select></div>
        <div className="control-tabs three"><button className={controlTab === 'player' ? 'active' : ''} onClick={() => setControlTab('player')}><span className="player-swatch" />玩家</button><button className={controlTab === 'crowd' ? 'active' : ''} onClick={() => setControlTab('crowd')}><span className="boss-swatch" />敵群</button><button className={controlTab === 'pacing' ? 'active' : ''} onClick={() => setControlTab('pacing')}><span className="gear-swatch" />節奏</button></div>
        <div className="controls-scroll">{controlTab === 'player' ? <div className="control-group"><RangeControl label="玩家生命" hint="五波戰鬥共用的生存資源" value={params.playerMaxHp} min={800} max={3200} step={100} onChange={(value) => updateParam('playerMaxHp', value)} /><RangeControl label="單擊傷害" hint="每次普通攻擊命中的基礎傷害" value={params.hitDamage} min={50} max={250} step={5} onChange={(value) => updateParam('hitDamage', value)} /><RangeControl label="攻擊間隔" hint="連段中每一擊之間的時間" value={params.attackInterval} min={.2} max={1} step={.05} suffix="s" onChange={(value) => updateParam('attackInterval', value)} /><RangeControl label="操作命中率" hint="將玩家輸入與走位能力轉為有效傷害" value={params.accuracy} min={50} max={100} suffix="%" onChange={(value) => updateParam('accuracy', value)} /><RangeControl label="連段段數" hint="第幾擊觸發終結傷害" value={params.comboHits} min={2} max={8} suffix="段" onChange={(value) => updateParam('comboHits', value)} /><RangeControl label="終結倍率" hint="連段最後一擊的傷害倍率" value={params.finisherMultiplier} min={1} max={3.5} step={.1} suffix="×" onChange={(value) => updateParam('finisherMultiplier', value)} /><RangeControl label="橫掃目標數" hint="普通攻擊可同時命中的敵人數" value={params.cleaveTargets} min={1} max={5} suffix="人" onChange={(value) => updateParam('cleaveTargets', value)} /><RangeControl label="命中硬直" hint="敵人無法進攻的控制時間" value={params.hitStun} min={.1} max={1.2} step={.05} suffix="s" onChange={(value) => updateParam('hitStun', value)} /><RangeControl label="必殺技倍率" hint="週期性範圍攻擊的傷害倍率" value={params.specialMultiplier} min={1.5} max={6} step={.1} suffix="×" onChange={(value) => updateParam('specialMultiplier', value)} /><RangeControl label="必殺技冷卻" hint="兩次範圍爆發之間的時間" value={params.specialCooldown} min={3} max={16} step={.5} suffix="s" onChange={(value) => updateParam('specialCooldown', value)} /><RangeControl label="閃避率" hint="反映走位後減少的有效承傷" value={params.dodgeRate} min={0} max={60} suffix="%" onChange={(value) => updateParam('dodgeRate', value)} /></div> : controlTab === 'crowd' ? <div className="control-group"><RangeControl label="初始波次人數" hint="第一波出現的敵人總數" value={params.baseWaveSize} min={2} max={12} suffix="人" onChange={(value) => updateParam('baseWaveSize', value)} /><RangeControl label="每波增加" hint="後續每波增加的敵人數" value={params.waveGrowth} min={0} max={5} suffix="人" onChange={(value) => updateParam('waveGrowth', value)} /><RangeControl label="敵人生命" hint="第一波一般敵人的生命值" value={params.enemyHp} min={120} max={800} step={20} onChange={(value) => updateParam('enemyHp', value)} /><RangeControl label="生命成長率" hint="每一波提高的敵人生命比例" value={params.enemyHpGrowth} min={0} max={28} suffix="%" onChange={(value) => updateParam('enemyHpGrowth', value)} /><RangeControl label="敵人傷害" hint="一般敵人的單次攻擊傷害" value={params.enemyDamage} min={25} max={180} step={5} onChange={(value) => updateParam('enemyDamage', value)} /><RangeControl label="敵人攻擊間隔" hint="群體攻擊判定的發生頻率" value={params.enemyAttackInterval} min={.6} max={2.5} step={.05} suffix="s" onChange={(value) => updateParam('enemyAttackInterval', value)} /><RangeControl label="同時進攻上限" hint="再多敵人也只有此數量能同時攻擊" value={params.aggressionSlots} min={1} max={7} suffix="人" onChange={(value) => updateParam('aggressionSlots', value)} /><RangeControl label="菁英比例" hint="每波敵人中菁英單位的比例" value={params.eliteRatio} min={0} max={60} step={5} suffix="%" onChange={(value) => updateParam('eliteRatio', value)} /><RangeControl label="菁英生命倍率" hint="菁英相對於一般敵人的生命倍率" value={params.eliteHpMultiplier} min={1} max={4} step={.1} suffix="×" onChange={(value) => updateParam('eliteHpMultiplier', value)} /></div> : <div className="control-group"><RangeControl label="增援間隔" hint="敵人進入畫面的時間間隔" value={params.spawnInterval} min={.2} max={2.5} step={.05} suffix="s" onChange={(value) => updateParam('spawnInterval', value)} /><RangeControl label="波次間休息" hint="清場後至下一波出現的空檔" value={params.intermission} min={0} max={12} step={.5} suffix="s" onChange={(value) => updateParam('intermission', value)} /><RangeControl label="波次間恢復" hint="每次清場後回復的最大生命比例" value={params.recovery} min={0} max={80} step={5} suffix="%" onChange={(value) => updateParam('recovery', value)} /><div className="formula-note"><span>場面壓力</span><strong>同時進攻數 × 敵人 DPS</strong><p>同屏人數塑造視覺密度；同時進攻上限才決定實際承傷壓力。</p></div></div>}</div>
        <div className="curve-summary"><div><span>預估群攻輸出</span><strong>{fmt(projected.output)} DPS</strong></div><div><span>基礎承傷壓力</span><strong className={projected.pressure > 180 ? 'danger' : ''}>{fmt(projected.pressure)} DPS</strong></div></div>
      </aside>
    </section>

    <section className="metrics-section"><div className="metrics-heading"><div><p className="section-label">ENCOUNTER METRICS</p><h2>關卡節奏讀數</h2></div><p>群體戰鬥的壓力來自「同時能做什麼」，不只是場上有多少敵人。</p></div><div className="metrics-grid six"><div className="metric-card primary"><span>目前波次</span><strong>{game.wave}<i>/5</i></strong><small>已擊倒 {game.defeatedEnemies} 人</small></div><div className="metric-card"><span>同屏敵人</span><strong>{game.active.length}<i>人</i></strong><small>最高 {game.peakCrowd} 人</small></div><div className="metric-card"><span>同時進攻</span><strong>{activeAttackers}<i>人</i></strong><small>上限 {params.aggressionSlots} 人</small></div><div className="metric-card"><span>目前承傷壓力</span><strong>{fmt(crowdPressure)}</strong><small>每秒有效傷害</small></div><div className="metric-card"><span>平均波長</span><strong>{averageWave.toFixed(1)}<i>s</i></strong><small>清場戰鬥時間</small></div><div className="metric-card warning"><span>戰鬥時間占比</span><strong>{combatRatio.toFixed(0)}<i>%</i></strong><small>其餘為波次休息</small></div></div></section>

    <section className="analysis-grid"><div className="history-panel"><div className="analysis-heading"><div><p className="section-label">RUN HISTORY</p><h2>清版測試紀錄</h2></div><span>保留最近 8 輪</span></div>{history.length === 0 ? <div className="empty-state"><strong>尚無完成紀錄</strong><p>完成或失敗後，整輪遭遇結果會出現在這裡。</p></div> : <div className="history-table"><div className="table-row brawler-row table-head"><span>輪次</span><span>情境</span><span>結果</span><span>波次</span><span>總時間</span><span>最高人群</span></div>{history.map((run) => <div className="table-row brawler-row" key={run.id}><span>#{run.id.toString().padStart(2, '0')}</span><span>{run.preset}</span><span className={run.result === 'CLEAR' ? 'win' : 'lose'}>{run.result}</span><span>{run.waves}/5</span><span>{run.clearTime.toFixed(1)}s</span><span>{run.peakCrowd} 人</span></div>)}</div>}</div>
      <div className="compare-panel"><div className="analysis-heading"><div><p className="section-label">A / B COMPARE</p><h2>遭遇比較</h2></div></div><div className="compare-slots"><button disabled={!latest} className={comparison.A ? 'filled' : ''} onClick={() => latest && setComparison((current) => ({ ...current, A: latest }))}><span>A</span><b>{comparison.A ? `#${comparison.A.id.toString().padStart(2, '0')} ${comparison.A.preset}` : '存入最新結果'}</b></button><div className="versus">VS</div><button disabled={!latest} className={comparison.B ? 'filled' : ''} onClick={() => latest && setComparison((current) => ({ ...current, B: latest }))}><span>B</span><b>{comparison.B ? `#${comparison.B.id.toString().padStart(2, '0')} ${comparison.B.preset}` : '存入最新結果'}</b></button></div>{compareRows.length === 0 ? <div className="compare-hint">先完成一輪街機標準，再調整增援間隔或同時進攻上限，比較場面密度與實際壓力。</div> : <div className="compare-table">{compareRows.map(([label, a, b]) => <div key={label}><span>{label}</span><b>{a}</b><b>{b}</b></div>)}</div>}</div>
    </section>
    <section className="event-panel"><div><p className="section-label">ENCOUNTER LOG</p><h2>遭遇紀錄</h2></div><div className="event-list">{eventLog.map((item, index) => <p key={`${item}-${index}`}><span>{index === 0 ? 'NOW' : `-${index}`}</span>{item}</p>)}</div></section>
    <footer><span>AVIX GAME DESIGN ACADEMY</span><p>同屏數量塑造畫面，進攻權塑造壓力。</p><span>MICROGAME TOOL · V0.4</span></footer>
  </main>;
}
