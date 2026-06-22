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
});
