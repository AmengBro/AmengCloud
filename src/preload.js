const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('dialog:openFile'),
  readFileAsBase64: (filePath) => ipcRenderer.invoke('file:readAsBase64', filePath),
  calculateSHA256: (filePath) => ipcRenderer.invoke('file:calculateSHA256', filePath),
  getTotalChunks: (filePath) => ipcRenderer.invoke('file:getTotalChunks', { filePath }),
  uploadFile: (fileData) => ipcRenderer.invoke('file:upload', fileData),
  fetchFiles: () => ipcRenderer.invoke('file:fetch'),
  deleteFile: (fileName) => ipcRenderer.invoke('file:delete', fileName),
  downloadFile: (options, updateProgress) => {
    // 监听下载进度事件
    ipcRenderer.removeAllListeners('download-progress');
    ipcRenderer.on('download-progress', (event, data) => {
      if (updateProgress) {
        updateProgress(data.current, data.total, data.message);
      }
    });
    return ipcRenderer.invoke('file:download', options);
  },
  cancelDownload: () => ipcRenderer.invoke('file:cancelDownload'),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  // 用户相关API
  login: (username, password) => ipcRenderer.invoke('user:login', { username, password }),
  register: (username, password) => ipcRenderer.invoke('user:register', { username, password }),
  getCurrentUser: () => ipcRenderer.invoke('user:getCurrent'),
  updateOwnedFiles: (userId, ownedFile) => ipcRenderer.invoke('user:updateOwnedFiles', { userId, ownedFile }),
  // 分片存储相关API
  uploadLargeFile: (params, totalChunks, updateProgress) => {
    // 监听进度事件
    ipcRenderer.removeAllListeners('upload-progress');
    ipcRenderer.on('upload-progress', (event, data) => {
      if (updateProgress) {
        updateProgress(data.current, data.total, data.message);
      }
    });
    return ipcRenderer.invoke('file:uploadLarge', params);
  },
  uploadChunk: (chunkData) => ipcRenderer.invoke('chunk:upload', chunkData),
  getChunk: (chunkId) => ipcRenderer.invoke('chunk:get', chunkId),
  deleteChunk: (chunkId) => ipcRenderer.invoke('chunk:delete', chunkId),
  listChunks: () => ipcRenderer.invoke('chunk:list'),
  // 解压相关API
  decompressBase64: (compressedBase64) => ipcRenderer.invoke('file:decompress', compressedBase64),
  // 分享相关API
  createShare: (fileName, fileId, password) => ipcRenderer.invoke('share:create', { fileName, fileId, password }),
  listShares: () => ipcRenderer.invoke('share:list'),
  getShareByFileId: (fileId) => ipcRenderer.invoke('share:getByFileId', fileId),
  getShareById: (shareId) => ipcRenderer.invoke('share:getById', shareId),
  deleteShare: (shareId) => ipcRenderer.invoke('share:delete', shareId)
});

window.addEventListener('DOMContentLoaded', () => {
  console.log('WorkDrive 已启动');
});