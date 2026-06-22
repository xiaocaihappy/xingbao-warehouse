import { useState, useEffect } from 'react';

const STATUS_ICON = {
  checking: '⏳',
  available: '🔔',
  'no-update': '✓',
  progress: '⬇',
  downloaded: '✅',
  error: '⚠',
  idle: '✓',
};

const STATUS_TEXT = {
  checking: '检查更新...',
  available: '发现新版本',
  'no-update': '已是最新版本',
  progress: '下载中',
  downloaded: '下载完成，重启后生效',
  error: '更新失败',
  idle: '',
};

export default function UpdateNotifier({ api }) {
  const [status, setStatus] = useState({ event: 'idle' });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // 监听 main process 发来的更新状态
    const unsubscribe = api?.onUpdateStatus((s) => {
      setStatus(s);
    });

    return () => {
      unsubscribe?.();
    };
  }, [api]);

  // 开发环境下不显示
  if (status?.devMode) return null;

  // idle 初始状态不显示（无文字时）
  if (status.event === 'idle' && !status.message) return null;

  const icon = STATUS_ICON[status.event] || '✓';
  const text = status.event === 'available'
    ? `${STATUS_TEXT.available} v${status.version}`
    : status.event === 'progress'
      ? `${STATUS_TEXT.progress} ${status.percent}%`
      : STATUS_TEXT[status.event] || '';

  function handleClick() {
    if (status.event === 'available') {
      api?.downloadUpdate();
    } else if (status.event === 'downloaded') {
      api?.installUpdate();
    } else if (status.event === 'error') {
      api?.checkForUpdates();
    } else {
      setExpanded(!expanded);
    }
  }

  return (
    <div className="update-notifier-container">
      <button
        className={`update-badge ${status.event}`}
        onClick={handleClick}
        title={`${text}${status.message ? '\n' + status.message : ''}`}
      >
        <span className="update-icon">{icon}</span>
        <span className="update-text">{text}</span>
      </button>

      {/* 展开的操作区 */}
      {expanded && status.event !== 'available' && status.event !== 'downloaded' && status.event !== 'progress' && (
        <div className="update-panel">
          <button className="btn btn-xs btn-outline" onClick={() => api?.checkForUpdates()}>
            🔄 手动检查更新
          </button>
        </div>
      )}

      {/* 下载进度条 */}
      {status.event === 'progress' && (
        <div className="update-progress-bar">
          <div
            className="update-progress-fill"
            style={{ width: `${status.percent || 0}%` }}
          />
        </div>
      )}

      {/* 错误回滚提示 */}
      {status.event === 'error' && (
        <div className="update-error-hint">
          更新失败，当前版本不受影响。
          <button className="btn btn-xs btn-outline" onClick={() => api?.checkForUpdates()}>
            🔄 重试
          </button>
        </div>
      )}
    </div>
  );
}
