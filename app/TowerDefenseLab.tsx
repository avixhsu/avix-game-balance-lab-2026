'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { sitePath } from './sitePath';

type Status = 'building' | 'running' | 'paused' | 'complete' | 'defeated';
type TowerKind = 'rapid' | 'cannon' | 'frost';
type EnemyKind = 'normal' | 'fast' | 'heavy' | 'swarm';
type StrategyKey = 'expand' | 'upgrade' | 'control';
type StrategyState = StrategyKey | 'manual';
type WaveProfile = 'mixed' | 'fast' | 'swarm' | 'heavy';
type ControlTab = 'tower' | 'enemy' | 'economy';
type RouteKey = 'straight' | 'corner' | 'hairpin' | 'split' | 'merge';
type Point = { x: number; y: number };
type RouteTemplate = {
  name: string;
  shortName: string;
  topology: string;
  principle: string;
  note: string;
  routes: Point[][];
  slots: Point[];
  turns: number;
  splitCount: number;
  mergeCount: number;
};

type Params = {
  rapidCost: number;
  rapidDamage: number;
  rapidInterval: number;
  rapidRange: number;
  cannonCost: number;
  cannonDamage: number;
  cannonInterval: number;
  cannonRange: number;
  blastRadius: number;
  frostCost: number;
  frostDamage: number;
  frostInterval: number;
  frostRange: number;
  frostSlow: number;
  frostDuration: number;
  upgradeCost: number;
  upgradePower: number;
  enemyBaseHp: number;
  enemyHpGrowth: number;
  enemyBaseSpeed: number;
  heavyArmor: number;
  spawnInterval: number;
  pressureMultiplier: number;
  startingGold: number;
  killReward: number;
  waveReward: number;
  baseHp: number;
};

type Tower = {
  slot: number;
  kind: TowerKind;
  level: number;
  cooldown: number;
  damage: number;
  overkill: number;
  kills: number;
  activeTime: number;
  support: number;
  flash: number;
  spent: number;
};

type Enemy = {
  id: number;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  progress: number;
  speed: number;
  armor: number;
  reward: number;
  baseDamage: number;
  slowLeft: number;
  slowStrength: number;
  route: number;
};

type WaveResult = {
  wave: number;
  killed: number;
  leaked: number;
  damage: number;
  pressure: number;
  earned: number;
  spent: number;
  baseHp: number;
};

type GameState = {
  status: Status;
  wave: number;
  baseHp: number;
  gold: number;
  elapsed: number;
  waveTime: number;
  spawnTimer: number;
  nextEnemyId: number;
  spawnQueue: EnemyKind[];
  enemies: Enemy[];
  towers: Tower[];
  totalKills: number;
  totalLeaks: number;
  totalDamage: number;
  totalOverkill: number;
  totalEarned: number;
  totalSpent: number;
  waveKills: number;
  waveLeaks: number;
  waveDamage: number;
  waveEarned: number;
  wavePressure: number;
  waveResults: WaveResult[];
  lastEvent: string;
};

type AutoResult = {
  cleared: number;
  baseHp: number;
  leaks: number;
  spent: number;
  damage: number;
  utilization: number;
  status: 'CLEAR' | 'BREAK';
};

const defaultParams: Params = {
  rapidCost: 110,
  rapidDamage: 26,
  rapidInterval: .4,
  rapidRange: 24,
  cannonCost: 175,
  cannonDamage: 105,
  cannonInterval: 1.55,
  cannonRange: 22,
  blastRadius: 6.5,
  frostCost: 145,
  frostDamage: 17,
  frostInterval: .78,
  frostRange: 23,
  frostSlow: 32,
  frostDuration: 1.6,
  upgradeCost: 75,
  upgradePower: 48,
  enemyBaseHp: 145,
  enemyHpGrowth: 18,
  enemyBaseSpeed: 4.3,
  heavyArmor: 32,
  spawnInterval: .72,
  pressureMultiplier: 1.35,
  startingGold: 520,
  killReward: 22,
  waveReward: 70,
  baseHp: 20,
};

const strategyNames: Record<StrategyState, string> = {
  expand: '擴張優先',
  upgrade: '升級優先',
  control: '混合控制',
  manual: '手動配置',
};

const profileNames: Record<WaveProfile, string> = {
  mixed: '混合波次',
  fast: '高速突擊',
  swarm: '群體壓力',
  heavy: '重裝推進',
};

const towerNames: Record<TowerKind, string> = { rapid: '速射塔', cannon: '砲塔', frost: '緩速塔' };
const towerMarks: Record<TowerKind, string> = { rapid: 'R', cannon: 'C', frost: 'F' };
const enemyMarks: Record<EnemyKind, string> = { normal: 'N', fast: 'F', heavy: 'H', swarm: 'S' };

const routeTemplates: Record<RouteKey, RouteTemplate> = {
  straight: {
    name: '直線基準', shortName: '直線', topology: '單一路線', principle: '基準組',
    note: '幾何沒有額外優勢，適合測量速度、射程與 DPS 的基本關係。',
    routes: [[{ x: 4, y: 52 }, { x: 96, y: 52 }]],
    slots: [{ x: 12, y: 28 }, { x: 24, y: 76 }, { x: 37, y: 27 }, { x: 49, y: 76 }, { x: 62, y: 27 }, { x: 74, y: 76 }, { x: 87, y: 27 }, { x: 92, y: 76 }],
    turns: 0, splitCount: 0, mergeCount: 0,
  },
  corner: {
    name: 'L 型轉角', shortName: 'L 型', topology: '單一路線', principle: '轉角覆蓋',
    note: '內側點位可同時覆蓋轉彎前後兩段，用來觀察射程的空間價值。',
    routes: [[{ x: 4, y: 78 }, { x: 53, y: 78 }, { x: 53, y: 28 }, { x: 96, y: 28 }]],
    slots: [{ x: 14, y: 57 }, { x: 31, y: 58 }, { x: 43, y: 58 }, { x: 67, y: 48 }, { x: 74, y: 12 }, { x: 89, y: 50 }, { x: 38, y: 91 }, { x: 61, y: 90 }],
    turns: 2, splitCount: 0, mergeCount: 0,
  },
  hairpin: {
    name: 'U 型折返', shortName: 'U 型', topology: '單一路線', principle: '重複覆蓋',
    note: '平行路段靠近，同一座塔可能兩次覆蓋敵人，凸顯射程與點位效率。',
    routes: [[{ x: 4, y: 77 }, { x: 88, y: 77 }, { x: 88, y: 27 }, { x: 15, y: 27 }]],
    slots: [{ x: 14, y: 55 }, { x: 28, y: 54 }, { x: 43, y: 54 }, { x: 58, y: 54 }, { x: 73, y: 54 }, { x: 78, y: 12 }, { x: 48, y: 12 }, { x: 22, y: 91 }],
    turns: 2, splitCount: 0, mergeCount: 0,
  },
  split: {
    name: '一分為二', shortName: '分岔', topology: '單入口／雙出口', principle: '火力分散',
    note: '敵人以 50／50 交替分流，測試相同預算如何被迫分散到兩條防線。',
    routes: [[{ x: 4, y: 52 }, { x: 41, y: 52 }, { x: 63, y: 24 }, { x: 96, y: 24 }], [{ x: 4, y: 52 }, { x: 41, y: 52 }, { x: 63, y: 80 }, { x: 96, y: 80 }]],
    slots: [{ x: 16, y: 29 }, { x: 17, y: 75 }, { x: 38, y: 31 }, { x: 38, y: 75 }, { x: 55, y: 52 }, { x: 72, y: 47 }, { x: 82, y: 8 }, { x: 83, y: 94 }],
    turns: 4, splitCount: 1, mergeCount: 0,
  },
  merge: {
    name: '二合為一', shortName: '合流', topology: '雙入口／單出口', principle: '壓力集中',
    note: '兩個入口同步出怪，合流後密度提高，用來觀察範圍與控制塔的收益。',
    routes: [[{ x: 4, y: 24 }, { x: 35, y: 24 }, { x: 54, y: 52 }, { x: 96, y: 52 }], [{ x: 4, y: 80 }, { x: 35, y: 80 }, { x: 54, y: 52 }, { x: 96, y: 52 }]],
    slots: [{ x: 15, y: 47 }, { x: 15, y: 58 }, { x: 36, y: 8 }, { x: 36, y: 94 }, { x: 49, y: 35 }, { x: 49, y: 70 }, { x: 70, y: 29 }, { x: 82, y: 75 }],
    turns: 4, splitCount: 0, mergeCount: 1,
  },
};

