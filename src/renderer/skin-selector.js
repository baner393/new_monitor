  /**
   * 皮肤选择面板
   *
   * 功能：
   * - 显示可用皮肤列表（名称、预览图、描述）
   * - 点击切换皮肤
   * - 记住上次选择（localStorage）
   */

export class SkinSelector {
  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'skin-selector';
    this.container.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(10px);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      font-family: 'Mojang', 'Unifont', monospace;
      color: white;
    `;

    this.isOpen = false;
    this.skins = [];
    this.currentSkin = 'turtle';
    this.onSkinChange = null;
    this._configPath = null;

    this._buildUI();
  }

  _buildUI() {
    // 标题
    const title = document.createElement('h1');
    title.textContent = '选择皮肤';
    title.style.cssText = `
      font-size: 24px;
      margin-bottom: 30px;
      text-shadow: 2px 2px 0 #000;
    `;
    this.container.appendChild(title);

    // 皮肤网格
    this.skinGrid = document.createElement('div');
    this.skinGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 20px;
      max-width: 700px;
      width: 90%;
      max-height: 60vh;
      overflow-y: auto;
      padding: 20px;
    `;
    this.container.appendChild(this.skinGrid);

    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = `
      margin-top: 30px;
      padding: 10px 30px;
      background: #666;
      color: white;
      border: 2px solid #555;
      font-family: 'Mojang', 'Unifont', monospace;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
    `;
    closeBtn.onmouseover = () => closeBtn.style.transform = 'scale(1.05)';
    closeBtn.onmouseout = () => closeBtn.style.transform = 'scale(1)';
    closeBtn.onclick = () => this.close();
    this.container.appendChild(closeBtn);

    // ESC 关闭
    this.container.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  /**
   * 加载皮肤配置
   * 优先 IPC（读取 userData 可写路径，返回 file:// 绝对路径）
   * 回退 fetch（读取 ASAR 内置皮肤）
   * @param {string} [configPath] - 可选的回退 URL
   */
  async loadSkins(configPath) {
    this._configPath = configPath;

    // Try IPC first (reads from writable userData, frame paths are file://)
    if (window.electronAPI?.getSkinConfig) {
      try {
        const config = await window.electronAPI.getSkinConfig();
        if (config && Array.isArray(config.skins) && config.skins.length > 0) {
          this._applyConfig(config);
          return;
        }
      } catch (err) {
        console.warn('[SkinSelector] IPC load failed, falling back:', err.message);
      }
    }

    // Fallback: fetch from URL (ASAR, built-in skins only)
    if (!configPath) {
      console.error('[SkinSelector] No configPath and IPC unavailable');
      this._applyConfig({ skins: [], defaultSkin: 'turtle' });
      return;
    }
    try {
      const response = await fetch(configPath + '?t=' + Date.now());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const config = await response.json();
      this._applyConfig(config);
    } catch (err) {
      console.error('[SkinSelector] Failed to load skins:', err.message);
    }
  }

  /**
   * Apply parsed skin config to state, trigger texture loading.
   * @param {{ skins: Array, defaultSkin: string }} config
   */
  async _applyConfig(config) {
    if (Array.isArray(config.skins)) {
      this.skins = config.skins;
    }

    // 等待 IPC 获取上次选择的皮肤
    await this._resolveSavedSkin(config);

    this._renderSkinGrid();

    // 触发皮肤切换回调，纹理从 file:// 路径加载
    const activeSkin = this.skins.find(s => s.id === this.currentSkin);
    if (activeSkin && this.onSkinChange) {
      this.onSkinChange(this.currentSkin, {
        ...activeSkin,
        sprites: activeSkin.frames,
      });
    }

    console.log('[SkinSelector] Skins loaded:', this.skins.map(s => s.id));
  }

  async _resolveSavedSkin(config) {
    try {
      if (window.electronAPI?.skin?.get) {
        const saved = await window.electronAPI.skin.get();
        if (saved && this.skins.some(s => s.id === saved)) {
          this.currentSkin = saved;
          console.log('[SkinSelector] Loaded saved skin from IPC:', saved);
          return;
        }
      }
      // Fallback
      const saved = localStorage.getItem('selectedSkin');
      if (saved && this.skins.some(s => s.id === saved)) {
        this.currentSkin = saved;
        return;
      }
    } catch (err) {
      console.warn('[SkinSelector] Failed to load saved skin:', err.message);
    }
    this.currentSkin = config.defaultSkin || 'turtle';
  }

