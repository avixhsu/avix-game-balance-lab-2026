'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { sitePath } from './sitePath';

type Status = 'idle' | 'running' | 'paused' | 'won' | 'lost';
type PresetKey = 'teaching' | 'standard' | 'pressure' | 'custom';
type DifficultyKey = Exclude<PresetKey, 'custom'>;
type StrategyKey = 'aggressive' | 'balanced' | 'conservative';
type SkillKey = 'novice' | 'skilled' | 'expert';
type BossPhase = 'idle' | 'windup' | 'active' | 'recovery';
type PlayerAction = 'waiting' | 'approaching' | 'combo' | 'retreating' | 'dodging';

type Params = {
  playerMaxHp: number; playerDamage: number; comboHits: number; comboInterval: number;
  finisherMultiplier: number; comboRecovery: number; playerSpeed: number; playerRange: number;
  dodgeDuration: number; dodgeCooldown: number; reactionDelay: number; retreatBuffer: number;
  bossMaxHp: number; bossDamage: number; bossIdle: number; bossWindup: number;
  bossActive: number; bossRecovery: number; bossSpeed: number; bossRange: number;
};

type GameState = {
  status: Status; phase: BossPhase; phaseLeft: number; phaseDodgeAttempted: boolean;
  playerAction: PlayerAction; playerX: number; bossX: number; playerHp: number; bossHp: number;
  elapsed: number; playerCooldown: number; comboRecoveryLeft: number; dodgeLeft: number;
  dodgeCooldownLeft: number; comboStep: number; damageDealt: number; damageTaken: number;
  playerHits: number; bossHits: number; dodges: number; openings: number; windowDamage: number;
  windowHits: number; currentWindowDamage: number; currentWindowHits: number; completedCombos: number;
  interruptedCombos: number; unsafeHits: number; overcommits: number; lastAttackAgo: number;
  attackIndex: number; effectiveReaction: number; executionWillSucceed: boolean; entryDelayLeft: number;
  playerFlash: number; bossFlash: number; hurtFlash: number; lastEvent: string;
};

type RunResult = {
  id: number; outcome: 'WIN' | 'LOSE'; preset: string; elapsed: number; dps: number;
  damageTaken: number; avgWindowDamage: number; avgWindowHits: number; windowUtilization: number;
  completedCombos: number; overcommits: number; dodges: number; strategy: string; skill: string;
};

type BatchSummary = {
  clearRate: number; medianTime: number; averageHp: number; averageWindowDamage: number;
  dodgeRate: number; overcommitRate: number;
};

const presets: Record<DifficultyKey, Params> = {
  teaching: {
    playerMaxHp: 1300, playerDamage: 145, comboHits: 5, comboInterval: .3, finisherMultiplier: 1.8,
    comboRecovery: .5, playerSpeed: 29, playerRange: 14, dodgeDuration: .42, dodgeCooldown: 1.1,
    reactionDelay: .24, retreatBuffer: .45, bossMaxHp: 3800, bossDamage: 100, bossIdle: 1.55,
    bossWindup: 1.05, bossActive: .42, bossRecovery: 3, bossSpeed: 8, bossRange: 18,
  },
  standard: {
    playerMaxHp: 1050, playerDamage: 115, comboHits: 5, comboInterval: .26, finisherMultiplier: 1.85,
    comboRecovery: .58, playerSpeed: 27, playerRange: 13, dodgeDuration: .32, dodgeCooldown: 1.35,
    reactionDelay: .34, retreatBuffer: .38, bossMaxHp: 5200, bossDamage: 185, bossIdle: 1.2,
    bossWindup: .72, bossActive: .38, bossRecovery: 2.4, bossSpeed: 10, bossRange: 19,
  },
  pressure: {
    playerMaxHp: 900, playerDamage: 112, comboHits: 6, comboInterval: .24, finisherMultiplier: 1.9,
    comboRecovery: .62, playerSpeed: 25, playerRange: 12, dodgeDuration: .24, dodgeCooldown: 1.6,
    reactionDelay: .52, retreatBuffer: .32, bossMaxHp: 6200, bossDamage: 250, bossIdle: .9,
    bossWindup: .56, bossActive: .34, bossRecovery: 1.65, bossSpeed: 14, bossRange: 20,
  },
};

const strategyProfiles: Record<StrategyKey, { name: string; description: string; entryDelay: number; retreatAdjust: number; evadeAdjust: number; overcommitBase: number }> = {
  aggressive: { name: '激進', description: '盡量榨乾窗口，輸出高但容易貪刀', entryDelay: 0, retreatAdjust: -.22, evadeAdjust: -.1, overcommitBase: .3 },
  balanced: { name: '平衡', description: '依安全窗口完成連段並正常撤退', entryDelay: .08, retreatAdjust: 0, evadeAdjust: 0, overcommitBase: .09 },
  conservative: { name: '保守', description: '延後進場並提早撤退，降低單次風險', entryDelay: .18, retreatAdjust: .3, evadeAdjust: .06, overcommitBase: .025 },
};

const skillProfiles: Record<SkillKey, { name: string; description: string; stability: number; reactionOffset: number; variance: number }> = {
  novice: { name: '新手', description: '反應較慢，時機誤差與操作失誤較多', stability: .7, reactionOffset: .16, variance: .18 },
  skilled: { name: '熟練', description: '大多能正確判讀，但偶爾仍會失誤', stability: .86, reactionOffset: 0, variance: .09 },
  expert: { name: '高手', description: '反應快速，操作結果相當穩定', stability: .97, reactionOffset: -.1, variance: .04 },
};

const presetNames: Record<PresetKey, string> = { teaching: '教學模式', standard: '標準難度', pressure: '高壓挑戰', custom: '自訂參數' };
const phaseNames: Record<BossPhase, string> = { idle: '追蹤／等待', windup: '攻擊前搖', active: '攻擊判定', recovery: '破綻窗口' };
const actionNames: Record<PlayerAction, string> = { waiting: '觀察走位', approaching: '接近 Boss', combo: '連段攻擊', retreating: '安全撤退', dodging: '閃避攻擊' };

