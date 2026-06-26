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
  const [showConfirm, setShowConfirm] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagLogs, setDiagLogs] = useState([]);

  useEffect(() => {
    const unsubscribe = api?.onUpdateStatus((s) => {
      setStatus(s);
    });
    return () => { unsubscribe?.(); };
  }, [api]);

  // 监听诊断日志
  useEffect(() => {
    const unsub = api?.onDiagnosticLog((entry) => {
      setDiagLogs((prev) => [...prev.slice(-49), entry]);
    });
    return () => { unsub?.(); };
  }, [api]);

  // 开发环境下不显示
  if (status?.devMode) return null;

  // idle 初始状态不显示（无文字且无错误消息时）
  if (status.event === 'idle' && !status.message) return null;

  const icon = STATUS_ICON[status.event] || '✓';
  const text = status.event === 'available'
    ? `${STATUS_TEXT.available} v${status.version}`
    : status.event === 'progress'
      ? `${STATUS_TEXT.progress} ${status.percent}%`
      : STATUS_TEXT[status.event] || '';

  function handleClick() {
    if (status.event === 'available') {
      // 显示确认弹窗，不直接下载
      setShowConfirm(true);
    } else if (status.event === 'downloaded') {
      api?.installUpdate();
    } else if (status.event === 'error') {
      api?.checkForUpdates();
    } else {
      setExpanded(!expanded);
    }
  }

  async function handleConfirmDownload() {
    setShowConfirm(false);
    api?.downloadUpdate();
  }

  async function runDiagnostic() {
    setDiagRunning(true);
    setDiagnostic(null);
    setDiagLogs([]);
    try {
      const result = await api?.runDiagnose();
      setDiagnostic(result);
    } catch (e) {
      setDiagnostic({ success: false, error: e.message });
    } finally {
      setDiagRunning(false);
    }
  }

  const statusColor = (s) => {
    switch (s) {
      case 'ok': return '#00e5a0';
      case 'warn': return '#ffab40';
      case 'error': return '#ff5252';
      default: return '#888';
    }
  };

  return (
    <div className="update-notifier-container">
      {/* 主状态按钮 */}
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
          <button className="btn btn-xs btn-outline" onClick={runDiagnostic} disabled={diagRunning} style={{ marginLeft: 8 }}>
            🔍 {diagRunning ? '诊断中...' : '连接诊断'}
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

      {/* 重试中提示 */}
      {status.event === 'checking' && status.retry > 0 && (
        <div className="update-error-hint" style={{ color: '#ffab40' }}>
          {status.message || `自动重试中: 第 ${status.retry + 1}/3 次...`}
        </div>
      )}

      {/* 错误回滚提示 */}
      {status.event === 'error' && (
        <div className="update-error-hint">
          <span>{status.message || '更新失败'}</span>
          <button className="btn btn-xs btn-outline" onClick={() => api?.checkForUpdates()}>
            🔄 重试
          </button>
          <button className="btn btn-xs btn-outline" onClick={runDiagnostic} disabled={diagRunning} style={{ marginLeft: 6 }}>
            🔍 {diagRunning ? '诊断中...' : '诊断'}
          </button>
          <button
            className="btn btn-xs btn-outline"
            style={{ marginLeft: 6 }}
            onClick={async () => {
              if (!api?.cleanupUpdateCache) return;
              const r = await api.cleanupUpdateCache();
              if (r?.success) {
                setStatus({ event: 'idle', message: r.message });
              }
            }}
          >
            🗑 回滚
          </button>
        </div>
      )}

      {/* 更新确认弹窗 */}
      {showConfirm && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 420, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔔</div>
            <h2 style={{ marginBottom: 8 }}>发现新版本</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 6, fontSize: 14 }}>
              新版本 <strong>v{status.version}</strong> 已可用
            </p>
            <p style={{ color: 'var(--muted-foreground)', fontSize: 12, marginBottom: 20 }}>
              下载完成后应用将自动安装并重启
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleConfirmDownload}>
                ⬇️ 立即下载更新
              </button>
              <button
                className="btn btn-outline" style={{ width: '100%' }}
                onClick={() => setShowConfirm(false)}
              >
                稍后提醒
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 诊断结果面板 */}
      {diagnostic && (
        <div className="diagnostic-panel">
          <div className="diagnostic-header">
            <span className="diagnostic-title">
              {diagnostic.success === false ? '⚠ 诊断异常' : '🔍 连接诊断报告'}
            </span>
            <button className="btn btn-xs btn-outline" onClick={() => { setDiagnostic(null); setDiagLogs([]); }}>
              关闭
            </button>
          </div>

          {diagnostic.success === false ? (
            <div className="diagnostic-error">{diagnostic.error}</div>
          ) : (
            <div className="diagnostic-results">
              {diagnostic.results
                ?.filter(r => r.step !== '__SUMMARY__')
                .map((r, i) => (
                  <div key={i} className="diagnostic-row">
                    <span className="diagnostic-indicator" style={{ color: statusColor(r.status) }}>
                      {r.status === 'ok' ? '●' : r.status === 'warn' ? '▲' : '✕'}
                    </span>
                    <span className="diagnostic-step">{r.step}</span>
                    <span className="diagnostic-detail" title={r.detail}>{r.detail}</span>
                  </div>
                ))}
              {/* 摘要行 */}
              {diagnostic.results
                ?.filter(r => r.step === '__SUMMARY__')
                .map((r, i) => (
                  <div key={`sum-${i}`} className="diagnostic-summary" style={{ color: statusColor(r.status) }}>
                    {r.detail}
                  </div>
                ))}
            </div>
          )}

          {/* 实时日志 */}
          {diagLogs.length > 0 && (
            <div className="diagnostic-logs">
              <div className="diag-logs-title">诊断日志</div>
              {diagLogs.map((log, i) => (
                <div key={i} className={`diag-log-entry diag-${log.level}`}>
                  <span className="diag-log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span className="diag-log-step">[{log.step}]</span>
                  <span className="diag-log-msg">{log.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
