let fileDataList = [];
let currentDirectory = 0; // 当前目录ID，0表示根目录
let directoryPath = []; // 目录路径历史
let isNavigating = false; // 防止快速点击导致的重复导航
let currentUser = null; // 当前用户信息

// 应用版本常量
const APP_VERSION = '1.2.0';
const APP_NAME = 'AmengCloud';
const APP_DESCRIPTION = '一个高效的云端文件管理应用';

// 分片存储常量
const CHUNK_SIZE = 32768; // 32KB（与主进程一致，测试得出Chunks表name字段最大约40KB）

let currentOperateId = -1;
let loginEventsBound = false;
let registerEventsBound = false;

console.log('runner.js 开始加载');

// 显示加载遮罩
function showLoading(message = '加载中...') {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.classList.remove('hidden');
        const loadingText = loadingOverlay.querySelector('span');
        if (loadingText) {
            loadingText.textContent = message;
        }
    }
}

// 隐藏加载遮罩
function hideLoading() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
    }
}

// 显示文件夹加载指示器
function showFolderLoading() {
    const loadingIndicator = document.getElementById('folderLoadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.classList.add('visible');
    }
}

// 隐藏文件夹加载指示器
function hideFolderLoading() {
    const loadingIndicator = document.getElementById('folderLoadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.classList.remove('visible');
    }
}

// 模态确认对话框
function showConfirmModal(message) {
    return new Promise((resolve) => {
        // 创建模态框覆盖层
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        modalOverlay.style.display = 'flex';
        
        // 创建模态框
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.maxWidth = '400px';
        
        modal.innerHTML = `
            <div class="modal-header">
                <h3>确认操作</h3>
                <button class="modal-close" id="confirmModalClose">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="modal-body">
                <p>${message}</p>
            </div>
            <div class="modal-footer">
                <button class="btn" id="confirmModalCancel">取消</button>
                <button class="btn btn-danger" id="confirmModalSubmit">确认</button>
            </div>
        `;
        
        modalOverlay.appendChild(modal);
        document.body.appendChild(modalOverlay);
        
        // 添加显示动画
        setTimeout(() => {
            modalOverlay.classList.add('active');
        }, 10);
        
        const closeModal = (result) => {
            modalOverlay.classList.remove('active');
            setTimeout(() => {
                document.body.removeChild(modalOverlay);
                resolve(result);
            }, 300);
        };
        
        // 绑定事件
        const closeBtn = document.getElementById('confirmModalClose');
        const cancelBtn = document.getElementById('confirmModalCancel');
        const submitBtn = document.getElementById('confirmModalSubmit');

        console.log('确认对话框按钮:', { closeBtn, cancelBtn, submitBtn });
        console.log('cancelBtn.parentElement:', cancelBtn ? cancelBtn.parentElement : null);
        console.log('cancelBtn.offsetParent:', cancelBtn ? cancelBtn.offsetParent : null);
        console.log('modalOverlay是否在body中:', document.body.contains(modalOverlay));

        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('关闭按钮被点击');
            closeModal(false);
        });
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('取消按钮被点击');
            closeModal(false);
        });
        modalOverlay.addEventListener('click', (e) => {
            console.log('遮罩被点击, e.target:', e.target);
            if (e.target === modalOverlay) {
                console.log('点击遮罩关闭');
                closeModal(false);
            }
        });
        submitBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('确认按钮被点击');
            closeModal(true);
        });
    });
}
const menu = document.getElementById('contextMenu');
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const backButton = document.getElementById('backButton');
const pathNav = document.getElementById('pathNav');

// 获取当前用户
async function getCurrentUser() {
    try {
        currentUser = await window.electronAPI.getCurrentUser();
        console.log('当前用户:', currentUser);
        
        // 检查用户的owned_file是否为空
        const ownedFileIds = getUserOwnedFileIds();
        if (ownedFileIds.length === 0) {
            console.log('用户的owned_file为空，需要关联所有现有文件');
            // 获取所有文件
            try {
                const response = await window.electronAPI.fetchFiles();
                if (response && response.data) {
                    // 提取所有文件ID（包括文件夹）
                    const allFileIds = response.data.map(item => item.id);
                    console.log('所有文件ID:', allFileIds);
                    // 更新用户的owned_file
                    await updateUserOwnedFiles(allFileIds);
                    // 更新currentUser的owned_file
                    currentUser.owned_file = JSON.stringify(allFileIds);
                }
            } catch (fileError) {
                console.error('获取文件列表失败:', fileError);
            }
        }
        
        return currentUser;
    } catch (error) {
        console.error('获取当前用户失败:', error);
        throw error;
    }
}

// 更新用户的文件列表
async function updateUserOwnedFiles(fileIds) {
    if (!currentUser || !currentUser.id) {
        console.error('用户信息无效，无法更新文件列表');
        return;
    }
    try {
        const ownedFileJson = JSON.stringify(fileIds);
        await window.electronAPI.updateOwnedFiles(currentUser.id, ownedFileJson);
        console.log('更新用户文件列表成功');
        // 同步更新本地currentUser的owned_file
        currentUser.owned_file = ownedFileJson;
        console.log('本地用户文件列表已同步更新');
    } catch (error) {
        console.error('更新用户文件列表失败:', error);
    }
}

// 获取用户拥有的文件ID列表
function getUserOwnedFileIds() {
    if (!currentUser || !currentUser.owned_file) {
        return [];
    }
    try {
        return JSON.parse(currentUser.owned_file);
    } catch (error) {
        console.error('解析owned_file失败:', error);
        return [];
    }
}

// 判断是否为Administrator用户
function isAdministrator() {
    return currentUser && 
           ((currentUser.username && currentUser.username.toLowerCase() === 'administrator') ||
            (currentUser.Username && currentUser.Username.toLowerCase() === 'administrator'));
}

// 判断是否为超级管理员（uuid=0的用户可以访问所有文件）
function isSuperAdmin() {
    return currentUser && 
           ((currentUser.uuid === 0) || 
            (currentUser.uuid === '0') ||
            (currentUser.UUID === 0) ||
            (currentUser.UUID === '0') ||
            isAdministrator());
}

// 将base64字符串分片
function splitBase64IntoChunks(base64Data) {
    const chunks = [];
    let start = 0;
    const length = base64Data.length;
    
    while (start < length) {
        const end = Math.min(start + CHUNK_SIZE, length);
        chunks.push(base64Data.substring(start, end));
        start = end;
    }
    
    return chunks;
}

// 上传文件分片到数据库（所有文件都在主进程处理分片上传）
async function uploadFileWithChunks(fileName, base64Data, sha256, floder, filePath, totalChunks, updateProgress) {
    console.log('开始上传文件:', fileName);
    console.log('文件大小:', base64Data.length, 'bytes');
    
    // 所有文件都在主进程中处理分片上传
    console.log('使用主进程分片上传');
    
    // 调用主进程的大文件上传API（传入进度回调）
    const result = await window.electronAPI.uploadLargeFile({
        filePath: filePath,
        fileName: fileName,
        sha256: sha256,
        floder: floder
    }, totalChunks, updateProgress);
    
    console.log('文件上传成功:', result);
    return result;
}

// 下载文件（支持分片拼接和旧文件兼容）
async function downloadFileWithChunks(fileRecord, savePath) {
    console.log('开始下载文件:', fileRecord.name);
    console.log('fileRecord.base64:', fileRecord.base64);
    
    // 判断存储格式：base64字段是JSON数组（分片存储）还是base64字符串（旧格式）
    let chunkIds = null;
    let isChunked = false;
    
    if (fileRecord.base64 && fileRecord.base64 !== 'floder' && fileRecord.base64 !== 'folder') {
        try {
            // 尝试解析为JSON数组（分片存储格式）
            const parsed = JSON.parse(fileRecord.base64);
            if (Array.isArray(parsed)) {
                chunkIds = parsed;
                isChunked = true;
                console.log('识别为分片存储格式，分片数:', chunkIds.length);
            }
        } catch (e) {
            // 不是JSON，说明是旧格式的base64数据
            console.log('识别为旧格式base64存储');
        }
    }
    
    if (isChunked && chunkIds) {
        // 分片存储格式
        console.log('文件为分片存储格式');
        
        try {
            // 获取所有分片
            const chunks = [];
            for (let i = 0; i < chunkIds.length; i++) {
                console.log('获取分片', i + 1, '/', chunkIds.length, 'ID:', chunkIds[i]);
                const chunkResult = await window.electronAPI.getChunk(chunkIds[i]);
                if (chunkResult && chunkResult.data && chunkResult.data.name) {
                    chunks.push(chunkResult.data.name);
                } else {
                    throw new Error('获取分片失败: ' + chunkIds[i]);
                }
            }
            
            // 拼接所有分片
            const compressedBase64 = chunks.join('');
            console.log('拼接完成，压缩后大小:', compressedBase64.length, 'bytes');
            
            // 解压数据（上传时使用了gzip压缩）
            console.log('开始解压数据...');
            const base64Data = await window.electronAPI.decompressBase64(compressedBase64);
            console.log('解压完成，原始大小:', base64Data.length, 'bytes');
            
            // 解码并保存
            return saveBase64ToFile(base64Data, savePath);
        } catch (error) {
            console.error('分片下载失败:', error);
            throw error;
        }
    } else {
        // 旧格式：直接存储base64
        console.log('文件为旧格式存储');
        if (!fileRecord.base64 || fileRecord.base64 === 'floder' || fileRecord.base64 === 'folder') {
            throw new Error('文件没有数据或为文件夹');
        }
        return saveBase64ToFile(fileRecord.base64, savePath);
    }
}

// 将base64数据保存为文件
function saveBase64ToFile(base64Data, savePath) {
    // 这部分逻辑需要在主进程中处理
    // 返回数据供主进程处理
    return { base64: base64Data, savePath: savePath };
}

// 刷新Administrator用户的owned_file（获取所有文件ID）
async function refreshAdministratorOwnedFiles() {
    try {
        const response = await window.electronAPI.fetchFiles();
        if (response && response.data) {
            const allFileIds = response.data.map(item => item.id);
            console.log('Administrator更新所有文件ID:', allFileIds);
            await updateUserOwnedFiles(allFileIds);
        }
    } catch (error) {
        console.error('刷新Administrator文件列表失败:', error);
    }
}

// 网络错误提示元素
const networkError = document.getElementById('networkError');
const retryButton = document.getElementById('retryButton');

// 检测网络连接
function checkNetworkConnection() {
    return navigator.onLine;
}

// 显示网络错误提示
function showNetworkError() {
    networkError.style.display = 'flex';
}

// 隐藏网络错误提示
function hideNetworkError() {
    networkError.style.display = 'none';
}

// 重新加载应用
async function reloadApp() {
    try {
        hideNetworkError();
        
        // 重新获取文件列表
        await fetchFilesFromDatabase();
        
        // 更新路径导航
        await updatePathNav();
        
        showNotification('网络连接已恢复！');
    } catch (error) {
        console.error('重新加载应用失败:', error);
        showNetworkError();
    }
}

document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOMContentLoaded 事件触发');

    // 初始化主题（确保暗黑模式立即生效）
    initTheme();

    // 检测网络连接
    if (!checkNetworkConnection()) {
        showNetworkError();
        hideLoading(); // 即使网络错误也要隐藏加载遮罩
        return;
    }

    // 检查是否有记住的登录状态
    const rememberedUser = localStorage.getItem('rememberedUser');
    if (rememberedUser) {
        try {
            const { username, password } = JSON.parse(rememberedUser);
            console.log('找到记住的登录状态:', username);

            // 自动登录
            showLoading('正在恢复登录...');
            const user = await window.electronAPI.login(username, password);
            currentUser = user;

            // 显示主应用
            const loginContainer = document.getElementById('loginContainer');
            const mainApp = document.getElementById('mainApp');
            loginContainer.style.display = 'none';
            mainApp.style.display = 'flex';

            // 初始化主应用
            try {
                await initMainApp();
            } finally {
                hideLoading();
            }
            return;
        } catch (error) {
            console.log('自动登录失败，将显示登录界面:', error);
            // 自动登录失败，清除保存的状态
            localStorage.removeItem('rememberedUser');
            hideLoading();
        }
    }

    // 显示登录界面
    showLoginScreen();

    // 页面初始化完成，隐藏加载遮罩
    hideLoading();
});

// 更新用户名显示（优先显示昵称）
function updateUsernameDisplay() {
    const usernameSpan = document.getElementById('currentUsername');
    if (usernameSpan && currentUser) {
        // 如果没有设置昵称，默认显示为当前用户名
        const nickname = currentUser.nick || currentUser.username || currentUser.Username || '用户';
        usernameSpan.textContent = nickname;
    }
}

