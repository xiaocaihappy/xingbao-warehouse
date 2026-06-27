import { useState, useEffect, lazy, Suspense, Component } from 'react';
import { getCurrentUser, getSession, onAuthStateChange, signOut } from './supabase';

// ===== React Error Boundary —— 防止渲染层崩溃导致白屏 =====
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // 写入渲染进程崩溃日志
    try {
      const log = {
        time: new Date().toISOString(),
        message: error?.message || String(error),
        stack: error?.stack || '',
        componentStack: errorInfo?.componentStack || '',
      };
      if (window.electronAPI?.isElectron) {
        localStorage.setItem('xingbao_crash_log', JSON.stringify(log));
      }
      console.error('[ErrorBoundary] React render error:', log);
    } catch {}
  }

  render() {
    if (this.state.error) {
      return (
        <div className="login-container">
          <div style={{ textAlign: 'center', maxWidth: 480, padding: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>应用发生错误</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
              {this.state.error?.message || '未知错误'}
            </p>
            <details style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 20, background: 'var(--bg-card)', padding: 12, borderRadius: 8, maxHeight: 200, overflow: 'auto' }}>
              <summary style={{ cursor: 'pointer', marginBottom: 8 }}>错误详情（点击展开）</summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                {this.state.error?.stack || ''}
                {this.state.errorInfo?.componentStack || ''}
              </pre>
            </details>
            <button
              className="btn btn-primary"
              onClick={() => {
                this.setState({ error: null, errorInfo: null });
                window.location.reload();
              }}
            >
              重新加载应用
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));

// ===== 启动时立即应用已保存的主题 =====
function applySavedTheme() {
  try {
    const themeId = localStorage.getItem('xingbao_theme');
    if (!themeId || themeId === 'dark') return; // 默认主题 (深色) 不需要额外设置

    if (themeId === 'custom') {
      const raw = localStorage.getItem('xingbao_theme_custom');
      if (!raw) return;
      const c = JSON.parse(raw);
      applyCustomVars(c);
      return;
    }

    applyPresetVars(themeId);
  } catch {}
}

// 6 个预设主题
const STARTUP_PRESETS = {
  'light':  { primary: '205 90% 42%', secondary: '175 80% 30%', bg: '210 20% 96%',  accent: '270 60% 55%', isLight: true },
  'matcha': { primary: '85 50% 42%',  secondary: '165 50% 42%', bg: '85 18% 90%',   accent: '45 60% 48%',  isLight: true },
  'pink':   { primary: '340 75% 55%', secondary: '300 50% 52%', bg: '340 12% 93%',  accent: '10 70% 60%',  isLight: true },
  'yellow': { primary: '40 75% 48%',  secondary: '25 65% 45%',  bg: '42 25% 94%',   accent: '200 60% 50%', isLight: true },
  'blue':   { primary: '205 80% 52%', secondary: '190 55% 46%', bg: '205 25% 92%',  accent: '250 60% 58%', isLight: true },
};

function applyPresetVars(themeId) {
  const preset = STARTUP_PRESETS[themeId];
  if (!preset) return;
  const root = document.documentElement;
  root.style.setProperty('--primary', preset.primary);
  root.style.setProperty('--secondary', preset.secondary);
  root.style.setProperty('--background', preset.bg);
  root.style.setProperty('--accent', preset.accent);
  setCommonVars(root, preset.isLight);
}

function applyCustomVars(c) {
  const root = document.documentElement;
  root.style.setProperty('--primary', `${c.primaryH || 200} ${c.primaryS || 100}% ${c.primaryL || 50}%`);
  root.style.setProperty('--secondary', `${c.secondaryH || 170} ${c.secondaryS || 100}% ${c.secondaryL || 45}%`);
  root.style.setProperty('--background', `${c.bgH || 220} ${c.bgS || 25}% ${c.bgL || 8}%`);
  root.style.setProperty('--accent', `${c.accentH || 270} ${c.accentS || 80}% ${c.accentL || 60}%`);
  setCommonVars(root, (c.bgL || 8) > 50);
}

function setCommonVars(root, isLight) {
  root.style.setProperty('--foreground', isLight ? '200 20% 5%' : '210 20% 98%');
  root.style.setProperty('--card', isLight ? '200 30% 91%' : '220 20% 12%');
  root.style.setProperty('--border', isLight ? '200 20% 80%' : '220 20% 20%');
  root.style.setProperty('--input', isLight ? '200 30% 96%' : '220 20% 18%');
  root.style.setProperty('--muted', isLight ? '200 30% 88%' : '220 20% 18%');
  root.style.setProperty('--muted-foreground', isLight ? '200 10% 40%' : '215 15% 65%');

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
}

// 页面加载时立即执行
applySavedTheme();

function AppLoader() {
  return (
    <div className="login-container">
      <div className="loading">
        <div className="spinner" />
        <p style={{ marginTop: 16 }}>加载中...</p>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCloseDialog, setShowCloseDialog] = useState(false);

  // ===== 全局关闭请求监听 =====
  // 注册在 App 顶层，无论登录/loading/断网状态，始终能响应关闭请求
  useEffect(() => {
    if (!window.electronAPI?.onCloseRequest) return;
    const unsub = window.electronAPI.onCloseRequest(() => {
      setShowCloseDialog(true);
    });
    return unsub;
  }, []);

  // ===== 会话恢复 & 认证状态监听 =====
  useEffect(() => {
    checkSession();
    const { data: subscription } = onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setUser(session?.user || null);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });
    return () => subscription?.unsubscribe();
  }, []);

  async function checkSession() {
    try {
      // 添加超时保护：断网时 Supabase 请求可能长时间挂起
      const session = await Promise.race([
        getSession(),
        new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      if (session) {
        const currentUser = await Promise.race([
          getCurrentUser(),
          new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
        setUser(currentUser);
      }
    } catch (e) {
      console.error('Session check failed:', e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <AppLoader />;
  }

  return (
    <ErrorBoundary>
      <Suspense fallback={<AppLoader />}>
        {user ? (
          <Dashboard user={user} onLogout={async () => {
            await signOut();
            setUser(null);
          }} />
        ) : (
          <Login onLogin={setUser} />
        )}

        {/* 全局关闭窗口询问弹窗 — 断网时仍能立即响应 */}
        {showCloseDialog && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 380, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔔</div>
            <h2 style={{ marginBottom: 8 }}>关闭窗口</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
              请选择要执行的操作
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={() => {
                  setShowCloseDialog(false);
                  window.electronAPI?.confirmClose('minimize');
                }}
              >
                📥 最小化到托盘
              </button>
              <button
                className="btn btn-outline"
                style={{ width: '100%' }}
                onClick={() => {
                  setShowCloseDialog(false);
                  window.electronAPI?.confirmClose('quit');
                }}
              >
                ❌ 退出程序
              </button>
              <button
                className="btn btn-sm"
                style={{
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: 'none',
                  cursor: 'pointer',
                  marginTop: 4,
                }}
                onClick={() => {
                  setShowCloseDialog(false);
                  window.electronAPI?.confirmClose('cancel');
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      </Suspense>
    </ErrorBoundary>
  );
}