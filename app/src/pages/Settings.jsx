import { useState, useEffect, useRef } from 'react';

// ===== 主题预设（6 色 + 自定义） =====
const THEME_PRESETS = [
  { id: 'dark',    name: '深色',   colors: ['#0f1a2e', '#00aef0', '#00e5c0'], primary: '200 100% 50%', secondary: '170 100% 45%', bg: '220 25% 8%',   accent: '270 80% 60%', isLight: false },
  { id: 'light',   name: '亮色',   colors: ['#f5f8fb', '#0077cc', '#008880'], primary: '205 90% 42%', secondary: '175 80% 30%', bg: '210 20% 96%',  accent: '270 60% 55%', isLight: true },
  { id: 'matcha',  name: '抹茶绿', colors: ['#eef6e8', '#6b9b37', '#3da88a'], primary: '85 50% 42%',  secondary: '165 50% 42%', bg: '85 18% 90%',   accent: '45 60% 48%',  isLight: true },
  { id: 'pink',    name: '粉色',   colors: ['#fce8f0', '#e8537a', '#c450b0'], primary: '340 75% 55%', secondary: '300 50% 52%', bg: '340 12% 93%',  accent: '10 70% 60%',  isLight: true },
  { id: 'yellow',  name: '浅黄',   colors: ['#fef9ec', '#d49929', '#c4752a'], primary: '40 75% 48%',  secondary: '25 65% 45%',  bg: '42 25% 94%',   accent: '200 60% 50%', isLight: true },
  { id: 'blue',    name: '淡蓝',   colors: ['#edf4fa', '#3b8ed4', '#3ea8b8'], primary: '205 80% 52%', secondary: '190 55% 46%', bg: '205 25% 92%',  accent: '250 60% 58%', isLight: true },
];

const CUSTOM_THEME_ID = 'custom';

const THEME_KEY = 'xingbao_theme';
const DISPLAY_NAME_KEY = 'xingbao_display_name';
const CUSTOM_THEME_KEY = 'xingbao_theme_custom';

// 默认自定义配色（深蓝）
const DEFAULT_CUSTOM = { primaryH: 200, primaryS: 100, primaryL: 50, secondaryH: 170, secondaryS: 100, secondaryL: 45, bgH: 220, bgS: 25, bgL: 8, accentH: 270, accentS: 80, accentL: 60 };

// ===== HSL 滑块子组件 =====
function ColorSlider({ label, hueField, satField, lumField, colors, onChange }) {
  const h = colors[hueField];
  const s = colors[satField];
  const l = colors[lumField];
  const swatchColor = `hsl(${h}, ${s}%, ${l}%)`;

  return (
    <div className="color-slider-group">
      <div className="color-slider-header">
        <span className="color-slider-label">{label}</span>
        <span className="color-slider-swatch" style={{ background: swatchColor }} />
        <span className="color-slider-hsl">H{h} S{s}% L{l}%</span>
      </div>
      <div className="slider-row">
        <span className="slider-tag">色相</span>
        <input type="range" min="0" max="360" value={h} className="slider-hue"
          onChange={e => onChange(hueField, e.target.value)} />
        <span className="slider-val">{h}°</span>
      </div>
      <div className="slider-row">
        <span className="slider-tag">饱和度</span>
        <input type="range" min="0" max="100" value={s} className="slider-sat"
          onChange={e => onChange(satField, e.target.value)} />
        <span className="slider-val">{s}%</span>
      </div>
      <div className="slider-row">
        <span className="slider-tag">亮度</span>
        <input type="range" min="0" max="100" value={l} className="slider-lum"
          onChange={e => onChange(lumField, e.target.value)} />
        <span className="slider-val">{l}%</span>
      </div>
    </div>
  );
}