// 退出登录
// 用户中心模态框
async function showUserCenterModal() {
    console.log('showUserCenterModal 被调用');
    const userCenterModalOverlay = document.createElement('div');
    userCenterModalOverlay.className = 'modal-overlay active';
    userCenterModalOverlay.style.display = 'flex';
    
    const userCenterModal = document.createElement('div');
    userCenterModal.className = 'modal';
    userCenterModal.style.maxWidth = '380px';
    
    // 获取用户名和昵称
    const username = currentUser?.Username || currentUser?.username || '用户';
    const nickname = currentUser?.nick || username;
    
    // 构建显示名称：昵称(用户名)
    const displayName = nickname === username ? username : `${nickname}(${username})`;
    
    // 获取头像路径
    let avatarStyle = 'background: var(--primary-color);';
    let avatarContent = '<i class="fa-solid fa-user" style="font-size: 32px; color: white;"></i>';
    if (currentUser?.photo && currentUser.photo.trim()) {
        const avatarPath = await window.electronAPI.getAvatarPath(currentUser.photo);
        if (avatarPath) {
            avatarStyle = `background: url(${avatarPath}) center/cover;`;
            avatarContent = '';
        }
    }
    
    userCenterModal.innerHTML = `
        <div class="modal-header">
            <h3>用户中心</h3>
            <button class="modal-close" id="userCenterModalClose">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="modal-body" style="padding: 0;">
            <div style="text-align: center; padding: 24px 20px; border-bottom: 1px solid var(--border-color);">
                <div style="width: 72px; height: 72px; border-radius: 50%; ${avatarStyle} display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px;">
                    ${avatarContent}
                </div>
                <h4 style="margin: 0 0 4px 0;">${displayName}</h4>
                <p style="margin: 0; font-size: 13px; color: var(--text-secondary);">欢迎使用 AmengCloud</p>
            </div>
            <div style="padding: 12px 0;">
                <button class="user-center-item" id="userCenterSettings">
                    <i class="fa-solid fa-gear"></i>
                    <span>设置</span>
                    <i class="fa-solid fa-chevron-right" style="margin-left: auto;"></i>
                </button>
                <button class="user-center-item" id="userCenterAbout">
                    <i class="fa-solid fa-circle-info"></i>
                    <span>关于</span>
                    <i class="fa-solid fa-chevron-right" style="margin-left: auto;"></i>
                </button>
            </div>
            <div style="padding: 16px 20px; border-top: 1px solid var(--border-color);">
                <button class="btn btn-danger" id="userCenterLogout" style="width: 100%;">
                    <i class="fa-solid fa-right-from-bracket"></i>
                    退出登录
                </button>
            </div>
        </div>
    `;
    
    userCenterModalOverlay.appendChild(userCenterModal);
    document.body.appendChild(userCenterModalOverlay);
    console.log('用户中心模态框已添加到页面');
    
    const closeModal = () => {
        document.body.removeChild(userCenterModalOverlay);
    };
    
    document.getElementById('userCenterModalClose').addEventListener('click', closeModal);
    userCenterModalOverlay.addEventListener('click', (e) => {
        if (e.target === userCenterModalOverlay) closeModal();
    });
    
    document.getElementById('userCenterLogout').addEventListener('click', () => {
        closeModal();
        logout();
    });
    
    document.getElementById('userCenterSettings').addEventListener('click', () => {
        closeModal();
        showSettingsModal();
    });
    
    document.getElementById('userCenterAbout').addEventListener('click', () => {
        showAboutModal();
    });
}

// 显示关于模态框
function showAboutModal() {
    const aboutModalOverlay = document.createElement('div');
    aboutModalOverlay.className = 'modal-overlay active';
    aboutModalOverlay.style.display = 'flex';
    
    const aboutModal = document.createElement('div');
    aboutModal.className = 'modal';
    aboutModal.style.maxWidth = '360px';
    aboutModal.style.textAlign = 'center';
    
    aboutModal.innerHTML = `
        <div class="modal-header">
            <h3>关于</h3>
            <button class="modal-close" id="aboutModalClose">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="modal-body" style="padding: 32px 24px;">
            <div style="width: 80px; height: 80px; border-radius: 16px; background: linear-gradient(135deg, var(--primary-color), var(--primary-hover)); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.15);">
                <i class="fa-solid fa-cloud" style="font-size: 36px; color: white;"></i>
            </div>
            <h2 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 600;">${APP_NAME}</h2>
            <p style="margin: 0 0 16px 0; color: var(--text-secondary); font-size: 14px;">${APP_DESCRIPTION}</p>
            <div style="background: var(--bg-secondary); border-radius: 8px; padding: 12px 20px; margin-bottom: 20px;">
                <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">版本号</div>
                <div style="font-size: 16px; font-weight: 500;">v${APP_VERSION}</div>
            </div>
            <p style="margin: 0; font-size: 12px; color: var(--text-secondary);">
                版权所有 2024-2026 ${APP_NAME} Team
            </p>
        </div>
        <div class="modal-footer" style="justify-content: center; border-top: 1px solid var(--border-color); padding: 16px;">
            <button class="btn btn-primary" id="aboutCloseBtn" style="min-width: 120px;">确定</button>
        </div>
    `;
    
    aboutModalOverlay.appendChild(aboutModal);
    document.body.appendChild(aboutModalOverlay);
    
    const closeAboutModal = () => {
        document.body.removeChild(aboutModalOverlay);
    };
    
    document.getElementById('aboutModalClose').addEventListener('click', closeAboutModal);
    document.getElementById('aboutCloseBtn').addEventListener('click', closeAboutModal);
    aboutModalOverlay.addEventListener('click', (e) => {
        if (e.target === aboutModalOverlay) closeAboutModal();
    });
}

// 压缩图片并转换为base64
async function compressImage(file, maxWidth = 200, maxHeight = 200, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // 计算缩放比例
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth) {
                    const scale = maxWidth / width;
                    width = maxWidth;
                    height = height * scale;
                }
                
                if (height > maxHeight) {
                    const scale = maxHeight / height;
                    height = maxHeight;
                    width = width * scale;
                }
                
                // 创建canvas并绘制压缩后的图片
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // 将canvas转换为base64
                const base64 = canvas.toDataURL('image/jpeg', quality);
                resolve(base64);
            };
            
            img.onerror = () => reject(new Error('图片加载失败'));
            img.src = e.target.result;
        };
        
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsDataURL(file);
    });
}

// 设置界面模态框
async function showSettingsModal() {
    const settingsModalOverlay = document.createElement('div');
    settingsModalOverlay.className = 'modal-overlay active';
    settingsModalOverlay.style.display = 'flex';
    
    const settingsModal = document.createElement('div');
    settingsModal.className = 'modal';
    settingsModal.style.maxWidth = '500px';
    
    // 获取用户当前的昵称和头像
    const username = currentUser?.Username || currentUser?.username || '用户';
    const nickname = currentUser?.nick || username;
    const currentPhoto = currentUser?.photo || ''; // 空字符串表示默认头像
    
    // 获取所有预设头像的路径
    const presetAvatars = [
        { filename: '', name: '默认' },        // 默认头像（空字符串）
        { filename: '1.jpeg', name: '头像1' },
        { filename: '2.jpg', name: '头像2' },
        { filename: '3.png', name: '头像3' },
        { filename: '4.png', name: '头像4' },
        { filename: '5.png', name: '头像5' },
        { filename: '6.png', name: '头像6' },
        { filename: '7.png', name: '头像7' },
        { filename: '8.png', name: '头像8' },
        { filename: '9.png', name: '头像9' },
        { filename: '10.jpg', name: '头像10' },
    ];
    
    // 预先获取所有头像路径
    const avatarPaths = {};
    for (const avatar of presetAvatars) {
        if (avatar.filename) {
            avatarPaths[avatar.filename] = await window.electronAPI.getAvatarPath(avatar.filename);
        }
    }
    
    settingsModal.innerHTML = `
        <div class="modal-header">
            <h3>设置</h3>
            <button class="modal-close" id="settingsModalClose">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="modal-body">
            <!-- 头像设置 -->
            <div class="form-group" style="margin-bottom: 24px;">
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">头像</label>
                <div id="avatarSelector" style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px;">
                    <!-- 预设头像将在这里动态生成 -->
                </div>
            </div>
            
            <!-- 昵称设置 -->
            <div class="form-group">
                <label for="settingsNickname">昵称</label>
                <input type="text" id="settingsNickname" class="form-input" placeholder="请输入昵称" value="${nickname}">
            </div>
            
            <!-- 修改密码按钮 -->
            <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--border-color);">
                <button class="btn btn-secondary" id="changePasswordBtn" style="width: 100%;">
                    <i class="fa-solid fa-key" style="margin-right: 8px;"></i>
                    修改密码
                </button>
            </div>
            
            <!-- 保存按钮 -->
            <div style="display: flex; gap: 12px; margin-top: 24px;">
                <button class="btn btn-secondary" id="settingsCancel" style="flex: 1;">
                    取消
                </button>
                <button class="btn btn-primary" id="settingsSave" style="flex: 1;">
                    保存
                </button>
            </div>
        </div>
    `;
    
    settingsModalOverlay.appendChild(settingsModal);
    document.body.appendChild(settingsModalOverlay);
    
    let selectedAvatar = currentPhoto; // 保存选中的头像文件名
    
    // 渲染预设头像选择器
    const avatarSelector = document.getElementById('avatarSelector');
    presetAvatars.forEach(avatar => {
        const avatarItem = document.createElement('div');
        avatarItem.style.width = '64px';
        avatarItem.style.height = '64px';
        avatarItem.style.borderRadius = '50%';
        avatarItem.style.cursor = 'pointer';
        avatarItem.style.transition = 'all 0.2s';
        avatarItem.style.border = avatar.filename === currentPhoto ? '3px solid var(--primary-color)' : '2px solid transparent';
        
        if (avatar.filename && avatarPaths[avatar.filename]) {
            avatarItem.style.background = `url(${avatarPaths[avatar.filename]}) center/cover`;
        } else {
            avatarItem.style.background = 'var(--primary-color)';
            // 默认头像显示用户图标
            avatarItem.innerHTML = '<i class="fa-solid fa-user" style="font-size: 24px; color: white; display: flex; align-items: center; justify-content: center; height: 100%;"></i>';
        }
        
        avatarItem.title = avatar.name;
        
        // 悬停效果
        avatarItem.addEventListener('mouseenter', () => {
            avatarItem.style.transform = 'scale(1.1)';
            avatarItem.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        });
        
        avatarItem.addEventListener('mouseleave', () => {
            avatarItem.style.transform = 'scale(1)';
            avatarItem.style.boxShadow = 'none';
        });
        
        // 点击选择
        avatarItem.addEventListener('click', () => {
            // 取消其他选中状态
            avatarSelector.querySelectorAll('div').forEach(item => {
                item.style.border = '2px solid transparent';
            });
            // 设置当前选中状态
            avatarItem.style.border = '3px solid var(--primary-color)';
            selectedAvatar = avatar.filename;
        });
        
        avatarSelector.appendChild(avatarItem);
    });
    
    const closeModal = () => {
        document.body.removeChild(settingsModalOverlay);
    };
    
    document.getElementById('settingsModalClose').addEventListener('click', closeModal);
    settingsModalOverlay.addEventListener('click', (e) => {
        if (e.target === settingsModalOverlay) closeModal();
    });
    
    // 取消按钮
    document.getElementById('settingsCancel').addEventListener('click', closeModal);
    
    // 保存按钮
    document.getElementById('settingsSave').addEventListener('click', async () => {
        const nickname = document.getElementById('settingsNickname').value.trim();
        
        if (!nickname) {
            showNotification('请输入昵称', 'error');
            return;
        }
        
        try {
            // 获取当前用户ID
            const userId = currentUser?.id || currentUser?.Id || currentUser?.record_id;
            console.log('当前用户ID:', userId);
            
            // 更新用户基本信息（昵称和头像）
            await window.electronAPI.updateUserInfo(userId, nickname, selectedAvatar);
            
            // 更新当前用户信息
            currentUser.nick = nickname;
            currentUser.photo = selectedAvatar;
            
            // 更新界面显示
            updateUsernameDisplay();
            await updateUserAvatar();
            
            showNotification('设置已保存', 'success');
            closeModal();
        } catch (error) {
            console.error('保存设置失败:', error);
            showNotification('保存失败: ' + error.message, 'error');
        }
    });
    
    // 修改密码按钮
    document.getElementById('changePasswordBtn').addEventListener('click', () => {
        closeModal();
        showChangePasswordModal();
    });
}