function clamp(value: number, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
function deterministicRoll(index: number, seed: number, salt = 0) {
  const value = Math.sin((index + 1) * 12.9898 + (seed + 1) * 78.233 + salt * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function withBossPreset(params: Params, key: DifficultyKey): Params {
  const boss = presets[key];
  return { ...params, bossMaxHp: boss.bossMaxHp, bossDamage: boss.bossDamage, bossIdle: boss.bossIdle, bossWindup: boss.bossWindup, bossActive: boss.bossActive, bossRecovery: boss.bossRecovery, bossSpeed: boss.bossSpeed, bossRange: boss.bossRange };
}

function phaseDuration(params: Params, phase: BossPhase) {
  return phase === 'idle' ? params.bossIdle : phase === 'windup' ? params.bossWindup : phase === 'active' ? params.bossActive : params.bossRecovery;
}

function createGame(params: Params, status: Status = 'idle'): GameState {
  return {
    status, phase: 'idle', phaseLeft: params.bossIdle, phaseDodgeAttempted: false, playerAction: 'waiting',
    playerX: 19, bossX: 79, playerHp: params.playerMaxHp, bossHp: params.bossMaxHp, elapsed: 0,
    playerCooldown: 0, comboRecoveryLeft: 0, dodgeLeft: 0, dodgeCooldownLeft: 0, comboStep: 0,
    damageDealt: 0, damageTaken: 0, playerHits: 0, bossHits: 0, dodges: 0, openings: 0,
    windowDamage: 0, windowHits: 0, currentWindowDamage: 0, currentWindowHits: 0,
    completedCombos: 0, interruptedCombos: 0, unsafeHits: 0, overcommits: 0, lastAttackAgo: 99,
    attackIndex: 0, effectiveReaction: params.reactionDelay, executionWillSucceed: true, entryDelayLeft: 0,
    playerFlash: 0, bossFlash: 0, hurtFlash: 0, lastEvent: '等待開始打帶跑測試',
  };
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

function formatValue(value: number, decimals = 0) {
  return value.toLocaleString('zh-TW', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function projectWindow(params: Params, strategyKey: StrategyKey = 'balanced') {
  const strategy = strategyProfiles[strategyKey];
  const approachDistance = Math.max(0, params.bossRange + 7 - params.playerRange * .86);
  const retreatBuffer = Math.max(0, params.retreatBuffer + strategy.retreatAdjust);
  const usableTime = Math.max(0, params.bossRecovery - retreatBuffer - strategy.entryDelay - approachDistance / params.playerSpeed);
  let time = 0; let hits = 0; let comboStep = 0; let damage = 0;
  while (time <= usableTime && hits < 40) {
    comboStep += 1;
    const finisher = comboStep >= params.comboHits;
    damage += params.playerDamage * (finisher ? params.finisherMultiplier : 1);
    hits += 1;
    time += finisher ? params.comboRecovery : params.comboInterval;
    if (finisher) comboStep = 0;
  }
  const cycle = params.bossIdle + params.bossWindup + params.bossActive + params.bossRecovery;
  return { hits, damage, opportunityRate: 60 / cycle, clearWindows: damage > 0 ? Math.ceil(params.bossMaxHp / damage) : 0 };
}

function runScenario(params: Params, strategyKey: StrategyKey, skillKey: SkillKey, seed: number) {
  const strategy = strategyProfiles[strategyKey];
  const skill = skillProfiles[skillKey];
  const projection = projectWindow(params, strategyKey);
  let playerHp = params.playerMaxHp;
  let bossHp = params.bossMaxHp;
  let elapsed = 0;
  let attacks = 0;
  let dodges = 0;
  let openings = 0;
  let overcommits = 0;
  let totalWindowDamage = 0;
  while (playerHp > 0 && bossHp > 0 && attacks < 60) {
    attacks += 1;
    const jitter = (deterministicRoll(attacks, seed, 1) * 2 - 1) * skill.variance;
    const reaction = Math.max(.03, params.reactionDelay + skill.reactionOffset + jitter);
    const stability = clamp(skill.stability + strategy.evadeAdjust, .2, .995);
    const executionPass = deterministicRoll(attacks, seed, 2) <= stability;
    if (executionPass && reaction < params.bossWindup) dodges += 1;
    else playerHp = Math.max(0, playerHp - params.bossDamage);
    elapsed += params.bossIdle + params.bossWindup + params.bossActive;
    if (playerHp <= 0) break;
    openings += 1;
    let windowDamage = projection.damage;
    const overcommitChance = strategy.overcommitBase * (1.25 - skill.stability);
    if (deterministicRoll(openings, seed, 3) < overcommitChance) {
      overcommits += 1;
      windowDamage += params.playerDamage;
      playerHp = Math.max(0, playerHp - params.bossDamage * .5);
    }
    bossHp = Math.max(0, bossHp - windowDamage);
    totalWindowDamage += windowDamage;
    elapsed += params.bossRecovery;
  }
  return { won: bossHp <= 0 && playerHp > 0, elapsed, hp: playerHp, attacks, dodges, openings, overcommits, averageWindowDamage: openings ? totalWindowDamage / openings : 0 };
}

function summarizeBatch(params: Params, strategyKey: StrategyKey, skillKey: SkillKey): BatchSummary {
  const runs = Array.from({ length: 20 }, (_, index) => runScenario(params, strategyKey, skillKey, index + 1));
  const wins = runs.filter((run) => run.won).sort((a, b) => a.elapsed - b.elapsed);
  const medianTime = wins.length ? wins[Math.floor(wins.length / 2)].elapsed : 0;
  const attacks = runs.reduce((sum, run) => sum + run.attacks, 0);
  const openings = runs.reduce((sum, run) => sum + run.openings, 0);
  return {
    clearRate: wins.length / runs.length * 100,
    medianTime,
    averageHp: runs.reduce((sum, run) => sum + run.hp, 0) / runs.length,
    averageWindowDamage: runs.reduce((sum, run) => sum + run.averageWindowDamage, 0) / runs.length,
    dodgeRate: attacks ? runs.reduce((sum, run) => sum + run.dodges, 0) / attacks * 100 : 0,
    overcommitRate: openings ? runs.reduce((sum, run) => sum + run.overcommits, 0) / openings * 100 : 0,
  };
}

type RangeProps = { label: string; hint: string; value: number; min: number; max: number; step?: number; suffix?: string; decimals?: number; onChange: (value: number) => void };
function RangeControl({ label, hint, value, min, max, step = 1, suffix = '', decimals = 0, onChange }: RangeProps) {
  const fill = (value - min) / (max - min) * 100;
  return <label className="range-control"><span className="range-heading"><b>{label}</b><output>{formatValue(value, decimals)}{suffix}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} style={{ '--range-fill': `${fill}%` } as React.CSSProperties} onChange={(event) => onChange(Number(event.target.value))} /><small>{hint}</small></label>;
}

export default function BossRushLab() {
  const [params, setParams] = useState<Params>(presets.standard);
  const [presetKey, setPresetKey] = useState<PresetKey>('standard');
  const [strategyKey, setStrategyKey] = useState<StrategyKey>('balanced');
  const [skillKey, setSkillKey] = useState<SkillKey>('skilled');
  const [autoMode, setAutoMode] = useState(true);
  const [simSpeed, setSimSpeed] = useState(1);
  const [controlTab, setControlTab] = useState<'combo' | 'action' | 'boss'>('combo');
  const [game, setGame] = useState<GameState>(() => createGame(presets.standard));
  const [history, setHistory] = useState<RunResult[]>([]);
  const [comparison, setComparison] = useState<{ A?: RunResult; B?: RunResult }>({});
  const [eventLog, setEventLog] = useState<string[]>(['調整連段與 Boss 窗口後，開始第一輪測試。']);
  const paramsRef = useRef(params);
  const gameRef = useRef(game);
  const keysRef = useRef(new Set<string>());
  const nextRunId = useRef(1);
  useEffect(() => { paramsRef.current = params; }, [params]);
  const addLog = (message: string) => setEventLog((current) => [message, ...current].slice(0, 5));

  useEffect(() => {
    const handleDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'BUTTON'].includes(target.tagName)) return;
      if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
        event.preventDefault(); keysRef.current.add(event.code);
      }
    };
    const handleUp = (event: KeyboardEvent) => keysRef.current.delete(event.code);
    window.addEventListener('keydown', handleDown); window.addEventListener('keyup', handleUp);
    return () => { window.removeEventListener('keydown', handleDown); window.removeEventListener('keyup', handleUp); };
  }, []);

  useEffect(() => {
    let frame = 0; let last = performance.now(); let lastPaint = 0;

    const finish = (state: GameState, outcome: 'WIN' | 'LOSE') => {
      if (state.status === 'won' || state.status === 'lost') return;
      state.status = outcome === 'WIN' ? 'won' : 'lost';
      const projection = projectWindow(paramsRef.current, strategyKey);
      const run: RunResult = {
        id: nextRunId.current++, outcome, preset: presetNames[presetKey], elapsed: state.elapsed,
        dps: state.elapsed > 0 ? state.damageDealt / state.elapsed : 0, damageTaken: state.damageTaken,
        avgWindowDamage: state.openings ? state.windowDamage / state.openings : 0,
        avgWindowHits: state.openings ? state.windowHits / state.openings : 0,
        windowUtilization: state.openings && projection.hits ? Math.min(150, state.windowHits / (state.openings * projection.hits) * 100) : 0,
        completedCombos: state.completedCombos, overcommits: state.overcommits, dodges: state.dodges,
        strategy: strategyProfiles[strategyKey].name, skill: skillProfiles[skillKey].name,
      };
      setHistory((current) => [run, ...current].slice(0, 8));
      addLog(outcome === 'WIN' ? `測試完成：經過 ${state.openings} 次破綻窗口擊破 Boss。` : `測試失敗：玩家在第 ${state.openings + 1} 個循環倒下。`);
    };

    const attackPlayer = (state: GameState, current: Params) => {
      if (state.playerCooldown > 0 || state.comboRecoveryLeft > 0) return;
      state.playerCooldown = current.comboInterval; state.playerFlash = .14; state.playerAction = 'combo';
      if (Math.abs(state.bossX - state.playerX) > current.playerRange) { state.lastEvent = '攻擊落空：Boss 位於攻擊距離外'; return; }
      const nextStep = state.comboStep + 1;
      const finisher = nextStep >= current.comboHits;
      const damage = current.playerDamage * (finisher ? current.finisherMultiplier : 1);
      state.bossHp = Math.max(0, state.bossHp - damage); state.damageDealt += damage; state.playerHits += 1; state.lastAttackAgo = 0;
      if (state.phase === 'recovery') {
        state.windowDamage += damage; state.windowHits += 1;
        state.currentWindowDamage += damage; state.currentWindowHits += 1;
      } else state.unsafeHits += 1;
      if (finisher) {
        state.comboStep = 0; state.completedCombos += 1; state.comboRecoveryLeft = current.comboRecovery;
        state.lastEvent = `連段終結命中，造成 ${formatValue(damage)} 傷害`;
      } else { state.comboStep = nextStep; state.lastEvent = `連段第 ${nextStep} 擊命中`; }
    };

    const dodge = (state: GameState, current: Params) => {
      if (state.dodgeCooldownLeft > 0 || state.dodgeLeft > 0) return false;
      state.dodgeLeft = current.dodgeDuration; state.dodgeCooldownLeft = current.dodgeCooldown;
      state.phaseDodgeAttempted = true; state.playerAction = 'dodging';
      const away = state.playerX < state.bossX ? -1 : 1;
      state.playerX = Math.max(5, Math.min(95, state.playerX + away * 7));
      state.lastEvent = '玩家讀取前搖並進行閃避';
      return true;
    };

    const move = (state: GameState, direction: number, speed: number, dt: number) => {
      state.playerX = Math.max(4, Math.min(96, state.playerX + direction * speed * dt));
    };

    const changePhase = (state: GameState, current: Params) => {
      if (state.phase === 'idle') {
        const skill = skillProfiles[skillKey];
        const strategy = strategyProfiles[strategyKey];
        state.attackIndex += 1;
        const jitter = (deterministicRoll(state.attackIndex, 6, 1) * 2 - 1) * skill.variance;
        state.effectiveReaction = Math.max(.03, current.reactionDelay + skill.reactionOffset + jitter);
        state.executionWillSucceed = deterministicRoll(state.attackIndex, 6, 2) <= clamp(skill.stability + strategy.evadeAdjust, .2, .995);
        state.phase = 'windup'; state.phaseLeft = current.bossWindup; state.phaseDodgeAttempted = false;
        state.lastEvent = `Boss 前搖開始，本次反應 ${state.effectiveReaction.toFixed(2)} 秒`;
        addLog(`Boss 前搖開始：${current.bossWindup.toFixed(2)} 秒後進入攻擊判定。`);
      } else if (state.phase === 'windup') {
        state.phase = 'active'; state.phaseLeft = current.bossActive; state.bossFlash = .25;
        const inRange = Math.abs(state.bossX - state.playerX) <= current.bossRange;
        if (inRange && state.dodgeLeft <= 0) {
          state.playerHp = Math.max(0, state.playerHp - current.bossDamage);
          state.damageTaken += current.bossDamage; state.bossHits += 1; state.hurtFlash = .25;
          if (state.lastAttackAgo <= current.retreatBuffer + current.bossWindup) state.overcommits += 1;
          state.lastEvent = `撤退失敗，承受 ${formatValue(current.bossDamage)} 傷害`;
          addLog(`Boss 命中：玩家承受 ${formatValue(current.bossDamage)} 傷害。`);
        } else {
          state.dodges += 1;
          state.lastEvent = state.dodgeLeft > 0 ? '閃避成功，等待 Boss 露出破綻' : '走位離開攻擊範圍';
          addLog(state.dodgeLeft > 0 ? '閃避成功：即將進入反擊窗口。' : '走位成功：Boss 攻擊落空。');
        }
      } else if (state.phase === 'active') {
        state.phase = 'recovery'; state.phaseLeft = current.bossRecovery; state.openings += 1;
        state.currentWindowDamage = 0; state.currentWindowHits = 0; state.comboStep = 0; state.comboRecoveryLeft = 0;
        state.entryDelayLeft = strategyProfiles[strategyKey].entryDelay;
        state.playerAction = 'approaching'; state.lastEvent = `破綻窗口開啟，共 ${current.bossRecovery.toFixed(2)} 秒`;
        addLog(`破綻窗口開啟：嘗試完成 ${current.comboHits} 段連擊後撤退。`);
      } else {
        if (state.comboStep > 0) state.interruptedCombos += 1;
        const strategy = strategyProfiles[strategyKey];
        const skill = skillProfiles[skillKey];
        const overcommitChance = strategy.overcommitBase * (1.25 - skill.stability);
        const overcommitted = state.currentWindowHits > 0 && deterministicRoll(state.openings, 6, 3) < overcommitChance;
        if (overcommitted) {
          const punish = current.bossDamage * .5;
          state.overcommits += 1;
          state.playerHp = Math.max(0, state.playerHp - punish);
          state.damageTaken += punish;
          state.hurtFlash = .22;
          state.lastEvent = `窗口結束時貪刀，承受 ${formatValue(punish)} 反擊傷害`;
          addLog(`撤退失誤：窗口結束時承受 ${formatValue(punish)} 反擊傷害。`);
        }
        state.comboStep = 0; state.phase = 'idle'; state.phaseLeft = current.bossIdle; state.playerAction = 'retreating';
        if (!overcommitted) {
          state.lastEvent = `窗口結束：${state.currentWindowHits} 擊／${formatValue(state.currentWindowDamage)} 傷害`;
          addLog(`窗口結束：命中 ${state.currentWindowHits} 次，造成 ${formatValue(state.currentWindowDamage)} 傷害。`);
        }
      }
    };

    const loop = (now: number) => {
      const rawDt = Math.min((now - last) / 1000, .05); last = now;
      const state = gameRef.current; const current = paramsRef.current;
      if (state.status === 'running') {
        const dt = rawDt * simSpeed;
        state.elapsed += dt; state.phaseLeft -= dt;
        state.playerCooldown = Math.max(0, state.playerCooldown - dt);
        state.comboRecoveryLeft = Math.max(0, state.comboRecoveryLeft - dt);
        state.entryDelayLeft = Math.max(0, state.entryDelayLeft - dt);
        state.dodgeLeft = Math.max(0, state.dodgeLeft - dt);
        state.dodgeCooldownLeft = Math.max(0, state.dodgeCooldownLeft - dt);
        state.lastAttackAgo += dt;
        state.playerFlash = Math.max(0, state.playerFlash - dt);
        state.bossFlash = Math.max(0, state.bossFlash - dt);
        state.hurtFlash = Math.max(0, state.hurtFlash - dt);

        const keys = keysRef.current;
        const left = keys.has('KeyA') || keys.has('ArrowLeft');
        const right = keys.has('KeyD') || keys.has('ArrowRight');
        const manualDirection = (right ? 1 : 0) - (left ? 1 : 0);
        const directionToBoss = state.playerX < state.bossX ? 1 : -1;
        const directionAway = -directionToBoss;
        const distance = Math.abs(state.bossX - state.playerX);

        if (autoMode) {
          if (state.phase === 'windup') {
            const phaseElapsed = current.bossWindup - Math.max(0, state.phaseLeft);
            state.playerAction = 'waiting';
            if (phaseElapsed >= state.effectiveReaction && state.executionWillSucceed && !state.phaseDodgeAttempted) dodge(state, current);
          } else if (state.phase === 'active') {
            state.playerAction = state.dodgeLeft > 0 ? 'dodging' : 'retreating';
            move(state, directionAway, current.playerSpeed * .82, dt);
          } else if (state.phase === 'recovery') {
            const effectiveRetreat = Math.max(0, current.retreatBuffer + strategyProfiles[strategyKey].retreatAdjust);
            if (state.entryDelayLeft > 0) {
              state.playerAction = 'waiting';
            } else if (state.phaseLeft <= effectiveRetreat) {
              state.playerAction = 'retreating'; move(state, directionAway, current.playerSpeed, dt);
            } else if (distance > current.playerRange * .86) {
              state.playerAction = 'approaching'; move(state, directionToBoss, current.playerSpeed, dt);
            } else attackPlayer(state, current);
          } else {
            const safeDistance = current.bossRange * .78;
            if (distance < safeDistance - 1) { state.playerAction = 'retreating'; move(state, directionAway, current.playerSpeed * .7, dt); }
            else if (distance > safeDistance + 2) { state.playerAction = 'approaching'; move(state, directionToBoss, current.playerSpeed * .55, dt); }
            else state.playerAction = 'waiting';
          }
        } else {
          if (manualDirection !== 0) {
            move(state, manualDirection, current.playerSpeed, dt);
            state.playerAction = manualDirection === directionAway ? 'retreating' : 'approaching';
          } else if (state.dodgeLeft > 0) state.playerAction = 'dodging';
          else state.playerAction = 'waiting';
          if (keys.has('Space')) attackPlayer(state, current);
          if (keys.has('ShiftLeft') || keys.has('ShiftRight')) dodge(state, current);
        }

        const updatedDistance = Math.abs(state.bossX - state.playerX);
        if (state.phase === 'idle' && updatedDistance > current.bossRange * .76) {
          const towardPlayer = state.bossX > state.playerX ? -1 : 1;
          state.bossX += towardPlayer * current.bossSpeed * dt;
        }
        state.bossX = Math.max(4, Math.min(96, state.bossX));
        if (state.phaseLeft <= 0) changePhase(state, current);
        if (state.bossHp <= 0) finish(state, 'WIN');
        else if (state.playerHp <= 0) finish(state, 'LOSE');
      }
      if (now - lastPaint > 34) { setGame({ ...state }); lastPaint = now; }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [autoMode, simSpeed, presetKey, strategyKey, skillKey]);

  const resetGame = (status: Status = 'idle') => {
    const next = createGame(paramsRef.current, status); gameRef.current = next; setGame({ ...next });
    keysRef.current.clear(); setEventLog([status === 'running' ? '打帶跑測試開始。' : '戰鬥已重置，等待下一輪測試。']);
  };
  const toggleRun = () => {
    if (gameRef.current.status === 'running') { gameRef.current.status = 'paused'; addLog('測試暫停。'); }
    else if (gameRef.current.status === 'paused') { gameRef.current.status = 'running'; addLog('測試繼續。'); }
    else { resetGame('running'); return; }
    setGame({ ...gameRef.current });
  };
  const updateParam = <K extends keyof Params>(key: K, value: Params[K]) => {
    if (String(key).startsWith('boss')) setPresetKey('custom');
    setParams((current) => {
      const next = { ...current, [key]: value }; paramsRef.current = next;
      if (gameRef.current.status !== 'running' && gameRef.current.status !== 'paused') {
        const fresh = createGame(next); gameRef.current = fresh; setGame({ ...fresh });
      }
      return next;
    });
  };
  const applyPreset = (key: DifficultyKey) => {
    const next = withBossPreset(paramsRef.current, key); setParams(next); paramsRef.current = next; setPresetKey(key);
    const fresh = createGame(next); gameRef.current = fresh; setGame({ ...fresh });
    setEventLog([`已套用「${presetNames[key]}」Boss 設定，玩家設定保持不變。`]);
  };
  const selectStrategy = (key: StrategyKey) => {
    setStrategyKey(key);
    const fresh = createGame(paramsRef.current); gameRef.current = fresh; setGame({ ...fresh });
    setEventLog([`玩家策略改為「${strategyProfiles[key].name}」。`]);
  };
  const selectSkill = (key: SkillKey) => {
    setSkillKey(key);
    const fresh = createGame(paramsRef.current); gameRef.current = fresh; setGame({ ...fresh });
    setEventLog([`操作水準改為「${skillProfiles[key].name}」。`]);
  };
  const holdControl = (code: string, active: boolean) => { if (active) keysRef.current.add(code); else keysRef.current.delete(code); };

  const projection = useMemo(() => projectWindow(params, strategyKey), [params, strategyKey]);
  const batchSummary = useMemo(() => summarizeBatch(params, strategyKey, skillKey), [params, strategyKey, skillKey]);
  const batchMatrix = useMemo(() => {
    const result = {} as Record<StrategyKey, Record<DifficultyKey, BatchSummary>>;
    (['aggressive', 'balanced', 'conservative'] as StrategyKey[]).forEach((strategy) => {
      result[strategy] = {} as Record<DifficultyKey, BatchSummary>;
      (['teaching', 'standard', 'pressure'] as DifficultyKey[]).forEach((difficulty) => {
        result[strategy][difficulty] = summarizeBatch(withBossPreset(params, difficulty), strategy, skillKey);
      });
    });
    return result;
  }, [params, skillKey]);
  const playerHpRatio = Math.max(0, game.playerHp / params.playerMaxHp * 100);
  const bossHpRatio = Math.max(0, game.bossHp / params.bossMaxHp * 100);
  const phaseProgress = 1 - Math.max(0, game.phaseLeft) / phaseDuration(params, game.phase);
  const averageWindowDamage = game.openings ? game.windowDamage / game.openings : 0;
  const averageWindowHits = game.openings ? game.windowHits / game.openings : 0;
  const windowUtilization = game.openings && projection.hits ? Math.min(150, game.windowHits / (game.openings * projection.hits) * 100) : 0;
  const latest = history[0];
  const comparisonRows = useMemo(() => {
    if (!comparison.A || !comparison.B) return [];
    return [
      ['結果', comparison.A.outcome, comparison.B.outcome],
      ['戰鬥時間', `${comparison.A.elapsed.toFixed(1)}s`, `${comparison.B.elapsed.toFixed(1)}s`],
      ['窗口平均傷害', formatValue(comparison.A.avgWindowDamage), formatValue(comparison.B.avgWindowDamage)],
      ['窗口平均命中', `${comparison.A.avgWindowHits.toFixed(1)} 擊`, `${comparison.B.avgWindowHits.toFixed(1)} 擊`],
      ['窗口利用率', `${comparison.A.windowUtilization.toFixed(0)}%`, `${comparison.B.windowUtilization.toFixed(0)}%`],
      ['貪刀失誤', `${comparison.A.overcommits} 次`, `${comparison.B.overcommits} 次`],
    ];
  }, [comparison]);

  return <main className="lab-shell boss-window-lab"><header className="lab-header"><div className="lab-brand-stack"><a href={sitePath('/')} className="lab-breadcrumb">← 返回模式首頁</a><div className="brand-lockup"><div className="brand-badge">A</div><div><p className="eyebrow">AVIX · GAME BALANCING LAB</p><h1>Boss Rush 數值實驗室</h1></div></div></div><div className="header-tools"><a href={sitePath('/cooking-delivery')} className="mode-jump">Cooking Delivery →</a><div className="mode-switch" aria-label="操作模式"><button className={autoMode ? 'selected' : ''} onClick={() => setAutoMode(true)}>自動示範</button><button className={!autoMode ? 'selected' : ''} onClick={() => setAutoMode(false)}>手動操作</button></div><div className="stage-pill"><span />{strategyProfiles[strategyKey].name} · {skillProfiles[skillKey].name} · {presetNames[presetKey]}</div></div></header>

    <section className="player-profile-panel"><div className="profile-copy"><p className="section-label">PLAYER MODEL</p><h2>玩家策略與操作水準</h2><span>{strategyProfiles[strategyKey].description}；{skillProfiles[skillKey].description}。</span></div><div className="profile-selector"><small>玩家策略</small><div>{(['aggressive', 'balanced', 'conservative'] as StrategyKey[]).map((key) => <button key={key} className={strategyKey === key ? 'selected' : ''} onClick={() => selectStrategy(key)}><b>{strategyProfiles[key].name}</b><span>{key === 'aggressive' ? '高輸出／高風險' : key === 'balanced' ? '安全與效率兼顧' : '低風險／長戰鬥'}</span></button>)}</div></div><div className="profile-selector skill-selector"><small>操作水準</small><div>{(['novice', 'skilled', 'expert'] as SkillKey[]).map((key) => <button key={key} className={skillKey === key ? 'selected' : ''} onClick={() => selectSkill(key)}><b>{skillProfiles[key].name}</b><span>{Math.round(skillProfiles[key].stability * 100)}% 穩定度</span></button>)}</div></div></section>

    <section className="workspace"><div className="arena-panel"><div className="panel-heading"><div><p className="section-label">HIT &amp; RUN COMBAT</p><h2>攻擊窗口測試場</h2></div><p className="keyboard-hint">{autoMode ? '觀察 → 閃避 → 連段 → 撤退' : 'A / D 移動 · SPACE 攻擊 · SHIFT 閃避'}</p></div>
      <div className={`arena window-arena ${game.status} phase-${game.phase} ${game.hurtFlash > 0 ? 'is-hurt' : ''}`}><div className="arena-grid" /><div className="arena-topline"><span>TEST CHAMBER 01</span><span>ATTACK WINDOW MODEL</span></div><div className="status-line"><div className="health-block player-health"><div className="health-copy"><span>PLAYER</span><strong>{formatValue(game.playerHp)} / {formatValue(params.playerMaxHp)}</strong></div><div className="health-track"><i style={{ width: `${playerHpRatio}%` }} /></div></div><div className="timer">{formatTime(game.elapsed)}</div><div className="health-block boss-health"><div className="health-copy"><span>BOSS</span><strong>{formatValue(game.bossHp)} / {formatValue(params.bossMaxHp)}</strong></div><div className="health-track"><i style={{ width: `${bossHpRatio}%` }} /></div></div></div>
        <div className="boss-phase-track">{(['idle', 'windup', 'active', 'recovery'] as BossPhase[]).map((phase) => <div key={phase} className={`${phase} ${game.phase === phase ? 'current' : ''}`}><span>{phaseNames[phase]}</span><i>{game.phase === phase ? `${Math.max(0, game.phaseLeft).toFixed(1)}s` : ''}</i><b>{game.phase === phase && <em style={{ width: `${phaseProgress * 100}%` }} />}</b></div>)}</div>
        <div className="combat-state"><span>{game.phase === 'recovery' ? 'ATTACK WINDOW OPEN' : 'PLAYER ACTION'}</span><strong>{actionNames[game.playerAction]}</strong><small>{game.lastEvent}</small></div>
        <div className={`telegraph ${game.phase === 'windup' || game.phase === 'active' ? 'active' : ''}`} style={{ left: `${Math.max(4, game.playerX - params.bossRange / 2)}%`, width: `${params.bossRange}%`, '--windup': `${game.phase === 'active' ? 100 : phaseProgress * 100}%` } as React.CSSProperties}><span>{game.phase === 'active' ? '攻擊判定' : '危險區域'}</span></div>
        <div className={`fighter player ${game.playerFlash > 0 ? 'is-attacking' : ''} ${game.dodgeLeft > 0 ? 'is-dodging' : ''}`} style={{ left: `${game.playerX}%` }}><div className="fighter-aura" /><span className="fighter-mark">P</span><small>PLAYER</small></div><div className={`attack-beam ${game.playerFlash > 0 ? 'active' : ''}`} style={{ left: `${Math.min(game.playerX, game.bossX)}%`, width: `${Math.abs(game.bossX - game.playerX)}%` }} /><div className={`fighter boss ${game.bossFlash > 0 ? 'is-attacking' : ''} ${game.phase === 'recovery' ? 'is-vulnerable' : ''}`} style={{ left: `${game.bossX}%` }}><div className="fighter-aura" /><span className="fighter-mark">B</span><small>{game.phase === 'recovery' ? 'VULNERABLE' : 'BOSS'}</small></div>
        <div className="combo-status"><span>COMBO</span><div>{Array.from({ length: params.comboHits }, (_, index) => <i key={index} className={index < game.comboStep ? 'active' : ''} />)}</div><strong>{game.comboStep}<small> / {params.comboHits}</small></strong></div>
        {game.status === 'idle' && <div className="arena-message"><span>READY TO TEST</span><strong>等待窗口，打一套，再離開</strong><p>同一套傷害，在不同窗口長度下會產生不同結果</p></div>}{game.status === 'paused' && <div className="arena-message"><span>SIMULATION PAUSED</span><strong>測試已暫停</strong><p>可以調整連段或窗口後繼續觀察</p></div>}{(game.status === 'won' || game.status === 'lost') && <div className={`arena-message result ${game.status}`}><span>{game.status === 'won' ? 'BOSS DEFEATED' : 'PLAYER DOWN'}</span><strong>{game.status === 'won' ? `${game.openings} 次窗口完成擊殺` : `玩家在 ${game.elapsed.toFixed(1)} 秒後倒下`}</strong><p>本輪結果已加入下方測試紀錄</p></div>}
        <div className="arena-legend"><span className={game.dodgeCooldownLeft <= 0 ? 'ready' : ''}>閃避 {game.dodgeCooldownLeft <= 0 ? 'READY' : `${game.dodgeCooldownLeft.toFixed(1)}s`}</span><span>本次窗口 {game.currentWindowHits} 擊／{formatValue(game.currentWindowDamage)} 傷害</span><span>距離 {Math.abs(game.bossX - game.playerX).toFixed(1)}</span></div></div>
      <div className="arena-actions"><button className="primary-action" onClick={toggleRun}><span>{game.status === 'running' ? 'Ⅱ' : '▶'}</span>{game.status === 'running' ? '暫停測試' : game.status === 'paused' ? '繼續測試' : '開始測試'}</button><button className="secondary-action" onClick={() => resetGame()}>↺ 重置</button><div className="speed-control"><span>速度</span>{[.75, 1, 1.5].map((speed) => <button key={speed} className={simSpeed === speed ? 'selected' : ''} onClick={() => setSimSpeed(speed)}>{speed}×</button>)}</div><div className="run-note"><span className={game.status === 'running' ? 'active-dot' : ''} />{game.status === 'running' ? phaseNames[game.phase] : game.status === 'paused' ? '暫停' : '等待測試'}</div></div>
      {!autoMode && <div className="touch-controls" aria-label="遊戲操作"><button onPointerDown={() => holdControl('KeyA', true)} onPointerUp={() => holdControl('KeyA', false)} onPointerLeave={() => holdControl('KeyA', false)}>← 左移</button><button onPointerDown={() => holdControl('KeyD', true)} onPointerUp={() => holdControl('KeyD', false)} onPointerLeave={() => holdControl('KeyD', false)}>右移 →</button><button className="attack" onPointerDown={() => holdControl('Space', true)} onPointerUp={() => holdControl('Space', false)} onPointerLeave={() => holdControl('Space', false)}>連段攻擊</button><button className="dodge" onPointerDown={() => holdControl('ShiftLeft', true)} onPointerUp={() => holdControl('ShiftLeft', false)} onPointerLeave={() => holdControl('ShiftLeft', false)}>閃避</button></div>}
    </div>

      <aside className="control-panel"><div className="panel-heading compact"><div><p className="section-label">PARAMETERS</p><h2>三軸控制台</h2></div><select aria-label="Boss 難度" value={presetKey} onChange={(event) => event.target.value !== 'custom' && applyPreset(event.target.value as DifficultyKey)}><option value="teaching">教學模式</option><option value="standard">標準難度</option><option value="pressure">高壓挑戰</option>{presetKey === 'custom' && <option value="custom">自訂 Boss</option>}</select></div>
        <div className="control-tabs three"><button className={controlTab === 'combo' ? 'active' : ''} onClick={() => setControlTab('combo')}><span className="player-swatch" />連段</button><button className={controlTab === 'action' ? 'active' : ''} onClick={() => setControlTab('action')}><span className="gear-swatch" />操作</button><button className={controlTab === 'boss' ? 'active' : ''} onClick={() => setControlTab('boss')}><span className="boss-swatch" />Boss</button></div>
        <div className="controls-scroll">{controlTab === 'combo' ? <div className="control-group"><RangeControl label="單擊傷害" hint="連段每一擊的基礎傷害" value={params.playerDamage} min={50} max={260} step={5} onChange={(value) => updateParam('playerDamage', value)} /><RangeControl label="目標連段數" hint="完成一套攻擊需要的打擊次數" value={params.comboHits} min={2} max={9} suffix="段" onChange={(value) => updateParam('comboHits', value)} /><RangeControl label="連段內間隔" hint="同一個輸出窗口內每一擊的時間" value={params.comboInterval} min={.15} max={.7} step={.01} suffix="s" decimals={2} onChange={(value) => updateParam('comboInterval', value)} /><RangeControl label="終結傷害倍率" hint="完整連段最後一擊的傷害倍率" value={params.finisherMultiplier} min={1} max={3.2} step={.05} suffix="×" decimals={2} onChange={(value) => updateParam('finisherMultiplier', value)} /><RangeControl label="連段後硬直" hint="完整連段後，再次出手前的等待時間" value={params.comboRecovery} min={.1} max={1.4} step={.05} suffix="s" decimals={2} onChange={(value) => updateParam('comboRecovery', value)} /><div className="formula-note"><span>核心觀察</span><strong>窗口夠長，終結技才打得出來</strong><p>增加段數不一定提高實際傷害；窗口結束前未完成的部分不會產生收益。</p></div></div> : controlTab === 'action' ? <div className="control-group"><RangeControl label="最大生命" hint="決定玩家能承受多少次判斷失誤" value={params.playerMaxHp} min={500} max={2200} step={50} onChange={(value) => updateParam('playerMaxHp', value)} /><RangeControl label="移動速度" hint="影響接近窗口與安全撤退的時間" value={params.playerSpeed} min={12} max={42} onChange={(value) => updateParam('playerSpeed', value)} /><RangeControl label="攻擊距離" hint="距離不足時，連段攻擊會落空" value={params.playerRange} min={7} max={24} onChange={(value) => updateParam('playerRange', value)} /><RangeControl label="閃避無敵" hint="可迴避 Boss 攻擊判定的時間" value={params.dodgeDuration} min={.1} max={.75} step={.01} suffix="s" decimals={2} onChange={(value) => updateParam('dodgeDuration', value)} /><RangeControl label="閃避冷卻" hint="冷卻未完成時無法再次閃避" value={params.dodgeCooldown} min={.5} max={3} step={.05} suffix="s" decimals={2} onChange={(value) => updateParam('dodgeCooldown', value)} /><RangeControl label="反應延遲" hint="自動模式讀到前搖後多久才開始閃避" value={params.reactionDelay} min={.05} max={1.1} step={.01} suffix="s" decimals={2} onChange={(value) => updateParam('reactionDelay', value)} /><RangeControl label="撤退預留" hint="窗口結束前保留多少時間停止攻擊" value={params.retreatBuffer} min={0} max={1.2} step={.05} suffix="s" decimals={2} onChange={(value) => updateParam('retreatBuffer', value)} /><div className="formula-note"><span>反應判定</span><strong>反應延遲 &lt; Boss 前搖</strong><p>若反應時間超過攻擊前搖，自動模式將來不及啟動閃避。</p></div></div> : <div className="control-group"><RangeControl label="最大生命" hint="決定需要利用多少次破綻窗口" value={params.bossMaxHp} min={2000} max={14000} step={250} onChange={(value) => updateParam('bossMaxHp', value)} /><RangeControl label="攻擊傷害" hint="每次判斷失誤造成的生命壓力" value={params.bossDamage} min={50} max={450} step={10} onChange={(value) => updateParam('bossDamage', value)} /><RangeControl label="追蹤等待" hint="兩次攻擊前搖之間的走位階段" value={params.bossIdle} min={.3} max={3.5} step={.05} suffix="s" decimals={2} onChange={(value) => updateParam('bossIdle', value)} /><RangeControl label="攻擊前搖" hint="玩家讀取危險並反應的時間" value={params.bossWindup} min={.2} max={1.8} step={.05} suffix="s" decimals={2} onChange={(value) => updateParam('bossWindup', value)} /><RangeControl label="攻擊持續" hint="Boss 動作播放與危險維持時間" value={params.bossActive} min={.15} max={1.2} step={.05} suffix="s" decimals={2} onChange={(value) => updateParam('bossActive', value)} /><RangeControl label="破綻窗口" hint="Boss 攻擊後可安全輸出的時間" value={params.bossRecovery} min={.5} max={4.5} step={.05} suffix="s" decimals={2} onChange={(value) => updateParam('bossRecovery', value)} /><RangeControl label="移動速度" hint="影響追擊壓力與安全距離" value={params.bossSpeed} min={4} max={24} onChange={(value) => updateParam('bossSpeed', value)} /><RangeControl label="攻擊範圍" hint="紅色危險區域的判定寬度" value={params.bossRange} min={10} max={30} onChange={(value) => updateParam('bossRange', value)} /></div>}</div>
        <div className="estimate-grid"><div><p>{strategyProfiles[strategyKey].name}安全命中</p><strong>{projection.hits}<small>擊</small></strong><span>已套用進場與撤退偏好</span></div><div><p>窗口傷害</p><strong>{formatValue(projection.damage)}</strong><span>預估每次安全輸出</span></div><div><p>機會頻率</p><strong>{projection.opportunityRate.toFixed(1)}<small>/min</small></strong><span>約 {projection.clearWindows} 次窗口擊殺</span></div></div>
      </aside></section>

    <section className="metrics-section"><div className="metrics-heading"><div><p className="section-label">WINDOW METRICS</p><h2>打帶跑體驗讀數</h2></div><p>重點不只是多少 DPS，而是每次抓到機會時能安全做完多少事。</p></div><div className="metrics-grid six"><div className="metric-card primary"><span>窗口平均傷害</span><strong>{formatValue(averageWindowDamage)}</strong><small>目前共 {game.openings} 次窗口</small></div><div className="metric-card"><span>窗口平均命中</span><strong>{averageWindowHits.toFixed(1)}<i>擊</i></strong><small>安全預估 {projection.hits} 擊</small></div><div className="metric-card"><span>窗口利用率</span><strong>{windowUtilization.toFixed(0)}<i>%</i></strong><small>實際命中 ÷ 安全容量</small></div><div className="metric-card"><span>完整連段</span><strong>{game.completedCombos}<i>次</i></strong><small>未完成 {game.interruptedCombos} 次</small></div><div className="metric-card"><span>貪刀失誤</span><strong>{game.overcommits}<i>次</i></strong><small>非窗口攻擊 {game.unsafeHits} 擊</small></div><div className="metric-card warning"><span>成功迴避</span><strong>{game.dodges}<i>次</i></strong><small>總承傷 {formatValue(game.damageTaken)}</small></div></div></section>

    <section className="batch-section"><div className="batch-heading"><div><p className="section-label">20-RUN BATCH TEST</p><h2>玩家模型批次結果</h2></div><p>固定判定序列 · 相同參數可重現 · 目前組合：{strategyProfiles[strategyKey].name}／{skillProfiles[skillKey].name}／{presetNames[presetKey]}</p></div><div className="batch-kpis"><div className="primary"><span>通關率</span><strong>{batchSummary.clearRate.toFixed(0)}<i>%</i></strong></div><div><span>通關時間中位數</span><strong>{batchSummary.medianTime ? batchSummary.medianTime.toFixed(1) : '—'}<i>{batchSummary.medianTime ? 's' : ''}</i></strong></div><div><span>平均剩餘生命</span><strong>{formatValue(batchSummary.averageHp)}</strong></div><div><span>閃避成功率</span><strong>{batchSummary.dodgeRate.toFixed(0)}<i>%</i></strong></div><div><span>貪刀窗口率</span><strong>{batchSummary.overcommitRate.toFixed(1)}<i>%</i></strong></div></div><div className="scenario-matrix"><div className="matrix-corner"><span>操作水準固定</span><strong>{skillProfiles[skillKey].name}</strong></div>{(['teaching', 'standard', 'pressure'] as DifficultyKey[]).map((difficulty) => <div className="matrix-head" key={difficulty}><span>BOSS</span><strong>{presetNames[difficulty]}</strong></div>)}{(['aggressive', 'balanced', 'conservative'] as StrategyKey[]).map((strategy) => <div className="matrix-row" key={strategy}><div className="matrix-label"><span>PLAYER</span><strong>{strategyProfiles[strategy].name}</strong><small>{strategyProfiles[strategy].description}</small></div>{(['teaching', 'standard', 'pressure'] as DifficultyKey[]).map((difficulty) => { const result = batchMatrix[strategy][difficulty]; const selected = strategy === strategyKey && difficulty === presetKey; return <button key={difficulty} className={`${selected ? 'selected' : ''} ${result.clearRate < 50 ? 'danger' : result.clearRate < 90 ? 'warning' : ''}`} onClick={() => { selectStrategy(strategy); applyPreset(difficulty); }}><span>通關率</span><strong>{result.clearRate.toFixed(0)}%</strong><small>{result.medianTime ? `${result.medianTime.toFixed(1)}s` : '無通關'} · HP {formatValue(result.averageHp)}</small><i>閃避 {result.dodgeRate.toFixed(0)}%</i></button>})}</div>)}</div></section>

    <section className="analysis-grid"><div className="history-panel"><div className="analysis-heading"><div><p className="section-label">RUN HISTORY</p><h2>測試紀錄</h2></div><span>保留最近 8 輪</span></div>{history.length === 0 ? <div className="empty-state"><strong>尚無完成紀錄</strong><p>完成第一輪後，窗口效率與貪刀結果會出現在這裡。</p></div> : <div className="history-table"><div className="table-row boss-window-row table-head"><span>輪次</span><span>玩家模型</span><span>結果</span><span>時間</span><span>窗口傷害</span><span>貪刀</span></div>{history.map((run) => <div className="table-row boss-window-row" key={run.id}><span>#{run.id.toString().padStart(2, '0')}</span><span>{run.strategy}／{run.skill}</span><span className={run.outcome === 'WIN' ? 'win' : 'lose'}>{run.outcome}</span><span>{run.elapsed.toFixed(1)}s</span><span>{formatValue(run.avgWindowDamage)}</span><span>{run.overcommits} 次</span></div>)}</div>}</div>
      <div className="compare-panel"><div className="analysis-heading"><div><p className="section-label">A / B COMPARE</p><h2>窗口方案比較</h2></div></div><div className="compare-slots"><button disabled={!latest} className={comparison.A ? 'filled' : ''} onClick={() => latest && setComparison((current) => ({ ...current, A: latest }))}><span>A</span><b>{comparison.A ? `#${comparison.A.id.toString().padStart(2, '0')} ${comparison.A.preset}` : '存入最新結果'}</b></button><div className="versus">VS</div><button disabled={!latest} className={comparison.B ? 'filled' : ''} onClick={() => latest && setComparison((current) => ({ ...current, B: latest }))}><span>B</span><b>{comparison.B ? `#${comparison.B.id.toString().padStart(2, '0')} ${comparison.B.preset}` : '存入最新結果'}</b></button></div>{comparisonRows.length === 0 ? <div className="compare-hint">先測試標準模式，再增加連段數或縮短破綻窗口，觀察傷害與貪刀風險的變化。</div> : <div className="compare-table">{comparisonRows.map(([label, a, b]) => <div key={label}><span>{label}</span><b>{a}</b><b>{b}</b></div>)}</div>}</div>
    </section>
    <section className="event-panel"><div><p className="section-label">COMBAT LOG</p><h2>窗口紀錄</h2></div><div className="event-list">{eventLog.map((item, index) => <p key={`${item}-${index}`}><span>{index === 0 ? 'NOW' : `-${index}`}</span>{item}</p>)}</div></section>
    <footer><span>AVIX GAME DESIGN ACADEMY</span><p>策略決定風險偏好，能力決定執行結果。</p><span>MICROGAME TOOL · V0.6</span></footer>
  </main>;
}
