import { useState, useEffect } from 'react';
import { fetchItems, subscribeToItems } from '../supabase';
import Query from './Query';
import Storage from './Storage';
import Settings from './Settings';
import UpdateNotifier from '../components/UpdateNotifier';

export default function Dashboard({ user, onLogout }) {
  const [currentPage, setCurrentPage] = useState('home');
  const [stats, setStats] = useState({ total: 0, channels: [] });
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    // 关闭监听已提升至 App 层（App.jsx），此处不再重复注册
    loadStats();
    let sub = null;
    try {
      sub = subscribeToItems(() => loadStats());
    } catch (e) {
      console.error('实时订阅初始化失败:', e);
    }

    return () => {
      sub?.unsubscribe?.();
    };
  }, []);

  async function loadStats() {
    try {
      const { data } = await fetchItems();
      if (Array.isArray(data)) {
        const channelMap = {};
        data.forEach((item) => {
          const ch = item.sales_channel || '未分类';
          channelMap[ch] = (channelMap[ch] || 0) + 1;
        });
        setStats({
          total: data.length,
          channels: Object.entries(channelMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4),
        });
      }
    } catch (e) {
      console.error('加载统计数据失败:', e);
    }
  }

  const navItems = [
    { id: 'home', label: '首页', icon: '🏠' },
    { id: 'query', label: '查询系统', icon: '🔍' },
    { id: 'storage', label: '存储系统', icon: '📦' },
  ];

  return (
    <div className="dashboard">
      <div className="sidebar">
        <div className="sidebar-header">
          <img src="./XBlogo.png" alt="星堡" className="sidebar-logo" />
          <h2>星堡移印样品</h2>
          <div className="subtitle">仓储系统</div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${currentPage === item.id && !showSettings ? 'active' : ''}`}
              onClick={() => { setCurrentPage(item.id); setShowSettings(false); }}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
          <button
            className={`nav-item ${showSettings ? 'active' : ''}`}
            onClick={() => { setShowSettings(true); }}
          >
            <span className="nav-icon">⚙️</span>
            设置
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">
              {(user?.user_metadata?.username || user?.email || '?')[0].toUpperCase()}
            </div>
            <div>
              <div className="user-name">
                {user?.user_metadata?.username || user?.email?.split('@')[0] || '用户'}
              </div>
              <div className="user-email">{user?.email}</div>
            </div>
          </div>
          <button className="btn btn-outline btn-sm" style={{ width: '100%', color: '#fff', borderColor: 'rgba(255,255,255,0.2)' }} onClick={onLogout}>
            退出登录
          </button>
        </div>
      </div>

      <div className="main-content">
        <div className="topbar">
          <h1>{showSettings ? '设置' : navItems.find((n) => n.id === currentPage)?.label || '首页'}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <UpdateNotifier api={window.electronAPI} />
          </div>
        </div>

        <div className="content-area">
          {showSettings && (
            <Settings
              user={user}
              onLogout={onLogout}
              onSwitchAccount={() => { onLogout(); }}
            />
          )}
          {!showSettings && currentPage === 'home' && <HomePage stats={stats} onNavigate={setCurrentPage} />}
          {!showSettings && currentPage === 'query' && <Query onStatsChange={loadStats} />}
          {!showSettings && currentPage === 'storage' && <Storage onStatsChange={loadStats} onBackHome={() => setCurrentPage('home')} />}
        </div>
      </div>

    </div>
  );
}

function HomePage({ stats, onNavigate }) {
  return (
    <div className="dashboard-home">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">记录总数</div>
          <div className="stat-value">{stats.total}</div>
        </div>
        {stats.channels.map(([name, count]) => (
          <div key={name} className="stat-card">
            <div className="stat-label">{name}</div>
            <div className="stat-value">{count}</div>
          </div>
        ))}
      </div>

      <div className="feature-grid">
        <div className="feature-card" onClick={() => onNavigate('query')}>
          <div className="feature-icon">🔍</div>
          <h3>查询系统</h3>
          <p>快速查找样品信息与位置，支持多维度查询（货架号、移印编号、销售、人员、格子号、产品货号）</p>
        </div>
        <div className="feature-card" onClick={() => onNavigate('storage')}>
          <div className="feature-icon">📦</div>
          <h3>存储系统</h3>
          <p>录入新样品数据与信息，一键录入货架号、移印编号、销售、人员、图片等信息</p>
        </div>
      </div>
    </div>
  );
}