// 显示修改密码模态框
function showChangePasswordModal() {
    const passwordModalOverlay = document.createElement('div');
    passwordModalOverlay.className = 'modal-overlay active';
    passwordModalOverlay.style.display = 'flex';
    
    const passwordModal = document.createElement('div');
    passwordModal.className = 'modal';
    passwordModal.style.maxWidth = '400px';
    
    passwordModal.innerHTML = `
        <div class="modal-header">
            <h3>修改密码</h3>
            <button class="modal-close" id="passwordModalClose">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label for="currentPassword">当前密码</label>
                <input type="password" id="currentPassword" class="form-input" placeholder="请输入当前密码">
            </div>
            <div class="form-group">
                <label for="newPassword">新密码</label>
                <input type="password" id="newPassword" class="form-input" placeholder="请输入新密码（至少6位）">
            </div>
            <div class="form-group">
                <label for="confirmPassword">确认密码</label>
                <input type="password" id="confirmPassword" class="form-input" placeholder="请再次输入新密码">
            </div>
            
            <div style="display: flex; gap: 12px; margin-top: 24px;">
                <button class="btn btn-secondary" id="passwordCancel" style="flex: 1;">
                    取消
                </button>
                <button class="btn btn-primary" id="passwordSave" style="flex: 1;">
                    确认修改
                </button>
            </div>
        </div>
    `;
    
    passwordModalOverlay.appendChild(passwordModal);
    document.body.appendChild(passwordModalOverlay);
    
    const closeModal = () => {
        document.body.removeChild(passwordModalOverlay);
    };
    
    document.getElementById('passwordModalClose').addEventListener('click', closeModal);
    passwordModalOverlay.addEventListener('click', (e) => {
        if (e.target === passwordModalOverlay) closeModal();
    });
    
    document.getElementById('passwordCancel').addEventListener('click', closeModal);
    
    // 确认修改按钮
    document.getElementById('passwordSave').addEventListener('click', async () => {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        
        if (!currentPassword) {
            showNotification('请输入当前密码', 'error');
            return;
        }
        if (!newPassword || newPassword.length < 6) {
            showNotification('新密码至少需要6位', 'error');
            return;
        }
        if (newPassword !== confirmPassword) {
            showNotification('两次输入的密码不一致', 'error');
            return;
        }
        
        try {
            const userId = currentUser?.id || currentUser?.Id || currentUser?.record_id;
            
            await window.electronAPI.updateUserPassword(userId, currentPassword, newPassword);
            
            showNotification('密码修改成功', 'success');
            closeModal();
        } catch (error) {
            console.error('修改密码失败:', error);
            showNotification('修改失败: ' + error.message, 'error');
        }
    });
}

// 更新用户名显示
function updateUsernameDisplay() {
    const usernameSpan = document.getElementById('currentUsername');
    if (usernameSpan && currentUser) {
        const nickname = currentUser.nick || currentUser.username || currentUser.Username || '用户';
        usernameSpan.textContent = nickname;
    }
}

// 更新用户头像显示
async function updateUserAvatar() {
    const userAvatar = document.getElementById('userAvatar');
    if (userAvatar && currentUser) {
        const photo = currentUser.photo;
        
        if (photo && photo.trim()) {
            // 使用预设头像，从主进程获取路径
            const avatarPath = await window.electronAPI.getAvatarPath(photo);
            if (avatarPath) {
                userAvatar.style.background = `url(${avatarPath}) center/cover`;
                userAvatar.innerHTML = '';
            } else {
                // 路径获取失败，显示默认头像
                userAvatar.style.background = 'rgba(255,255,255,0.2)';
                userAvatar.innerHTML = '<i class="fa-solid fa-user" style="font-size: 14px; color: white;"></i>';
            }
        } else {
            // 默认头像
            userAvatar.style.background = 'rgba(255,255,255,0.2)';
            userAvatar.innerHTML = '<i class="fa-solid fa-user" style="font-size: 14px; color: white;"></i>';
        }
    }
}

function logout() {
    console.log('logout 函数被调用');
    currentUser = null;
    currentDirectory = 0; // 重置为根目录
    directoryPath = []; // 重置路径
    
    // 重置事件绑定标志
    loginEventsBound = false;
    registerEventsBound = false;
    
    const loginContainer = document.getElementById('loginContainer');
    const registerContainer = document.getElementById('registerContainer');
    const mainApp = document.getElementById('mainApp');
    const loginButton = document.getElementById('loginButton');
    const registerSubmitButton = document.getElementById('registerSubmitButton');
    const loginUsernameInput = document.getElementById('loginUsername');
    const loginPasswordInput = document.getElementById('loginPassword');
    const registerUsernameInput = document.getElementById('registerUsername');
    const registerPasswordInput = document.getElementById('registerPassword');
    const registerConfirmPasswordInput = document.getElementById('registerConfirmPassword');
    
    if (loginContainer && registerContainer && mainApp) {
        mainApp.style.display = 'none';
        registerContainer.style.display = 'none';
        loginContainer.style.display = 'flex';
        
        // 重置按钮状态
        if (loginButton) {
            loginButton.disabled = false;
            loginButton.textContent = '登录';
        }
        if (registerSubmitButton) {
            registerSubmitButton.disabled = false;
            registerSubmitButton.textContent = '注册';
        }
        
        // 清空所有输入框
        loginUsernameInput.value = '';
        loginPasswordInput.value = '';
        registerUsernameInput.value = '';
        registerPasswordInput.value = '';
        registerConfirmPasswordInput.value = '';

        // 清除记住的登录状态
        localStorage.removeItem('rememberedUser');

        // 确保隐藏加载遮罩
        hideLoading();

        // 重新绑定登录注册事件
        loginEventsBound = false;
        registerEventsBound = false;
        showLoginScreen();

        showNotification('已退出登录');
    }
}

// 初始化主应用（在登录成功后调用）
async function initMainApp() {
    try {
        updateUsernameDisplay();
        await updateUserAvatar(); // 恢复await
        await fetchFilesFromDatabase();
        setupEvents();
        initTheme();
        addEntranceAnimations();
        setupWebview();
        setupNewItemModal();
        setupFileUpload();
        initTransferQueue();
        
        // 绑定用户资料按钮点击事件（打开用户中心）
        const userProfileBtn = document.getElementById('userProfileBtn');
        console.log('userProfileBtn 元素:', userProfileBtn);
        if (userProfileBtn) {
            userProfileBtn.addEventListener('click', showUserCenterModal);
            console.log('用户资料按钮点击事件已绑定');
        } else {
            console.error('找不到 userProfileBtn 元素');
        }
    } catch (error) {
        console.error('初始化主应用失败:', error);
        showNotification('初始化失败: ' + error.message, 'error');
    }
}

// 切换到登录界面
function showLogin() {
    const loginContainer = document.getElementById('loginContainer');
    const registerContainer = document.getElementById('registerContainer');
    
    if (loginContainer && registerContainer) {
        registerContainer.style.display = 'none';
        loginContainer.style.display = 'flex';
    }
}

// 切换到注册界面
function showRegister() {
    const loginContainer = document.getElementById('loginContainer');
    const registerContainer = document.getElementById('registerContainer');
    
    if (loginContainer && registerContainer) {
        loginContainer.style.display = 'none';
        registerContainer.style.display = 'flex';
    }
}

// 显示登录界面
async function showLoginScreen() {
    console.log('showLoginScreen 被调用');
    const loginContainer = document.getElementById('loginContainer');
    const mainApp = document.getElementById('mainApp');
    
    if (!loginContainer) {
        console.error('找不到登录容器');
        return;
    }
    
    // ====== 登录界面元素 ======
    const loginButton = document.getElementById('loginButton');
    const loginUsernameInput = document.getElementById('loginUsername');
    const loginPasswordInput = document.getElementById('loginPassword');
    const goToRegisterLink = document.getElementById('goToRegister');
    
    // ====== 注册界面元素 ======
    const registerSubmitButton = document.getElementById('registerSubmitButton');
    const registerUsernameInput = document.getElementById('registerUsername');
    const registerPasswordInput = document.getElementById('registerPassword');
    const registerConfirmPasswordInput = document.getElementById('registerConfirmPassword');
    const goToLoginLink = document.getElementById('goToLogin');
    
    // 确保登录按钮可用
    if (loginButton) {
        loginButton.disabled = false;
        loginButton.style.pointerEvents = 'auto';
        loginButton.style.opacity = '1';
    }

    // 确保所有输入框可用
    if (loginUsernameInput) loginUsernameInput.disabled = false;
    if (loginPasswordInput) loginPasswordInput.disabled = false;
    if (registerUsernameInput) registerUsernameInput.disabled = false;
    if (registerPasswordInput) registerPasswordInput.disabled = false;
    if (registerConfirmPasswordInput) registerConfirmPasswordInput.disabled = false;
    if (registerSubmitButton) registerSubmitButton.disabled = false;

    // 只绑定一次事件监听器
    if (!loginEventsBound && loginButton) {
        loginEventsBound = true;
        console.log('绑定登录按钮事件');
        
        // ====== 登录按钮事件 ======
        loginButton.addEventListener('click', async (e) => {
            console.log('登录按钮点击了');
            e.preventDefault();
            e.stopPropagation();
            
            const username = loginUsernameInput.value.trim();
            const password = loginPasswordInput.value;
            
            if (!username || !password) {
                showNotification('请输入用户名和密码', 'error');
                return;
            }
            
            try {
                loginButton.disabled = true;
                loginButton.textContent = '登录中...';
                
                // 显示加载遮罩
                showLoading('登录中...');
                
                const user = await window.electronAPI.login(username, password);
                currentUser = user;

                // 保存登录状态到 localStorage
                localStorage.setItem('rememberedUser', JSON.stringify({
                    username: username,
                    password: password  // 如果需要记住密码
                }));

                // 初始化主应用（在隐藏加载遮罩前完成）
                showNotification('登录成功！');
                loginContainer.style.display = 'none';
                mainApp.style.display = 'flex';
                
                try {
                    await initMainApp();
                } finally {
                    // 隐藏加载遮罩
                    hideLoading();
                }
            } catch (error) {
                console.error('登录失败:', error);
                showNotification('登录失败: ' + error.message, 'error');
                loginButton.disabled = false;
                loginButton.textContent = '登录';
                loginUsernameInput.disabled = false;
                loginPasswordInput.disabled = false;
                // 登录失败也要隐藏加载遮罩
                hideLoading();
            }
        });
        
        // 登录界面回车键登录
        loginPasswordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                loginButton.click();
            }
        });
        
        // ====== 去注册链接 ======
        goToRegisterLink.addEventListener('click', (e) => {
            e.preventDefault();
            showRegister();
        });
    }
    
    // 只绑定一次注册事件监听器
    if (!registerEventsBound && registerSubmitButton) {
        registerEventsBound = true;

        // ====== 滑块验证相关元素 ======
        const captchaOverlay = document.getElementById('captchaOverlay');
        const captchaClose = document.getElementById('captchaClose');
        const sliderTrack = document.querySelector('.slider-track');
        const sliderTarget = document.getElementById('sliderTarget');
        const sliderThumb = document.getElementById('sliderThumb');
        const captchaStatus = document.getElementById('captchaStatus');

        // 初始化滑块验证
        function initSliderCaptcha() {
            const trackWidth = sliderTrack.offsetWidth;
            const targetLeft = Math.random() * (trackWidth - 80) + 60;
            sliderTarget.style.left = targetLeft + 'px';
            sliderThumb.style.left = '4px';
            sliderThumb.classList.remove('dragging');
            captchaStatus.textContent = '';
            captchaStatus.className = 'captcha-status';
        }

        // 显示滑块验证
        function showCaptcha() {
            initSliderCaptcha();
            captchaOverlay.style.display = 'flex';
        }

        // 隐藏滑块验证
        function hideCaptcha() {
            captchaOverlay.style.display = 'none';
            initSliderCaptcha();
        }

        // 滑块拖动逻辑
        let isDragging = false;
        let startX = 0;
        let startLeft = 0;

        sliderThumb.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startLeft = parseInt(sliderThumb.style.left) || 4;
            sliderThumb.classList.add('dragging');
            captchaStatus.textContent = '拖动滑块到目标位置';
            captchaStatus.className = 'captcha-status info';

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        sliderThumb.addEventListener('touchstart', (e) => {
            isDragging = true;
            startX = e.touches[0].clientX;
            startLeft = parseInt(sliderThumb.style.left) || 4;
            sliderThumb.classList.add('dragging');
            captchaStatus.textContent = '拖动滑块到目标位置';
            captchaStatus.className = 'captcha-status info';

            document.addEventListener('touchmove', onTouchMove);
            document.addEventListener('touchend', onTouchEnd);
        });

        function onMouseMove(e) {
            if (!isDragging) return;
            updateSliderPosition(e.clientX);
        }

        function onMouseUp() {
            finishDrag();
        }

        function onTouchMove(e) {
            if (!isDragging) return;
            updateSliderPosition(e.touches[0].clientX);
        }

        function onTouchEnd() {
            finishDrag();
        }

        function updateSliderPosition(clientX) {
            const trackWidth = sliderTrack.offsetWidth;
            const maxLeft = trackWidth - 40;
            const deltaX = clientX - startX;
            let newLeft = startLeft + deltaX;

            if (newLeft < 4) newLeft = 4;
            if (newLeft > maxLeft) newLeft = maxLeft;

            sliderThumb.style.left = newLeft + 'px';
        }

        function finishDrag() {
            isDragging = false;
            sliderThumb.classList.remove('dragging');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);

            // 验证是否成功
            const thumbLeft = parseInt(sliderThumb.style.left);
            const targetLeft = parseInt(sliderTarget.style.left);
            const tolerance = 15;

            if (Math.abs(thumbLeft - targetLeft) <= tolerance) {
                // 验证成功
                captchaStatus.textContent = '验证成功！';
                captchaStatus.className = 'captcha-status success';
                sliderThumb.style.background = '#28a745';

                setTimeout(() => {
                    hideCaptcha();
                    // 验证成功后执行注册
                    doRegister();
                }, 500);
            } else {
                // 验证失败
                captchaStatus.textContent = '验证失败，请重试';
                captchaStatus.className = 'captcha-status error';

                setTimeout(() => {
                    initSliderCaptcha();
                }, 1000);
            }
        }

        // 关闭验证界面
        captchaClose.addEventListener('click', () => {
            hideCaptcha();
        });

        captchaOverlay.addEventListener('click', (e) => {
            if (e.target === captchaOverlay) {
                hideCaptcha();
            }
        });

        // 注册表单数据
        let pendingRegisterData = null;

        // ====== 注册按钮事件 ======
        registerSubmitButton.addEventListener('click', async (e) => {
            e.preventDefault();

            const username = registerUsernameInput.value.trim();
            const password = registerPasswordInput.value;
            const confirmPassword = registerConfirmPasswordInput.value;

            if (!username || !password || !confirmPassword) {
                showNotification('请填写完整信息', 'error');
                return;
            }

            if (password.length < 6) {
                showNotification('密码长度至少6位', 'error');
                return;
            }

            if (password !== confirmPassword) {
                showNotification('两次输入的密码不一致', 'error');
                return;
            }

            // 保存注册数据，准备进行验证
            pendingRegisterData = { username, password };

            // 显示滑块验证
            showCaptcha();
        });

        // 执行注册
        async function doRegister() {
            if (!pendingRegisterData) return;

            const { username, password } = pendingRegisterData;

            try {
                registerSubmitButton.disabled = true;
                registerSubmitButton.textContent = '注册中...';

                await window.electronAPI.register(username, password);

                showNotification('注册成功，请登录！');

                // 清空注册表单，切换到登录界面
                registerUsernameInput.value = '';
                registerPasswordInput.value = '';
                registerConfirmPasswordInput.value = '';
                registerSubmitButton.disabled = false;
                registerSubmitButton.textContent = '注册';
                pendingRegisterData = null;

                // 把注册的用户名填到登录界面
                loginUsernameInput.value = username;
                showLogin();
            } catch (error) {
                console.error('注册失败:', error);
                showNotification('注册失败: ' + error.message, 'error');
                registerSubmitButton.disabled = false;
                registerSubmitButton.textContent = '注册';
                pendingRegisterData = null;
            }
        }

        // 注册界面回车键注册
        registerConfirmPasswordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                registerSubmitButton.click();
            }
        });

        // ====== 去登录链接 ======
        goToLoginLink.addEventListener('click', (e) => {
            e.preventDefault();
            showLogin();
        });
    }
}

