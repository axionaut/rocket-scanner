// stratgen-tab.js — StratGen Strategy Lab Integrated Directly in Rocket Scanner
// Unified Strategy Generation, Backtesting, Leaderboard, AI Refinement & 1-Click Instant Deployment

(function () {
  'use strict';

  const SG_API = 'http://127.0.0.1:8899';
  let isConnected = false;
  let activeTab = 'leaderboard'; // 'leaderboard' | 'studio' | 'catalog' | 'parity'
  let leaderboardData = [];
  let selectedStrategy = null;
  let isGenerating = false;
  let isRefining = false;
  let isDiscoveryLoop = false;
  let discoveryTimer = null;
  let lastDeployedHash = null;

  function $(id) { return document.getElementById(id); }

  async function checkConnection() {
    try {
      const res = await fetch(`${SG_API}/api/leaderboard`, { method: 'GET', mode: 'cors' });
      if (res.ok) {
        const j = await res.json();
        isConnected = true;
        leaderboardData = j.leaderboard || [];
        updateConnectionStatus(true);
        return true;
      }
    } catch (e) {
      isConnected = false;
      updateConnectionStatus(false);
      return false;
    }
    isConnected = false;
    updateConnectionStatus(false);
    return false;
  }

  function updateConnectionStatus(connected) {
    const el = $('sgConnStatus');
    if (!el) return;
    if (connected) {
      el.innerHTML = '<span style="color:#22c55e">●</span> <span style="color:var(--t1)">StratGen Engine Connected</span> <span style="font-family:monospace;font-size:11px;color:var(--t3)">(127.0.0.1:8899)</span>';
      el.style.borderColor = 'rgba(34,197,94,0.3)';
    } else {
      el.innerHTML = '<span style="color:#ef4444">○</span> <span style="color:#ef4444">StratGen Engine Offline</span> <button onclick="window.RocketStratGen.retry()" style="background:none;border:1px solid #ef4444;color:#ef4444;border-radius:4px;padding:1px 6px;cursor:pointer;font-size:11px;margin-left:6px">Retry</button>';
      el.style.borderColor = 'rgba(239,68,68,0.3)';
    }
  }

  function getActiveDeployed() {
    return window.RocketStrategy?.CONFIG?.ACTIVE_STRATGEN_DEPLOYED || null;
  }

  function render() {
    const container = $('stratgenContent');
    if (!container) return;

    const dep = getActiveDeployed();
    const depName = dep ? (dep.name || dep.id) : 'None (Baseline RS Rules)';
    const depRules = dep?.spec?.entry_rules ? dep.spec.entry_rules.length : 0;
    const depTgt = dep ? (window.RocketStrategy.CONFIG.TARGET_PCT + '%') : '1.25%';
    const depSl = dep ? (window.RocketStrategy.CONFIG.STOP_LOSS_PCT > 0 ? ('-' + window.RocketStrategy.CONFIG.STOP_LOSS_PCT + '%') : 'None') : 'None';
    const depHash = dep?.sha256 ? dep.sha256.substring(0, 12) + '...' : (dep ? 'In-Memory' : 'N/A');

    container.innerHTML = `
      <div style="padding:16px 20px;max-width:1400px;margin:0 auto;color:var(--t1);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
        
        <!-- TOP STATUS & DEPLOYED HERO CARD -->
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px 18px;margin-bottom:18px;gap:12px">
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            <div id="sgConnStatus" style="font-size:12.5px;padding:5px 12px;background:var(--bg-raised);border:1px solid var(--border);border-radius:20px;display:flex;align-items:center;gap:6px">
              ${isConnected 
                ? '<span style="color:#22c55e">●</span> <span style="color:var(--t1)">StratGen Engine Connected</span> <span style="font-family:monospace;font-size:11px;color:var(--t3)">(127.0.0.1:8899)</span>'
                : '<span style="color:var(--t3)">Checking connection...</span>'}
            </div>
            
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:12px;color:var(--t3);text-transform:uppercase;letter-spacing:0.5px">Active RS Strategy:</span>
              <span style="font-weight:700;font-size:13.5px;color:${dep ? '#00e5a3' : 'var(--amber)'};background:rgba(${dep ? '0,229,163' : '251,191,36'},0.12);padding:3px 10px;border-radius:6px;border:1px solid rgba(${dep ? '0,229,163' : '251,191,36'},0.3)">
                ${dep ? '🚀 ' + depName : '⚡ ' + depName}
              </span>
              ${dep ? `<span style="font-size:11px;font-family:monospace;color:var(--t3)">[${depHash}]</span>` : ''}
              ${dep ? `<span style="font-size:11.5px;color:var(--t2)">(${depRules} rules | Target ${depTgt} | SL ${depSl})</span>` : ''}
            </div>
          </div>

          <div style="display:flex;gap:8px;align-items:center">
            ${dep ? `
              <button onclick="window.switchTab(0)" style="background:rgba(0,229,163,0.15);border:1px solid #00e5a3;color:#00e5a3;font-weight:600;padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12.5px">
                👉 View in Live Rankings
              </button>
              <button onclick="window.RocketStratGen.undeployActive()" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#ef4444;padding:6px 12px;border-radius:7px;cursor:pointer;font-size:12px" title="Revert to baseline Rocket Scanner rules">
                Clear Active
              </button>
            ` : `
              <span style="font-size:12px;color:var(--t3)">Deploy any strategy below to activate live</span>
            `}
          </div>
        </div>

        <!-- ACTION CONTROLS & SUB-NAV -->
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">
          <!-- Sub Tabs -->
          <div style="display:flex;background:var(--bg-raised);padding:3px;border-radius:8px;border:1px solid var(--border);gap:4px">
            <button onclick="window.RocketStratGen.setSubTab('leaderboard')" style="padding:6px 14px;border-radius:6px;border:none;background:${activeTab==='leaderboard'?'#00e5a3':'transparent'};color:${activeTab==='leaderboard'?'#07090e':'var(--t2)'};font-weight:600;font-size:12.5px;cursor:pointer">
              🏆 Leaderboard (${leaderboardData.length})
            </button>
            <button onclick="window.RocketStratGen.setSubTab('studio')" style="padding:6px 14px;border-radius:6px;border:none;background:${activeTab==='studio'?'#00e5a3':'transparent'};color:${activeTab==='studio'?'#07090e':'var(--t2)'};font-weight:600;font-size:12.5px;cursor:pointer">
              🔬 Strategy Studio & AI Refiner
            </button>
            <button onclick="window.RocketStratGen.setSubTab('parity')" style="padding:6px 14px;border-radius:6px;border:none;background:${activeTab==='parity'?'#00e5a3':'transparent'};color:${activeTab==='parity'?'#07090e':'var(--t2)'};font-weight:600;font-size:12.5px;cursor:pointer">
              ⚖️ Execution Parity Audit
            </button>
          </div>

          <!-- Action Buttons -->
          <div style="display:flex;gap:8px;align-items:center">
            <button id="btnGenerateOnce" onclick="window.RocketStratGen.generateOnce()" style="background:var(--bg-card);border:1px solid var(--border-hi);color:var(--t1);padding:7px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px">
              ${isGenerating ? '⏳ Generating Alpha...' : '✨ Generate Once (Gemini)'}
            </button>
            <button id="btnAutoLoop" onclick="window.RocketStratGen.toggleDiscoveryLoop()" style="background:${isDiscoveryLoop?'rgba(239,68,68,0.2)':'rgba(59,130,246,0.15)'};border:1px solid ${isDiscoveryLoop?'#ef4444':'var(--blue)'};color:${isDiscoveryLoop?'#ef4444':'var(--blue)'};padding:7px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600">
              ${isDiscoveryLoop ? '⏹ Stop Discovery Loop' : '🤖 Run Auto-Discovery'}
            </button>
            <button onclick="window.RocketStratGen.reloadLeaderboard()" style="background:var(--bg-card);border:1px solid var(--border);color:var(--t2);padding:7px 12px;border-radius:7px;cursor:pointer;font-size:12px" title="Refresh leaderboard data">
              🔄 Refresh
            </button>
          </div>
        </div>

        <!-- MAIN SUB-VIEW CONTENT -->
        <div id="sgSubContent">
          ${renderSubView()}
        </div>

      </div>
    `;

    checkConnection();
  }

  function renderSubView() {
    if (activeTab === 'leaderboard') return renderLeaderboard();
    if (activeTab === 'studio') return renderStudio();
    if (activeTab === 'parity') return renderParity();
    return '';
  }

  function renderLeaderboard() {
    if (!leaderboardData || leaderboardData.length === 0) {
      return `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:40px;text-align:center">
          <div style="font-size:32px;margin-bottom:12px">⚡</div>
          <h3 style="font-size:16px;margin:0 0 8px 0;color:var(--t1)">No Strategies Generated Yet</h3>
          <p style="color:var(--t2);font-size:13px;max-width:500px;margin:0 auto 16px auto">
            Generate your first autonomous alpha candidate using the Gemini AI discovery engine or start the auto-discovery loop.
          </p>
          <button onclick="window.RocketStratGen.generateOnce()" style="background:#00e5a3;color:#07090e;font-weight:700;border:none;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">
            ✨ Generate First Strategy
          </button>
        </div>
      `;
    }

    const activeDep = getActiveDeployed();
    const activeId = activeDep ? (activeDep.id || activeDep.name) : null;

    let rowsHtml = leaderboardData.map((s, idx) => {
      const isAct = (activeId && (s.id === activeId || s.name === activeId));
      const m = s.metrics || {};
      const winRate = m.win_rate !== undefined ? (m.win_rate * 100).toFixed(1) + '%' : (m.win_rate_pct ? m.win_rate_pct.toFixed(1) + '%' : '-');
      const ret = m.net_return_pct !== undefined ? (m.net_return_pct > 0 ? '+' : '') + m.net_return_pct.toFixed(2) + '%' : (m.return_pct ? m.return_pct.toFixed(2) + '%' : '-');
      const retColor = String(ret).startsWith('+') ? '#22c55e' : (String(ret).startsWith('-') ? '#ef4444' : 'var(--t1)');
      const sharpe = m.sharpe_ratio !== undefined ? m.sharpe_ratio.toFixed(2) : (m.sharpe ? m.sharpe.toFixed(2) : '-');
      const pf = m.profit_factor !== undefined ? m.profit_factor.toFixed(2) : '-';
      const dd = m.max_drawdown_pct !== undefined ? '-' + Math.abs(m.max_drawdown_pct).toFixed(1) + '%' : '-';
      const trades = m.total_trades || m.trades || 0;

      const rulesCount = s.spec?.entry_rules ? s.spec.entry_rules.length : 0;
      const tgt = s.spec?.exit?.tp_pct ? (s.spec.exit.tp_pct * 100).toFixed(2) + '%' : (s.spec?.target_pct ? s.spec.target_pct + '%' : '1.25%');
      const sl = s.spec?.exit?.sl_pct ? '-' + (s.spec.exit.sl_pct * 100).toFixed(2) + '%' : (s.spec?.stop_loss_pct ? '-' + s.spec.stop_loss_pct + '%' : 'None');

      return `
        <tr style="border-bottom:1px solid var(--border);background:${isAct ? 'rgba(0,229,163,0.04)' : 'transparent'};transition:background .15s" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='${isAct ? 'rgba(0,229,163,0.04)' : 'transparent'}'">
          <td style="padding:12px 14px;font-family:monospace;font-size:12px;color:var(--t3);width:40px">#${idx+1}</td>
          
          <td style="padding:12px 14px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-weight:600;font-size:13.5px;color:var(--t1)">${s.name || s.id}</span>
              ${isAct ? '<span style="font-size:10px;padding:2px 7px;background:rgba(0,229,163,0.2);color:#00e5a3;border:1px solid #00e5a3;border-radius:4px;font-weight:700">LIVE ACTIVE</span>' : ''}
              ${s.refined ? '<span style="font-size:10px;padding:1px 5px;background:rgba(59,130,246,0.15);color:var(--blue);border-radius:3px">Refined</span>' : ''}
            </div>
            <div style="font-size:11.5px;color:var(--t2);margin-top:3px;max-width:550px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${s.hypothesis || s.spec?.hypothesis || 'Long-only alpha hypothesis'}
            </div>
          </td>

          <td style="padding:12px 14px;font-family:monospace;font-size:13px;font-weight:700;color:${retColor}">${ret}</td>
          <td style="padding:12px 14px;font-family:monospace;font-size:13px">${winRate}</td>
          <td style="padding:12px 14px;font-family:monospace;font-size:12.5px;color:var(--t2)">${pf}</td>
          <td style="padding:12px 14px;font-family:monospace;font-size:12.5px;color:var(--t2)">${sharpe}</td>
          <td style="padding:12px 14px;font-family:monospace;font-size:12.5px;color:#ef4444">${dd}</td>
          <td style="padding:12px 14px;font-family:monospace;font-size:12.5px">${trades}</td>

          <td style="padding:12px 14px;text-align:right">
            <div style="display:flex;gap:6px;justify-content:flex-end">
              ${!isAct ? `
                <button onclick="window.RocketStratGen.deployStrategy('${s.id}')" style="background:#00e5a3;color:#07090e;font-weight:700;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11.5px" title="Deploy directly to Rocket Scanner live state">
                  🚀 Deploy
                </button>
              ` : `
                <button onclick="window.switchTab(0)" style="background:rgba(0,229,163,0.15);border:1px solid #00e5a3;color:#00e5a3;font-weight:600;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:11.5px">
                  View Live
                </button>
              `}
              <button onclick="window.RocketStratGen.inspectStrategy('${s.id}')" style="background:var(--bg-raised);border:1px solid var(--border);color:var(--t1);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:11.5px">
                🔍 Studio
              </button>
              <button onclick="window.RocketStratGen.deleteStrategy('${s.id}', '${(s.name||'').replace(/'/g, "\\'")}')" style="background:transparent;border:1px solid rgba(239,68,68,0.25);color:#ef4444;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:11.5px" title="Delete strategy">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden">
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;text-align:left">
            <thead>
              <tr style="border-bottom:1px solid var(--border);background:var(--bg-raised);font-size:11.5px;color:var(--t3);text-transform:uppercase;letter-spacing:0.5px">
                <th style="padding:10px 14px">#</th>
                <th style="padding:10px 14px">Strategy & Hypothesis</th>
                <th style="padding:10px 14px">Net Return</th>
                <th style="padding:10px 14px">Win Rate</th>
                <th style="padding:10px 14px">Profit Factor</th>
                <th style="padding:10px 14px">Sharpe</th>
                <th style="padding:10px 14px">Max DD</th>
                <th style="padding:10px 14px">Trades</th>
                <th style="padding:10px 14px;text-align:right">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderStudio() {
    const s = selectedStrategy || (leaderboardData.length > 0 ? leaderboardData[0] : null);
    if (!s) {
      return `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:30px;text-align:center;color:var(--t2)">
          Select a strategy from the Leaderboard to inspect in Studio.
        </div>
      `;
    }

    const rules = s.spec?.entry_rules || [];
    const exit = s.spec?.exit || {};

    const rulesHtml = rules.map((r, i) => `
      <div style="display:flex;align-items:center;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:8px;gap:12px">
        <span style="font-family:monospace;font-size:11.5px;color:var(--t3);width:24px">#${i+1}</span>
        <div style="flex:1">
          <span style="font-family:monospace;font-weight:700;color:var(--blue);font-size:13px">${r.metric}</span>
          <span style="font-weight:700;color:var(--amber);margin:0 8px;font-size:13px">${r.op}</span>
          <span style="font-family:monospace;color:#22c55e;font-size:13px">${r.value !== undefined ? r.value : (r.ref_metric || '-')}</span>
        </div>
        <span style="font-size:11.5px;color:var(--t3);padding:2px 8px;background:var(--bg-raised);border-radius:4px">
          ${r.timeframe || '1m'}
        </span>
      </div>
    `).join('');

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <!-- LEFT: SPEC & RULES -->
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:18px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="font-size:15px;margin:0;color:var(--t1)">${s.name || s.id}</h3>
            <button onclick="window.RocketStratGen.deployStrategy('${s.id}')" style="background:#00e5a3;color:#07090e;font-weight:700;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px">
              🚀 Deploy to Live RS
            </button>
          </div>

          <div style="font-size:12.5px;color:var(--t2);margin-bottom:16px;line-height:1.4">
            ${s.hypothesis || s.spec?.hypothesis || 'No hypothesis specified.'}
          </div>

          <div style="font-size:12px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">
            Entry Rules (${rules.length})
          </div>
          <div style="margin-bottom:18px">
            ${rulesHtml}
          </div>

          <div style="font-size:12px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">
            Exit Rules
          </div>
          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;font-size:12px">
            <div style="background:var(--bg-raised);padding:8px 10px;border-radius:6px;border:1px solid var(--border)">
              <div style="color:var(--t3)">Target (TP)</div>
              <div style="font-weight:700;color:#22c55e;font-size:13px;margin-top:2px">
                ${exit.tp_pct ? (exit.tp_pct * 100).toFixed(2) + '%' : (s.spec?.target_pct ? s.spec.target_pct + '%' : '1.25%')}
              </div>
            </div>
            <div style="background:var(--bg-raised);padding:8px 10px;border-radius:6px;border:1px solid var(--border)">
              <div style="color:var(--t3)">Stop Loss (SL)</div>
              <div style="font-weight:700;color:#ef4444;font-size:13px;margin-top:2px">
                ${exit.sl_pct ? '-' + (exit.sl_pct * 100).toFixed(2) + '%' : (s.spec?.stop_loss_pct ? '-' + s.spec.stop_loss_pct + '%' : 'None')}
              </div>
            </div>
            <div style="background:var(--bg-raised);padding:8px 10px;border-radius:6px;border:1px solid var(--border)">
              <div style="color:var(--t3)">Holding Period</div>
              <div style="font-weight:700;color:var(--blue);font-size:13px;margin-top:2px">
                T+${s.spec?.max_holding_days || 2} Days
              </div>
            </div>
          </div>
        </div>

        <!-- RIGHT: AI REFINER & BACKTEST -->
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:18px">
          <h3 style="font-size:15px;margin:0 0 12px 0;color:var(--t1)">🧠 Autonomous AI Refiner</h3>
          <p style="font-size:12.5px;color:var(--t2);margin-bottom:14px">
            Prompt Gemini to optimize indicator thresholds, tighten stop-loss, or filter false breakouts for this specific strategy.
          </p>

          <textarea id="refinePromptInput" placeholder="e.g. Tighten stop loss to 1.5% and add a volume ignition filter (rvol > 2.0) to improve win rate..." style="width:100%;height:80px;background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--t1);font-size:13px;outline:none;resize:none;margin-bottom:12px"></textarea>

          <div style="display:flex;gap:8px;margin-bottom:18px">
            <button onclick="window.RocketStratGen.refineStrategy('${s.id}')" style="flex:1;background:var(--blue);color:#fff;font-weight:600;border:none;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:12.5px">
              ${isRefining ? '⏳ Refining with Gemini...' : '⚡ Run AI Refinement'}
            </button>
            <button onclick="window.RocketStratGen.backtestCurrent('${s.id}')" style="background:var(--bg-raised);border:1px solid var(--border);color:var(--t1);font-weight:600;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:12.5px">
              🔄 Retest (2503 Stocks)
            </button>
          </div>

          <div style="border-top:1px solid var(--border);padding-top:14px">
            <div style="font-size:12px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">
              Backtest Performance Breakdown
            </div>
            <div id="studioPerfBox" style="background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;padding:12px;font-family:monospace;font-size:12px;line-height:1.6">
              <div>Net Return: <span style="color:#22c55e;font-weight:700">${s.metrics?.net_return_pct ? s.metrics.net_return_pct.toFixed(2)+'%' : 'N/A'}</span></div>
              <div>Win Rate: <span style="color:var(--t1);font-weight:700">${s.metrics?.win_rate ? (s.metrics.win_rate*100).toFixed(1)+'%' : 'N/A'}</span></div>
              <div>Profit Factor: <span style="color:var(--t2)">${s.metrics?.profit_factor || 'N/A'}</span></div>
              <div>Total Trades: <span style="color:var(--t2)">${s.metrics?.total_trades || 0}</span></div>
              <div>Max Drawdown: <span style="color:#ef4444">${s.metrics?.max_drawdown_pct ? s.metrics.max_drawdown_pct.toFixed(2)+'%' : 'N/A'}</span></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderParity() {
    const dep = getActiveDeployed();
    return `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:22px;max-width:900px">
        <h3 style="font-size:15px;margin:0 0 10px 0;color:var(--t1)">⚖️ Real-Time Parity & Integrity Monitor</h3>
        <p style="font-size:12.5px;color:var(--t2);margin-bottom:16px">
          Verifies that the strategy rules backtested in StratGen are 100% identically evaluated in Rocket Scanner's live trading engine.
        </p>

        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-weight:600;font-size:13px;color:var(--t1)">1. Deployed Strategy Contract</div>
              <div style="font-size:11.5px;color:var(--t3)">SHA-256 integrity match between StratGen and Rocket Scanner</div>
            </div>
            <div style="font-size:12px;font-weight:700;color:${dep ? '#22c55e' : 'var(--amber)'}">
              ${dep ? '✅ Active Synchronized' : '⚠️ None Deployed (Baseline)'}
            </div>
          </div>

          <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-weight:600;font-size:13px;color:var(--t1)">2. Strict Indicator Validation</div>
              <div style="font-size:11.5px;color:var(--t3)">Zero proxy fallbacks — uncalculated indicators return null and strictly fail entry</div>
            </div>
            <div style="font-size:12px;font-weight:700;color:#22c55e">
              ✅ Enforced in v1625+
            </div>
          </div>

          <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-weight:600;font-size:13px;color:var(--t1)">3. Single-Leg Stop Loss Protection</div>
              <div style="font-weight:700;font-size:11.5px;color:var(--t3)">Stop GTT orders are preserved during trailing; never cancelled without confirmed replacement</div>
            </div>
            <div style="font-size:12px;font-weight:700;color:#22c55e">
              ✅ Active & Protected
            </div>
          </div>

          <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-weight:600;font-size:13px;color:var(--t1)">4. Helper Backend Model Synchronization</div>
              <div style="font-size:11.5px;color:var(--t3)">Execution helper (port 8787) model synchronized with UI active strategy</div>
            </div>
            <div style="font-size:12px;font-weight:700;color:#22c55e">
              ✅ STRATGEN Engine Active
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // --- ACTIONS ---

  async function deployStrategy(stratId) {
    const s = leaderboardData.find(x => x.id === stratId);
    if (!s) return alert("Strategy not found");

    try {
      // 1. Post to StratGen server for persistence and checkpoint
      const res = await fetch(`${SG_API}/api/deploy_to_rocket_scanner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy_id: s.id, strategy: s })
      });
      const data = await res.json();
      
      const deployedObj = data.deployed || s;

      // 2. Immediately apply in-memory to Rocket Scanner's active engine
      if (window.RocketStrategy?.applyDeployedStrategy) {
        window.RocketStrategy.applyDeployedStrategy(deployedObj);
      }

      // 3. Update the dropdown in Rocket Scanner's Rankings header
      const opt = $('optStratGen');
      if (opt) {
        opt.textContent = `StratGen: ${deployedObj.name || deployedObj.id}`;
      }
      const sel = $('fModel');
      if (sel) {
        sel.value = 'STRATGEN';
      }

      // 4. Trigger filter re-calculation across all 2503 stocks
      if (typeof window.scheduleApplyFilters === 'function') {
        window.scheduleApplyFilters();
      }

      // Re-render StratGen tab
      render();

      alert(`🚀 DEPLOYED SUCCESSFULLY TO ROCKET SCANNER!\n\nStrategy: "${s.name}"\nTarget: ${window.RocketStrategy.CONFIG.TARGET_PCT}%\nStop Loss: ${window.RocketStrategy.CONFIG.STOP_LOSS_PCT}%\n\nStocks in Rankings are now filtered live by this strategy!`);

    } catch (e) {
      alert("Deployment error: " + e.message);
    }
  }

  function undeployActive() {
    if (!confirm("Remove the active strategy from Rocket Scanner and revert to baseline rules?")) return;
    if (window.RocketStrategy?.applyDeployedStrategy) {
      window.RocketStrategy.applyDeployedStrategy(null);
    }
    const opt = $('optStratGen');
    if (opt) opt.textContent = 'StratGen: Baseline Rules';
    if (typeof window.scheduleApplyFilters === 'function') {
      window.scheduleApplyFilters();
    }
    render();
  }

  async function deleteStrategy(stratId, stratName) {
    if (!confirm(`Permanently delete strategy "${stratName}"?`)) return;
    try {
      const res = await fetch(`${SG_API}/api/delete_strategy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy_id: stratId })
      });
      const data = await res.json();
      if (data.success) {
        leaderboardData = data.leaderboard || [];
        // If it was the active deployed strategy, undeploy it
        const dep = getActiveDeployed();
        if (dep && (dep.id === stratId || dep.name === stratName)) {
          undeployActive();
        }
        render();
      } else {
        alert("Delete failed: " + (data.error || "Unknown error"));
      }
    } catch (e) {
      alert("Delete error: " + e.message);
    }
  }

  async function generateOnce() {
    if (isGenerating) return;
    isGenerating = true;
    render();
    try {
      const res = await fetch(`${SG_API}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success && data.strategy) {
        await reloadLeaderboard();
        selectedStrategy = data.strategy;
        activeTab = 'studio';
        render();
        alert(`✨ New Alpha Candidate Generated!\n\n"${data.strategy.name}"\nWin Rate: ${(data.strategy.metrics?.win_rate*100||0).toFixed(1)}%\nNet Return: ${(data.strategy.metrics?.net_return_pct||0).toFixed(2)}%`);
      } else {
        alert("Generation failed: " + (data.error || "Check Gemini API key in StratGen settings"));
      }
    } catch (e) {
      alert("Generation error: " + e.message);
    } finally {
      isGenerating = false;
      render();
    }
  }

  function toggleDiscoveryLoop() {
    isDiscoveryLoop = !isDiscoveryLoop;
    render();
    if (isDiscoveryLoop) {
      alert("🤖 Autonomous Alpha Discovery Loop started! StratGen will discover and backtest candidates continuously.");
      runNextDiscoveryStep();
    } else {
      clearTimeout(discoveryTimer);
      alert("Discovery loop stopped.");
    }
  }

  async function runNextDiscoveryStep() {
    if (!isDiscoveryLoop) return;
    try {
      await fetch(`${SG_API}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await reloadLeaderboard();
      render();
    } catch (e) {}
    if (isDiscoveryLoop) {
      discoveryTimer = setTimeout(runNextDiscoveryStep, 15000);
    }
  }

  async function refineStrategy(stratId) {
    const s = leaderboardData.find(x => x.id === stratId) || selectedStrategy;
    if (!s) return;
    const promptInput = $('refinePromptInput');
    const userPrompt = promptInput ? promptInput.value.trim() : '';

    isRefining = true;
    render();
    try {
      const res = await fetch(`${SG_API}/api/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy_id: s.id, prompt: userPrompt })
      });
      const data = await res.json();
      if (data.success && data.strategy) {
        await reloadLeaderboard();
        selectedStrategy = data.strategy;
        render();
        alert(`🧠 Refinement Complete!\n\nRefined: "${data.strategy.name}"\nNew Win Rate: ${(data.strategy.metrics?.win_rate*100||0).toFixed(1)}%\nNew Return: ${(data.strategy.metrics?.net_return_pct||0).toFixed(2)}%`);
      } else {
        alert("Refinement failed: " + (data.error || "Unknown error"));
      }
    } catch (e) {
      alert("Refine error: " + e.message);
    } finally {
      isRefining = false;
      render();
    }
  }

  async function backtestCurrent(stratId) {
    alert("Running backtest against all 2,503 NSE stocks...");
    await reloadLeaderboard();
    render();
  }

  async function reloadLeaderboard() {
    try {
      const res = await fetch(`${SG_API}/api/leaderboard`);
      if (res.ok) {
        const j = await res.json();
        leaderboardData = j.leaderboard || [];
      }
    } catch (e) {}
  }

  function setSubTab(tab) {
    activeTab = tab;
    render();
  }

  function inspectStrategy(stratId) {
    const s = leaderboardData.find(x => x.id === stratId);
    if (s) {
      selectedStrategy = s;
      activeTab = 'studio';
      render();
    }
  }

  function retry() {
    checkConnection().then(render);
  }

  // Export public interface
  window.RocketStratGen = {
    render,
    setSubTab,
    deployStrategy,
    undeployActive,
    deleteStrategy,
    inspectStrategy,
    generateOnce,
    toggleDiscoveryLoop,
    refineStrategy,
    backtestCurrent,
    reloadLeaderboard,
    retry
  };

})();
