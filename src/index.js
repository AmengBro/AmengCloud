const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

// 获取头像存储目录
function getAvatarDir() {
  const userDataPath = app.getPath('userData');
  const avatarDir = path.join(userDataPath, 'avatars');
  if (!fs.existsSync(avatarDir)) {
    fs.mkdirSync(avatarDir, { recursive: true });
  }
  return avatarDir;
}

function createWindow () {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 开发模式下自动打开开发者工具
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // 允许通过 F12 打开开发者工具
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      event.preventDefault();
      // 使用 try-catch 来处理不同 Electron 版本的 API 差异
      try {
        // 尝试使用 isDevToolsOpened (旧版本)
        if (typeof mainWindow.webContents.isDevToolsOpened === 'function') {
          if (mainWindow.webContents.isDevToolsOpened()) {
            mainWindow.webContents.closeDevTools();
          } else {
            mainWindow.webContents.openDevTools();
          }
        } else {
          // 直接打开/关闭，不检查状态
          mainWindow.webContents.toggleDevTools();
        }
      } catch (e) {
        // 如果都失败，直接尝试打开
        mainWindow.webContents.openDevTools();
      }
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  
  // 注册IPC处理函数
  setupIpcHandlers();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 分片存储常量
const CHUNK_TABLE_ID = 'lPC8BdINUq';
const DATA_TABLE_ID = 'x0612PXRor';
const CHUNK_SIZE = 32768; // 32KB = 32 * 1024 (测试得出Chunks表name字段最大约40KB)

// 下载取消标志
let isDownloadCancelled = false;

function setupIpcHandlers() {
  // 打开文件选择对话框
  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (canceled) {
      return null;
    } else {
      return filePaths[0];
    }
  });
  
  // 读取文件并转换为base64
  ipcMain.handle('file:readAsBase64', async (event, filePath) => {
    try {
      const data = fs.readFileSync(filePath);
      return data.toString('base64');
    } catch (error) {
      console.error('读取文件失败:', error);
      throw error;
    }
  });

  // 分片上传大文件（在主进程中处理）
  ipcMain.handle('file:uploadLarge', async (event, { filePath, fileName, sha256, floder }) => {
    try {
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('开始分片上传大文件:', fileName);
      console.log('文件路径:', filePath);
      
      // 读取文件
      const fileBuffer = fs.readFileSync(filePath);
      const fileSize = fileBuffer.length;
      console.log('文件大小:', fileSize, 'bytes');
      
      // 转换为base64
      const base64Data = fileBuffer.toString('base64');
      console.log('base64大小:', base64Data.length, 'bytes');
      
      // 使用gzip压缩base64数据（减少存储体积）
      const zlib = require('zlib');
      const compressedBuffer = zlib.gzipSync(base64Data);
      const compressedBase64 = compressedBuffer.toString('base64');
      console.log('压缩后大小:', compressedBase64.length, 'bytes');
      console.log('压缩率:', ((base64Data.length - compressedBase64.length) / base64Data.length * 100).toFixed(2) + '%');
      
      // 计算分片数量（使用全局CHUNK_SIZE）
      const totalChunks = Math.ceil(compressedBase64.length / CHUNK_SIZE);
      console.log('总分片数:', totalChunks);
      
      // 上传每一片
      const chunkIds = [];
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, compressedBase64.length);
        const chunkData = compressedBase64.substring(start, end);
        
        console.log(`上传分片 ${i + 1}/${totalChunks}, 大小: ${chunkData.length} bytes`);
        
        // 使用https模块上传分片
         const chunkResult = await new Promise((resolve, reject) => {
           // 构建请求体
           const requestBody = { name: chunkData };
           const requestBodyStr = JSON.stringify(requestBody);
          
          console.log(`分片 ${i + 1} 请求体大小: ${requestBodyStr.length} bytes`);
          console.log(`分片 ${i + 1} 请求体前100字符: ${requestBodyStr.substring(0, 100)}...`);
          
          const options = {
            hostname: 'data.520ai.cc',
            path: `/api/bases/bseloUQsS6clyMZgVMK/tables/${CHUNK_TABLE_ID}/records`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-bm-token': apiKey,
              'Content-Length': Buffer.byteLength(requestBodyStr)
            }
          };
          
          const req = https.request(options, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => responseBody += chunk);
            res.on('end', () => {
              console.log(`分片 ${i + 1} 响应状态: ${res.statusCode}`);
              console.log(`分片 ${i + 1} 响应内容: ${responseBody.substring(0, 200)}...`);
              
              if (res.statusCode !== 200 && res.statusCode !== 201) {
                reject(new Error(`上传分片失败: ${res.statusCode}\n${responseBody}`));
              } else {
                try {
                  const data = JSON.parse(responseBody);
                  console.log(`分片 ${i + 1} 解析结果:`, data);
                  resolve(data);
                } catch (e) {
                  reject(new Error(`解析响应失败: ${e.message}\n响应内容: ${responseBody}`));
                }
              }
            });
          });
          
          req.on('error', (e) => {
            console.error(`分片 ${i + 1} 网络请求失败:`, e);
            reject(new Error(`网络请求失败: ${e.message}`));
          });
          
          req.write(requestBodyStr);
          req.end();
        });
        
        if (chunkResult && chunkResult.id) {
          chunkIds.push(chunkResult.id);
          console.log(`分片 ${i + 1} 上传成功，ID: ${chunkResult.id}`);
          
          // 发送进度更新事件
          event.sender.send('upload-progress', { current: i + 1, total: totalChunks });
        } else {
          console.error(`分片 ${i + 1} 上传失败，返回结果:`, chunkResult);
          throw new Error(`上传分片 ${i + 1} 失败`);
        }
      }
      
      // 所有分片上传完成，发送"正在创建文件信息"提示
      event.sender.send('upload-progress', { 
        current: totalChunks, 
        total: totalChunks, 
        message: '正在创建文件信息' 
      });
      
      // 上传文件记录
       const fileResult = await new Promise((resolve, reject) => {
         // 构建请求体
         const requestBody = {
           name: fileName,
           base64: JSON.stringify(chunkIds), // 分片ID列表存储在base64字段中
           sha256: sha256,
           floder: floder
         };
         const requestBodyStr = JSON.stringify(requestBody);
        
        console.log('文件记录请求体大小:', requestBodyStr.length, 'bytes');
        console.log('文件记录请求体:', requestBodyStr.substring(0, 200) + '...');
        
        const options = {
          hostname: 'data.520ai.cc',
          path: '/api/bases/bseloUQsS6clyMZgVMK/tables/x0612PXRor/records',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bm-token': apiKey,
            'Content-Length': Buffer.byteLength(requestBodyStr)
          }
        };
        
        const req = https.request(options, (res) => {
          let responseBody = '';
          res.on('data', (chunk) => responseBody += chunk);
          res.on('end', () => {
            console.log('文件记录响应状态:', res.statusCode);
            console.log('文件记录响应内容:', responseBody);
            
            if (res.statusCode !== 200 && res.statusCode !== 201) {
              reject(new Error(`上传文件记录失败: ${res.statusCode}\n${responseBody}`));
            } else {
              try {
                const data = JSON.parse(responseBody);
                resolve(data);
              } catch (e) {
                reject(new Error(`解析响应失败: ${e.message}`));
              }
            }
          });
        });
        
        req.on('error', (e) => reject(new Error(`网络请求失败: ${e.message}`)));
        req.write(requestBodyStr);
        req.end();
      });
      
      console.log('大文件上传成功:', fileResult);
      console.log('====================================');
      return fileResult;
    } catch (error) {
      console.error('大文件上传失败:', error);
      throw error;
    }
  });
  
  // 计算文件的SHA256值
  ipcMain.handle('file:calculateSHA256', async (event, filePath) => {
    try {
      const data = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256');
      hash.update(data);
      return hash.digest('hex');
    } catch (error) {
      console.error('计算SHA256失败:', error);
      throw error;
    }
  });
  
  // 解压base64数据（gzip解压）
  ipcMain.handle('file:decompress', async (event, compressedBase64) => {
    try {
      const zlib = require('zlib');
      const compressedBuffer = Buffer.from(compressedBase64, 'base64');
      const decompressedBuffer = zlib.gunzipSync(compressedBuffer);
      return decompressedBuffer.toString('base64');
    } catch (error) {
      console.error('解压失败:', error);
      throw error;
    }
  });
  
  // 上传文件到数据库
  ipcMain.handle('file:upload', async (event, fileData) => {
    try {
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('开始上传文件:', fileData.name);
      console.log('文件大小 (base64长度):', fileData.base64.length);
      console.log('SHA256:', fileData.sha256);
      console.log('Floder:', fileData.floder || 0);
      console.log('API Key:', apiKey.substring(0, 10) + '...');
      
      // 构建请求体
      const requestBody = {
        name: fileData.name,
        base64: fileData.base64,
        sha256: fileData.sha256,
        floder: fileData.floder || 0
      };
      
      if (fileData.data) {
        requestBody.fields.data = fileData.data;
      }
      
      const requestBodyStr = JSON.stringify(requestBody);
      console.log('请求体大小:', requestBodyStr.length, 'bytes');
      console.log('请求体前200字符:', requestBodyStr.substring(0, 200) + '...');
      
      // 使用https模块发送请求
      return new Promise((resolve, reject) => {
        const options = {
          hostname: 'data.520ai.cc',
          path: '/api/bases/bseloUQsS6clyMZgVMK/tables/x0612PXRor/records',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bm-token': apiKey,
            'Content-Length': Buffer.byteLength(requestBodyStr)
          }
        };
        
        const req = https.request(options, (res) => {
          console.log('响应状态:', res.statusCode);
          
          let responseBody = '';
          res.on('data', (chunk) => {
            responseBody += chunk;
          });
          
          res.on('end', () => {
            console.log('响应内容:', responseBody);
            
            if (res.statusCode !== 200 && res.statusCode !== 201) {
              const errorMessage = `上传失败: ${res.statusCode}\n响应内容: ${responseBody}`;
              console.error(errorMessage);
              reject(new Error(errorMessage));
              return;
            }
            
            try {
              const responseData = JSON.parse(responseBody);
              console.log('解析JSON成功:', responseData);
              resolve(responseData);
            } catch (jsonError) {
              console.error('解析JSON失败:', jsonError);
              reject(new Error(`解析响应失败: ${jsonError.message}\n响应内容: ${responseBody}`));
            }
          });
        });
        
        req.on('error', (e) => {
          console.error('网络请求失败:', e);
          reject(new Error(`网络请求失败: ${e.message}`));
        });
        
        req.write(requestBodyStr);
        req.end();
      });
    } catch (error) {
      console.error('上传文件失败:', error);
      throw error;
    } finally {
      console.log('====================================');
    }
  });

  // 获取文件列表（获取所有页）
  ipcMain.handle('file:fetch', async (event) => {
    try {
      const baseUrl = 'https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/x0612PXRor/records';
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('开始获取文件列表（获取所有页）');
      console.log('API Base URL:', baseUrl);
      
      let allRecords = [];
      let currentPage = 1;
      let totalPages = 1;
      
      do {
        const url = `${baseUrl}?page=${currentPage}`;
        console.log(`请求第 ${currentPage}/${totalPages} 页: ${url}`);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'x-bm-token': apiKey
          }
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`获取第${currentPage}页失败: ${response.status} ${errorText}`);
        }
        
        const responseData = await response.json();
        console.log(`第 ${currentPage} 页数据:`, responseData);
        
        if (responseData.data && Array.isArray(responseData.data)) {
          allRecords = allRecords.concat(responseData.data);
        }
        
        totalPages = responseData.last_page || 1;
        currentPage++;
        
      } while (currentPage <= totalPages);
      
      console.log(`获取完成，共 ${allRecords.length} 条记录`);
      
      // 返回与原API相同的格式，但data包含所有记录
      return {
        data: allRecords,
        total: allRecords.length,
        per_page: 15,
        current_page: 1,
        last_page: 1,
        count: allRecords.length
      };
    } catch (error) {
      console.error('获取文件列表失败:', error);
      throw error;
    } finally {
      console.log('====================================');
    }
  });

  // 删除文件
  ipcMain.handle('file:delete', async (event, fileName) => {
    try {
      // 注意：由于我们没有记录数据库中的记录ID，我们需要先获取文件列表，找到对应的记录ID，然后删除
      const url = 'https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/x0612PXRor/records';
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('开始删除文件:', fileName);
      console.log('API URL:', url);
      console.log('API Key:', apiKey.substring(0, 10) + '...'); // 只显示前10个字符
      
      // 获取所有页面的文件列表
      console.log('获取文件列表（所有页面）...');
      let allRecords = [];
      let currentPage = 1;
      let totalPages = 1;
      
      do {
        const pageUrl = `${url}?page=${currentPage}`;
        const fetchResponse = await fetch(pageUrl, {
          method: 'GET',
          headers: {
            'x-bm-token': apiKey
          }
        });
        
        if (!fetchResponse.ok) {
          throw new Error(`获取文件列表失败: ${fetchResponse.status} ${fetchResponse.statusText}`);
        }
        
        const fetchData = await fetchResponse.json();
        if (fetchData.data && Array.isArray(fetchData.data)) {
          allRecords = allRecords.concat(fetchData.data);
        }
        totalPages = fetchData.last_page || 1;
        currentPage++;
      } while (currentPage <= totalPages);
      
      console.log('获取文件列表成功，共', allRecords.length, '条记录');
      
      // 找到对应的记录
      const record = allRecords.find(item => item.name === fileName);
      if (!record) {
        throw new Error(`未找到文件: ${fileName}`);
      }
      
      console.log('找到记录:', record);
      
      // 如果是分片存储的文件，先删除对应的分片
      if (record.base64 && record.base64 !== 'floder' && record.base64 !== 'folder') {
        try {
          const chunkIds = JSON.parse(record.base64);
          if (Array.isArray(chunkIds)) {
            console.log('检测到分片存储格式，正在删除', chunkIds.length, '个分片');
            
            for (const chunkId of chunkIds) {
              console.log('删除分片:', chunkId);
              const chunkDeleteUrl = `https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/${CHUNK_TABLE_ID}/records/${chunkId}`;
              const chunkResponse = await fetch(chunkDeleteUrl, {
                method: 'DELETE',
                headers: {
                  'x-bm-token': apiKey
                }
              });
              
              if (!chunkResponse.ok) {
                console.warn(`删除分片 ${chunkId} 失败:`, chunkResponse.status);
              } else {
                console.log(`分片 ${chunkId} 删除成功`);
              }
            }
          }
        } catch (e) {
          // 不是JSON格式，说明是旧格式的base64数据，不需要删除分片
          console.log('文件为旧格式存储，无需删除分片');
        }
      }
      
      // 构建删除URL
      const deleteUrl = `${url}/${record.id}`;
      console.log('删除URL:', deleteUrl);
      
      // 发送删除请求
      console.log('发送删除请求...');
      const deleteResponse = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'x-bm-token': apiKey
        }
      });
      
      console.log('响应状态:', deleteResponse.status);
      console.log('响应状态文本:', deleteResponse.statusText);
      
      // 读取响应内容
      const deleteText = await deleteResponse.text();
      console.log('响应内容:', deleteText);
      
      if (!deleteResponse.ok) {
        const errorMessage = `删除文件失败: ${deleteResponse.status} ${deleteResponse.statusText}\n响应内容: ${deleteText}`;
        console.error(errorMessage);
        throw new Error(errorMessage);
      }
      
      try {
        const deleteData = JSON.parse(deleteText);
        console.log('解析JSON成功:', deleteData);
        return { success: true, deletedId: record.id };
      } catch (jsonError) {
        console.error('解析JSON失败:', jsonError);
        console.error('响应内容:', deleteText);
        throw new Error(`解析响应失败: ${jsonError.message}\n响应内容: ${deleteText}`);
      }
    } catch (error) {
      console.error('删除文件失败:', error);
      throw error;
    } finally {
      console.log('====================================');
    }
  });

  // 获取文件分片数量（用于在渲染进程中显示准确的分片数）
  ipcMain.handle('file:getTotalChunks', async (event, { filePath }) => {
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');
      const zlib = require('zlib');
      const compressedBuffer = zlib.gzipSync(base64Data);
      const compressedBase64 = compressedBuffer.toString('base64');
      const totalChunks = Math.ceil(compressedBase64.length / CHUNK_SIZE);
      return { success: true, totalChunks };
    } catch (error) {
      console.error('计算分片数失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 下载文件
  ipcMain.handle('file:download', async (event, { fileName, savePath }) => {
    try {
      const url = 'https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/x0612PXRor/records';
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('开始下载文件:', fileName);
      console.log('保存路径:', savePath);
      console.log('API URL:', url);
      console.log('API Key:', apiKey.substring(0, 10) + '...'); // 只显示前10个字符
      
      // 重置取消标志
      isDownloadCancelled = false;
      
      // 发送进度事件：开始下载
      event.sender.send('download-progress', { current: 0, total: 100, message: '正在查找文件...' });
      
      // 获取所有页面的文件列表
      console.log('获取文件列表（所有页面）...');
      let allRecords = [];
      let currentPage = 1;
      let totalPages = 1;
      
      do {
        const pageUrl = `${url}?page=${currentPage}`;
        const fetchResponse = await fetch(pageUrl, {
          method: 'GET',
          headers: {
            'x-bm-token': apiKey
          }
        });
        
        if (!fetchResponse.ok) {
          throw new Error(`获取文件列表失败: ${fetchResponse.status} ${fetchResponse.statusText}`);
        }
        
        const fetchData = await fetchResponse.json();
        if (fetchData.data && Array.isArray(fetchData.data)) {
          allRecords = allRecords.concat(fetchData.data);
        }
        totalPages = fetchData.last_page || 1;
        currentPage++;
      } while (currentPage <= totalPages);
      
      console.log('获取文件列表成功，共', allRecords.length, '条记录');
      
      // 发送进度事件：找到文件
      event.sender.send('download-progress', { current: 10, total: 100, message: '正在准备下载...' });
      
      // 找到对应的记录
      const record = allRecords.find(item => item.name === fileName);
      if (!record) {
        throw new Error(`未找到文件: ${fileName}`);
      }
      
      console.log('找到记录:', record);
      
      // 检查是否有数据
      if (!record.base64) {
        throw new Error(`文件没有数据: ${fileName}`);
      }
      
      let base64Data = '';
      
      // 判断是否为分片存储格式（JSON数组格式，如 "[415,416]"）
      let isChunked = false;
      if (record.base64 && record.base64.startsWith('[')) {
        try {
          const chunkIds = JSON.parse(record.base64);
          if (Array.isArray(chunkIds) && chunkIds.length > 0) {
            isChunked = true;
            console.log('文件为分片存储格式');
            console.log('分片ID列表:', chunkIds);
            
            // 获取所有分片并拼接
            let compressedBase64 = '';
            for (let i = 0; i < chunkIds.length; i++) {
              // 检查是否取消下载
              if (isDownloadCancelled) {
                throw new Error('下载已取消');
              }
              
              // 发送进度事件：获取分片
              event.sender.send('download-progress', { 
                current: 10 + Math.round((i / chunkIds.length) * 50), 
                total: 100, 
                message: `正在下载第 ${i + 1}/${chunkIds.length} 个分片` 
              });
              
              console.log('获取分片', i + 1, '/', chunkIds.length, 'ID:', chunkIds[i]);
              const chunkUrl = `https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/${CHUNK_TABLE_ID}/records/${chunkIds[i]}`;
              const chunkResponse = await fetch(chunkUrl, {
                method: 'GET',
                headers: {
                  'x-bm-token': apiKey
                }
              });
              
              if (!chunkResponse.ok) {
                throw new Error(`获取分片失败: ${chunkResponse.status} ${chunkResponse.statusText}`);
              }
              
              const chunkData = await chunkResponse.json();
              if (chunkData && chunkData.name) {
                compressedBase64 += chunkData.name;
                console.log('分片', i + 1, '获取成功，大小:', chunkData.name.length, 'bytes');
              } else {
                throw new Error(`分片数据为空: ${chunkIds[i]}`);
              }
            }
            
            console.log('所有分片拼接完成，压缩数据大小:', compressedBase64.length, 'bytes');
            
            // 发送进度事件：开始解压
            event.sender.send('download-progress', { current: 60, total: 100, message: '正在解压数据...' });
            
            // 解压数据（上传时使用了gzip压缩）
            console.log('开始解压数据...');
            const zlib = require('zlib');
            const compressedBuffer = Buffer.from(compressedBase64, 'base64');
            const decompressedBuffer = zlib.gunzipSync(compressedBuffer);
            console.log('解压完成，压缩前base64大小:', decompressedBuffer.length, 'bytes');
            
            // 发送进度事件：开始解码
            event.sender.send('download-progress', { current: 75, total: 100, message: '正在解码base64...' });
            
            // 解压后得到的是原始base64字符串，需要再解码为二进制
            console.log('解码base64为原始文件...');
            const buffer = Buffer.from(decompressedBuffer.toString(), 'base64');
            console.log('原始文件大小:', buffer.length, 'bytes');
            
            // 发送进度事件：开始保存
            event.sender.send('download-progress', { current: 90, total: 100, message: '正在保存文件...' });
            
            // 确保保存目录存在
            const fs = require('fs');
            const path = require('path');
            const saveDir = path.dirname(savePath);
            if (!fs.existsSync(saveDir)) {
              fs.mkdirSync(saveDir, { recursive: true });
              console.log('创建保存目录:', saveDir);
            }
            
            // 保存文件
            console.log('保存文件...');
            fs.writeFileSync(savePath, buffer);
            console.log('文件保存成功:', savePath);
            
            // 发送进度事件：完成
            event.sender.send('download-progress', { current: 100, total: 100, message: '下载完成' });
            
            return { success: true, path: savePath };
          }
        } catch (chunkError) {
          console.error('分片下载失败:', chunkError);
          throw new Error(`分片下载失败: ${chunkError.message}`);
        }
      }
      
      // 如果不是分片存储格式，则为旧格式
      if (!isChunked) {
        // 旧格式：直接存储base64
        console.log('文件为旧格式存储');
        base64Data = record.base64;
        
        // 发送进度事件：开始解码
        event.sender.send('download-progress', { current: 20, total: 100, message: '正在解码base64...' });
        
        // 解码base64数据并保存到文件
        console.log('解码base64数据...');
        const buffer = Buffer.from(base64Data, 'base64');
        console.log('数据大小:', buffer.length, 'bytes');
        
        // 发送进度事件：开始保存
        event.sender.send('download-progress', { current: 80, total: 100, message: '正在保存文件...' });
        
        // 确保保存目录存在
        const fs = require('fs');
        const path = require('path');
        const saveDir = path.dirname(savePath);
        if (!fs.existsSync(saveDir)) {
          fs.mkdirSync(saveDir, { recursive: true });
          console.log('创建保存目录:', saveDir);
        }
        
        // 保存文件
        console.log('保存文件...');
        fs.writeFileSync(savePath, buffer);
        console.log('文件保存成功:', savePath);
        
        // 发送进度事件：完成
        event.sender.send('download-progress', { current: 100, total: 100, message: '下载完成' });
        
        return { success: true, path: savePath };
      }
    } catch (error) {
      console.error('下载文件失败:', error);
      throw error;
    } finally {
      console.log('====================================');
    }
  });

  // 取消下载
  ipcMain.handle('file:cancelDownload', async () => {
    isDownloadCancelled = true;
    console.log('下载已取消');
    return { success: true };
  });

  // 选择保存目录
  ipcMain.handle('dialog:selectDirectory', async () => {
    const { dialog } = require('electron');
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    
    if (canceled) {
      return null;
    } else {
      return filePaths[0];
    }
  });

  // 用户登录
  ipcMain.handle('user:login', async (event, { username, password }) => {
    try {
      const userUrl = 'https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/AnIpKe3pqF/records';
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('用户登录:', username);
      
      // 获取用户列表 - 使用fetch (GET请求fetch没问题)
      const response = await fetch(userUrl, {
        method: 'GET',
        headers: {
          'x-bm-token': apiKey
        }
      });
      
      if (!response.ok) {
        throw new Error(`获取用户列表失败: ${response.status} ${response.statusText}`);
      }
      
      const responseData = await response.json();
      
      // 查找用户（通过username字段）
      const user = responseData.data.find(item => 
        (item.username && item.username.toLowerCase() === username.toLowerCase()) ||
        (item.Username && item.Username.toLowerCase() === username.toLowerCase())
      );
      
      if (!user) {
        throw new Error('用户不存在');
      }
      
      // 验证密码（简单比较，实际项目中应该用哈希）
      if ((user.password !== password) && (user.Password !== password)) {
        throw new Error('密码错误');
      }
      
      console.log('登录成功:', user);
      console.log('====================================');
      return user;
    } catch (error) {
      console.error('登录失败:', error);
      throw error;
    }
  });

  // 用户注册
  ipcMain.handle('user:register', async (event, { username, password }) => {
    try {
      const userUrl = 'https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/AnIpKe3pqF/records';
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';

      console.log('====================================');
      console.log('用户注册:', username);

      // 先检查用户是否已存在
      const checkResponse = await fetch(userUrl, {
        method: 'GET',
        headers: {
          'x-bm-token': apiKey
        }
      });

      if (!checkResponse.ok) {
        throw new Error(`获取用户列表失败: ${checkResponse.status} ${checkResponse.statusText}`);
      }

      const checkData = await checkResponse.json();
      const existingUser = checkData.data.find(item =>
        (item.username && item.username.toLowerCase() === username.toLowerCase()) ||
        (item.Username && item.Username.toLowerCase() === username.toLowerCase())
      );

      if (existingUser) {
        throw new Error('用户名已存在');
      }

      // 创建新用户 - 使用https模块
      // 注意：用户表字段名是 Username（大写开头），没有 uuid 字段
      const requestBody = {
        Username: username,
        password: password,
        owned_file: '[]'
      };
      
      const requestBodyStr = JSON.stringify(requestBody);
      console.log('请求体大小:', requestBodyStr.length, 'bytes');
      console.log('请求体:', requestBodyStr);
      
      return new Promise((resolve, reject) => {
        const options = {
          hostname: 'data.520ai.cc',
          path: '/api/bases/bseloUQsS6clyMZgVMK/tables/AnIpKe3pqF/records',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bm-token': apiKey,
            'Content-Length': Buffer.byteLength(requestBodyStr)
          }
        };
        
        const req = https.request(options, (res) => {
          console.log('响应状态:', res.statusCode);
          console.log('响应头:', res.headers);
          
          let responseBody = '';
          res.on('data', (chunk) => {
            responseBody += chunk;
          });
          
          res.on('end', () => {
            console.log('响应内容:', responseBody);
            
            if (res.statusCode !== 200 && res.statusCode !== 201) {
              const errorMessage = `创建用户失败: ${res.statusCode}\n响应内容: ${responseBody}`;
              console.error(errorMessage);
              reject(new Error(errorMessage));
              return;
            }
            
            try {
              const responseData = JSON.parse(responseBody);
              console.log('注册成功:', responseData);
              console.log('====================================');
              resolve(responseData);
            } catch (jsonError) {
              console.error('解析JSON失败:', jsonError);
              reject(new Error(`解析响应失败: ${jsonError.message}\n响应内容: ${responseBody}`));
            }
          });
        });
        
        req.on('error', (e) => {
          console.error('网络请求失败:', e);
          reject(new Error(`网络请求失败: ${e.message}`));
        });
        
        req.write(requestBodyStr);
        req.end();
      });
    } catch (error) {
      console.error('注册失败:', error);
      throw error;
    }
  });

  // 获取当前用户（默认用户username=user）
  ipcMain.handle('user:getCurrent', async () => {
    try {
      const userUrl = 'https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/AnIpKe3pqF/records';
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      const defaultUsername = 'user';
      
      console.log('====================================');
      console.log('开始获取当前用户:', defaultUsername);
      console.log('API URL:', userUrl);
      
      // 获取用户列表
      const response = await fetch(userUrl, {
        method: 'GET',
        headers: {
          'x-bm-token': apiKey
        }
      });
      
      if (!response.ok) {
        throw new Error(`获取用户列表失败: ${response.status} ${response.statusText}`);
      }
      
      const responseData = await response.json();
      console.log('获取用户列表成功:', responseData);
      
      // 查找默认用户（通过username字段，不区分大小写）
      let user = responseData.data.find(item => 
        (item.username && item.username.toLowerCase() === defaultUsername.toLowerCase()) ||
        (item.Username && item.Username.toLowerCase() === defaultUsername.toLowerCase())
      );
      
      if (!user) {
        console.log('默认用户不存在，需要创建');
        // 创建默认用户
        const createResponse = await fetch(userUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bm-token': apiKey
          },
          body: JSON.stringify({
            fields: {
              username: defaultUsername,
              owned_file: '[]'
            }
          })
        });
        
        if (!createResponse.ok) {
          throw new Error(`创建默认用户失败: ${createResponse.status} ${createResponse.statusText}`);
        }
        
        const createData = await createResponse.json();
        console.log('创建默认用户成功:', createData);
        user = createData;
      }
      
      console.log('当前用户:', user);
      console.log('====================================');
      return user;
    } catch (error) {
      console.error('获取当前用户失败:', error);
      throw error;
    }
  });

  // 更新用户信息（昵称和头像）
  ipcMain.handle('user:updateInfo', async (event, { userId, nick, photo }) => {
    try {
      const userUrl = 'https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/AnIpKe3pqF/records';
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('更新用户信息 - 参数:');
      console.log('userId:', userId);
      console.log('nick:', nick);
      console.log('photo:', photo ? '有头像数据' : '无头像数据');
      
      // 构建更新URL
      const updateUrl = `${userUrl}/${userId}`;
      console.log('更新URL:', updateUrl);
      console.log('使用HTTPS:', updateUrl.startsWith('https://'));
      
      const updateData = {};
      
      if (nick !== undefined && nick !== null) {
        updateData.nick = nick;
      }
      if (photo !== undefined && photo !== null) {
        updateData.photo = photo;
      }
      
      console.log('发送的数据:', JSON.stringify(updateData));
      
      const response = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-bm-token': apiKey
        },
        body: JSON.stringify(updateData)
      });
      
      console.log('响应状态:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log('响应内容:', errorText);
        throw new Error(`更新用户信息失败: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('更新用户信息成功:', result);
      console.log('====================================');
      return result;
    } catch (error) {
      console.error('更新用户信息失败:', error);
      throw error;
    }
  });

  // 修改密码
  ipcMain.handle('user:updatePassword', async (event, { userId, currentPassword, newPassword }) => {
    try {
      const userUrl = 'https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/AnIpKe3pqF/records';
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('修改密码 - 参数:');
      console.log('userId:', userId);
      console.log('currentPassword:', currentPassword ? '已提供' : '未提供');
      console.log('newPassword:', newPassword ? '已提供' : '未提供');
      
      // 先查询用户当前密码
      const getUserUrl = `${userUrl}/${userId}`;
      const getUserResponse = await fetch(getUserUrl, {
        method: 'GET',
        headers: {
          'x-bm-token': apiKey
        }
      });
      
      console.log('获取用户信息响应状态:', getUserResponse.status, getUserResponse.statusText);
      
      if (!getUserResponse.ok) {
        const errorText = await getUserResponse.text();
        console.log('获取用户信息失败:', errorText);
        throw new Error(`获取用户信息失败: ${getUserResponse.status} ${getUserResponse.statusText}`);
      }
      
      const userData = await getUserResponse.json();
      console.log('用户信息:', userData);
      
      // 验证当前密码
      const storedPassword = userData.password;
      console.log('存储的密码:', storedPassword);
      
      if (storedPassword !== currentPassword) {
        throw new Error('当前密码不正确');
      }
      
      // 更新密码
      const updateUrl = `${userUrl}/${userId}`;
      const updateData = {
        password: newPassword
      };
      
      console.log('发送的数据:', JSON.stringify(updateData));
      
      const updateResponse = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-bm-token': apiKey
        },
        body: JSON.stringify(updateData)
      });
      
      console.log('更新响应状态:', updateResponse.status, updateResponse.statusText);
      
      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.log('更新失败:', errorText);
        throw new Error(`更新密码失败: ${updateResponse.status} ${updateResponse.statusText}`);
      }
      
      const result = await updateResponse.json();
      console.log('修改密码成功:', result);
      console.log('====================================');
      return result;
    } catch (error) {
      console.error('修改密码失败:', error);
      throw error;
    }
  });

  // 更新用户文件列表
  ipcMain.handle('user:updateOwnedFiles', async (event, { userId, ownedFile }) => {
    try {
      const userUrl = 'https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/AnIpKe3pqF/records';
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('开始更新用户文件列表');
      console.log('用户ID:', userId);
      console.log('owned_file:', ownedFile);
      console.log('API URL:', userUrl);
      
      // 构建更新URL
      const updateUrl = `${userUrl}/${userId}`;
      console.log('更新URL:', updateUrl);
      
      // 发送更新请求
      const response = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-bm-token': apiKey
        },
        body: JSON.stringify({ owned_file: ownedFile })
      });
      
      console.log('响应状态:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log('响应内容:', errorText);
        throw new Error(`更新文件列表失败: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('更新文件列表成功:', result);
      console.log('====================================');
      return result;
    } catch (error) {
      console.error('更新文件列表失败:', error);
      throw error;
    }
  });

  // 获取预设头像路径（从photores目录）
  ipcMain.handle('avatar:getPath', async (event, filename) => {
    try {
      if (!filename || !filename.trim()) {
        return null; // 空值表示默认头像
      }

      // 判断是否为打包后的环境
      const isPackaged = app.isPackaged;

      // 构建头像文件的完整路径
      let avatarPath;
      if (isPackaged) {
        // 打包后：extraResource 会被复制到 resources 目录下
        avatarPath = path.join(process.resourcesPath, 'photores', filename);
      } else {
        // 开发环境：直接从项目根目录的 photores 获取
        avatarPath = path.join(__dirname, '../photores', filename);
      }

      console.log('====================================');
      console.log('头像路径:', avatarPath);

      // 检查文件是否存在
      if (!fs.existsSync(avatarPath)) {
        // 尝试从应用根目录获取（开发环境可能的另一种路径）
        const altPath = path.join(path.dirname(__dirname), 'photores', filename);
        if (fs.existsSync(altPath)) {
          avatarPath = altPath;
        } else {
          console.warn('头像文件不存在:', avatarPath);
          return null;
        }
      }

      // 返回 file:// 协议路径，供前端使用
      // 处理 Windows 和 Linux 路径，并对特殊字符进行编码
      let normalizedPath;
      let fileUrl;
      
      if (process.platform === 'win32') {
        // Windows: file:///C:/path/to/file.png
        normalizedPath = avatarPath.replace(/\\/g, '/');
        fileUrl = 'file:///' + encodeURI(normalizedPath);
      } else {
        // Linux/macOS: file:///path/to/file.png
        // Linux 路径已经是 /home/... 格式，只需要 file:// 前缀
        // 注意：不要加第三个斜杠，因为路径本身以 / 开头
        // file:// + /home/... = file:///home/... (正确)
        normalizedPath = avatarPath;
        fileUrl = 'file://' + encodeURI(normalizedPath);
      }
      
      return fileUrl;
    } catch (error) {
      console.error('获取头像路径失败:', error);
      return null;
    }
  });

  // 更新用户的owned_file字段
  ipcMain.handle('user:updateOwnedFiles', async (event, { userId, ownedFile }) => {
    try {
      const userUrl = 'https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/AnIpKe3pqF/records';
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('开始更新用户文件列表');
      console.log('用户ID:', userId);
      console.log('owned_file:', ownedFile);
      console.log('API URL:', userUrl);
      
      // 构建更新URL
      const updateUrl = `${userUrl}/${userId}`;
      console.log('更新URL:', updateUrl);
      
      // 发送更新请求
      const response = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-bm-token': apiKey
        },
        body: JSON.stringify({
          owned_file: ownedFile
        })
      });
      
      console.log('响应状态:', response.status);
      console.log('响应状态文本:', response.statusText);
      
      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`更新用户文件列表失败: ${response.status} ${response.statusText}\n响应内容: ${responseText}`);
      }
      
      const responseData = await response.json();
      console.log('更新用户文件列表成功:', responseData);
      console.log('====================================');
      return responseData;
    } catch (error) {
      console.error('更新用户文件列表失败:', error);
      throw error;
    }
  });

  // 检查文件是否被其他用户引用（返回引用该文件的用户ID列表）
  ipcMain.handle('file:checkFileReferences', async (event, fileId) => {
    try {
      const userUrl = 'https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/AnIpKe3pqF/records';
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('检查文件引用:', fileId);
      
      // 获取所有用户
      const response = await fetch(userUrl, {
        method: 'GET',
        headers: {
          'x-bm-token': apiKey
        }
      });
      
      if (!response.ok) {
        throw new Error(`获取用户列表失败: ${response.status}`);
      }
      
      const data = await response.json();
      const users = data.data || [];
      
      // 查找引用该文件的用户
      const referencingUsers = [];
      const fileIdStr = String(fileId); // 转为字符串用于比较
      for (const user of users) {
        if (user.owned_file) {
          let ownedFiles = [];
          try {
            ownedFiles = JSON.parse(user.owned_file);
          } catch (e) {
            ownedFiles = [];
          }
          // 使用字符串比较，避免类型不匹配
          if (ownedFiles.map(id => String(id)).includes(fileIdStr)) {
            referencingUsers.push(user.id);
          }
        }
      }
      
      console.log('引用该文件的用户:', referencingUsers);
      console.log('====================================');
      return referencingUsers;
    } catch (error) {
      console.error('检查文件引用失败:', error);
      throw error;
    }
  });

  // 上传单个分片到数据块表格
  ipcMain.handle('chunk:upload', async (event, chunkData) => {
    try {
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('开始上传分片');
      console.log('chunkData:', JSON.stringify(chunkData).length, 'bytes');
      console.log('chunkData.name存在:', !!chunkData.name);
      console.log('分片数据大小:', chunkData.name ? chunkData.name.length : 0, 'bytes');
      
      // 检查chunkData的结构
      if (!chunkData || !chunkData.name) {
        throw new Error('chunkData不完整，缺少name字段');
      }
      
      // 使用直接字段格式（测试确认此格式有效）
      const requestBody = {
        name: chunkData.name // 分片的base64数据存储在name字段中
      };
      
      const requestBodyStr = JSON.stringify(requestBody);
      console.log('请求体大小:', requestBodyStr.length, 'bytes');
      console.log('请求体前300字符:', requestBodyStr.substring(0, 300) + '...');
      
      // 使用https模块发送请求（测试确认此方式可以成功上传）
      return new Promise((resolve, reject) => {
        const options = {
          hostname: 'data.520ai.cc',
          path: `/api/bases/bseloUQsS6clyMZgVMK/tables/${CHUNK_TABLE_ID}/records`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bm-token': apiKey,
            'Content-Length': Buffer.byteLength(requestBodyStr)
          }
        };
        
        const req = https.request(options, (res) => {
          console.log('响应状态:', res.statusCode);
          console.log('响应头:', res.headers);
          
          let responseBody = '';
          res.on('data', (chunk) => {
            responseBody += chunk;
          });
          
          res.on('end', () => {
            console.log('响应内容:', responseBody);
            
            if (res.statusCode !== 200 && res.statusCode !== 201) {
              const errorMessage = `上传分片失败: ${res.statusCode}\n响应内容: ${responseBody}`;
              console.error(errorMessage);
              reject(new Error(errorMessage));
              return;
            }
            
            try {
              const responseData = JSON.parse(responseBody);
              console.log('上传分片成功:', responseData);
              console.log('====================================');
              resolve(responseData);
            } catch (jsonError) {
              console.error('解析JSON失败:', jsonError);
              reject(new Error(`解析响应失败: ${jsonError.message}\n响应内容: ${responseBody}`));
            }
          });
        });
        
        req.on('error', (e) => {
          console.error('网络请求失败:', e);
          reject(new Error(`网络请求失败: ${e.message}`));
        });
        
        req.write(requestBodyStr);
        req.end();
      });
    } catch (error) {
      console.error('上传分片失败:', error);
      throw error;
    }
  });

  // 获取单个分片
  ipcMain.handle('chunk:get', async (event, chunkId) => {
    try {
      const url = `https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/${CHUNK_TABLE_ID}/records/${chunkId}`;
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('开始获取分片:', chunkId);
      console.log('API URL:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-bm-token': apiKey
        }
      });
      
      console.log('响应状态:', response.status);
      
      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`获取分片失败: ${response.status} ${response.statusText}\n响应内容: ${responseText}`);
      }
      
      const responseData = await response.json();
      console.log('获取分片成功:', responseData);
      console.log('====================================');
      return responseData;
    } catch (error) {
      console.error('获取分片失败:', error);
      throw error;
    }
  });

  // 删除分片
  ipcMain.handle('chunk:delete', async (event, chunkId) => {
    try {
      const url = `https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/${CHUNK_TABLE_ID}/records/${chunkId}`;
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('开始删除分片:', chunkId);
      console.log('API URL:', url);
      
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'x-bm-token': apiKey
        }
      });
      
      console.log('响应状态:', response.status);
      
      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`删除分片失败: ${response.status} ${response.statusText}\n响应内容: ${responseText}`);
      }
      
      console.log('删除分片成功');
      console.log('====================================');
      return { success: true };
    } catch (error) {
      console.error('删除分片失败:', error);
      throw error;
    }
  });

  // 获取所有分片列表
  ipcMain.handle('chunk:list', async (event) => {
    try {
      const url = `https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/${CHUNK_TABLE_ID}/records`;
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
      
      console.log('====================================');
      console.log('开始获取分片列表');
      console.log('API URL:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-bm-token': apiKey
        }
      });
      
      console.log('响应状态:', response.status);
      
      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`获取分片列表失败: ${response.status} ${response.statusText}\n响应内容: ${responseText}`);
      }
      
      const responseData = await response.json();
      console.log('获取分片列表成功:', responseData);
      console.log('====================================');
      return responseData;
    } catch (error) {
      console.error('获取分片列表失败:', error);
      throw error;
    }
  });

  // ====== 分享功能 ======
  ipcMain.handle('share:create', async (event, { fileName, fileId, password }) => {
    try {
      const shareUrl = 'https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/yyZol13kp6/records';
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';

      console.log('====================================');
      console.log('创建分享:', { fileName, fileId, hasPassword: !!password });

      const response = await fetch(shareUrl, {
        method: 'POST',
        headers: {
          'x-bm-token': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: fileName,
          fileid: fileId.toString(),
          Words: password || ''
        })
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`创建分享失败: ${response.status} ${response.statusText}\n响应内容: ${responseText}`);
      }

      const responseData = await response.json();
      console.log('创建分享成功:', responseData);
      console.log('====================================');
      return responseData;
    } catch (error) {
      console.error('创建分享失败:', error);
      throw error;
    }
  });

  // 获取分享列表
  ipcMain.handle('share:list', async (event) => {
    try {
      const shareUrl = 'https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/yyZol13kp6/records';
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';

      console.log('====================================');
      console.log('获取分享列表');

      const response = await fetch(shareUrl, {
        method: 'GET',
        headers: {
          'x-bm-token': apiKey
        }
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`获取分享列表失败: ${response.status} ${response.statusText}\n响应内容: ${responseText}`);
      }

      const responseData = await response.json();
      console.log('获取分享列表成功:', responseData);
      console.log('====================================');
      return responseData;
    } catch (error) {
      console.error('获取分享列表失败:', error);
      throw error;
    }
  });

  // 根据文件ID获取分享信息
  ipcMain.handle('share:getByFileId', async (event, fileId) => {
    try {
      const shareUrl = 'https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/yyZol13kp6/records';
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';

      console.log('====================================');
      console.log('获取分享信息:', fileId);

      const response = await fetch(shareUrl, {
        method: 'GET',
        headers: {
          'x-bm-token': apiKey
        }
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`获取分享信息失败: ${response.status} ${response.statusText}\n响应内容: ${responseText}`);
      }

      const responseData = await response.json();
      const share = responseData.data.find(item => item.fileid === fileId.toString());
      console.log('获取分享信息成功:', share);
      console.log('====================================');
      return share;
    } catch (error) {
      console.error('获取分享信息失败:', error);
      throw error;
    }
  });

  // 根据分享ID获取分享信息
  ipcMain.handle('share:getById', async (event, shareId) => {
    try {
      const shareUrl = `https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/yyZol13kp6/records/${shareId}`;
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';

      console.log('====================================');
      console.log('根据ID获取分享:', shareId);

      const response = await fetch(shareUrl, {
        method: 'GET',
        headers: {
          'x-bm-token': apiKey
        }
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`获取分享失败: ${response.status} ${response.statusText}\n响应内容: ${responseText}`);
      }

      const responseData = await response.json();
      console.log('获取分享成功:', responseData);
      console.log('====================================');
      return responseData;
    } catch (error) {
      console.error('获取分享失败:', error);
      throw error;
    }
  });

  // 删除分享
  ipcMain.handle('share:delete', async (event, shareId) => {
    try {
      const shareUrl = `https://data.520ai.cc/api/bases/bseloUQsS6clyMZgVMK/tables/yyZol13kp6/records/${shareId}`;
      const apiKey = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';

      console.log('====================================');
      console.log('删除分享:', shareId);

      const response = await fetch(shareUrl, {
        method: 'DELETE',
        headers: {
          'x-bm-token': apiKey
        }
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`删除分享失败: ${response.status} ${response.statusText}\n响应内容: ${responseText}`);
      }

      console.log('删除分享成功');
      console.log('====================================');
      return { success: true };
    } catch (error) {
      console.error('删除分享失败:', error);
      throw error;
    }
  });
}