// 重试按钮点击事件
retryButton.addEventListener('click', reloadApp);

// 监听网络状态变化
window.addEventListener('online', function() {
    hideNetworkError();
    reloadApp();
});

window.addEventListener('offline', function() {
    showNetworkError();
});

// 从数据库获取文件列表
async function fetchFilesFromDatabase() {
    // 显示加载指示器
    showFolderLoading();
    
    try {
        // 获取当前用户和用户拥有的文件ID列表
        if (!currentUser) {
            await getCurrentUser();
        }
        const userOwnedFileIds = getUserOwnedFileIds();
        console.log('用户拥有的文件ID:', userOwnedFileIds);
        
        const response = await window.electronAPI.fetchFiles();
        console.log('获取文件列表成功:', response);
        
        // 处理响应数据
        if (response && response.data) {
            console.log('原始数据列表:', response.data);
            
            // 转换为前端需要的格式
            const allItems = response.data.map((item, index) => {
                // 检查是否为文件夹（数据和校验码都为"floder"）
                // 同时也兼容"folder"拼写
                const isFolder = (item.base64 === "floder" && item.sha256 === "floder") || 
                                 (item.base64 === "folder" && item.sha256 === "folder") ||
                                 (item.data === "floder" || item.data === "folder");
                
                console.log(`项目 ${index}: ID=${item.id}, name=${item.name}, base64=${item.base64}, sha256=${item.sha256}, data=${item.data}, floder=${item.floder}, isFolder=${isFolder}`);
                
                // 提取文件扩展名（仅对文件）
                const ext = !isFolder ? item.name.split('.').pop() : undefined;
                // 格式化日期时间（从数据库的updated_at字段读取）
                const updateTime = item.updated_at || item.updatedAt || item.created_at || item.createdAt;
                const date = updateTime ? new Date(updateTime).toLocaleString('zh-CN', { 
                    month: 'numeric', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }) : new Date().toLocaleString('zh-CN', { 
                    month: 'numeric', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                return {
                    id: item.id, // 使用数据库中的实际ID
                    name: item.name,
                    type: isFolder ? 'folder' : 'file',
                    ext: ext,
                    date: date,
                    floder: item.floder || 0 // 存储隶属的文件夹ID
                };
            });
            
            console.log('转换后的所有项目:', allItems);
            
            // 过滤只显示用户拥有的文件（包括文件夹）
            // 文件夹也视为文件，需要包含在owned_file中
            // 对于超级管理员（uuid=0或Administrator），显示所有文件
            let userItems;
            if (isSuperAdmin()) {
                userItems = allItems; // 超级管理员可以看到所有文件
                console.log('超级管理员用户（uuid=0或Administrator），显示所有文件');
            } else {
                userItems = allItems.filter(item => userOwnedFileIds.includes(item.id));
                console.log('普通用户，只显示拥有的文件');
            }
            
            console.log('用户拥有的项目:', userItems);
            console.log('当前目录:', currentDirectory);
            
            // 根据当前目录过滤文件
            fileDataList = userItems.filter(item => item.floder === currentDirectory);
            
            console.log('最终显示的文件列表:', fileDataList);
        } else {
            // 如果没有数据，使用默认数据
            fileDataList = [
                { id: 1, name: "熊大快跑", type: "folder", date: "3/8 00:00", floder: 0 },
                { id: 2, name: "Linkboy_setup.exe", type: "file", ext: "exe", date: "3/8 00:00", floder: 0 }
            ];
            
            // 根据当前目录过滤文件
            fileDataList = fileDataList.filter(item => item.floder === currentDirectory);
        }
        
        // 刷新UI
        refreshUi();
    } catch (error) {
        console.error('获取文件列表失败:', error);
        // 使用默认数据
        fileDataList = [
            { id: 1, name: "熊大快跑", type: "folder", date: "3/8 00:00", floder: 0 },
            { id: 2, name: "Linkboy_setup.exe", type: "file", ext: "exe", date: "3/8 00:00", floder: 0 }
        ];
        
        // 根据当前目录过滤文件
        fileDataList = fileDataList.filter(item => item.floder === currentDirectory);
        
        refreshUi();
        showNotification('获取文件列表失败: ' + error.message, 'error');
    } finally {
        // 隐藏加载指示器
        hideFolderLoading();
    }
}

function addEntranceAnimations() {
    const sidebar = document.querySelector('.sidebar');
    const contentArea = document.querySelector('.content-area');
    const rightBar = document.querySelector('.right-bar');
    
    [sidebar, contentArea, rightBar].forEach((el, i) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        setTimeout(() => {
            el.style.transition = 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, 100 + i * 100);
    });
}

function refreshUi() {
    const container = document.getElementById('fileList');
    container.innerHTML = "";

    for (let i = 0; i < fileDataList.length; i++) {
        const data = fileDataList[i];
        const itemDiv = document.createElement('div');
        itemDiv.className = 'file-item';
        itemDiv.dataset.id = data.id;
        itemDiv.style.opacity = '0';
        itemDiv.style.transform = 'translateX(-20px)';

        let iconHtml = data.type === 'folder' 
            ? `<div class="file-icon"><i class="fa-solid fa-folder"></i></div>`
            : `<div class="file-icon generic"><i class="fa-solid fa-file"></i></div>`;

        itemDiv.innerHTML = `
            <div class="file-info">
                ${iconHtml}
                <div>
                    <div class="file-name">${data.name}</div>
                </div>
            </div>
            <div class="file-actions">
                <span>${data.date}</span>
                <div class="menu-btn" onclick="showMenu(event, ${data.id})">
                    <i class="fa-solid fa-ellipsis"></i>
                </div>
            </div>
        `;
        
        // 添加点击事件处理
        itemDiv.addEventListener('click', async function(e) {
            // 如果点击的是菜单按钮，不处理
            if (e.target.closest('.menu-btn')) {
                return;
            }
            
            // 如果是文件夹，进入该文件夹
            if (data.type === 'folder' && !isNavigating) {
                isNavigating = true;
                showFolderLoading(); // 立即显示加载指示器
                try {
                    directoryPath.push(currentDirectory);
                    currentDirectory = data.id;
                    await updatePathNav();
                    await fetchFilesFromDatabase();
                } finally {
                    isNavigating = false;
                }
            } else if (data.type === 'file') {
                // 如果是文件，显示文件详情
                await showFileDetails(data.id);
            }
        });
        
        container.appendChild(itemDiv);
        
        setTimeout(() => {
            itemDiv.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
            itemDiv.style.opacity = '1';
            itemDiv.style.transform = 'translateX(0)';
        }, 50 + i * 80);
    }
}

// 显示文件详情模态框
async function showFileDetails(fileId) {
    // 从fileDataList中查找文件信息
    let fileName = '';
    let fileType = '';
    for (let i = 0; i < fileDataList.length; i++) {
        if (fileDataList[i].id === fileId) {
            fileName = fileDataList[i].name;
            fileType = fileDataList[i].type;
            break;
        }
    }
    
    // 获取文件的详细信息
    let fileDetails = null;
    try {
        const response = await window.electronAPI.fetchFiles();
        if (response && response.data) {
            fileDetails = response.data.find(item => item.name === fileName);
        }
    } catch (error) {
        console.error('获取文件详情失败:', error);
    }
    
    // 显示详情模态框
    const modalOverlay = document.getElementById('modalOverlay');
    const modal = document.getElementById('modal');
    modalOverlay.classList.add('active');
    
    // 修改模态框内容为文件详情
    modal.innerHTML = `
        <div class="modal-header">
            <h3>文件详情</h3>
            <button class="modal-close" id="modalClose">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>文件名</label>
                <div class="form-input readonly">${fileName}</div>
            </div>
            <div class="form-group">
                <label>类型</label>
                <div class="form-input readonly">文件</div>
            </div>
            <div class="form-group">
                <label>大小</label>
                <div class="form-input readonly">${(() => {
                    try {
                        const chunkIds = fileDetails && fileDetails.base64 ? JSON.parse(fileDetails.base64) : null;
                        if (Array.isArray(chunkIds)) {
                            const chunkCount = chunkIds.length;
                            const sizeInKB = chunkCount * 32;
                            return `${chunkCount} 个分片 (${sizeInKB} KB)`;
                        }
                        return fileDetails && fileDetails.base64 ? Math.round(fileDetails.base64.length * 3 / 4 / 1024) + ' KB' : '未知';
                    } catch (e) {
                        return '未知';
                    }
                })()}</div>
            </div>
            <div class="form-group">
                <label>SHA256</label>
                <div class="form-input readonly" style="font-family: monospace; font-size: 12px; word-break: break-all;">${fileDetails ? fileDetails.sha256 : '未知'}</div>
            </div>
            <div class="form-group">
                <label>上传时间</label>
                <div class="form-input readonly">${fileDetails && fileDetails.created_at ? new Date(fileDetails.created_at).toLocaleString('zh-CN') : '未知'}</div>
            </div>
            <div class="form-group">
                <label>修改时间</label>
                <div class="form-input readonly">${fileDetails && fileDetails.updated_at ? new Date(fileDetails.updated_at).toLocaleString('zh-CN') : '未知'}</div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-primary" id="modalCloseBtn">关闭</button>
        </div>
    `;
    
    // 关闭模态框函数
    function closeModal() {
        modalOverlay.classList.remove('active');
    }
    
    // 关闭按钮事件
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', function(e) {
        if (e.target === modalOverlay) closeModal();
    });
}

// 更新路径导航
async function updatePathNav() {
    pathNav.innerHTML = "";
    
    // 获取所有文件夹信息
    let allFolders = [];
    try {
        const response = await window.electronAPI.fetchFiles();
        if (response && response.data) {
            allFolders = response.data.filter(item => 
                item.base64 === "floder" && item.sha256 === "floder"
            );
        }
    } catch (error) {
        console.error('获取文件夹信息失败:', error);
    }
    
    // 构建完整路径
    const pathItems = [{ id: 0, name: '根目录' }];
    let currentPath = [...directoryPath];
    currentPath.push(currentDirectory);
    
    // 为每个目录添加路径项
    for (let i = 1; i < currentPath.length; i++) {
        const folderId = currentPath[i];
        const folder = allFolders.find(f => f.id === folderId);
        if (folder) {
            pathItems.push({ id: folder.id, name: folder.name });
        }
    }
    
    // 添加路径项到导航栏
    pathItems.forEach((item, index) => {
        const pathItem = document.createElement('span');
        pathItem.className = 'path-item';
        if (index === pathItems.length - 1) {
            pathItem.classList.add('active');
        }
        pathItem.dataset.id = item.id;
        pathItem.textContent = item.name;
        pathItem.addEventListener('click', async function() {
            // 导航到选中的目录
            if (isNavigating) return;
            
            const targetId = parseInt(this.dataset.id);
            
            // 如果点击的就是当前目录，不处理
            if (targetId === currentDirectory) return;
            
            isNavigating = true;
            showFolderLoading(); // 立即显示加载指示器
            try {
                // 直接设置当前目录，路径导航会根据currentDirectory重建
                currentDirectory = targetId;
                directoryPath = []; // 清空路径栈，因为我们是直接跳转
                
                await updatePathNav();
                await fetchFilesFromDatabase();
            } finally {
                isNavigating = false;
            }
        });
        pathNav.appendChild(pathItem);
    });
    
    // 显示返回按钮
    backButton.style.display = currentDirectory === 0 ? 'none' : 'block';
}

