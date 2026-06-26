import { useState, useEffect, useRef } from 'react';

const THEME_PRESETS = [
  { id: 'dark-blue',    name: '深蓝',   colors: ['#0f131a', '#00c8ff', '#00e5c0'], primary: '200 100% 50%', secondary: '180 100% 45%', bg: '220 25% 8%' },
  { id: 'dark-purple',  name: '紫夜',   colors: ['#1a1025', '#b388ff', '#64ffda'], primary: '270 80% 65%', secondary: '170 100% 45%', bg: '265 25% 10%' },
  { id: 'dark-green',   name: '墨绿',   colors: ['#101a14', '#69f0ae', '#40c4ff'], primary: '150 100% 45%', secondary: '200 100% 50%', bg: '150 20% 7%' },
  { id: 'dark-orange',  name: '暖橙',   colors: ['#1a1410', '#ffab40', '#00b0ff'], primary: '30 100% 55%', secondary: '200 100% 48%', bg: '30 20% 8%' },
  { id: 'light-cyan',   name: '亮青',   colors: ['#f0f8fc', '#0077cc', '#008880'], primary: '200 90% 40%', secondary: '180 80% 30%', bg: '200 30% 94%' },
];

const THEME_KEY = 'xingbao_theme';
const DISPLAY_NAME_KEY = 'xingbao_display_name';

export default function Settings({ user, onLogout, onSwitchAccount }) {
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem(DISPLAY_NAME_KEY) || user?.user_metadata?.display_name || ''
  );
  const [activeTheme, setActiveTheme] = useState(
    () => localStorage.getItem(THEME_KEY) || 'dark-blue'
  );
  const [nicknameSaved, setNicknameSaved] = useState(false);
  const [updateStatus, setUpdateStatus] = useState({ event: 'idle' });
  const [toast, setToast] = useState(null);
  const [appVersion, setAppVersion] = useState('');
  const unsubRef = useRef(null);

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

  function applyTheme(themeId) {
    const isLight = themeId.startsWith('light');
    const preset = THEME_PRESETS.find(t => t.id === themeId);
    if (!preset) return;

    const root = document.documentElement;
    root.style.setProperty('--primary', preset.primary);
    root.style.setProperty('--secondary', preset.secondary);
    root.style.setProperty('--background', preset.bg);
    root.style.setProperty('--foreground', isLight ? '200 20% 5%' : '210 20% 98%');
    root.style.setProperty('--card', isLight ? '200 30% 91%' : '220 20% 12%');
    root.style.setProperty('--border', isLight ? '200 20% 80%' : '220 20% 20%');
    root.style.setProperty('--input', isLight ? '200 30% 96%' : '220 20% 18%');
    root.style.setProperty('--muted', isLight ? '200 30% 88%' : '220 20% 18%');
    root.style.setProperty('--muted-foreground', isLight ? '200 10% 40%' : '215 15% 65%');

    // 更新遗留 CSS 变量
    if (isLight) {
      root.style.setProperty('--text', '#1a1a2e');
      root.style.setProperty('--text-secondary', '#555');
      root.style.setProperty('--bg', '#eef4f8');
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
      root.style.setProperty('--bg', 'hsl(220, 25%, 8%)');
      root.style.setProperty('--bg-card', 'hsl(220, 20%, 12%)');
      root.style.setProperty('--glass-bg', 'rgba(255, 255, 255, 0.05)');
      root.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.1)');
      root.style.setProperty('--glass-shadow', '0 8px 32px rgba(0, 0, 0, 0.37), inset 0 1px 1px rgba(255, 255, 255, 0.1)');
      root.style.setProperty('--shadow', '0 4px 16px rgba(0, 0, 0, 0.3)');
      root.style.setProperty('--shadow-lg', '0 12px 40px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.08)');
      document.body.className = 'theme-dark';
    }

    localStorage.setItem(THEME_KEY, themeId);
    setActiveTheme(themeId);
  }

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
          </div>
        </div>
      </div>

      {/* 3. 主题颜色 */}
      <div className="settings-card">
        <div className="settings-card-icon">🎨</div>
        <div className="settings-card-body">
          <h3>主题颜色</h3>
          <p className="settings-card-desc">选择你喜欢的界面配色方案</p>
          <div className="theme-grid">
            {THEME_PRESETS.map(preset => (
              <button
                key={preset.id}
                className={`theme-swatch ${activeTheme === preset.id ? 'active' : ''}`}
                onClick={() => applyTheme(preset.id)}
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
          </div>
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
