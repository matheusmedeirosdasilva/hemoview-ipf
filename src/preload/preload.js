const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipfAnalyzer', {
  selectAndAnalyze: () => ipcRenderer.invoke('file:select-and-analyze')
});