// 回到上一级目录
async function goBack() {
    if (directoryPath.length > 0 && !isNavigating) {
        isNavigating = true;
        showFolderLoading(); // 立即显示加载指示器
        try {
            currentDirectory = directoryPath.pop();
            await updatePathNav();
            await fetchFilesFromDatabase();
        } finally {
            isNavigating = false;
        }
    }
}

function showMenu(e, fileId) {
    e.stopPropagation();
    currentOperateId = fileId;

    // 获取菜单尺寸
    const menuWidth = menu.offsetWidth || 180;
    const menuHeight = menu.offsetHeight || 200;

    // 计算菜单位置，确保不超出屏幕边界
    let left = e.clientX + 10;
    let top = e.clientY + 10;

    // 如果菜单会超出右侧边界，向左显示
    if (left + menuWidth > window.innerWidth) {
        left = e.clientX - menuWidth - 10;
    }

    // 如果菜单会超出底部边界，向上显示
    if (top + menuHeight > window.innerHeight) {
        top = e.clientY - menuHeight - 10;
    }

    // 确保菜单不会超出左侧和顶部边界
    left = Math.max(left, 10);
    top = Math.max(top, 10);

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.classList.add('visible');

    // 先重置所有菜单项为显示状态
    menu.querySelectorAll('.menu-action').forEach(item => {
        item.style.display = 'flex';
    });

    // 根据文件类型显示/隐藏下载和详情按钮
    let fileType = '';
    for (let i = 0; i < fileDataList.length; i++) {
        if (fileDataList[i].id === fileId) {
            fileType = fileDataList[i].type;
            break;
        }
    }

    const isFolder = fileType === 'folder';
    menu.querySelectorAll('.menu-action').forEach(item => {
        const text = item.textContent || item.innerText;
        if (text.includes('下载') || text.includes('详情')) {
            item.style.display = isFolder ? 'none' : 'flex';
        }
    });
}

function hideMenu() {
    menu.classList.remove('visible');
    currentOperateId = -1;
}

function setupEvents() {
    document.addEventListener('click', hideMenu);
    
    // 返回按钮点击事件
    backButton.addEventListener('click', goBack);
    
    // 接收文件按钮事件
    const receiveButton = document.getElementById('receiveButton');
    if (receiveButton) {
        receiveButton.addEventListener('click', showReceiveModal);
    }
    
    // 本地存储区点击事件（开发中提示）
    const localStorageNav = document.getElementById('localStorageNav');
    if (localStorageNav) {
        localStorageNav.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showNotification('功能开发中，敬请期待', 'info');
            
            // 切回云端文件夹
            const navFiles = document.getElementById('navFiles');
            const localStorageItem = document.getElementById('localStorageNav');
            if (navFiles && localStorageItem) {
                document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
                navFiles.classList.add('active');
            }
        });
    }
    
    // 为HTML中静态的"根目录"span元素添加点击事件
    const rootPathItem = pathNav.querySelector('[data-id="0"]');
    if (rootPathItem) {
        rootPathItem.addEventListener('click', async function() {
            if (isNavigating) return;
            if (currentDirectory === 0) return; // 已经在根目录
            
            isNavigating = true;
            try {
                currentDirectory = 0;
                directoryPath = [];
                await updatePathNav();
                await fetchFilesFromDatabase();
            } finally {
                isNavigating = false;
            }
        });
    }
    
    document.getElementById('actionDelete').addEventListener('click', async function(e) {
        e.stopPropagation();
        if (currentOperateId === -1) return;
        let fileName = "";
        let fileType = "";
        for (let i = 0; i < fileDataList.length; i++) {
            if (fileDataList[i].id === currentOperateId) {
                fileName = fileDataList[i].name;
                fileType = fileDataList[i].type;
                break;
            }
        }
        if (await showConfirmModal("确定要删除 <strong>" + fileName + "</strong> 吗？")) {
            try {
                // 获取当前用户
                if (!currentUser) {
                    await getCurrentUser();
                }
                
                // 检查文件是否被其他用户引用
                const referencingUsers = await window.electronAPI.checkFileReferences(currentOperateId);
                console.log('引用该文件的用户:', referencingUsers);
                console.log('当前用户:', currentUser);
                console.log('当前用户ID:', currentUser.id);
                console.log('当前用户ID类型:', typeof currentUser.id);
                console.log('referencingUsers[0]类型:', referencingUsers.length > 0 ? typeof referencingUsers[0] : 'undefined');
                
                const currentUserId = String(currentUser.id); // 转为字符串用于比较
                // 只有当没有其他用户引用（只有自己或没人引用）时，才删除源文件
                const isOnlyOwner = referencingUsers.length === 0 || 
                    (referencingUsers.length === 1 && String(referencingUsers[0]) === currentUserId);
                console.log('isOnlyOwner:', isOnlyOwner);
                console.log('字符串比较 - referencingUsers[0]:', String(referencingUsers[0]), ', currentUserId:', currentUserId);
                
                if (isOnlyOwner) {
                    // 只有当前用户引用该文件：删除源文件 + 从ownedfile移除
                    console.log('只有当前用户引用该文件，删除源文件');
                    
                    let deletedIds = [currentOperateId];
                    
                    if (fileType === 'folder') {
                        // 如果是文件夹，需要先获取所有子文件
                        const response = await window.electronAPI.fetchFiles();
                        if (response && response.data) {
                            const childFiles = response.data.filter(item => item.floder === currentOperateId);
                            for (const child of childFiles) {
                                await window.electronAPI.deleteFile(child.name);
                                deletedIds.push(child.id);
                            }
                        }
                    }
                    
                    // 调用删除API删除源文件
                    await window.electronAPI.deleteFile(fileName);
                    
                    // 从当前用户的ownedfile中移除（转为字符串比较避免类型不匹配）
                    const userOwnedFileIds = getUserOwnedFileIds();
                    const deletedIdsStr = deletedIds.map(id => String(id));
                    const updatedFileIds = userOwnedFileIds.filter(id => !deletedIdsStr.includes(String(id)));
                    await updateUserOwnedFiles(updatedFileIds);
                    
                } else {
                    // 有其他用户引用该文件：只从ownedfile移除，不删除源文件
                    console.log('有其他用户引用该文件，只移除访问权限');
                    
                    // 从当前用户的ownedfile中移除
                    const userOwnedFileIds = getUserOwnedFileIds();
                    const updatedFileIds = userOwnedFileIds.filter(id => String(id) !== String(currentOperateId));
                    await updateUserOwnedFiles(updatedFileIds);
                    
                    showNotification('已取消共享权限，源文件保留', 'info');
                }
                
                // 重新获取文件列表
                await fetchFilesFromDatabase();
                
                // 显示成功消息
                showNotification('删除成功！');
            } catch (error) {
                console.error('删除失败:', error);
                showNotification('删除失败: ' + error.message, 'error');
                
                // 如果API删除失败，至少在本地删除
                let newList = [];
                for (let i = 0; i < fileDataList.length; i++) {
                    if (fileDataList[i].id !== currentOperateId) {
                        newList.push(fileDataList[i]);
                    }
                }
                fileDataList = newList;
                refreshUi();
            }
        }
        hideMenu();
    });
    
    // 下载按钮事件
    document.querySelectorAll('.menu-action').forEach(item => {
        if (item.textContent.includes('下载')) {
            item.addEventListener('click', async function(e) {
                e.stopPropagation();
                if (currentOperateId === -1) return;
                
                let fileName = "";
                for (let i = 0; i < fileDataList.length; i++) {
                    if (fileDataList[i].id === currentOperateId) {
                        fileName = fileDataList[i].name;
                        break;
                    }
                }
                
                const modalOverlay = document.getElementById('modalOverlay');
                const modal = document.getElementById('modal');
                modalOverlay.classList.add('active');
                isNewItemModal = false;
                
                modal.innerHTML = `
                    <div class="modal-header">
                        <h3>下载文件</h3>
                        <button class="modal-close" id="modalClose">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="savePath">保存路径</label>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" id="savePath" class="form-input" placeholder="请输入保存路径" style="flex: 1;">
                                <button class="btn" id="browseButton">浏览</button>
                            </div>
                        </div>
                        <div class="form-group" style="display: flex; align-items: center; gap: 16px;">
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                <input type="checkbox" id="setAsDefault"> 设置为默认路径
                            </label>
                            <!-- <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                <input type="checkbox" id="useQueueDownload"> 添加到传输队列
                            </label> -->
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn" id="modalCancel">取消</button>
                        <button class="btn btn-primary" id="modalSubmit">下载</button>
                    </div>
                `;
                
                const savedPath = localStorage.getItem('defaultDownloadPath');
                const defaultPath = (savedPath && savedPath.length >= 3 && (savedPath.startsWith('/') || /^[a-zA-Z]:[\\\/]/.test(savedPath))) ? savedPath : '';
                document.getElementById('savePath').value = defaultPath;
                
                document.getElementById('browseButton').addEventListener('click', async function() {
                    const directory = await window.electronAPI.selectDirectory();
                    if (directory) {
                        document.getElementById('savePath').value = directory;
                    }
                });
                
                function closeModal() {
                    modalOverlay.classList.remove('active');
                    isNewItemModal = true;
                }
                
                document.getElementById('modalCancel').addEventListener('click', closeModal);
                document.getElementById('modalClose').addEventListener('click', closeModal);
                modalOverlay.addEventListener('click', function(e) {
                    if (e.target === modalOverlay) closeModal();
                });
                
                document.getElementById('modalSubmit').addEventListener('click', async function() {
                    const savePath = document.getElementById('savePath').value.trim();
                    if (!savePath || savePath.length < 3) {
                        showNotification('请输入有效的保存路径', 'error');
                        return;
                    }
                    
                    // 验证路径格式（支持 Windows 和 Linux/macOS 路径）
                    const isValidPath = savePath.startsWith('/') || /^[a-zA-Z]:[\\\/]/.test(savePath);
                    if (!isValidPath) {
                        showNotification('请输入有效的路径', 'error');
                        return;
                    }
                    
                    if (document.getElementById('setAsDefault').checked) {
                        localStorage.setItem('defaultDownloadPath', savePath);
                    }
                    
                    // 使用 path.sep 进行跨平台路径拼接
                    const pathSep = savePath.endsWith('\\') || savePath.endsWith('/') ? '' : (savePath.includes('/') ? '/' : '\\');
                    const fullPath = savePath + pathSep + fileName;
                    
                    // 直接下载，不使用队列
                    modal.innerHTML = `
                            <div class="modal-header">
                                <h3>下载文件</h3>
                            </div>
                            <div class="modal-body" style="text-align: center;">
                                <div id="downloadStatus" style="margin-bottom: 20px;">正在查找文件...</div>
                                <div class="progress-bar-container" style="width: 100%; height: 20px; background-color: var(--hover-color); border-radius: 10px; overflow: hidden;">
                                    <div class="progress-bar" style="width: 0%; height: 100%; background-color: var(--primary-color); transition: width 0.3s ease;"></div>
                                </div>
                                <div class="progress-text" style="margin-top: 10px; font-size: 14px; color: var(--text-secondary);">0%</div>
                            </div>
                        `;
                        
                        const progressBar = modal.querySelector('.progress-bar');
                        const progressText = modal.querySelector('.progress-text');
                        const downloadStatus = document.getElementById('downloadStatus');
                        
                        function updateProgress(current, total, message) {
                            const percent = Math.round((current / total) * 100);
                            progressBar.style.width = percent + '%';
                            progressText.textContent = percent + '%';
                            downloadStatus.textContent = message || '下载中... ' + percent + '%';
                        }
                        
                        try {
                            const result = await window.electronAPI.downloadFile({ fileName, savePath: fullPath }, updateProgress);
                            updateProgress(100, 100, '下载完成');
                            setTimeout(() => {
                                closeModal();
                                showNotification('文件下载成功！保存路径: ' + result.path);
                            }, 500);
                        } catch (error) {
                            console.error('下载文件失败:', error);
                            closeModal();
                            showNotification('下载文件失败: ' + error.message, 'error');
                        }
                    });
                
                hideMenu();
            });
        } else if (item.textContent.includes('分享')) {
            item.addEventListener('click', async function(e) {
                e.stopPropagation();
                if (currentOperateId === -1) return;
                
                let fileName = "";
                let fileId = "";
                let folderId = 0;
                for (let i = 0; i < fileDataList.length; i++) {
                    if (fileDataList[i].id === currentOperateId) {
                        fileName = fileDataList[i].name;
                        fileId = fileDataList[i].id;
                        folderId = fileDataList[i].floder || 0;
                        break;
                    }
                }
                
                const modalOverlay = document.getElementById('modalOverlay');
                const modal = document.getElementById('modal');
                modalOverlay.classList.add('active');
                isNewItemModal = false;
                
                // 如果文件不在根目录，显示警告提示
                const folderWarning = folderId !== 0 ? `
                    <div class="form-group" style="background-color: #fef3c7; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                        <label style="color: #b45309; font-weight: bold;">⚠️ 提示</label>
                        <div style="color: #92400e; margin-top: 4px;">
                            你也许需要分享其父目录才会给对方展示该文件
                        </div>
                    </div>
                ` : '';
                
                modal.innerHTML = `
                    <div class="modal-header">
                        <h3>分享文件</h3>
                        <button class="modal-close" id="modalClose">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        ${folderWarning}
                        <div class="form-group">
                            <label for="shareDescription">文件信息</label>
                            <input type="text" id="shareDescription" class="form-input" value="${fileName}" placeholder="例如：这是我的论文">
                        </div>
                        <div class="form-group">
                            <label for="sharePassword">设置密码（可选）</label>
                            <input type="password" id="sharePassword" class="form-input" placeholder="留空则无需密码">
                        </div>
                        <div class="form-group">
                            <label>分享链接</label>
                            <div class="form-input readonly" id="shareLink" style="word-break: break-all; color: var(--primary-color); font-family: monospace;"></div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn" id="modalCancel">取消</button>
                        <button class="btn btn-primary" id="modalSubmit">创建分享</button>
                    </div>
                `;
                
                function closeModal() {
                    modalOverlay.classList.remove('active');
                    isNewItemModal = true;
                }
                
                document.getElementById('modalCancel').addEventListener('click', closeModal);
                document.getElementById('modalClose').addEventListener('click', closeModal);
                modalOverlay.addEventListener('click', function(e) {
                    if (e.target === modalOverlay) closeModal();
                });
                
                document.getElementById('modalSubmit').addEventListener('click', async function() {
                    const description = document.getElementById('shareDescription').value.trim() || fileName;
                    const password = document.getElementById('sharePassword').value.trim();
                    
                    try {
                        const result = await window.electronAPI.createShare(description, fileId, password);
                        console.log('分享创建成功:', result);
                        
                        // 生成分享链接：amengshare://{Id}.sharedameng.{随机数}.file
                        const shareId = result.data && result.data.id ? result.data.id : result.id;
                        const randomNum = Math.random().toString(36).substring(2, 10);
                        const shareLink = `amengshare://${shareId}.sharedameng.${randomNum}.file`;
                        document.getElementById('shareLink').textContent = shareLink;
                        
                        showNotification('分享创建成功！');
                        
                        // 复制链接到剪贴板
                        try {
                            await navigator.clipboard.writeText(shareLink);
                            showNotification('链接已复制到剪贴板！');
                        } catch (err) {
                            console.log('无法复制到剪贴板');
                        }
                        
                        // 禁用创建按钮，改为关闭按钮
                        document.getElementById('modalSubmit').textContent = '关闭';
                        document.getElementById('modalSubmit').addEventListener('click', closeModal);
                    } catch (error) {
                        console.error('创建分享失败:', error);
                        showNotification('创建分享失败: ' + error.message, 'error');
                    }
                });
                
                hideMenu();
            });
        } else if (item.textContent.includes('详情')) {
        item.addEventListener('click', async function(e) {
                e.stopPropagation();
                if (currentOperateId === -1) return;
                
                let fileName = "";
                let fileType = "";
                for (let i = 0; i < fileDataList.length; i++) {
                    if (fileDataList[i].id === currentOperateId) {
                        fileName = fileDataList[i].name;
                        fileType = fileDataList[i].type;
                        break;
                    }
                }
                
                // 获取文件的详细信息
                let fileDetails = null;
                try {
                    const response = await window.electronAPI.fetchFiles();
                    if (response && response.data) {
                        fileDetails = response.data.find(item => item.name === fileName);
                    }
                } catch (error) {
                    console.error('获取文件详情失败:', error);
                }
                
                // 显示详情模态框
                const modalOverlay = document.getElementById('modalOverlay');
                const modal = document.getElementById('modal');
                modalOverlay.classList.add('active');
                
                // 修改模态框内容为文件详情
                modal.innerHTML = `
                    <div class="modal-header">
                        <h3>文件详情</h3>
                        <button class="modal-close" id="modalClose">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label>文件名</label>
                            <div class="form-input readonly">${fileName}</div>
                        </div>
                        <div class="form-group">
                            <label>类型</label>
                            <div class="form-input readonly">${fileType === 'folder' ? '文件夹' : '文件'}</div>
                        </div>
                        ${fileType !== 'folder' ? `
                        <div class="form-group">
                            <label>大小</label>
                            <div class="form-input readonly">${(() => {
                                try {
                                    const chunkIds = fileDetails && fileDetails.base64 ? JSON.parse(fileDetails.base64) : null;
                                    if (Array.isArray(chunkIds)) {
                                        const chunkCount = chunkIds.length;
                                        const sizeInKB = chunkCount * 32;
                                        return `${chunkCount} 个分片 (${sizeInKB} KB)`;
                                    }
                                    return fileDetails && fileDetails.base64 ? Math.round(fileDetails.base64.length * 3 / 4 / 1024) + ' KB' : '未知';
                                } catch (e) {
                                    return '未知';
                                }
                            })()}</div>
                        </div>
                        <div class="form-group">
                            <label>SHA256</label>
                            <div class="form-input readonly" style="font-family: monospace; font-size: 12px; word-break: break-all;">${fileDetails ? fileDetails.sha256 : '未知'}</div>
                        </div>
                        ` : ''}
                        <div class="form-group">
                            <label>上传时间</label>
                            <div class="form-input readonly">${fileDetails ? new Date(fileDetails.created_at).toLocaleString('zh-CN') : '未知'}</div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-primary" id="modalCloseBtn">关闭</button>
                    </div>
                `;
                
                // 关闭模态框函数
                function closeModal() {
                    modalOverlay.classList.remove('active');
                }
                
                // 关闭按钮事件
                document.getElementById('modalClose').addEventListener('click', closeModal);
                document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
                modalOverlay.addEventListener('click', function(e) {
                    if (e.target === modalOverlay) closeModal();
                });
                
                hideMenu();
            });
        }
    });

    themeToggle.addEventListener('click', toggleTheme);
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            this.classList.add('active');
        });
    });
}

function initTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
    
    const cards = document.querySelectorAll('.card');
    cards.forEach((card, i) => {
        card.style.transition = 'none';
        setTimeout(() => {
            card.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
        }, 10);
    });
}

function updateThemeIcon(theme) {
    if (theme === 'dark') {
        themeIcon.className = 'fa-solid fa-sun';
    } else {
        themeIcon.className = 'fa-solid fa-moon';
    }
}

function setupWebview() {
    const webviewLink = document.getElementById('webviewLink');
    const webviewContainer = document.getElementById('webviewContainer');
    const webview = document.getElementById('webview');
    const webviewClose = document.getElementById('webviewClose');
    const webviewBack = document.getElementById('webviewBack');
    const webviewForward = document.getElementById('webviewForward');
    const webviewRefresh = document.getElementById('webviewRefresh');
    const webviewTitle = document.getElementById('webviewTitle');

    webviewLink.addEventListener('click', function(e) {
        e.preventDefault();
        const url = this.getAttribute('data-url');
        webview.src = url;
        webviewTitle.textContent = '加载中...';
        webviewContainer.classList.add('active');
    });

    webviewClose.addEventListener('click', function() {
        webviewContainer.classList.remove('active');
        webview.src = 'about:blank';
    });

    webviewBack.addEventListener('click', function() {
        if (webview.canGoBack()) {
            webview.goBack();
        }
    });

    webviewForward.addEventListener('click', function() {
        if (webview.canGoForward()) {
            webview.goForward();
        }
    });

    webviewRefresh.addEventListener('click', function() {
        webview.reload();
    });

    webview.addEventListener('page-title-updated', function(e) {
        webviewTitle.textContent = e.title || '网页版';
    });
}

function setupNewItemModal() {
    const newButton = document.getElementById('newButton');
    const newMenu = document.getElementById('newMenu');
    const modalOverlay = document.getElementById('modalOverlay');
    const modalTitle = document.getElementById('modalTitle');
    const fileTypeGroup = document.getElementById('fileTypeGroup');
    const modalSubmit = document.getElementById('modalSubmit');
    const modalCancel = document.getElementById('modalCancel');
    const modalClose = document.getElementById('modalClose');
    const itemNameInput = document.getElementById('itemName');
    let currentItemType = '';
    let isNewItemModal = true;

    // 隐藏新建菜单的函数
    function hideNewMenu() {
        newMenu.classList.remove('visible');
    }

    newButton.addEventListener('click', function(e) {
        e.stopPropagation();
        newMenu.classList.toggle('visible');
    });

    // 点击其他地方关闭新建菜单（与三个点菜单共用同一个全局点击事件）
    document.addEventListener('click', hideNewMenu);

    // 阻止点击菜单内部时关闭菜单
    newMenu.addEventListener('click', function(e) {
        e.stopPropagation();
    });

    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', function() {
            currentItemType = this.getAttribute('data-type');
            if (currentItemType === 'folder') {
                // 使用独立的新建文件夹模态框，避免与文件详情冲突
                showCreateFolderModal();
                newMenu.classList.remove('visible');
            }
        });
    });

    function closeModal() {
        modalOverlay.classList.remove('active');
    }

    modalSubmit.addEventListener('click', function() {
        if (!isNewItemModal) return;
        const name = itemNameInput.value.trim();
        if (!name) {
            alert('请输入名称');
            return;
        }
        
        addNewItem(currentItemType, name);
        closeModal();
    });

    modalCancel.addEventListener('click', closeModal);
    modalClose.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', function(e) {
        if (e.target === modalOverlay) closeModal();
    });
}

function setupFileUpload() {
    // 检查是否已经添加过上传按钮，防止重复添加
    if (document.querySelector('.upload-file-item')) {
        console.log('上传文件按钮已存在，跳过重复添加');
        return;
    }
    
    // 添加上传文件按钮到下拉菜单
    const newMenu = document.getElementById('newMenu');
    const uploadItem = document.createElement('button');
    uploadItem.className = 'dropdown-item upload-file-item';  // 添加唯一类名用于检测
    uploadItem.innerHTML = '<i class="fa-solid fa-upload" style="width:20px;"></i> 上传文件';
    uploadItem.addEventListener('click', async function() {
        try {
            // 选择文件
            const filePath = await window.electronAPI.selectFile();
            if (!filePath) return;
            
            // 显示模态框
            const modalOverlay = document.getElementById('modalOverlay');
            const modal = document.getElementById('modal');
            modalOverlay.classList.add('active');
            
            // 第一步：显示"正在处理文件"
            modal.innerHTML = `
                <div class="modal-header">
                    <h3>上传文件</h3>
                </div>
                <div class="modal-body" style="text-align: center;">
                    <div style="margin-bottom: 20px;">正在处理文件...</div>
                </div>
            `;
            
            // 提取文件名
            const fileName = filePath.split('\\').pop().split('/').pop();
            
            // 读取文件并转换为base64
            const base64 = await window.electronAPI.readFileAsBase64(filePath);
            
            // 计算SHA256值
            const sha256 = await window.electronAPI.calculateSHA256(filePath);
            
            // 从主进程获取准确的分片数量（考虑gzip压缩后的大小）
            const chunkResult = await window.electronAPI.getTotalChunks(filePath);
            const totalChunks = chunkResult.success ? chunkResult.totalChunks : Math.ceil(base64.length / CHUNK_SIZE);
            
            // 第二步：显示分片数量和上传按钮
            modal.innerHTML = `
                <div class="modal-header">
                    <h3>上传文件</h3>
                </div>
                <div class="modal-body" style="text-align: center;">
                    <div style="margin-bottom: 20px;">将会上传${totalChunks}个分片</div>
                    <div style="margin-bottom: 20px; font-size: 14px; color: var(--text-secondary);">按下上传键继续</div>
                    <button class="btn btn-primary" id="startUploadBtn">上传</button>
                </div>
            `;
            
            // 等待用户点击上传按钮
            await new Promise((resolve) => {
                document.getElementById('startUploadBtn').addEventListener('click', resolve);
            });
            
            // 第三步：显示实际进度
            modal.innerHTML = `
                <div class="modal-header">
                    <h3>上传文件</h3>
                </div>
                <div class="modal-body" style="text-align: center;">
                    <div id="uploadStatus" style="margin-bottom: 20px;">正在上传第 1/${totalChunks} 个分片</div>
                    <div class="progress-bar-container" style="width: 100%; height: 20px; background-color: var(--hover-color); border-radius: 10px; overflow: hidden;">
                        <div class="progress-bar" style="width: 0%; height: 100%; background-color: var(--primary-color); transition: width 0.3s ease;"></div>
                    </div>
                    <div class="progress-text" style="margin-top: 10px; font-size: 14px; color: var(--text-secondary);">0%</div>
                </div>
            `;
            
            const progressBar = modal.querySelector('.progress-bar');
            const progressText = modal.querySelector('.progress-text');
            const uploadStatus = document.getElementById('uploadStatus');
            
            // 更新进度的函数
            function updateProgress(current, total, message) {
                const percent = Math.round((current / total) * 10000) / 100;
                progressBar.style.width = percent + '%';
                progressText.textContent = percent + '%';
                uploadStatus.textContent = message || `正在上传第 ${current}/${total} 个分片`;
            }
            
            // 开始上传
            try {
                const result = await uploadFileWithChunks(fileName, base64, sha256, currentDirectory, filePath, totalChunks, updateProgress);
                
                // 上传完成后，将进度设置为100%
                updateProgress(totalChunks, totalChunks);
                
                // 获取新文件的ID并更新用户的owned_file
                if (result && result.id) {
                    const newFileId = result.id;
                    const userOwnedFileIds = getUserOwnedFileIds();
                    userOwnedFileIds.push(newFileId);
                    await updateUserOwnedFiles(userOwnedFileIds);
                    
                    // 如果是Administrator，实时更新owned_file确保对所有文件的访问
                    if (isAdministrator()) {
                        await refreshAdministratorOwnedFiles();
                    }
                }
                
                // 延迟关闭，让用户看到完成状态
                setTimeout(() => {
                    modalOverlay.classList.remove('active');
                    
                    // 重新获取文件列表
                    fetchFilesFromDatabase();
                    
                    // 显示成功消息
                    showNotification('文件上传成功！');
                }, 500);
            } catch (uploadError) {
                console.error('上传文件失败:', uploadError);
                modalOverlay.classList.remove('active');
                showNotification('上传文件失败: ' + uploadError.message, 'error');
            }
        } catch (error) {
            console.error('处理文件失败:', error);
            document.getElementById('modalOverlay').classList.remove('active');
            showNotification('处理文件失败: ' + error.message, 'error');
        }
    });
    
    // 插入到下拉菜单的末尾
    newMenu.appendChild(uploadItem);
}

