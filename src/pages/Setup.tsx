import { useState } from 'react';
import { useUiStore } from '../stores/uiStore';
import { setPluginDir, getSystemInfo, openPathInExplorer } from '../lib/tauri-commands';

interface SetupProps {
  onComplete: () => void;
}

export function Setup({ onComplete }: SetupProps) {
  const addToast = useUiStore((s) => s.addToast);
  // Pre-fill with previously saved dir (for re-configuration)
  const [dir, setDir] = useState(() => localStorage.getItem('nekoai-plugin-dir') ?? '');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');
  const isReconfig = !!localStorage.getItem('nekoai-plugin-dir');

  async function selectFolder() {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const selected = await open({ directory: true, title: '选择 NekoAI 插件目录' });
      if (selected && typeof selected === 'string') {
        setDir(selected);
        setError('');
      }
    } catch {
      addToast('warning', '文件选择器不可用，请手动输入路径');
    }
  }

  async function openCurrentDir() {
    if (!dir.trim()) {
      addToast('warning', '请先输入或选择插件目录');
      return;
    }

    try {
      await openPathInExplorer(dir.trim());
    } catch (e: any) {
      addToast('error', `打开目录失败: ${e?.message ?? e}`);
    }
  }
  async function validate() {
    if (!dir.trim()) {
      setError('请输入或选择插件目录路径');
      return;
    }
    setValidating(true);
    setError('');
    try {
      // Set dir on Rust backend
      await setPluginDir(dir.trim());
      // Verify the dir works by reading system info
      const info = await getSystemInfo();
      const foundCount = info.files.filter((f) => f.exists).length;

      // Persist to localStorage
      localStorage.setItem('nekoai-plugin-dir', dir.trim());
      localStorage.setItem('nekoai-configured', 'true');

      if (foundCount === 0) {
        addToast('warning', '已连接到目录，但未检测到任何配置文件。请确认目录是否正确。');
      } else {
        addToast('success', `已连接到插件目录，检测到 ${foundCount} 个配置文件`);
      }
      onComplete();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes('not a directory') || msg.includes('No such file')) {
        setError('目录不存在或路径无效，请检查后重试');
      } else {
        setError(msg);
      }
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-full w-full">
      <div className="w-[460px] rounded-[var(--radius)] p-8 border border-[var(--border-subtle)]" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
        {/* Logo */}
        <div className="text-center mb-8">
          <span className="text-6xl block mb-3">🐱</span>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">NekoAI 管理面板</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {isReconfig ? '重新选择插件目录' : '首次运行设置'}
          </p>
        </div>

        {/* Step */}
        <div className="space-y-4">
          <div>
            <label className="text-sm text-[var(--text-secondary)] mb-2 block">
              请选择 NekoAI 插件目录
            </label>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              该目录应包含 <code className="mono text-[var(--accent-purple)]">runtime_config.json</code> 或 <code className="mono text-[var(--accent-purple)]">api_config.json</code> 等配置文件
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={dir}
                onChange={(e) => { setDir(e.target.value); setError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && validate()}
                placeholder="C:\\Users\\...\\Koishi\\plugins\\koishi-plugin-Enhanced-NekoAI"
                className="flex-1 px-3 py-2.5 text-sm mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] placeholder:text-[var(--text-muted)]"
              />
              <button
                onClick={selectFolder}
                className="px-4 py-2.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-purple)] transition-colors cursor-pointer flex-shrink-0"
              >
                📁 浏览
              </button>
              <button
                onClick={openCurrentDir}
                className="px-4 py-2.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-purple)] transition-colors cursor-pointer flex-shrink-0"
              >
                📂 打开目录
              </button>
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-[var(--radius-sm)] bg-[rgba(255,82,82,0.1)] border border-[var(--error)] text-xs text-[var(--error)]">
              {error}
            </div>
          )}

          <button
            onClick={validate}
            disabled={validating || !dir.trim()}
            className={`w-full py-3 text-sm font-medium rounded-[var(--radius-sm)] transition-all cursor-pointer
              ${dir.trim()
                ? 'bg-[var(--accent-purple)] text-white hover:opacity-90'
                : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'
              }`}
          >
            {validating ? '正在验证目录...' : isReconfig ? '确认并重新连接' : '开始使用'}
          </button>

          {/* Tips */}
          <div className="pt-2 border-t border-[var(--border-subtle)]">
            <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
              💡 提示：插件目录通常在 Koishi 的 <code className="mono">plugins</code> 文件夹下，例如 <code className="mono text-[var(--accent-purple)]">Koishi\\plugins\\koishi-plugin-Enhanced-NekoAI</code>
            </p>
          </div>
        </div>

        <p className="text-[10px] text-[var(--text-muted)] text-center mt-6">
          🐾 NekoAI GUI Manager v1.0 — by KanameMadoka520
        </p>
      </div>
    </div>
  );
}
