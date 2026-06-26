const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,

  // ===== 自动更新 API =====
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),

  // 诊断相关
  onDiagnosticLog: (callback) => {
    const handler = (_event, entry) => callback(entry);
    ipcRenderer.on('diagnostic:log', handler);
    return () => ipcRenderer.removeListener('diagnostic:log', handler);
  },
  runDiagnose: () => ipcRenderer.invoke('diagnose:run'),
  cleanupUpdateCache: () => ipcRenderer.invoke('update:cleanup-cache'),

  // ===== 窗口关闭 API =====
  onCloseRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('window:close-request', handler);
    return () => ipcRenderer.removeListener('window:close-request', handler);
  },
  confirmClose: (action) => ipcRenderer.send('window:close-confirm', action),

  // ===== Excel 导出 API =====
  exportExcel: (items) => ipcRenderer.invoke('export:excel', items),
});