// 显示接收文件模态框
function showReceiveModal() {
    const modalOverlay = document.getElementById('modalOverlay');
    const modal = document.getElementById('modal');
    modalOverlay.classList.add('active');
    isNewItemModal = false;
    
    modal.innerHTML = `
        <div class="modal-header">
            <h3>接收文件</h3>
            <button class="modal-close" id="modalClose">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label for="shareLinks">分享链接（每行一条）</label>
                <textarea id="shareLinks" class="form-input" rows="6" placeholder="amengshare://1.sharedameng.abc123.file&#10;amengshare://2.sharedameng.def456.file"></textarea>
            </div>
            <div id="receiveResults" style="display: none; margin-top: 16px;">
                <h4 style="margin-bottom: 8px;">处理结果</h4>
                <div id="resultsList" style="max-height: 200px; overflow-y: auto;"></div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn" id="modalCancel">取消</button>
            <button class="btn btn-primary" id="modalSubmit">开始接收</button>
        </div>
    `;
    
    function closeModal() {
        modalOverlay.classList.remove('active');
        isNewItemModal = true;
    }
    
    document.getElementById('modalCancel').addEventListener('click', closeModal);
    document.getElementById('modalClose').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', function(e) {
        if (e.target === modalOverlay) closeModal();
    });
    
    document.getElementById('modalSubmit').addEventListener('click', async function() {
        const linksText = document.getElementById('shareLinks').value.trim();
        if (!linksText) {
            showNotification('请输入分享链接', 'error');
            return;
        }
        
        // 分割链接（支持多行）
        const links = linksText.split(/\r?\n/).filter(link => link.trim());
        const resultsList = document.getElementById('resultsList');
        const receiveResults = document.getElementById('receiveResults');
        
        receiveResults.style.display = 'block';
        resultsList.innerHTML = '';
        
        // 依次解析每条链接
        for (let i = 0; i < links.length; i++) {
            const link = links[i].trim();
            await processShareLink(link, resultsList);
        }
    });
}

// 解析分享链接并处理
async function processShareLink(link, resultsContainer) {
    try {
        // 解析链接格式: amengshare://{Id}.sharedameng.{随机数}.file
        const regex = /^amengshare:\/\/(\d+)\.sharedameng\.[a-zA-Z0-9]+\.file$/;
        const match = link.match(regex);

        if (!match) {
            addResult(resultsContainer, link, '无效的分享链接格式', 'error');
            return;
        }

        const shareId = match[1];
        console.log('解析分享链接:', link, '分享ID:', shareId);

        // 获取分享信息
        const shareResult = await window.electronAPI.getShareById(shareId);
        console.log('API返回结果:', shareResult);
        
        if (!shareResult) {
            addResult(resultsContainer, link, '分享不存在或已过期', 'error');
            return;
        }
        
        // 检查数据结构
        const shareData = shareResult.data || shareResult;
        console.log('分享数据:', shareData);
        
        if (!shareData || !shareData.fileid) {
            addResult(resultsContainer, link, '分享数据格式错误', 'error');
            return;
        }

        // 获取被分享文件的信息
        const fileInfo = await getFileInfoById(shareData.fileid);
        if (!fileInfo) {
            addResult(resultsContainer, link, '分享的文件不存在', 'error');
            return;
        }

        // 如果有密码，需要验证
        if (shareData.Words && shareData.Words.trim()) {
            let attempts = 0;
            let maxAttempts = 3;
            let password;

            while (attempts < maxAttempts) {
                password = await promptPassword(shareData.name);
                if (!password) {
                    addResult(resultsContainer, link, '已取消', 'error');
                    return;
                }
                if (password === shareData.Words) {
                    break;
                }
                attempts++;
                if (attempts >= maxAttempts) {
                    addResult(resultsContainer, link, `密码错误次数过多（${maxAttempts}次）`, 'error');
                    return;
                }
                addResult(resultsContainer, link, `密码错误，剩余 ${maxAttempts - attempts} 次尝试机会`, 'error');
            }
        }

        // 将文件添加到用户的ownedfile
        await addFileToOwnedFiles(shareData.fileid);

        const fileType = fileInfo.type === 'folder' ? '文件夹' : '文件';
        addResult(resultsContainer, link, `${fileType} "${fileInfo.name}" 接收成功`, 'success');

    } catch (error) {
        console.error('处理分享链接失败:', error);
        addResult(resultsContainer, link, '处理失败: ' + error.message, 'error');
    }
}

// 添加处理结果
function addResult(container, link, message, type) {
    const resultItem = document.createElement('div');
    resultItem.style.padding = '8px';
    resultItem.style.borderRadius = '4px';
    resultItem.style.marginBottom = '4px';
    resultItem.style.fontSize = '13px';
    
    if (type === 'success') {
        resultItem.style.backgroundColor = '#dcfce7';
        resultItem.style.color = '#166534';
    } else {
        resultItem.style.backgroundColor = '#fee2e2';
        resultItem.style.color = '#991b1b';
    }
    
    resultItem.innerHTML = `<strong>${link}</strong><br>${message}`;
    container.appendChild(resultItem);
}

