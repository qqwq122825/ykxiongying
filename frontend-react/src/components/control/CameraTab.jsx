/**
 * 摄像头/录音Tab - 摄像头和麦克风控制
 * 从 ControlPage.jsx 提取 (lines 2346-2471)
 */
export default function CameraTab({
  deviceSleeping,
  deviceOnline,
  camActive,
  camFacing,
  camSrc,
  setCamFacing,
  setCamActive,
  setCamSrc,
  camActiveRef,
  micActive,
  micQuality,
  micMode,
  micDuration,
  micNoiseSuppression,
  setMicQuality,
  setMicMode,
  setMicDuration,
  setMicNoiseSuppression,
  setMicActive,
  resolvedDeviceId,
  sendWs,
  addLog,
  centerToast,
}) {
  function startCamera(facing) {
    setCamFacing(facing)
    setCamActive(true)
    camActiveRef.current = true
    sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'CAMERA_SWITCH', params: { cameraType: facing } } })
    addLog(`摄像头启动: ${facing === 'front' ? '前置' : '后置'}`)
    centerToast(`${facing === 'front' ? '前置' : '后置'}摄像头启动中...`)
  }
  function stopCamera() {
    setCamActive(false)
    camActiveRef.current = false
    sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'CAMERA_STOP', params: {} } })
    setCamSrc('')
    addLog('摄像头已停止')
    centerToast('摄像头已停止')
  }
  function switchCamFacing(facing) {
    if (camActive && camFacing === facing) { stopCamera(); return }
    startCamera(facing)
  }
  function refreshCamera() {
    if (!camActive) return
    sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'CAMERA_SWITCH', params: { cameraType: camFacing } } })
    addLog('摄像头刷新')
  }
  function startMic() {
    sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'MICROPHONE_SET_CONFIG', params: { qualityMode: micQuality, audioSource: micMode, volumeGain: 2, noiseSuppression: micNoiseSuppression } } })
    setTimeout(() => {
      sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'MICROPHONE_START_RECORDING', params: {} } })
    }, 200)
    setMicActive(true)
    addLog('麦克风录制启动')
    centerToast('麦克风启动')
  }
  function stopMic() {
    setMicActive(false)
    sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'MICROPHONE_STOP_RECORDING', params: {} } })
    addLog('麦克风录制已停止')
    centerToast('麦克风已停止')
  }

  return (
    <div className="ctrl-tab-content">
      <div className="ctrl-tab-panel">
        <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ width: 4, height: 18, background: '#1890ff', borderRadius: 2, marginRight: 8 }} />
            <span style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>📸 摄像头 / 🎙️ 录音</span>
            <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: deviceSleeping ? 'rgba(245,158,11,.15)' : (deviceOnline ? 'rgba(82,196,26,.15)' : 'rgba(239,68,68,.15)'), color: deviceSleeping ? '#f59e0b' : (deviceOnline ? '#52c41a' : '#f87171') }}>{deviceSleeping ? '休眠中' : (deviceOnline ? '已连接' : '未连接')}</span>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ padding: '10px 0', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => switchCamFacing('front')} style={{ padding: '5px 14px', fontSize: 12, borderRadius: 6, border: 'none', background: camActive && camFacing === 'front' ? 'linear-gradient(135deg, #52c41a, #389e0d)' : 'linear-gradient(135deg, #1890ff, #096dd9)', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>{camActive && camFacing === 'front' ? '✕ 关闭前置' : '📷 前置'}</button>
                <button onClick={() => switchCamFacing('back')} style={{ padding: '5px 14px', fontSize: 12, borderRadius: 6, border: 'none', background: camActive && camFacing === 'back' ? 'linear-gradient(135deg, #52c41a, #389e0d)' : 'linear-gradient(135deg, #1890ff, #096dd9)', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>{camActive && camFacing === 'back' ? '✕ 关闭后置' : '📷 后置'}</button>
              </div>
              <button onClick={refreshCamera} disabled={!camActive} style={{ width: 30, height: 30, padding: 0, borderRadius: 6, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.05)', color: '#e2e8f0', cursor: camActive ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }} title="刷新画面">🔄</button>
              {camActive && <button onClick={() => switchCamFacing(camFacing === 'front' ? 'back' : 'front')} style={{ padding: '5px 14px', fontSize: 12, borderRadius: 6, border: 'none', background: '#722ed1', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>🔄 切换</button>}
            </div>

            <div style={{ width: '100%', height: 360, borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.08)' }}>
              {camSrc ? (
                <img src={camSrc} alt="camera" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: 48, marginBottom: 8, display: 'block', opacity: 0.5 }}>📷</span>
                    <div style={{ fontSize: 13 }}>{camActive ? '连接中...' : '摄像头待机'}</div>
                    <div style={{ fontSize: 11, marginTop: 4, color: '#475569' }}>点击"启动"开始摄像头监控</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 4, height: 18, background: '#fa8c16', borderRadius: 2 }} />
              <span style={{ fontSize: 14, fontWeight: 500, color: '#fff' }}>🎙️ 麦克风录音</span>
              {micActive && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(239,68,68,.15)', color: '#f87171', fontWeight: 600 }}>● 录制中</span>}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={micQuality} onChange={e => setMicQuality(e.target.value)} style={{ padding: '5px 10px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.05)', color: '#e2e8f0' }}>
                <option value="STANDARD" style={{ background: '#1e293b' }}>标准</option>
                <option value="HIGH" style={{ background: '#1e293b' }}>高清</option>
                <option value="LOW" style={{ background: '#1e293b' }}>省流</option>
              </select>
              <select value={micMode} onChange={e => setMicMode(e.target.value)} style={{ padding: '5px 10px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.05)', color: '#e2e8f0' }}>
                <option value="VOICE_RECOGNITION" style={{ background: '#1e293b' }}>语音识别</option>
                <option value="MIC" style={{ background: '#1e293b' }}>麦克风</option>
                <option value="VOICE_COMMUNICATION" style={{ background: '#1e293b' }}>通话</option>
                <option value="CAMCORDER" style={{ background: '#1e293b' }}>摄像机</option>
                <option value="DEFAULT" style={{ background: '#1e293b' }}>默认</option>
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 80 }}>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>倍数</span>
                <select value={micDuration} onChange={e => setMicDuration(Number(e.target.value))} style={{ padding: '3px 8px', fontSize: 11, borderRadius: 4, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.05)', color: '#e2e8f0' }}>
                  <option value={1}>1x</option><option value={1.5}>1.5x</option><option value={2}>2x</option><option value={3}>3x</option>
                </select>
              </div>
              <button onClick={() => { setMicNoiseSuppression(!micNoiseSuppression); centerToast(micNoiseSuppression ? '降噪已关闭' : '降噪已开启') }} style={{ padding: '5px 12px', fontSize: 11, borderRadius: 6, border: micNoiseSuppression ? '1px solid rgba(82,196,26,.4)' : '1px solid rgba(255,255,255,.15)', background: micNoiseSuppression ? 'rgba(82,196,26,.15)' : 'rgba(255,255,255,.05)', color: micNoiseSuppression ? '#52c41a' : '#94a3b8', cursor: 'pointer', fontWeight: 500 }}>{micNoiseSuppression ? '🔇 降噪开' : '🔊 降噪关'}</button>
              <button onClick={micActive ? stopMic : startMic} style={{ padding: '5px 16px', fontSize: 12, borderRadius: 6, border: 'none', background: micActive ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 'linear-gradient(135deg, #fa8c16, #d46b08)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>{micActive ? '⏹ 停止' : '▶ 启动'}</button>
            </div>
          </div>

          <div style={{ marginTop: 12, textAlign: 'center', color: '#64748b', fontSize: 11 }}>
            摄像头 ~100KB/s · 麦克风 16kHz · 画面自动刷新
          </div>
        </div>
      </div>
    </div>
  )
}
