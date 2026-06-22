import { useState, useEffect, lazy, Suspense } from 'react';
import { getCurrentUser, getSession, onAuthStateChange, signOut } from './supabase';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));

// 启动时立即应用已保存的主题
function applySavedTheme() {
  try {
    const themeId = localStorage.getItem('xingbao_theme');
    if (!themeId || themeId === 'dark-blue') return; // 默认主题不需要设置
    applyThemeVars(themeId);
  } catch {}
}

function applyThemeVars(themeId) {
  const isLight = themeId.startsWith('light');

  const THEME_MAP = {
    'dark-purple':  { primary: '270 80% 65%', secondary: '170 100% 45%', bg: '265 25% 10%' },
    'dark-green':   { primary: '150 100% 45%', secondary: '200 100% 50%', bg: '150 20% 7%' },
    'dark-orange':  { primary: '30 100% 55%', secondary: '200 100% 48%', bg: '30 20% 8%' },
    'light-cyan':   { primary: '200 90% 40%', secondary: '180 80% 30%', bg: '200 30% 94%' },
  };

  const preset = THEME_MAP[themeId];
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

  // === 关键：更新遗留 CSS 变量 ===
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
      const session = await getSession();
      if (session) {
        const currentUser = await getCurrentUser();
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
    <Suspense fallback={<AppLoader />}>
      {user ? (
        <Dashboard user={user} onLogout={async () => {
          await signOut();
          setUser(null);
        }} />
      ) : (
        <Login onLogin={setUser} />
      )}
    </Suspense>
  );
}