  /**
   * 重新加载皮肤配置（导入新皮肤后调用）
   */
  async reload() {
    await this.loadSkins(this._configPath);
  }

  _renderSkinGrid() {
    this.skinGrid.innerHTML = '';

    this.skins.forEach((skin) => {
      const isSelected = skin.id === this.currentSkin;

      const card = document.createElement('div');
      card.style.cssText = `
        background: ${isSelected ? '#2a4a2a' : '#2a2a2a'};
        border: 2px solid ${isSelected ? '#4CAF50' : '#444'};
        border-radius: 8px;
        padding: 15px;
        cursor: pointer;
        text-align: center;
        transition: all 0.2s;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      `;
      card.onmouseover = () => {
        if (!isSelected) card.style.borderColor = '#888';
        card.style.transform = 'scale(1.05)';
      };
      card.onmouseout = () => {
        card.style.borderColor = isSelected ? '#4CAF50' : '#444';
        card.style.transform = 'scale(1)';
      };
      card.onclick = () => this._selectSkin(skin.id);

      // 预览图
      const previewWrap = document.createElement('div');
      previewWrap.style.cssText = `
        width: 64px; height: 64px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.3);
        border-radius: 4px;
        overflow: hidden;
      `;

      const preview = document.createElement('img');
      preview.src = skin.preview;
      preview.style.cssText = `
        max-width: 64px; max-height: 64px;
        image-rendering: pixelated;
        object-fit: contain;
      `;
      preview.onerror = () => {
        preview.style.display = 'none';
        const ph = document.createElement('div');
        ph.textContent = '?';
        ph.style.cssText = 'font-size:24px; color:#666;';
        previewWrap.appendChild(ph);
      };
      previewWrap.appendChild(preview);
      card.appendChild(previewWrap);

      // 名称
      const name = document.createElement('div');
      name.textContent = skin.displayName || skin.name || skin.id;
      name.style.cssText = `
        font-size: 14px; font-weight: bold;
        color: ${isSelected ? '#4CAF50' : '#ddd'};
      `;
      card.appendChild(name);

      // 描述
      if (skin.description) {
        const desc = document.createElement('div');
        desc.textContent = skin.description;
        desc.style.cssText = `
          font-size: 11px; color: #999;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        `;
        card.appendChild(desc);
      }

      // 选中标记
      if (isSelected) {
        const badge = document.createElement('div');
        badge.textContent = '✓ 使用中';
        badge.style.cssText = 'font-size:11px; color:#4CAF50; margin-top:2px;';
        card.appendChild(badge);
      }

      this.skinGrid.appendChild(card);
    });
  }

  _selectSkin(skinId) {
    if (skinId === this.currentSkin) return;

    this.currentSkin = skinId;
    this._renderSkinGrid();

    // 通过 IPC 持久化到文件（可靠，支持 file:// 协议）
    if (window.electronAPI?.skin?.set) {
      window.electronAPI.skin.set(skinId);
    }
    // Fallback: 也写 localStorage 做兼容
    localStorage.setItem('selectedSkin', skinId);

    const skinData = this.skins.find(s => s.id === skinId);
    if (!skinData) return;

    if (this.onSkinChange) {
      this.onSkinChange(skinId, {
        ...skinData,
        sprites: skinData.frames,
      });
    }

    console.log(`[SkinSelector] Switched to skin: ${skinId}`);
  }

  open() {
    this.isOpen = true;
    this.container.style.display = 'flex';
    this._renderSkinGrid();
    if (window.electronAPI?.setIgnoreMouseEvents) {
      window.electronAPI.setIgnoreMouseEvents(false);
    }
  }

  close() {
    this.isOpen = false;
    this.container.style.display = 'none';
    if (window.electronAPI?.setIgnoreMouseEvents) {
      window.electronAPI.setIgnoreMouseEvents(true);
    }
  }

  getCurrentSkin() {
    const skin = this.skins.find(s => s.id === this.currentSkin);
    return skin ? { ...skin, sprites: skin.frames } : null;
  }
}
