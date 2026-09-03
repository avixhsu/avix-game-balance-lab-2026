import { sitePath } from './sitePath';

export default function Home() {
  return (
    <main className="hub-shell">
      <header className="hub-header">
        <div className="brand-lockup">
          <div className="brand-badge">A</div>
          <div><p className="eyebrow">AVIX · GAME DESIGN ACADEMY</p><strong>數值實驗室</strong></div>
        </div>
        <span className="hub-version">MICROGAME TOOL · 2026</span>
      </header>

      <section className="hub-hero">
        <p className="section-label">SELECT A LAB</p>
        <h1>用一場微型遊戲，<br />看見數值如何改變體驗。</h1>
        <p>選擇測試情境、調整參數，再從可觀察的結果反推平衡問題。</p>
      </section>

      <section className="mode-grid">
        <a href={sitePath('/boss-rush')} className="mode-card available boss-mode">
          <div className="mode-index">01</div>
          <div className="mode-visual"><span className="mini-player">P</span><i /><span className="mini-boss">B</span></div>
          <p>COMBAT BALANCE</p><h2>Boss Rush</h2>
          <strong>戰鬥節奏與容錯</strong>
          <div className="mode-tags"><span>TTK</span><span>DPS</span><span>攻擊窗口</span></div>
          <div className="mode-action">進入實驗室 <span>→</span></div>
        </a>

        <a href={sitePath('/cooking-delivery')} className="mode-card available cooking-mode">
          <div className="mode-index">02</div>
          <div className="mode-visual production-line"><span>訂單</span><i /><span>廚房</span><i /><span>配送</span></div>
          <p>PRODUCTION BALANCE</p><h2>Cooking Delivery</h2>
          <strong>產能與流程瓶頸</strong>
          <div className="mode-tags"><span>產能</span><span>等待時間</span><span>滿意度</span></div>
          <div className="mode-action">進入實驗室 <span>→</span></div>
        </a>

        <a href={sitePath('/tower-defense')} className="mode-card available tower-mode"><div className="mode-index">03</div><div className="mode-visual tower-preview"><span className="tower-node">R</span><i /><span className="path-node">N</span><span className="path-node fast">F</span><i /><span className="base-node">BASE</span></div><p>RESOURCE ALLOCATION</p><h2>Tower Defense</h2><strong>資源配置與波次壓力</strong><div className="mode-tags"><span>建造成本</span><span>有效輸出</span><span>敵軍編成</span></div><div className="mode-action">進入實驗室 <span>→</span></div></a>
        <a href={sitePath('/beat-em-up')} className="mode-card available brawler-mode"><div className="mode-index">04</div><div className="mode-visual crowd-preview"><span className="crowd-player">P</span><i /><span>E</span><span>E</span><span className="elite">E+</span></div><p>ENCOUNTER PACING</p><h2>Beat&apos;em Up</h2><strong>群體戰鬥與關卡節奏</strong><div className="mode-tags"><span>波次壓力</span><span>連段效率</span><span>增援節奏</span></div><div className="mode-action">進入實驗室 <span>→</span></div></a>
      </section>

      <footer className="hub-footer"><span>先定義體驗，再調整數值。</span><span>AVIX GAME DESIGN ACADEMY</span></footer>
    </main>
  );
}