export default function Settings({ user, onLogout, onSwitchAccount }) {
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem(DISPLAY_NAME_KEY) || user?.user_metadata?.display_name || ''
  );
  const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
  const [activeTheme, setActiveTheme] = useState(savedTheme);
  const [nicknameSaved, setNicknameSaved] = useState(false);
  const [updateStatus, setUpdateStatus] = useState({ event: 'idle' });
  const [toast, setToast] = useState(null);
  const [appVersion, setAppVersion] = useState('');
  const unsubRef = useRef(null);

  // 自定义颜色状态
  const [showCustomPicker, setShowCustomPicker] = useState(savedTheme === CUSTOM_THEME_ID);
  const [customColors, setCustomColors] = useState(() => {
    if (savedTheme === CUSTOM_THEME_ID) {
      try {
        const saved = localStorage.getItem(CUSTOM_THEME_KEY);
        if (saved) return { ...DEFAULT_CUSTOM, ...JSON.parse(saved) };
      } catch {}
    }
    return { ...DEFAULT_CUSTOM };
  });

  // ===== 核心：将 HSL 变量写入 document ====
  const applyThemeVarsCore = (primaryHsl, secondaryHsl, bgHsl, accentHsl, isLight) => {
    const root = document.documentElement;
    root.style.setProperty('--primary', primaryHsl);
    root.style.setProperty('--secondary', secondaryHsl);
    root.style.setProperty('--background', bgHsl);
    root.style.setProperty('--accent', accentHsl);
    root.style.setProperty('--foreground', isLight ? '200 20% 5%' : '210 20% 98%');
    root.style.setProperty('--card', isLight ? '200 30% 91%' : '220 20% 12%');
    root.style.setProperty('--border', isLight ? '200 20% 80%' : '220 20% 20%');
    root.style.setProperty('--input', isLight ? '200 30% 96%' : '220 20% 18%');
    root.style.setProperty('--muted', isLight ? '200 30% 88%' : '220 20% 18%');
    root.style.setProperty('--muted-foreground', isLight ? '200 10% 40%' : '215 15% 65%');

    if (isLight) {
      root.style.setProperty('--text', '#1a1a2e');
      root.style.setProperty('--text-secondary', '#555');
      root.style.setProperty('--bg', `hsl(${bgHsl})`);
      root.style.setProperty('--bg-card', '#f4f8fc');
      root.style.setProperty('--glass-bg', 'rgba(255, 255, 255, 0.85)');
      root.style.setProperty('--glass-border', 'rgba(0, 0, 0, 0.08)');
      root.style.setProperty('--glass-shadow', '0 8px 32px rgba(0, 0, 0, 0.08), inset 0 1px 1px rgba(255, 255, 255, 0.9)');
      root.style.setProperty('--shadow', '0 4px 16px rgba(0, 0, 0, 0.08)');
      root.style.setProperty('--shadow-lg', '0 12px 40px rgba(0, 0, 0, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.6)');
      document.body.className = 'theme-light';
    } else {
      root.style.setProperty('--text', 'hsl(210, 20%, 98%)');
      root.style.setProperty('--text-secondary', 'hsl(215, 15%, 65%)');
      root.style.setProperty('--bg', `hsl(${bgHsl})`);
      root.style.setProperty('--bg-card', 'hsl(220, 20%, 12%)');
      root.style.setProperty('--glass-bg', 'rgba(255, 255, 255, 0.05)');
      root.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.1)');
      root.style.setProperty('--glass-shadow', '0 8px 32px rgba(0, 0, 0, 0.37), inset 0 1px 1px rgba(255, 255, 255, 0.1)');
      root.style.setProperty('--shadow', '0 4px 16px rgba(0, 0, 0, 0.3)');
      root.style.setProperty('--shadow-lg', '0 12px 40px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.08)');
      document.body.className = 'theme-dark';
    }
  };

  // ===== 应用预设主题 =====
  function applyPreset(themeId) {
    const preset = THEME_PRESETS.find(t => t.id === themeId);
    if (!preset) return;
    applyThemeVarsCore(preset.primary, preset.secondary, preset.bg, preset.accent, preset.isLight);
    localStorage.setItem(THEME_KEY, themeId);
    localStorage.removeItem(CUSTOM_THEME_KEY);
    setActiveTheme(themeId);
    setShowCustomPicker(false);
  }

  // ===== 应用自定义主题 =====
  function applyCustom(c) {
    const c2 = c || customColors;
    const bgLightness = parseInt(c2.bgL);
    const isLight = bgLightness > 50;
    applyThemeVarsCore(
      `${c2.primaryH} ${c2.primaryS}% ${c2.primaryL}%`,
      `${c2.secondaryH} ${c2.secondaryS}% ${c2.secondaryL}%`,
      `${c2.bgH} ${c2.bgS}% ${c2.bgL}%`,
      `${c2.accentH} ${c2.accentS}% ${c2.accentL}%`,
      isLight
    );
    localStorage.setItem(THEME_KEY, CUSTOM_THEME_ID);
    localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(c2));
    setActiveTheme(CUSTOM_THEME_ID);
  }

  // ===== 更新单个 HSL 值并即时预览 =====
  function updateCustomField(field, value) {
    const next = { ...customColors, [field]: Number(value) };
    setCustomColors(next);
    applyCustom(next);
  }

  // ===== 重置自定义到默认 =====
  function resetCustom() {
    setCustomColors({ ...DEFAULT_CUSTOM });
    applyCustom(DEFAULT_CUSTOM);
  }

  // ===== 预设色板点击 =====
  function handleSwatchClick(preset) {
    if (preset.id === CUSTOM_THEME_ID) {
      setShowCustomPicker(true);
      applyCustom();
      return;
    }
    applyPreset(preset.id);
  }

  // 获取应用版本号
  useEffect(() => {
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then(setAppVersion).catch(() => setAppVersion('未知'));
    } else {
      setAppVersion('开发模式');
    }
  }, []);

  // 加载 + 监听更新状态
  useEffect(() => {
    if (window.electronAPI?.onUpdateStatus) {
      unsubRef.current = window.electronAPI.onUpdateStatus((s) => {
        setUpdateStatus(s);
        // 根据事件类型显示 toast
        if (s.event === 'no-update') showToast('✓ 已是最新版本', 'success');
        else if (s.event === 'available') showToast(`发现新版本 v${s.version}`, 'success');
        else if (s.event === 'error') showToast(s.message || '检查更新失败', 'error');
        else if (s.event === 'devMode') showToast('开发模式，请使用 npm run dist 打包后测试', 'error');
      });
    }
    return () => { unsubRef.current?.(); };
  }, []);


  function handleSaveNickname() {
    const trimmed = displayName.trim();
    if (!trimmed) {
      showToast('昵称不能为空', 'error');
      return;
    }
    localStorage.setItem(DISPLAY_NAME_KEY, trimmed);
    setDisplayName(trimmed);
    setNicknameSaved(true);
    showToast('✓ 昵称已保存', 'success');
    setTimeout(() => setNicknameSaved(false), 2000);
  }

  async function handleCheckUpdate() {
    if (!window.electronAPI?.checkForUpdates) {
      showToast('仅桌面端支持在线更新', 'error');
      return;
    }
    setUpdateStatus({ event: 'checking' });
    showToast('正在检查更新...', 'success');
    try {
      // 设置 10s 超时
      await Promise.race([
        window.electronAPI.checkForUpdates(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('检查超时')), 10000)),
      ]);
    } catch (_) {
      setUpdateStatus({ event: 'error', message: '检查更新失败：网络不可达' });
      showToast('检查更新失败', 'error');
    }
  }

  function handleLogout() {
    onLogout?.();
  }

  function handleSwitchAccount() {
    localStorage.removeItem('xingbao_saved_email');
    onSwitchAccount?.();
  }

  function showToast(msg, type) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="settings-page">
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <div className="page-header">
        <div className="header-dots"><span /><span /><span /></div>
        <h1 className="header-title">系统设置</h1>
        <p className="header-subtitle">个性化配置 · 账户管理</p>
      </div>

      {/* 1. 修改昵称 */}
      <div className="settings-card">
        <div className="settings-card-icon">👤</div>
        <div className="settings-card-body">
          <h3>用户昵称</h3>
          <p className="settings-card-desc">修改在系统中显示的姓名，将同步至仓储人员列表</p>
          <div className="settings-input-row">
            <input
              type="text"
              className="settings-input"
              value={displayName}
              onChange={e => { setDisplayName(e.target.value); setNicknameSaved(false); }}
              placeholder="请输入您的昵称"
              maxLength={20}
            />
            <button
              className={`btn btn-primary-glow btn-sm ${nicknameSaved ? 'btn-saved' : ''}`}
              onClick={handleSaveNickname}
              disabled={!displayName.trim()}
            >
              {nicknameSaved ? '✓ 已保存' : '保存'}
            </button>
          </div>
        </div>
      </div>

      {/* 2. 版本更新 */}
      <div className="settings-card">
        <div className="settings-card-icon">🔄</div>
        <div className="settings-card-body">
          <h3>版本更新</h3>
          <p className="settings-card-desc">
            {updateStatus.event === 'checking' && '⏳ 正在检查更新...'}
            {updateStatus.event === 'no-update' && '✓ 已是最新版本'}
            {updateStatus.event === 'error' && `⚠ ${updateStatus.message || '检查失败'}`}
            {updateStatus.event === 'progress' && `⬇ 下载中 ${updateStatus.percent || 0}%`}
            {updateStatus.event === 'downloaded' && '✅ 下载完成，重启后生效'}
            {(updateStatus.event === 'idle' || updateStatus.event === 'checking') && `检查并安装最新版本，当前版本 v${appVersion}`}
            {updateStatus.event === 'available' && `发现新版本 v${updateStatus.version}`}
          </p>
          <div className="settings-input-row">
            {updateStatus.event === 'available' && (
              <button className="btn btn-primary-glow btn-sm" onClick={() => window.electronAPI?.downloadUpdate()}>
                ⬇ 下载更新
              </button>
            )}
            {updateStatus.event === 'downloaded' && (
              <button className="btn btn-primary-glow btn-sm" onClick={() => window.electronAPI?.installUpdate()}>
                🔄 重启安装
              </button>
            )}
            {(updateStatus.event === 'idle' || updateStatus.event === 'error' || updateStatus.event === 'no-update') && (
              <button
                className="btn btn-outline-accent btn-sm"
                onClick={handleCheckUpdate}
                disabled={updateStatus.event === 'checking'}
              >
                {updateStatus.event === 'checking' ? '⏳ 检查中...' : '🔍 检查更新'}
              </button>
            )}
            <button
              className="btn btn-outline btn-sm"
              style={{ marginLeft: 8 }}
              onClick={async () => {
                if (!window.electronAPI?.runDiagnose) {
                  showToast('仅桌面端支持诊断', 'error');
                  return;
                }
                showToast('正在诊断更新链路...', 'success');
                try {
                  const result = await window.electronAPI.runDiagnose();
                  if (result.success) {
                    const errors = result.results?.filter(r => r.status === 'error') || [];
                    if (errors.length > 0) {
                      showToast(`诊断完成: ${errors.length} 项异常`, 'error');
                    } else {
                      showToast('诊断完成: 所有环节正常', 'success');
                    }
                    console.table(result.results);
                  } else {
                    showToast(`诊断异常: ${result.error}`, 'error');
                  }
                } catch (e) {
                  showToast('诊断异常', 'error');
                }
              }}
            >
              🔬 诊断链路
            </button>
          </div>
        </div>
      </div>

      {/* 3. 主题颜色 */}
      <div className="settings-card">
        <div className="settings-card-icon">🎨</div>
        <div className="settings-card-body">
          <h3>主题颜色</h3>
          <p className="settings-card-desc">选择你喜欢的界面配色方案，或自定义专属色调</p>
          <div className="theme-grid">
            {THEME_PRESETS.map(preset => (
              <button
                key={preset.id}
                className={`theme-swatch ${activeTheme === preset.id ? 'active' : ''}`}
                onClick={() => handleSwatchClick(preset)}
                title={preset.name}
              >
                <span className="theme-dots">
                  {preset.colors.map((c, i) => (
                    <span key={i} className="theme-dot" style={{ background: c }} />
                  ))}
                </span>
                <span className="theme-name">{preset.name}</span>
              </button>
            ))}
            {THEME_PRESETS.length <= 6 && (
              <button
                className={`theme-swatch custom-swatch ${activeTheme === CUSTOM_THEME_ID ? 'active' : ''}`}
                onClick={() => handleSwatchClick({ id: CUSTOM_THEME_ID })}
                title="自定义"
              >
                <span className="theme-dots custom-dots">
                  <span className="theme-dot-rainbow" />
                </span>
                <span className="theme-name">自定义</span>
              </button>
            )}
          </div>

          {/* 自定义色调面板 */}
          {showCustomPicker && (
            <div className="custom-picker">
              <div className="custom-picker-header">
                <span className="custom-picker-title">🎛 自定义色调</span>
                <button className="btn btn-xs btn-outline" onClick={resetCustom}>↺ 重置</button>
              </div>
              <div className="custom-row">
                <ColorSlider label="主色调" hueField="primaryH" satField="primaryS" lumField="primaryL" colors={customColors} onChange={updateCustomField} />
                <ColorSlider label="辅色调" hueField="secondaryH" satField="secondaryS" lumField="secondaryL" colors={customColors} onChange={updateCustomField} />
              </div>
              <div className="custom-row">
                <ColorSlider label="强调色" hueField="accentH" satField="accentS" lumField="accentL" colors={customColors} onChange={updateCustomField} />
                <ColorSlider label="背景色" hueField="bgH" satField="bgS" lumField="bgL" colors={customColors} onChange={updateCustomField} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. 账户管理（退出登录 + 切换账号合并） */}
      <div className="settings-card">
        <div className="settings-card-icon">🔑</div>
        <div className="settings-card-body">
          <h3>账户管理</h3>
          <p className="settings-card-desc">安全退出当前账号或切换到其他账号登录系统</p>
          <div className="settings-input-row">
            <button className="btn btn-ghost-danger btn-sm" onClick={handleLogout}>
              🚪 退出登录
            </button>
            <button className="btn btn-outline btn-sm" onClick={handleSwitchAccount}>
              🔄 切换账号
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