// 密码输入弹窗（使用独立遮罩）
function promptPassword(shareName) {
    return new Promise((resolve) => {
        const modalOverlay = document.getElementById('modalOverlay');
        const passwordOverlay = document.createElement('div');
        passwordOverlay.className = 'modal-overlay active';
        passwordOverlay.id = 'passwordOverlay';

        passwordOverlay.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3>输入分享密码</h3>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>分享 "${shareName}" 需要密码</label>
                        <input type="password" id="passwordInput" class="form-input" placeholder="请输入密码">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn" id="passwordCancel">取消</button>
                    <button class="btn btn-primary" id="passwordSubmit">确定</button>
                </div>
            </div>
        `;

        document.body.appendChild(passwordOverlay);

        const passwordInput = document.getElementById('passwordInput');
        const submitBtn = document.getElementById('passwordSubmit');
        const cancelBtn = document.getElementById('passwordCancel');

        passwordInput.focus();

        passwordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                submitBtn.click();
            }
        });

        function cleanup() {
            document.body.removeChild(passwordOverlay);
        }

        submitBtn.addEventListener('click', function() {
            const password = passwordInput.value;
            cleanup();
            resolve(password);
        });

        cancelBtn.addEventListener('click', function() {
            cleanup();
            resolve(null);
        });
    });
}

// 根据文件ID获取文件信息
async function getFileInfoById(fileId) {
    try {
        const response = await window.electronAPI.fetchFiles();
        if (response && response.data) {
            return response.data.find(item => item.id == fileId);
        }
        return null;
    } catch (error) {
        console.error('获取文件信息失败:', error);
        return null;
    }
}

// 将文件添加到用户的ownedfile
async function addFileToOwnedFiles(fileId) {
    try {
        if (!currentUser) {
            throw new Error('请先登录');
        }

        const userId = currentUser.id;
        let ownedFiles = [];

        if (currentUser.owned_file) {
            try {
                ownedFiles = JSON.parse(currentUser.owned_file);
                // 确保是数字类型
                ownedFiles = ownedFiles.map(id => parseInt(id));
            } catch (e) {
                ownedFiles = [];
            }
        }

        const numericFileId = parseInt(fileId);

        // 避免重复添加
        if (!ownedFiles.includes(numericFileId)) {
            ownedFiles.push(numericFileId);
            await window.electronAPI.updateOwnedFiles(userId, JSON.stringify(ownedFiles));

            // 更新当前用户的owned_file
            currentUser.owned_file = JSON.stringify(ownedFiles);
        }

        // 刷新文件列表
        await fetchFilesFromDatabase();

    } catch (error) {
        console.error('添加文件到ownedfile失败:', error);
        throw error;
    }
}

// 显示通知
function showNotification(message, type = 'success') {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        border-radius: 8px;
        color: white;
        font-size: 14px;
        font-weight: 500;
        z-index: 1000;
        transform: translateX(100%);
        transition: transform 0.3s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    `;
    
    // 设置背景色
    if (type === 'success') {
        notification.style.backgroundColor = '#4CAF50';
    } else if (type === 'error') {
        notification.style.backgroundColor = '#f44336';
    }
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // 显示通知
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // 3秒后隐藏通知
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// ==================== 传输队列功能 ====================

// 下载队列数组
let downloadQueue = [];
let isDownloading = false;
let currentDownloadTask = null;

// 初始化传输队列
function initTransferQueue() {
    // 导航切换
    const navFiles = document.getElementById('navFiles');
    const navQueue = document.getElementById('navQueue');
    const clearQueueBtn = document.getElementById('clearQueueBtn');
    const queueList = document.getElementById('queueList');

    if (navFiles) {
        navFiles.addEventListener('click', () => {
            showView('files');
        });
    }

    if (navQueue) {
        navQueue.addEventListener('click', () => {
            showView('queue');
        });
    }

    if (clearQueueBtn) {
        clearQueueBtn.addEventListener('click', () => {
            clearDownloadQueue();
        });
    }

    if (queueList) {
        queueList.addEventListener('click', (e) => {
            const target = e.target;
            const btn = target.closest('button');

            if (!btn) return;

            const index = parseInt(btn.dataset.index);
            if (isNaN(index)) return;

            if (btn.classList.contains('queue-btn-remove')) {
                removeFromQueue(index);
            } else if (btn.classList.contains('queue-btn-stop')) {
                stopDownload(index);
            } else if (btn.classList.contains('queue-btn-retry')) {
                retryDownload(index);
            }
        });
    }
}

// 显示指定视图
function showView(view) {
    const fileView = document.querySelector('.file-view');
    const queueView = document.querySelector('.queue-view');
    const navFiles = document.getElementById('navFiles');
    const navQueue = document.getElementById('navQueue');
    const headerTitle = document.getElementById('headerTitle');
    const pathNav = document.getElementById('pathNav');
    
    if (view === 'files') {
        fileView.style.display = 'flex';
        queueView.style.display = 'none';
        navFiles.classList.add('active');
        navQueue.classList.remove('active');
        headerTitle.textContent = '云端文件夹';
        pathNav.style.display = 'flex';
    } else if (view === 'queue') {
        fileView.style.display = 'none';
        queueView.style.display = 'flex';
        navFiles.classList.remove('active');
        navQueue.classList.add('active');
        headerTitle.textContent = '传输队列';
        pathNav.style.display = 'none';
    }
}

// 添加文件到下载队列
function addToDownloadQueue(fileName) {
    console.log('addToDownloadQueue called with fileName:', fileName);
    // 检查是否已在队列中
    const exists = downloadQueue.find(item => item.fileName === fileName);
    if (exists) {
        showNotification('文件已在队列中', 'error');
        return;
    }
    
    // 获取文件保存路径
    const savedPath = localStorage.getItem('defaultDownloadPath');
    // 跨平台默认路径
    const isWindows = savedPath && /^[a-zA-Z]:[\\\/]/.test(savedPath);
    const defaultPath = (savedPath && savedPath.length >= 3 && (savedPath.startsWith('/') || isWindows))
        ? savedPath
        : (process.platform === 'win32' ? 'C:\\Users\\Public\\Downloads' : '/tmp/AmengCloud');
    
    // 使用 path.sep 或手动判断进行跨平台路径拼接
    const pathSep = defaultPath.endsWith('\\') || defaultPath.endsWith('/') ? '' : (defaultPath.includes('/') ? '/' : '\\');
    const savePath = defaultPath + pathSep + fileName;
    
    // 添加到队列
    const task = {
        id: Date.now(),
        fileName: fileName,
        savePath: savePath,
        status: 'pending', // pending, downloading, completed, error
        progress: 0,
        progressText: '等待下载',
        chunkInfo: ''
    };
    
    downloadQueue.push(task);
    updateQueueUI();
    startDownloadQueue();
}

// 开始下载队列
async function startDownloadQueue() {
    // 强制重置 isDownloading 状态，确保不会被卡住
    const pendingTasks = downloadQueue.filter(item => item.status === 'pending');
    const downloadingTasks = downloadQueue.filter(item => item.status === 'downloading');
    
    // 如果有等待的任务但没有正在下载的任务，重置 isDownloading
    if (pendingTasks.length > 0 && downloadingTasks.length === 0) {
        isDownloading = false;
    }
    
    if (isDownloading || downloadQueue.length === 0) {
        return;
    }
    
    // 找到第一个待下载的任务
    const taskIndex = downloadQueue.findIndex(item => item.status === 'pending');
    if (taskIndex === -1) {
        return;
    }
    
    isDownloading = true;
    currentDownloadTask = downloadQueue[taskIndex];
    currentDownloadTask.status = 'downloading';
    updateQueueUI();
    
    try {
        // 下载文件（传入进度回调）
        const result = await window.electronAPI.downloadFile(
            { fileName: currentDownloadTask.fileName, savePath: currentDownloadTask.savePath },
            (current, total, message) => {
                updateTaskProgress(taskIndex, current, total, message);
            }
        );
        
        if (result.success) {
            downloadQueue[taskIndex].status = 'completed';
            downloadQueue[taskIndex].progress = 100;
            downloadQueue[taskIndex].progressText = '下载完成';
            showNotification(`${currentDownloadTask.fileName} 下载完成`, 'success');
        } else {
            throw new Error('下载失败');
        }
    } catch (error) {
        downloadQueue[taskIndex].status = 'error';
        downloadQueue[taskIndex].progressText = '下载失败';
        showNotification(`${currentDownloadTask.fileName} 下载失败: ${error.message}`, 'error');
    } finally {
        isDownloading = false;
        console.log('isDownloading set to false in startDownloadQueue finally');
        currentDownloadTask = null;
        updateQueueUI();
        // 继续下一个任务
        setTimeout(startDownloadQueue, 500);
    }
}

// 更新任务进度
function updateTaskProgress(taskIndex, current, total, message) {
    const task = downloadQueue[taskIndex];
    if (!task || task.status !== 'downloading') return;
    
    const percent = Math.round((current / total) * 100);
    task.progress = percent;
    
    if (message) {
        // 提取分片信息
        const chunkMatch = message.match(/正在下载第 (\d+)\/(\d+) 个分片/);
        if (chunkMatch) {
            task.chunkInfo = `第 ${chunkMatch[1]}/${chunkMatch[2]} 个分片`;
            task.progressText = message;
        } else {
            task.chunkInfo = '';
            task.progressText = message;
        }
    } else {
        task.progressText = `下载中 ${percent}%`;
    }
    
    updateQueueUI();
}

// 更新队列UI
function updateQueueUI() {
    const queueList = document.getElementById('queueList');
    const queueBadge = document.getElementById('queueBadge');
    const emptyQueue = document.getElementById('emptyQueue');
    
    // 更新徽章
    const pendingCount = downloadQueue.filter(item => item.status === 'pending').length;
    const downloadingCount = downloadQueue.filter(item => item.status === 'downloading').length;
    const totalCount = pendingCount + downloadingCount;
    
    if (totalCount > 0) {
        queueBadge.textContent = totalCount;
        queueBadge.style.display = 'inline';
    } else {
        queueBadge.style.display = 'none';
    }
    
    // 更新队列列表
    if (downloadQueue.length === 0) {
        emptyQueue.style.display = 'flex';
        queueList.innerHTML = '';
        queueList.appendChild(emptyQueue);
        return;
    }
    
    emptyQueue.style.display = 'none';
    
    queueList.innerHTML = downloadQueue.map((task, index) => {
        const isActive = task.status === 'downloading';
        const showProgress = isActive || task.status === 'completed' || task.status === 'error';
        
        if (isActive) {
            // 正在下载的文件显示详细信息
            return `
                <div class="queue-item ${isActive ? 'active' : ''}" data-id="${task.id}" data-index="${index}">
                    <div class="queue-item-icon">
                        ${getFileIcon(task.fileName)}
                    </div>
                    <div class="queue-item-info">
                        <div class="queue-item-main">
                            <div class="queue-item-name">${task.fileName}</div>
                            <div class="queue-item-right">
                                <span class="queue-percent">${task.progress}%</span>
                            </div>
                        </div>
                        <div class="queue-progress-container">
                            <div class="queue-progress-bar" style="width: ${task.progress}%"></div>
                        </div>
                        <div class="queue-chunk-info">${task.chunkInfo || '正在下载...'}</div>
                    </div>
                    <div class="queue-item-actions">
                        <button class="queue-action-btn stop queue-btn-stop" data-index="${index}" title="停止下载">
                            <i class="fa-solid fa-square"></i>
                        </button>
                    </div>
                </div>
            `;
        } else {
            // 等待下载/已完成/失败的文件显示状态信息
            let statusText = '';
            let statusClass = '';
            if (task.status === 'pending') {
                statusText = '等待中';
                statusClass = 'queue-status-pending';
            } else if (task.status === 'completed') {
                statusText = '已完成';
                statusClass = 'queue-status-completed';
            } else if (task.status === 'error') {
                statusText = task.progressText || '下载失败';
                statusClass = 'queue-status-error';
            }
            
            return `
                <div class="queue-item" data-id="${task.id}" data-index="${index}">
                    <div class="queue-item-icon">
                        ${getFileIcon(task.fileName)}
                    </div>
                    <div class="queue-item-info">
                        <div class="queue-item-name">${task.fileName}</div>
                        <div class="queue-item-status ${statusClass}">${statusText}</div>
                    </div>
                    <div class="queue-item-actions">
                        ${task.status === 'pending' ? `
                            <button class="queue-action-btn queue-btn-remove" data-index="${index}" title="删除任务">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        ` : ''}
                        ${task.status === 'completed' ? `
                            <button class="queue-action-btn queue-btn-remove" data-index="${index}" title="移除任务">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        ` : ''}
                        ${task.status === 'error' ? `
                            <button class="queue-action-btn queue-btn-retry" data-index="${index}" title="重试下载">
                                <i class="fa-solid fa-refresh"></i>
                            </button>
                            <button class="queue-action-btn queue-btn-remove" data-index="${index}" title="删除任务">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }
    }).join('');
}

// 获取文件图标（与文件列表保持一致）
function getFileIcon(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const iconMap = {
        'pdf': 'fa-file-pdf',
        'doc': 'fa-file-word',
        'docx': 'fa-file-word',
        'xls': 'fa-file-excel',
        'xlsx': 'fa-file-excel',
        'ppt': 'fa-file-powerpoint',
        'pptx': 'fa-file-powerpoint',
        'txt': 'fa-file-text',
        'jpg': 'fa-file-image',
        'jpeg': 'fa-file-image',
        'png': 'fa-file-image',
        'gif': 'fa-file-image',
        'zip': 'fa-file-archive',
        'rar': 'fa-file-archive',
        '7z': 'fa-file-archive',
        'js': 'fa-file-code',
        'json': 'fa-file-code',
        'html': 'fa-file-code',
        'css': 'fa-file-code',
        'exe': 'fa-file-exe'
    };
    
    const iconClass = iconMap[ext] || 'fa-file';
    return `<i class="fa-solid ${iconClass}" style="color: var(--primary-color);"></i>`;
}

// 从队列中移除任务
function removeFromQueue(index) {
    console.log('removeFromQueue called with index:', index, 'queue length before:', downloadQueue.length);
    downloadQueue.splice(index, 1);
    console.log('queue length after:', downloadQueue.length);
    updateQueueUI();
}

// 停止下载
async function stopDownload(index) {
    if (downloadQueue[index].status === 'downloading') {
        // 调用主进程取消下载
        await window.electronAPI.cancelDownload();
        
        downloadQueue[index].status = 'pending';
        downloadQueue[index].progress = 0;
        downloadQueue[index].progressText = '已暂停';
        downloadQueue[index].chunkInfo = '';
        isDownloading = false;
        console.log('isDownloading set to false in stopDownload');
        currentDownloadTask = null;
        updateQueueUI();
        startDownloadQueue();
    }
}

// 重试下载
function retryDownload(index) {
    downloadQueue[index].status = 'pending';
    downloadQueue[index].progress = 0;
    downloadQueue[index].progressText = '等待下载';
    downloadQueue[index].chunkInfo = '';
    updateQueueUI();
    startDownloadQueue();
}

// 清空下载队列
function clearDownloadQueue() {
    downloadQueue = [];
    isDownloading = false;
    currentDownloadTask = null;
    updateQueueUI();
}

// 全局函数导出（供HTML中onclick使用）
window.removeFromQueue = removeFromQueue;
window.stopDownload = stopDownload;
window.retryDownload = retryDownload;

// ==================== 显示新建文件夹模态框（独立于文件详情模态框） ====================
function showCreateFolderModal() {
    // 创建独立的模态框容器
    const folderModalOverlay = document.createElement('div');
    folderModalOverlay.className = 'modal-overlay';
    folderModalOverlay.style.display = 'flex';
    
    const folderModal = document.createElement('div');
    folderModal.className = 'modal';
    
    folderModal.innerHTML = `
        <div class="modal-header">
            <h3>新建文件夹</h3>
            <button class="modal-close" id="folderModalClose">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label for="folderName">名称</label>
                <input type="text" id="folderName" class="form-input" placeholder="请输入文件夹名称">
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn" id="folderModalCancel">取消</button>
            <button class="btn btn-primary" id="folderModalSubmit">创建</button>
        </div>
    `;
    
    folderModalOverlay.appendChild(folderModal);
    document.body.appendChild(folderModalOverlay);
    
    // 添加显示动画
    setTimeout(() => {
        folderModalOverlay.classList.add('active');
    }, 10);
    
    const folderNameInput = document.getElementById('folderName');
    const closeModal = () => {
        folderModalOverlay.classList.remove('active');
        setTimeout(() => {
            document.body.removeChild(folderModalOverlay);
        }, 300);
    };
    
    // 绑定事件
    document.getElementById('folderModalClose').addEventListener('click', closeModal);
    document.getElementById('folderModalCancel').addEventListener('click', closeModal);
    folderModalOverlay.addEventListener('click', (e) => {
        if (e.target === folderModalOverlay) closeModal();
    });
    
    document.getElementById('folderModalSubmit').addEventListener('click', async () => {
        const name = folderNameInput.value.trim();
        if (!name) {
            alert('请输入文件夹名称');
            return;
        }
        
        try {
            await addNewItem('folder', name);
            closeModal();
            showNotification('文件夹创建成功！');
        } catch (error) {
            console.error('创建文件夹失败:', error);
            showNotification('创建文件夹失败: ' + error.message, 'error');
        }
    });
    
    // 聚焦输入框
    setTimeout(() => folderNameInput.focus(), 300);
}

async function addNewItem(type, name) {
    const newId = Math.max(...fileDataList.map(item => item.id), 0) + 1;
    const newItem = {
        id: newId,
        name: name,
        type: type,
        date: new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    };
    
    if (type === 'file') {
        const fileType = document.getElementById('fileType').value;
        newItem.ext = fileType.substring(1);
    }
    
    // 对于文件夹，上传到数据库
    if (type === 'folder') {
        try {
            // 调用上传API，数据和校验码都为"floder"，并设置floder字段为当前目录ID
            const result = await window.electronAPI.uploadFile({
                name: name,
                base64: "floder",
                sha256: "floder",
                floder: currentDirectory
            });
            
            // 获取新文件夹的ID并更新用户的owned_file
            // API返回的数据直接包含id字段，不是嵌套在data对象中
            if (result && result.id) {
                const newFolderId = result.id;
                const userOwnedFileIds = getUserOwnedFileIds();
                userOwnedFileIds.push(newFolderId);
                await updateUserOwnedFiles(userOwnedFileIds);
                
                // 如果是Administrator，实时更新owned_file确保对所有文件的访问
                if (isAdministrator()) {
                    await refreshAdministratorOwnedFiles();
                }
            }
            
            // 重新获取文件列表
            await fetchFilesFromDatabase();
            
            // 显示成功消息
            showNotification('文件夹创建成功！');
        } catch (error) {
            console.error('创建文件夹失败:', error);
            showNotification('创建文件夹失败: ' + error.message, 'error');
            
            // 如果API上传失败，至少在本地添加
            newItem.floder = currentDirectory;
            fileDataList.push(newItem);
            refreshUi();
        }
    } else {
        // 对于文件，只在本地添加（因为文件上传是通过专门的上传按钮处理的）
        newItem.floder = currentDirectory;
        fileDataList.push(newItem);
        refreshUi();
    }
}
