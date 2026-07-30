const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,

  // ===== 自动更新 API =====
  // 监听更新状态变化
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },
  // 手动检查更新
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  // 开始下载
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  // 安装并重启
  installUpdate: () => ipcRenderer.invoke('update:install'),

  // 获取当前应用版本号
  getAppVersion: () => ipcRenderer.invoke('app:version'),

  // ===== 在线更新诊断 =====
  // 运行完整诊断（返回各环节检查结果）
  runDiagnose: () => ipcRenderer.invoke('update:diagnose'),
  // 监听诊断日志流（实时输出诊断过程）
  onDiagnosticLog: (callback) => {
    const handler = (_event, entry) => callback(entry);
    ipcRenderer.on('update:diagnostic-log', handler);
    return () => ipcRenderer.removeListener('update:diagnostic-log', handler);
  },
  // 手动清理更新缓存（安全回滚到当前版本）
  cleanupUpdateCache: () => ipcRenderer.invoke('update:cleanup-cache'),

  // Excel 导出（含嵌入图片）→ 主进程生成 .xlsx
  exportExcel: (items) => ipcRenderer.invoke('excel:export', items),

  // ===== 窗口关闭 API =====
  // 监听主进程的关闭请求
  onCloseRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('window:close-request', handler);
    return () => ipcRenderer.removeListener('window:close-request', handler);
  },
  // 确认关闭操作
  confirmClose: (action) => ipcRenderer.send('window:confirm-close', action),
});
