// ScreenView.jsx —— 木马投屏双层 img 粘滞帧 + 错误重连 + 状态角标
// 2026-08-05：根据 Claude 5.0 方案 1a 实施
//
// 关键设计：
// - 稳定层（stable）：URL 不变，浏览器不重发请求，永远保留最后一帧
// - 活动层（active）：每次重连换 &v=N，活动层第一帧渲染成功后覆盖稳定层
// - 断流期间稳定层一直显示，画面不黑屏
// - 退避重连（带抖动）防止打爆后端
// - 状态角标让用户知道当前连接状态
import { useEffect, useRef, useState, useCallback } from 'react';

const BASE_SRC = (deviceId) =>
  `${window.location.origin}/api/tunnel/minicap-stream?deviceId=${encodeURIComponent(deviceId)}`;

const STATUS_TEXT = {
  connecting: '连接中…',
  live: '投屏中',
  slow: '网络较慢…',
  reconnecting: '断流，自动恢复中…',
  stalled: '画面停滞，正在强制刷新…',
  error: '投屏异常',
};

const STATUS_COLOR = {
  connecting: '#1890ff',
  live: '#52c41a',
  slow: '#faad14',
  reconnecting: '#1890ff',
  stalled: '#faad14',
  error: '#ff4d4f',
};

export default function ScreenView({ deviceId, onPointerDown, onPointerMove, onPointerUp }) {
  const [gen, setGen] = useState(0);              // 活动层重连代数
  const [status, setStatus] = useState('connecting');
  const [liveReady, setLiveReady] = useState(false);
  const [stableReady, setStableReady] = useState(false);
  const genRef = useRef(0);
  const slowTimer = useRef(null);
  const stallTimer = useRef(null);
  const lastFrameAt = useRef(Date.now());

  // 活动层 src（带 &v 防缓存）
  const liveSrc = `${BASE_SRC(deviceId)}&v=${gen}`;

  // 活动层切换时重置状态
  useEffect(() => {
    setLiveReady(false);
    setStatus('connecting');
    clearTimeout(slowTimer.current);
    clearTimeout(stallTimer.current);
    slowTimer.current = setTimeout(() => {
      if (!liveReady) setStatus('slow');
    }, 8000);
    // 5s 没拿到帧 → 主动断连触发重连（防 TCP 假死）
    stallTimer.current = setTimeout(() => {
      if (!liveReady) {
        setStatus('stalled');
        reloadActive();
      }
    }, 12000);
    return () => {
      clearTimeout(slowTimer.current);
      clearTimeout(stallTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen]);

  const reloadActive = useCallback(() => {
    setGen((g) => { const next = g + 1; genRef.current = next; return next; });
  }, []);

  const onLiveLoad = useCallback(() => {
    clearTimeout(slowTimer.current);
    clearTimeout(stallTimer.current);
    setLiveReady(true);
    setStatus('live');
    lastFrameAt.current = Date.now();
  }, []);

  const onLiveError = useCallback(() => {
    setStatus('reconnecting');
    // 退避重连：500ms 起跳，2 倍递增，上限 8s，加 ±20% 抖动（防多个客户端同时打）
    const backoff = Math.min(500 * 2 ** (genRef.current % 6), 8000) * (0.8 + Math.random() * 0.4);
    setTimeout(() => reloadActive(), backoff);
  }, [reloadActive]);

  // 稳定层 onLoad：标记有图可显示（无论稳定层之后是否 error），让 stableReady=true
  const onStableLoad = useCallback(() => {
    setStableReady(true);
  }, []);

  // 监听 src 变化时重置（避免更新时间错乱）
  useEffect(() => {
    if (gen === 0) return; // 初次不 reset
    setLiveReady(false);
    setStatus('connecting');
  }, [gen]);

  // 关闭时清理
  useEffect(() => {
    return () => {
      clearTimeout(slowTimer.current);
      clearTimeout(stallTimer.current);
    };
  }, []);

  return (
    <div className="screen-wrap" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* 稳定层：URL 不变，断流期间保留最后一帧（浏览器不重发请求） */}
      <img
        src={BASE_SRC(deviceId)}
        alt=""
        draggable={false}
        onLoad={onStableLoad}
        style={{
          position: 'absolute', inset: 0, zIndex: 1,
          width: '100%', height: '100%', objectFit: 'contain',
          opacity: stableReady ? 1 : 0,
          background: '#000',
          pointerEvents: 'none',
        }}
      />
      {/* 活动层：每次重连换 &v=gen，第一帧渲染前透明，出帧后盖住稳定层 */}
      <img
        key={gen}
        src={liveSrc}
        alt="screen"
        draggable={false}
        onLoad={onLiveLoad}
        onError={onLiveError}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: 'absolute', inset: 0, zIndex: 2,
          width: '100%', height: '100%', objectFit: 'contain',
          opacity: liveReady ? 1 : 0,
          background: '#000',
          cursor: 'crosshair',
          transition: 'opacity 0.2s ease',
          userSelect: 'none', touchAction: 'none',
        }}
      />
      <StatusPill status={status} />
    </div>
  );
}

function StatusPill({ status }) {
  if (status === 'live') return null;
  return (
    <div style={{
      position: 'absolute', top: 8, left: 8, zIndex: 10,
      padding: '4px 10px',
      background: 'rgba(0,0,0,0.6)',
      color: STATUS_COLOR[status] || '#aaa',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 600,
      backdropFilter: 'blur(4px)',
      pointerEvents: 'none',
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: STATUS_COLOR[status] || '#aaa',
        animation: status === 'reconnecting' ? 'pulse 1.5s infinite' : 'none',
      }} />
      {STATUS_TEXT[status] || status}
    </div>
  );
}