const routeKeys: RouteKey[] = ['straight', 'corner', 'hairpin', 'split', 'merge'];

function segmentsFor(template: RouteTemplate, aspect = 1.65) {
  const unique = new Map<string, { x: number; y: number; length: number; angle: number }>();
  template.routes.forEach((route) => route.slice(0, -1).forEach((point, index) => {
    const next = route[index + 1];
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    const screenDy = dy / aspect;
    const key = `${point.x},${point.y},${next.x},${next.y}`;
    unique.set(key, { x: point.x, y: point.y, length: Math.sqrt(dx * dx + screenDy * screenDy), angle: Math.atan2(screenDy, dx) * 180 / Math.PI });
  }));
  return [...unique.values()];
}

function uniqueEndpoints(template: RouteTemplate, atEnd: boolean) {
  const unique = new Map<string, Point>();
  template.routes.forEach((route) => {
    const point = atEnd ? route[route.length - 1] : route[0];
    unique.set(`${point.x},${point.y}`, point);
  });
  return [...unique.values()];
}

function pointAt(template: RouteTemplate, routeIndex: number, progress: number) {
  const route = template.routes[routeIndex] ?? template.routes[0];
  const segments = route.slice(0, -1).map((point, index) => distance(point, route[index + 1]));
  const total = segments.reduce((sum, value) => sum + value, 0);
  let distanceLeft = Math.max(0, Math.min(1, progress)) * total;
  for (let index = 0; index < segments.length; index += 1) {
    const length = segments[index];
    if (distanceLeft <= length || index === segments.length - 1) {
      const ratio = length > 0 ? distanceLeft / length : 0;
      const start = route[index];
      const end = route[index + 1];
      return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
    }
    distanceLeft -= length;
  }
  return route[route.length - 1];
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function fmt(value: number, decimals = 0) {
  return value.toLocaleString('zh-TW', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function towerBaseCost(kind: TowerKind, params: Params) {
  return kind === 'rapid' ? params.rapidCost : kind === 'cannon' ? params.cannonCost : params.frostCost;
}

function upgradePrice(tower: Tower, params: Params) {
  const stepFactor = tower.level === 1 ? 1 : 1.4;
  return Math.round(towerBaseCost(tower.kind, params) * params.upgradeCost / 100 * stepFactor);
}

function towerStats(tower: Tower, params: Params) {
  const power = 1 + (tower.level - 1) * params.upgradePower / 100;
  const speedFactor = Math.pow(.93, tower.level - 1);
  if (tower.kind === 'rapid') return { damage: params.rapidDamage * power, interval: params.rapidInterval * speedFactor, range: params.rapidRange + (tower.level - 1) * 1.5, blast: 0, slow: 0, duration: 0, penetration: .05 };
  if (tower.kind === 'cannon') return { damage: params.cannonDamage * power, interval: params.cannonInterval * speedFactor, range: params.cannonRange + (tower.level - 1) * 1.5, blast: params.blastRadius, slow: 0, duration: 0, penetration: .5 };
  return { damage: params.frostDamage * power, interval: params.frostInterval * speedFactor, range: params.frostRange + (tower.level - 1) * 1.5, blast: 0, slow: params.frostSlow / 100, duration: params.frostDuration, penetration: 0 };
}

function towerDps(tower: Tower, params: Params) {
  const stats = towerStats(tower, params);
  return stats.damage / stats.interval;
}

function makeBlankGame(params: Params): GameState {
  return {
    status: 'building', wave: 1, baseHp: params.baseHp, gold: params.startingGold,
    elapsed: 0, waveTime: 0, spawnTimer: 0, nextEnemyId: 1, spawnQueue: [], enemies: [], towers: [],
    totalKills: 0, totalLeaks: 0, totalDamage: 0, totalOverkill: 0, totalEarned: 0, totalSpent: 0,
    waveKills: 0, waveLeaks: 0, waveDamage: 0, waveEarned: 0, wavePressure: 0,
    waveResults: [], lastEvent: '配置防禦塔後開始第一波',
  };
}

type BuildAction = { type: 'build'; slot: number; tower: TowerKind } | { type: 'upgrade'; slot: number; level: 2 | 3 };

const strategyActions: Record<StrategyKey, BuildAction[]> = {
  expand: [
    { type: 'build', slot: 0, tower: 'rapid' }, { type: 'build', slot: 1, tower: 'rapid' },
    { type: 'build', slot: 3, tower: 'cannon' }, { type: 'build', slot: 4, tower: 'rapid' },
    { type: 'build', slot: 5, tower: 'frost' }, { type: 'build', slot: 2, tower: 'rapid' },
    { type: 'build', slot: 6, tower: 'cannon' }, { type: 'build', slot: 7, tower: 'frost' },
    { type: 'upgrade', slot: 3, level: 2 }, { type: 'upgrade', slot: 6, level: 2 },
    { type: 'upgrade', slot: 0, level: 2 }, { type: 'upgrade', slot: 1, level: 2 },
    { type: 'upgrade', slot: 4, level: 2 }, { type: 'upgrade', slot: 5, level: 2 },
    { type: 'upgrade', slot: 3, level: 3 }, { type: 'upgrade', slot: 6, level: 3 },
    { type: 'upgrade', slot: 0, level: 3 }, { type: 'upgrade', slot: 1, level: 3 },
    { type: 'upgrade', slot: 4, level: 3 }, { type: 'upgrade', slot: 5, level: 3 },
  ],
  upgrade: [
    { type: 'build', slot: 3, tower: 'cannon' }, { type: 'upgrade', slot: 3, level: 2 },
    { type: 'build', slot: 0, tower: 'rapid' }, { type: 'upgrade', slot: 0, level: 2 },
    { type: 'upgrade', slot: 3, level: 3 }, { type: 'upgrade', slot: 0, level: 3 },
    { type: 'build', slot: 5, tower: 'frost' }, { type: 'upgrade', slot: 5, level: 2 },
    { type: 'build', slot: 6, tower: 'cannon' }, { type: 'upgrade', slot: 6, level: 2 },
    { type: 'build', slot: 1, tower: 'rapid' }, { type: 'upgrade', slot: 5, level: 3 },
    { type: 'upgrade', slot: 6, level: 3 }, { type: 'upgrade', slot: 1, level: 2 },
    { type: 'build', slot: 4, tower: 'rapid' }, { type: 'upgrade', slot: 1, level: 3 },
    { type: 'upgrade', slot: 4, level: 2 }, { type: 'upgrade', slot: 4, level: 3 },
  ],
  control: [
    { type: 'build', slot: 1, tower: 'frost' }, { type: 'build', slot: 3, tower: 'cannon' },
    { type: 'build', slot: 5, tower: 'frost' }, { type: 'build', slot: 0, tower: 'rapid' },
    { type: 'upgrade', slot: 1, level: 2 }, { type: 'upgrade', slot: 3, level: 2 },
    { type: 'build', slot: 6, tower: 'cannon' }, { type: 'build', slot: 4, tower: 'rapid' },
    { type: 'upgrade', slot: 5, level: 2 }, { type: 'upgrade', slot: 0, level: 2 },
    { type: 'build', slot: 2, tower: 'rapid' }, { type: 'build', slot: 7, tower: 'frost' },
    { type: 'upgrade', slot: 3, level: 3 }, { type: 'upgrade', slot: 6, level: 2 },
    { type: 'upgrade', slot: 1, level: 3 }, { type: 'upgrade', slot: 5, level: 3 },
    { type: 'upgrade', slot: 0, level: 3 }, { type: 'upgrade', slot: 4, level: 2 },
    { type: 'upgrade', slot: 6, level: 3 }, { type: 'upgrade', slot: 7, level: 2 },
  ],
};

function buildTower(state: GameState, slot: number, kind: TowerKind, params: Params) {
  if (state.towers.some((tower) => tower.slot === slot)) return false;
  const cost = towerBaseCost(kind, params);
  if (state.gold < cost) return false;
  state.gold -= cost;
  state.totalSpent += cost;
  state.towers.push({ slot, kind, level: 1, cooldown: .2, damage: 0, overkill: 0, kills: 0, activeTime: 0, support: 0, flash: 0, spent: cost });
  state.lastEvent = `${towerNames[kind]}完成建造`;
  return true;
}

function upgradeTower(state: GameState, slot: number, params: Params) {
  const tower = state.towers.find((item) => item.slot === slot);
  if (!tower || tower.level >= 3) return false;
  const cost = upgradePrice(tower, params);
  if (state.gold < cost) return false;
  state.gold -= cost;
  state.totalSpent += cost;
  tower.spent += cost;
  tower.level += 1;
  state.lastEvent = `${towerNames[tower.kind]}升至 Lv.${tower.level}`;
  return true;
}

function autoSpend(state: GameState, strategy: StrategyKey, params: Params) {
  for (const action of strategyActions[strategy]) {
    const tower = state.towers.find((item) => item.slot === action.slot);
    if (action.type === 'build') {
      if (tower) continue;
      if (!buildTower(state, action.slot, action.tower, params)) break;
    } else {
      if (!tower || tower.level >= action.level) continue;
      if (!upgradeTower(state, action.slot, params)) break;
    }
  }
}

function makeGame(params: Params, strategy: StrategyKey = 'control') {
  const state = makeBlankGame(params);
  autoSpend(state, strategy, params);
  state.lastEvent = `已套用「${strategyNames[strategy]}」初始配置`;
  return state;
}

function distributeKinds(count: number, weights: Partial<Record<EnemyKind, number>>, offset: number) {
  const kinds = (Object.keys(weights) as EnemyKind[]).filter((kind) => (weights[kind] ?? 0) > 0);
  const quotas = kinds.map((kind) => ({ kind, remaining: Math.max(1, Math.round(count * (weights[kind] ?? 0))) }));
  const result: EnemyKind[] = [];
  let cursor = offset % Math.max(1, kinds.length);
  while (result.length < count && quotas.some((item) => item.remaining > 0)) {
    const item = quotas[cursor % quotas.length];
    if (item.remaining > 0) { result.push(item.kind); item.remaining -= 1; }
    cursor += 1;
  }
  while (result.length < count) result.push(kinds[result.length % kinds.length] ?? 'normal');
  return result;
}

function waveKinds(wave: number, profile: WaveProfile) {
  let count = Math.round(5 + wave * 1.25);
  let weights: Partial<Record<EnemyKind, number>>;
  if (profile === 'fast') weights = { fast: .68, normal: .22, heavy: .1 };
  else if (profile === 'swarm') { count = Math.round(count * 1.35); weights = { swarm: .72, normal: .18, fast: .1 }; }
  else if (profile === 'heavy') { count = Math.max(5, Math.round(count * .76)); weights = { heavy: .68, normal: .22, fast: .1 }; }
  else {
    const patterns: Partial<Record<EnemyKind, number>>[] = [
      { normal: 1 }, { normal: .42, swarm: .58 }, { normal: .42, fast: .58 },
      { normal: .5, heavy: .5 }, { fast: .35, swarm: .65 }, { normal: .35, heavy: .65 },
      { normal: .25, fast: .25, heavy: .25, swarm: .25 }, { fast: .5, swarm: .5 },
      { heavy: .45, fast: .3, normal: .25 }, { heavy: .4, fast: .2, swarm: .4 },
    ];
    weights = patterns[wave - 1];
  }
  return distributeKinds(count, weights, wave);
}

function enemyFor(kind: EnemyKind, wave: number, id: number, route: number, params: Params): Enemy {
  const growth = Math.pow(1 + params.enemyHpGrowth / 100, wave - 1);
  const pressure = wave === 5 ? 1 + (params.pressureMultiplier - 1) * .55 : wave === 10 ? params.pressureMultiplier : 1;
  const hpFactor = kind === 'fast' ? .66 : kind === 'heavy' ? 2.35 : kind === 'swarm' ? .38 : 1;
  const speedFactor = kind === 'fast' ? 1.62 : kind === 'heavy' ? .69 : kind === 'swarm' ? 1.08 : 1;
  const rewardFactor = kind === 'fast' ? .8 : kind === 'heavy' ? 1.75 : kind === 'swarm' ? .52 : 1;
  const hp = params.enemyBaseHp * growth * pressure * hpFactor;
  return {
    id, kind, hp, maxHp: hp, progress: 0, speed: params.enemyBaseSpeed / 100 * speedFactor,
    armor: kind === 'heavy' ? params.heavyArmor / 100 : 0,
    reward: Math.max(1, Math.round(params.killReward * rewardFactor)), baseDamage: kind === 'heavy' ? 2 : 1,
    slowLeft: 0, slowStrength: 0, route,
  };
}

function wavePressure(wave: number, profile: WaveProfile, params: Params) {
  return waveKinds(wave, profile).reduce((sum, kind, index) => {
    const enemy = enemyFor(kind, wave, index, 0, params);
    return sum + enemy.maxHp / Math.max(.2, 1 - enemy.armor);
  }, 0);
}

function startWaveMutable(state: GameState, params: Params, profile: WaveProfile, template: RouteTemplate) {
  if (state.status !== 'building') return;
  state.spawnQueue = waveKinds(state.wave, profile);
  state.wavePressure = state.spawnQueue.reduce((sum, kind, index) => {
    const enemy = enemyFor(kind, state.wave, index, index % template.routes.length, params);
    return sum + enemy.maxHp / Math.max(.2, 1 - enemy.armor);
  }, 0);
  state.status = 'running';
  state.waveTime = 0;
  state.spawnTimer = 0;
  state.waveKills = 0;
  state.waveLeaks = 0;
  state.waveDamage = 0;
  state.waveEarned = 0;
  state.towers.forEach((tower) => { tower.cooldown = .15; tower.flash = 0; });
  state.lastEvent = `第 ${state.wave} 波開始，${state.spawnQueue.length} 名敵人進場`;
}

function dealDamage(state: GameState, tower: Tower, enemy: Enemy, rawDamage: number, penetration: number) {
  const effective = rawDamage * (1 - enemy.armor * (1 - penetration));
  const actual = Math.min(enemy.hp, effective);
  const overkill = Math.max(0, effective - enemy.hp);
  enemy.hp = Math.max(0, enemy.hp - effective);
  tower.damage += actual;
  tower.overkill += overkill;
  state.totalDamage += actual;
  state.totalOverkill += overkill;
  state.waveDamage += actual;
}

type StepOutcome = { type: 'wave' | 'complete' | 'defeated'; message: string } | null;

function stepWave(state: GameState, params: Params, template: RouteTemplate, dt: number): StepOutcome {
  if (state.status !== 'running') return null;
  state.elapsed += dt;
  state.waveTime += dt;
  state.spawnTimer -= dt;

  while (state.spawnQueue.length > 0 && state.spawnTimer <= 0) {
    const batchSize = template.mergeCount > 0 ? Math.min(2, state.spawnQueue.length) : 1;
    for (let batchIndex = 0; batchIndex < batchSize; batchIndex += 1) {
      const kind = state.spawnQueue.shift()!;
      const id = state.nextEnemyId++;
      const routeIndex = template.mergeCount > 0 ? batchIndex % template.routes.length : (id - 1) % template.routes.length;
      state.enemies.push(enemyFor(kind, state.wave, id, routeIndex, params));
    }
    state.spawnTimer += params.spawnInterval * batchSize;
  }

  const survivors: Enemy[] = [];
  state.enemies.forEach((enemy) => {
    enemy.slowLeft = Math.max(0, enemy.slowLeft - dt);
    if (enemy.slowLeft <= 0) enemy.slowStrength = 0;
    const slowFactor = 1 - enemy.slowStrength;
    enemy.progress += enemy.speed * slowFactor * dt;
    if (enemy.progress >= 1) {
      state.baseHp = Math.max(0, state.baseHp - enemy.baseDamage);
      state.totalLeaks += 1;
      state.waveLeaks += 1;
      state.lastEvent = `${enemyMarks[enemy.kind]} 型敵人突破防線`;
    } else survivors.push(enemy);
  });
  state.enemies = survivors;

  if (state.baseHp <= 0) {
    state.status = 'defeated';
    return { type: 'defeated', message: `基地在第 ${state.wave} 波失守。` };
  }

  state.towers.forEach((tower) => {
    const stats = towerStats(tower, params);
    tower.cooldown -= dt;
    tower.flash = Math.max(0, tower.flash - dt);
    const origin = template.slots[tower.slot];
    const targets = state.enemies
      .filter((enemy) => enemy.hp > 0 && distance(origin, pointAt(template, enemy.route, enemy.progress)) <= stats.range)
      .sort((a, b) => b.progress - a.progress);
    if (targets.length > 0) tower.activeTime += dt;
    if (targets.length === 0 || tower.cooldown > 0) return;
    tower.cooldown += stats.interval;
    tower.flash = .15;
    const target = targets[0];
    if (tower.kind === 'cannon') {
      const hitPoint = pointAt(template, target.route, target.progress);
      targets.filter((enemy) => distance(hitPoint, pointAt(template, enemy.route, enemy.progress)) <= stats.blast).slice(0, 7).forEach((enemy) => dealDamage(state, tower, enemy, stats.damage, stats.penetration));
    } else {
      dealDamage(state, tower, target, stats.damage, stats.penetration);
      if (tower.kind === 'frost') {
        const previous = target.slowLeft;
        target.slowLeft = Math.max(target.slowLeft, stats.duration);
        target.slowStrength = Math.max(target.slowStrength, stats.slow);
        tower.support += Math.max(0, target.slowLeft - previous) * stats.slow;
      }
    }
  });

  const alive: Enemy[] = [];
  state.enemies.forEach((enemy) => {
    if (enemy.hp > 0) { alive.push(enemy); return; }
    state.totalKills += 1;
    state.waveKills += 1;
    state.gold += enemy.reward;
    state.totalEarned += enemy.reward;
    state.waveEarned += enemy.reward;
    const killer = state.towers.filter((tower) => tower.flash > 0).sort((a, b) => b.damage - a.damage)[0];
    if (killer) killer.kills += 1;
  });
  state.enemies = alive;

  if (state.spawnQueue.length === 0 && state.enemies.length === 0) {
    const clearedWave = state.wave;
    state.gold += params.waveReward;
    state.totalEarned += params.waveReward;
    state.waveEarned += params.waveReward;
    state.waveResults.push({
      wave: clearedWave, killed: state.waveKills, leaked: state.waveLeaks, damage: state.waveDamage,
      pressure: state.wavePressure, earned: state.waveEarned, spent: state.totalSpent, baseHp: state.baseHp,
    });
    if (clearedWave >= 10) {
      state.status = 'complete';
      state.lastEvent = `十波防守完成，基地剩餘 ${state.baseHp} HP`;
      return { type: 'complete', message: `完成十波防守，基地剩餘 ${state.baseHp} HP。` };
    }
    state.wave += 1;
    state.status = 'building';
    state.lastEvent = `第 ${clearedWave} 波完成，獲得波次獎勵 ${params.waveReward}`;
    return { type: 'wave', message: `第 ${clearedWave} 波完成，可重新配置資源。` };
  }
  return null;
}

function runAutoStrategy(strategy: StrategyKey, profile: WaveProfile, params: Params, template: RouteTemplate): AutoResult {
  const state = makeBlankGame(params);
  let guard = 0;
  while (state.status !== 'complete' && state.status !== 'defeated' && guard < 250000) {
    if (state.status === 'building') {
      autoSpend(state, strategy, params);
      startWaveMutable(state, params, profile, template);
    }
    stepWave(state, params, template, .08);
    guard += 1;
  }
  return {
    cleared: state.waveResults.length, baseHp: state.baseHp, leaks: state.totalLeaks,
    spent: state.totalSpent, damage: state.totalDamage,
    utilization: state.towers.length ? state.towers.reduce((sum, tower) => sum + tower.activeTime, 0) / state.towers.length / Math.max(1, state.elapsed) * 100 : 0,
    status: state.status === 'complete' ? 'CLEAR' : 'BREAK',
  };
}

function coverageRatio(slot: number, range: number, template: RouteTemplate) {
  const origin = template.slots[slot];
  let covered = 0;
  const samples = 120;
  template.routes.forEach((_, routeIndex) => {
    for (let index = 0; index < samples; index += 1) {
      if (distance(origin, pointAt(template, routeIndex, index / (samples - 1))) <= range) covered += 1;
    }
  });
  return covered / (samples * template.routes.length);
}

function defenseCapacity(towers: Tower[], wave: number, profile: WaveProfile, params: Params, template: RouteTemplate) {
  const baseTravel = 1 / Math.max(.005, params.enemyBaseSpeed / 100);
  const crowdFactor = profile === 'swarm' ? 2.8 : profile === 'mixed' ? 1.75 : profile === 'fast' ? 1.25 : 1.08;
  const speedFactor = profile === 'fast' ? 1.45 : profile === 'heavy' ? .78 : 1;
  const pressureAdjustment = wave === 5 ? 1.04 : wave === 10 ? 1.08 : 1;
  const direct = towers.reduce((sum, tower) => {
    const stats = towerStats(tower, params);
    const area = tower.kind === 'cannon' ? crowdFactor : 1;
    return sum + stats.damage / stats.interval * coverageRatio(tower.slot, stats.range, template) * baseTravel / speedFactor * area;
  }, 0);
  const frostCount = towers.filter((tower) => tower.kind === 'frost').length;
  return direct * (1 + frostCount * params.frostSlow / 100 * .16) * pressureAdjustment;
}

type RangeProps = { label: string; hint: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void };

function RangeControl({ label, hint, value, min, max, step = 1, suffix = '', onChange }: RangeProps) {
  const fill = (value - min) / (max - min) * 100;
  const decimals = step < 1 ? (step < .1 ? 2 : 1) : 0;
  return <label className="range-control"><span className="range-heading"><b>{label}</b><output>{fmt(value, decimals)}{suffix}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} style={{ '--range-fill': `${fill}%` } as React.CSSProperties} onChange={(event) => onChange(Number(event.target.value))} /><small>{hint}</small></label>;
}

function RoutePreview({ template }: { template: RouteTemplate }) {
  const segments = segmentsFor(template, 2.1);
  const starts = uniqueEndpoints(template, false);
  const goals = uniqueEndpoints(template, true);
  return <div className="route-mini" aria-hidden="true"><div>{segments.map((segment, index) => <i key={index} style={{ left: `${segment.x}%`, top: `${segment.y}%`, width: `${segment.length}%`, transform: `rotate(${segment.angle}deg)` }} />)}</div>{starts.map((point, index) => <span className="mini-entry" key={`s-${index}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} />)}{goals.map((point, index) => <span className="mini-goal" key={`g-${index}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} />)}</div>;
}

export default function TowerDefenseLab() {
  const [params, setParams] = useState<Params>(defaultParams);
  const [strategy, setStrategy] = useState<StrategyState>('control');
  const [profile, setProfile] = useState<WaveProfile>('mixed');
  const [routeKey, setRouteKey] = useState<RouteKey>('straight');
  const [selectedTower, setSelectedTower] = useState<TowerKind>('rapid');
  const [selectedSlot, setSelectedSlot] = useState<number | null>(1);
  const [controlTab, setControlTab] = useState<ControlTab>('tower');
  const [simSpeed, setSimSpeed] = useState(4);
  const [game, setGame] = useState<GameState>(() => makeGame(defaultParams, 'control'));
  const [eventLog, setEventLog] = useState<string[]>(['已套用混合控制配置，可直接開始第一波。']);

  const paramsRef = useRef(params);
  const profileRef = useRef(profile);
  const routeRef = useRef(routeKey);
  const gameRef = useRef(game);
  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { routeRef.current = routeKey; }, [routeKey]);

  const template = routeTemplates[routeKey];
  const renderedSegments = useMemo(() => segmentsFor(template), [template]);
  const entries = useMemo(() => uniqueEndpoints(template, false), [template]);
  const bases = useMemo(() => uniqueEndpoints(template, true), [template]);

  const addLog = (message: string) => setEventLog((current) => [message, ...current].slice(0, 5));

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let lastPaint = 0;
    const loop = (now: number) => {
      const state = gameRef.current;
      const dt = Math.min((now - last) / 1000, .05) * simSpeed;
      last = now;
      if (state.status === 'running') {
        const outcome = stepWave(state, paramsRef.current, routeTemplates[routeRef.current], dt);
        if (outcome) addLog(outcome.message);
      }
      if (now - lastPaint > 50) {
        setGame({ ...state, enemies: [...state.enemies], towers: [...state.towers], waveResults: [...state.waveResults] });
        lastPaint = now;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [simSpeed]);

  const resetWith = (nextStrategy: StrategyState = strategy, nextProfile: WaveProfile = profile, nextParams: Params = paramsRef.current, nextRoute: RouteKey = routeKey) => {
    const fallback: StrategyKey = nextStrategy === 'manual' ? 'control' : nextStrategy;
    const next = nextStrategy === 'manual' ? makeBlankGame(nextParams) : makeGame(nextParams, fallback);
    gameRef.current = next;
    setGame({ ...next, towers: [...next.towers] });
    setStrategy(nextStrategy);
    setProfile(nextProfile);
    setRouteKey(nextRoute);
    profileRef.current = nextProfile;
    routeRef.current = nextRoute;
    setEventLog([nextStrategy === 'manual' ? '已清空配置，請選擇塔種並點擊建造位置。' : `已載入「${routeTemplates[nextRoute].name} × ${strategyNames[nextStrategy]}」。`]);
  };

  const applyStrategy = (key: StrategyKey) => resetWith(key, profile);
  const applyProfile = (key: WaveProfile) => resetWith(strategy === 'manual' ? 'control' : strategy, key);
  const applyRoute = (key: RouteKey) => resetWith(strategy === 'manual' ? 'control' : strategy, profile, paramsRef.current, key);

  const toggle = () => {
    const state = gameRef.current;
    if (state.status === 'building') {
      if (state.towers.length === 0) { addLog('至少需要建造一座防禦塔。'); return; }
      startWaveMutable(state, paramsRef.current, profileRef.current, routeTemplates[routeRef.current]);
      addLog(state.lastEvent);
    } else if (state.status === 'running') {
      state.status = 'paused'; addLog('戰鬥模擬暫停。');
    } else if (state.status === 'paused') {
      state.status = 'running'; addLog('戰鬥模擬繼續。');
    } else {
      resetWith(strategy === 'manual' ? 'control' : strategy, profile, paramsRef.current, routeKey);
      return;
    }
    setGame({ ...state });
  };

  const handleSlot = (slot: number) => {
    const state = gameRef.current;
    setSelectedSlot(slot);
    if (state.status !== 'building') return;
    const tower = state.towers.find((item) => item.slot === slot);
    let changed = false;
    if (tower) {
      if (tower.level >= 3) addLog(`${towerNames[tower.kind]}已達最高等級。`);
      else if (state.gold < upgradePrice(tower, paramsRef.current)) addLog('金錢不足，無法升級。');
      else changed = upgradeTower(state, slot, paramsRef.current);
    } else {
      if (state.gold < towerBaseCost(selectedTower, paramsRef.current)) addLog('金錢不足，無法建造。');
      else changed = buildTower(state, slot, selectedTower, paramsRef.current);
    }
    if (changed) { setStrategy('manual'); addLog(state.lastEvent); setGame({ ...state, towers: [...state.towers] }); }
  };

  const updateParam = <K extends keyof Params>(key: K, value: Params[K]) => {
    setParams((current) => {
      const next = { ...current, [key]: value };
      paramsRef.current = next;
      if (gameRef.current.wave === 1 && gameRef.current.status === 'building' && strategy !== 'manual') {
        const refreshed = makeGame(next, strategy);
        gameRef.current = refreshed;
        setGame({ ...refreshed, towers: [...refreshed.towers] });
      }
      return next;
    });
  };

  const restoreDefaults = () => {
    const next = { ...defaultParams };
    setParams(next);
    paramsRef.current = next;
    resetWith('control', 'mixed', next, 'straight');
  };

  const routeResults = useMemo(() => {
    const comparisonStrategy: StrategyKey = strategy === 'manual' ? 'control' : strategy;
    return Object.fromEntries(routeKeys.map((key) => [key, runAutoStrategy(comparisonStrategy, profile, params, routeTemplates[key])])) as Record<RouteKey, AutoResult>;
  }, [params, profile, strategy]);

  const pressureCurve = useMemo(() => {
    const values = Array.from({ length: 10 }, (_, index) => {
      const wave = index + 1;
      return { wave, pressure: wavePressure(wave, profile, params), capacity: defenseCapacity(game.towers, wave, profile, params, template) };
    });
    return { values, max: Math.max(1, ...values.flatMap((value) => [value.pressure, value.capacity])) };
  }, [params, profile, game.towers, template]);

  const totalDps = game.towers.reduce((sum, tower) => sum + towerDps(tower, params), 0);
  const damagePerGold = game.totalSpent > 0 ? game.totalDamage / game.totalSpent : 0;
  const overkillRate = game.totalDamage + game.totalOverkill > 0 ? game.totalOverkill / (game.totalDamage + game.totalOverkill) * 100 : 0;
  const cleared = game.waveResults.length;
  const currentTower = selectedSlot === null ? undefined : game.towers.find((tower) => tower.slot === selectedSlot);
  const maxTowerDamage = Math.max(1, ...game.towers.map((tower) => tower.damage));
  const averageCoverage = game.towers.length ? game.towers.reduce((sum, tower) => sum + coverageRatio(tower.slot, towerStats(tower, params).range, template), 0) / game.towers.length * 100 : 0;
  const actualUtilization = game.towers.length && game.elapsed > 0 ? game.towers.reduce((sum, tower) => sum + tower.activeTime, 0) / game.towers.length / game.elapsed * 100 : 0;

  const actionLabel = game.status === 'building' ? `開始第 ${game.wave} 波` : game.status === 'running' ? '暫停模擬' : game.status === 'paused' ? '繼續模擬' : '重新開始';

  return <main className="lab-shell td-lab">
    <header className="lab-header"><div className="lab-brand-stack"><a href={sitePath('/')} className="lab-breadcrumb">← 返回模式首頁</a><div className="brand-lockup"><div className="brand-badge">A</div><div><p className="eyebrow">AVIX · GAME BALANCING LAB</p><h1>塔防關卡路徑實驗室</h1></div></div></div><div className="header-tools"><a href={sitePath('/beat-em-up')} className="mode-jump">Beat&apos;em Up →</a><div className="stage-pill"><span />{template.shortName} · {strategyNames[strategy]} · {profileNames[profile]}</div></div></header>

    <section className="player-profile-panel td-route-panel">
      <div className="route-panel-copy"><p className="section-label">PATH TEMPLATE</p><h2>路線形狀如何改變有效防守？</h2><span>五種模板統一通行時間、預算、敵軍與建造點數量，只比較幾何與拓樸。</span></div>
      <div className="route-template-grid">{routeKeys.map((key) => { const route = routeTemplates[key]; return <button type="button" key={key} className={routeKey === key ? 'selected' : ''} onClick={() => applyRoute(key)}><RoutePreview template={route} /><span>{route.topology}</span><b>{route.name}</b><small>{route.principle}</small></button>; })}</div>
      <div className="route-context-controls"><span>固定比較條件</span><label>配置策略<select aria-label="配置策略" value={strategy === 'manual' ? 'control' : strategy} onChange={(event) => applyStrategy(event.target.value as StrategyKey)}><option value="expand">擴張優先</option><option value="upgrade">升級優先</option><option value="control">混合控制</option></select></label><label>敵軍編成<select aria-label="敵軍編成" value={profile} onChange={(event) => applyProfile(event.target.value as WaveProfile)}><option value="mixed">混合波次</option><option value="fast">高速突擊</option><option value="swarm">群體壓力</option><option value="heavy">重裝推進</option></select></label><small>切換條件或路線會重新開始</small></div>
    </section>

    <section className="workspace td-workspace">
      <div className="arena-panel td-arena-panel"><div className="panel-heading"><div><p className="section-label">LIVE PATH TEST</p><h2>{template.name} · 標準化十波</h2></div><p className="keyboard-hint">{template.note}</p></div>
        <div className={`defense-board ${game.status}`}>
          <div className="board-grid" />
          <div className="td-topline"><span>BASE HP <b>{game.baseHp}/{params.baseHp}</b></span><span>WAVE {game.wave.toString().padStart(2, '0')} / 10</span><span>GOLD <b>{fmt(game.gold)}</b></span></div>
          <div className="path-layer">{renderedSegments.map((segment, index) => <i key={index} style={{ left: `${segment.x}%`, top: `${segment.y}%`, width: `${segment.length}%`, transform: `rotate(${segment.angle}deg)` }} />)}</div>
          {entries.map((point, index) => <div className="td-entry" key={`entry-${index}`} style={{ left: `${point.x}%`, top: `${point.y}%` }}>IN{entries.length > 1 ? index + 1 : ''}</div>)}{bases.map((point, index) => <div className="td-base" key={`base-${index}`} style={{ left: `${point.x}%`, top: `${point.y}%` }}><span>BASE{bases.length > 1 ? ` ${index + 1}` : ''}</span><b>{game.baseHp}</b></div>)}
          {game.towers.map((tower) => {
            const slot = template.slots[tower.slot];
            const stats = towerStats(tower, params);
            return <button type="button" aria-label={`${towerNames[tower.kind]} Lv.${tower.level}`} title={`${towerNames[tower.kind]} Lv.${tower.level}｜點擊升級`} key={tower.slot} className={`td-tower ${tower.kind} ${tower.flash > 0 ? 'firing' : ''} ${selectedSlot === tower.slot ? 'selected' : ''}`} style={{ left: `${slot.x}%`, top: `${slot.y}%`, '--tower-range': `${stats.range * 2}%` } as React.CSSProperties} onClick={() => handleSlot(tower.slot)}><i /><strong>{towerMarks[tower.kind]}</strong><small>Lv.{tower.level}</small></button>;
          })}
          {template.slots.map((slot, index) => game.towers.some((tower) => tower.slot === index) ? null : <button type="button" aria-label={`建造位置 ${index + 1}`} key={index} className={`td-slot ${selectedSlot === index ? 'selected' : ''}`} style={{ left: `${slot.x}%`, top: `${slot.y}%` }} onClick={() => handleSlot(index)}><span>＋</span><small>{index + 1}</small></button>)}
          {game.enemies.map((enemy) => {
            const point = pointAt(template, enemy.route, enemy.progress);
            return <div key={enemy.id} className={`td-enemy ${enemy.kind} ${enemy.slowLeft > 0 ? 'slowed' : ''}`} style={{ left: `${point.x}%`, top: `${point.y}%` }}><strong>{enemyMarks[enemy.kind]}</strong><i><b style={{ width: `${Math.max(0, enemy.hp / enemy.maxHp * 100)}%` }} /></i></div>;
          })}
          {game.status === 'building' && <div className="td-message"><span>{template.topology.toUpperCase()}</span><strong>{template.name} · 第 {game.wave} 波</strong><p>{game.wave === 1 ? template.note : `目前有 ${fmt(game.gold)} 金幣可建造或升級。`}</p></div>}
          {game.status === 'paused' && <div className="td-message"><span>PAUSED</span><strong>模擬已暫停</strong><p>繼續後將從目前波次接續。</p></div>}
          {game.status === 'complete' && <div className="td-message result complete"><span>DEFENSE COMPLETE</span><strong>十波防守完成</strong><p>基地剩餘 {game.baseHp} HP，共漏掉 {game.totalLeaks} 名敵人。</p></div>}
          {game.status === 'defeated' && <div className="td-message result defeated"><span>BASE LOST</span><strong>第 {game.wave} 波失守</strong><p>調整塔種、升級順序或敵軍參數後再次測試。</p></div>}
          <div className="td-wave-track">{Array.from({ length: 10 }, (_, index) => index + 1).map((wave) => <div key={wave} className={wave <= cleared ? 'cleared' : wave === game.wave ? 'current' : ''}><i /><span>{wave}</span></div>)}</div>
        </div>

        <div className="td-build-toolbar">
          <div className="tower-shop">{(['rapid', 'cannon', 'frost'] as TowerKind[]).map((kind) => <button type="button" key={kind} disabled={game.status !== 'building'} className={selectedTower === kind ? 'selected' : ''} onClick={() => setSelectedTower(kind)}><b>{towerMarks[kind]}</b><span><strong>{towerNames[kind]}</strong><small>{fmt(towerBaseCost(kind, params))} G</small></span></button>)}</div>
          <div className="selected-tower-detail">{currentTower ? <><span>選取 {towerNames[currentTower.kind]} Lv.{currentTower.level}</span><b>{currentTower.level >= 3 ? '已達最高等級' : `點擊升級 · ${upgradePrice(currentTower, params)} G`}</b></> : <><span>選取建造位置</span><b>將建造{towerNames[selectedTower]}</b></>}</div>
        </div>

        <div className="arena-actions"><button type="button" className="primary-action" onClick={toggle}><span>{game.status === 'running' ? 'Ⅱ' : '▶'}</span>{actionLabel}</button><button type="button" className="secondary-action" onClick={() => resetWith(strategy === 'manual' ? 'control' : strategy, profile, paramsRef.current, routeKey)}>重置本局</button><button type="button" className="secondary-action" disabled={game.wave !== 1 || game.status !== 'building'} onClick={() => resetWith('manual', profile, paramsRef.current, routeKey)}>清空配置</button><div className="run-note"><span className={game.status === 'running' ? 'active-dot' : ''} />{game.status === 'running' ? `第 ${game.wave} 波進行中 · 場上 ${game.enemies.length}` : game.lastEvent}</div><div className="speed-control"><span>速度</span>{[1, 4, 10].map((speed) => <button type="button" key={speed} className={simSpeed === speed ? 'selected' : ''} onClick={() => setSimSpeed(speed)}>{speed}×</button>)}</div></div>
      </div>

      <aside className="control-panel td-control-panel"><div className="panel-heading compact"><div><p className="section-label">BALANCE PARAMETERS</p><h2>數值控制台</h2></div><button type="button" className="text-action" onClick={restoreDefaults}>恢復預設</button></div>
        <div className="control-tabs td-tabs"><button type="button" className={controlTab === 'tower' ? 'active' : ''} onClick={() => setControlTab('tower')}><span className="player-swatch" />防禦塔</button><button type="button" className={controlTab === 'enemy' ? 'active' : ''} onClick={() => setControlTab('enemy')}><span className="boss-swatch" />敵人波次</button><button type="button" className={controlTab === 'economy' ? 'active' : ''} onClick={() => setControlTab('economy')}><span className="gold-swatch" />資源</button></div>
        <div className="controls-scroll td-controls-scroll">
          {controlTab === 'tower' && <div className="control-group"><RangeControl label="速射塔傷害" hint="單體塔每次攻擊造成的傷害。" value={params.rapidDamage} min={10} max={55} onChange={(value) => updateParam('rapidDamage', value)} /><RangeControl label="速射攻擊間隔" hint="越短代表攻擊頻率越高。" value={params.rapidInterval} min={.22} max={.8} step={.02} suffix="s" onChange={(value) => updateParam('rapidInterval', value)} /><RangeControl label="砲塔傷害" hint="範圍攻擊的單次基礎傷害。" value={params.cannonDamage} min={55} max={190} step={5} onChange={(value) => updateParam('cannonDamage', value)} /><RangeControl label="砲塔攻擊間隔" hint="高傷害的代價是較長攻擊間隔。" value={params.cannonInterval} min={.8} max={2.6} step={.05} suffix="s" onChange={(value) => updateParam('cannonInterval', value)} /><RangeControl label="緩速比例" hint="延長敵人在整條防線中的停留時間。" value={params.frostSlow} min={10} max={55} suffix="%" onChange={(value) => updateParam('frostSlow', value)} /><RangeControl label="每級能力增幅" hint="每次升級增加的傷害比例。" value={params.upgradePower} min={20} max={80} suffix="%" onChange={(value) => updateParam('upgradePower', value)} /></div>}
          {controlTab === 'enemy' && <div className="control-group"><RangeControl label="第一波基礎生命" hint="普通敵人在第一波的生命值。" value={params.enemyBaseHp} min={70} max={260} step={5} onChange={(value) => updateParam('enemyBaseHp', value)} /><RangeControl label="每波生命成長" hint="以複利方式增加後續波次生命值。" value={params.enemyHpGrowth} min={8} max={30} suffix="%" onChange={(value) => updateParam('enemyHpGrowth', value)} /><RangeControl label="基礎移動速度" hint="數值越高，防禦塔的有效攻擊時間越短。" value={params.enemyBaseSpeed} min={2.8} max={7} step={.1} suffix="%/s" onChange={(value) => updateParam('enemyBaseSpeed', value)} /><RangeControl label="重裝減傷" hint="重裝敵人對未穿透傷害的減免比例。" value={params.heavyArmor} min={10} max={60} suffix="%" onChange={(value) => updateParam('heavyArmor', value)} /><RangeControl label="出怪間隔" hint="越短代表敵群越密集，範圍塔收益越高。" value={params.spawnInterval} min={.3} max={1.5} step={.05} suffix="s" onChange={(value) => updateParam('spawnInterval', value)} /><RangeControl label="壓力波倍率" hint="套用於第 5 波與第 10 波的額外生命倍率。" value={params.pressureMultiplier} min={1} max={2.2} step={.05} suffix="×" onChange={(value) => updateParam('pressureMultiplier', value)} /></div>}
          {controlTab === 'economy' && <div className="control-group"><RangeControl label="初始金錢" hint="決定第一波前可以完成多少配置。" value={params.startingGold} min={250} max={900} step={10} suffix=" G" onChange={(value) => updateParam('startingGold', value)} /><RangeControl label="普通擊殺獎勵" hint="其他敵人依類型套用獎勵倍率。" value={params.killReward} min={8} max={45} suffix=" G" onChange={(value) => updateParam('killReward', value)} /><RangeControl label="波次完成獎勵" hint="每波結束後提供的固定資源。" value={params.waveReward} min={20} max={180} step={5} suffix=" G" onChange={(value) => updateParam('waveReward', value)} /><RangeControl label="升級價格比例" hint="以塔的建造價格計算升級成本。" value={params.upgradeCost} min={35} max={130} step={5} suffix="%" onChange={(value) => updateParam('upgradeCost', value)} /><RangeControl label="基地生命" hint="重裝敵人突破時會造成 2 點傷害。" value={params.baseHp} min={5} max={40} onChange={(value) => updateParam('baseHp', value)} /></div>}
        </div>
        <div className="estimate-grid"><div><p>帳面總 DPS</p><strong>{fmt(totalDps)}</strong><span>未計範圍與緩速</span></div><div><p>本波敵軍壓力</p><strong>{fmt(wavePressure(game.wave, profile, params))}</strong><span>有效生命總量</span></div><div><p>過度擊殺</p><strong>{fmt(overkillRate, 1)}<small>%</small></strong><span>輸出沒有轉成擊殺</span></div></div>
      </aside>
    </section>

    <section className="metrics-section"><div className="metrics-heading"><div><p className="section-label">PATH METRICS</p><h2>路線與防守結果</h2></div><p>通行時間固定，觀察點位覆蓋與火力利用率如何改變。</p></div><div className="metrics-grid six"><div className="metric-card primary"><span>完成波次</span><strong>{cleared}<i>/10</i></strong><small>目前進度</small></div><div className="metric-card"><span>基地生命</span><strong>{game.baseHp}<i> HP</i></strong><small>剩餘容錯</small></div><div className="metric-card"><span>平均路徑覆蓋</span><strong>{fmt(averageCoverage, 1)}<i>%</i></strong><small>單塔可接觸路線比例</small></div><div className="metric-card"><span>火力利用率</span><strong>{fmt(actualUtilization, 1)}<i>%</i></strong><small>有目標時間 ÷ 模擬時間</small></div><div className="metric-card"><span>漏怪數</span><strong>{game.totalLeaks}</strong><small>突破防線</small></div><div className="metric-card"><span>每金幣傷害</span><strong>{fmt(damagePerGold, 1)}</strong><small>實際傷害 ÷ 支出</small></div></div></section>

    <section className="analysis-grid td-analysis-grid">
      <div className="history-panel td-pressure-panel"><div className="analysis-heading"><div><p className="section-label">PRESSURE CURVE</p><h2>防線容量 vs. 敵軍壓力</h2></div><span>以目前塔配置估算十波結果</span></div><div className="td-pressure-legend"><span><i className="capacity-key" />防線容量</span><span><i className="pressure-key" />敵軍有效生命</span></div><div className="td-pressure-chart">{pressureCurve.values.map((value) => { const result = game.waveResults.find((item) => item.wave === value.wave); return <div className={`td-pressure-column ${value.wave === game.wave ? 'current' : ''}`} key={value.wave}><div><i className="capacity-bar" style={{ height: `${Math.max(3, value.capacity / pressureCurve.max * 100)}%` }} /><i className="pressure-bar" style={{ height: `${Math.max(3, value.pressure / pressureCurve.max * 100)}%` }} /></div><span>W{value.wave}</span><small>{result ? `${result.leaked} 漏` : value.capacity >= value.pressure ? '可守' : '壓力'}</small></div>; })}</div></div>
      <div className="compare-panel td-contribution-panel"><div className="analysis-heading"><div><p className="section-label">TOWER VALUE</p><h2>防禦塔貢獻</h2></div><span>實際傷害與投資效率</span></div>{game.towers.length === 0 ? <div className="empty-state"><strong>尚未建造防禦塔</strong><p>建造後會顯示每座塔的實際貢獻。</p></div> : <div className="tower-contribution-list">{game.towers.slice().sort((a, b) => b.damage - a.damage).map((tower) => <div key={tower.slot}><span className={`tower-mini ${tower.kind}`}>{towerMarks[tower.kind]}</span><div><p><b>{towerNames[tower.kind]} · #{tower.slot + 1}</b><small>Lv.{tower.level} · {fmt(tower.damage / Math.max(1, tower.spent), 1)} 傷害/G</small></p><i><b style={{ width: `${tower.damage / maxTowerDamage * 100}%` }} /></i></div><strong>{fmt(tower.damage)}</strong></div>)}</div>}</div>
    </section>

    <section className="batch-section td-route-comparison"><div className="batch-heading"><div><p className="section-label">STANDARDIZED COMPARISON</p><h2>五種基礎路線模板</h2></div><p>固定通行時間、預算、塔配置與敵軍編成；點擊卡片載入該路線。</p></div><div className="route-comparison-grid">{routeKeys.map((key) => { const route = routeTemplates[key]; const result = routeResults[key]; const severity = result.cleared >= 10 ? '' : result.cleared >= 7 ? 'warning' : 'danger'; return <button type="button" key={key} className={`${severity} ${routeKey === key ? 'selected' : ''}`} onClick={() => applyRoute(key)}><RoutePreview template={route} /><span>{route.topology}</span><h3>{route.name}</h3><p>{route.principle}</p><div><b>{result.cleared}<small>/10 波</small></b><strong>{fmt(result.utilization, 1)}<small>% 利用率</small></strong></div><div className="route-card-footer"><span>基地 {result.baseHp} HP</span><span>漏怪 {result.leaks}</span></div></button>; })}</div><div className="route-normalization-note"><span>CONTROLLED VARIABLES</span><p>總通行時間 100% · 建造點 8 · 初始預算 {fmt(params.startingGold)} G · {strategyNames[strategy === 'manual' ? 'control' : strategy]} · {profileNames[profile]}</p></div></section>

    <section className="event-panel"><div><p className="section-label">EVENT LOG</p><h2>數值事件</h2></div><div className="event-list">{eventLog.map((event, index) => <p key={`${event}-${index}`}><span>EVENT {String(index + 1).padStart(2, '0')}</span>{event}</p>)}</div></section>
    <footer><span>AVIX GAME DESIGN ACADEMY · MICROGAME TOOL 2026</span><p>塔防平衡不是只比較 DPS，而是觀察資源、覆蓋時間與敵軍編成如何互相作用。</p></footer>
  </main>;
}
