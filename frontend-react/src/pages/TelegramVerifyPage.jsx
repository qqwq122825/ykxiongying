import React, { useEffect, useRef, useState } from 'react'

const V6Logo = () => (
  <div style={{ width: 96, height: 96, margin: '0 auto 14px', borderRadius: 22, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(167,139,250,0.45)', boxShadow: '0 0 40px rgba(56,189,248,0.25)' }}>
    <svg viewBox="0 0 100 100" width="64" height="64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="48" r="40" stroke="#22d3ee" strokeWidth="5" fill="none" />
      <path d="M28 44 C28 26, 72 26, 72 44 L72 62 C72 68, 66 70, 60 66 L56 62 L44 62 L40 66 C34 70, 28 68, 28 62 Z" fill="#22d3ee" />
      <circle cx="40" cy="46" r="4.2" fill="#0b0d10" />
      <circle cx="60" cy="46" r="4.2" fill="#0b0d10" />
      <path d="M44 54 Q50 59 56 54" stroke="#0b0d10" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  </div>
)

const StarIcon = () => (
  <div style={{
    width: 64, height: 64, borderRadius: 18, margin: '10px auto 16px',
    background: 'linear-gradient(135deg, rgba(249,115,22,0.12) 0%, rgba(168,85,247,0.12) 100%)',
    border: '1px solid rgba(249,115,22,0.25)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)'
  }}>
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none">
      <path d="M12 3 L14.3 9.3 L21 9.8 L16 14.2 L17.6 21 L12 17.3 L6.4 21 L8 14.2 L3 9.8 L9.7 9.3 Z"
            fill="#fb923c" stroke="#fdba74" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  </div>
)

export default function TelegramVerifyPage({ account, challengeId, expiresIn = 300, onSubmit, onBack }) {
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [remaining, setRemaining] = useState(expiresIn)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const firstRef = useRef(null)
  const inputsRef = useRef([])

  useEffect(() => { setRemaining(expiresIn) }, [expiresIn])
  useEffect(() => { firstRef.current?.focus?.() }, [])
  useEffect(() => {
    if (remaining <= 0) return
    const t = setInterval(() => setRemaining(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [remaining])

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')

  function onDigitChange(i, v) {
    setError('')
    const ch = v.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[i] = ch
    setDigits(next)
    if (ch && i < 5) setTimeout(() => inputsRef.current[i + 1]?.focus?.(), 0)
  }

  function onKeyDown(e, i) {
    if (e.key === 'Backspace') {
      if (!digits[i] && i > 0) {
        e.preventDefault()
        const next = [...digits]; next[i - 1] = ''; setDigits(next)
        setTimeout(() => inputsRef.current[i - 1]?.focus?.(), 0)
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault(); inputsRef.current[i - 1]?.focus?.()
    } else if (e.key === 'ArrowRight' && i < 5) {
      e.preventDefault(); inputsRef.current[i + 1]?.focus?.()
    } else if (e.key === 'Enter') {
      e.preventDefault(); submit()
    }
  }

  function onPaste(e) {
    const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6)
    if (!text) return
    e.preventDefault()
    const next = ['', '', '', '', '', '']
    for (let i = 0; i < Math.min(text.length, 6); i++) next[i] = text[i]
    setDigits(next)
    setError('')
    const focusIdx = Math.min(text.length, 5)
    setTimeout(() => inputsRef.current[focusIdx]?.focus?.(), 0)
  }

  async function submit() {
    const code = digits.join('')
    if (code.length !== 6) { setError('请输入完整的6位验证码'); return }
    if (remaining <= 0) { setError('验证码已过期，请返回重新登录'); return }
    setSubmitting(true); setError('')
    try { await onSubmit(code) }
    catch (err) { setError(err.message || '验证码错误或已过期') }
    finally { setSubmitting(false) }
  }

  return (
    <div className="login-page" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <div className="login-bg" />
      <div className="login-grid" />

      <div style={{ position: 'relative', zIndex: 2, height: '100vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', boxSizing: 'border-box' }}>
        <V6Logo />

        <h1 className="login-title" style={{ textAlign: 'center', margin: '0 0 4px', fontSize: 34, fontWeight: 800, background: 'linear-gradient(135deg,#fb923c 0%,#ef4444 35%,#d946ef 70%,#a78bfa 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', letterSpacing: 2 }}>
          V6-设备管理后台
        </h1>
        <div className="login-subtitle" style={{ textAlign: 'center', color: '#a78bfa', fontSize: 13, letterSpacing: 4, marginBottom: 26, fontWeight: 500, opacity: 0.95 }}>
          DEVICE MANAGEMENT SYSTEM
        </div>

        <div className="login-card" style={{ width: 'min(460px, 94vw)', position: 'relative', margin: '0 auto' }}>
          <span className="corner tl"></span>
          <span className="corner tr"></span>
          <span className="corner bl"></span>
          <span className="corner br"></span>

          <div className="login-band" style={{ padding: '14px 22px', textAlign: 'center', fontSize: 13, color: '#a78bfa', fontWeight: 600, letterSpacing: 1, marginBottom: 18 }}>
            Secure Access <span style={{ color: '#fb923c', margin: '0 6px' }}>◆</span> 安全接入认证
          </div>

          <StarIcon />

          <div style={{ textAlign: 'center', fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: 1, marginBottom: 10 }}>
            Telegram 安全验证
          </div>
          <div style={{ textAlign: 'center', fontSize: 14, color: '#a78bfa', marginBottom: 22, fontWeight: 500 }}>
            验证码已发送到你的 Telegram
          </div>

          <div
            className="tg-otp-row"
            onPaste={onPaste}
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 14,
              marginBottom: 18
            }}
          >
            {digits.map((d, i) => (
              <input
                key={i}
                type="text"
                inputMode="numeric"
                pattern="\d*"
                maxLength={1}
                value={d}
                ref={el => { inputsRef.current[i] = el; if (i === 0) firstRef.current = el }}
                onChange={e => onDigitChange(i, e.target.value)}
                onKeyDown={e => onKeyDown(e, i)}
                onFocus={e => { e.target.style.borderColor = '#fb923c'; e.target.style.boxShadow = '0 0 0 3px rgba(251,146,60,0.18)' }}
                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; e.target.style.boxShadow = 'none' }}
                style={{
                  width: 56,
                  height: 68,
                  borderRadius: 14,
                  border: '2px solid rgba(255,255,255,0.08)',
                  background: d ? 'rgba(251,146,60,0.05)' : 'rgba(255,255,255,0.04)',
                  color: '#fff',
                  fontSize: 28,
                  fontWeight: 700,
                  textAlign: 'center',
                  outline: 'none',
                  fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
                  caretColor: '#fb923c',
                  transition: 'all 0.15s'
                }}
              />
            ))}
          </div>

          <div style={{ textAlign: 'center', fontSize: 14, color: '#a78bfa', fontWeight: 500, marginBottom: 24 }}>
            验证码有效期 <span style={{ color: '#fff', fontWeight: 600, letterSpacing: 1 }}>{mm}:{ss}</span>
          </div>

          {error && (
            <div className="login-error" style={{ marginBottom: 18, fontSize: 13, padding: '10px 14px', borderRadius: 10 }}>{error}</div>
          )}

          <button
            type="button"
            className="login-btn"
            disabled={submitting || remaining <= 0 || digits.some(x => !x)}
            onClick={submit}
            style={{
              width: '100%',
              padding: '14px 18px',
              borderRadius: 14,
              border: 'none',
              color: '#fff',
              fontWeight: 700,
              fontSize: 16,
              letterSpacing: 2,
              cursor: submitting || remaining <= 0 || digits.some(x => !x) ? 'not-allowed' : 'pointer',
              background: (submitting || remaining <= 0 || digits.some(x => !x))
                ? 'linear-gradient(135deg, #475569 0%, #334155 100%)'
                : 'linear-gradient(135deg, #f97316 0%, #fb7185 35%, #ec4899 65%, #d946ef 100%)',
              opacity: (submitting || remaining <= 0 || digits.some(x => !x)) ? 0.55 : 1,
              boxShadow: (submitting || remaining <= 0 || digits.some(x => !x)) ? 'none' : '0 10px 30px rgba(236,72,153,0.25)',
              marginBottom: 18
            }}
          >
            {submitting ? '验 证 中...' : '验证并进入系统'}
          </button>

          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <button
              type="button"
              onClick={onBack}
              style={{
                background: 'none',
                border: 'none',
                color: '#a78bfa',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                padding: '6px 10px',
                letterSpacing: 0.5
              }}
            >← 返回重新登录</button>
          </div>

          <div className="login-foot" style={{ textAlign: 'center', fontSize: 11, color: 'rgba(148,163,184,0.6)', letterSpacing: 2, padding: '6px 0 2px' }}>
            ENCRYPTED · V6 设备管理后台
          </div>
        </div>
      </div>
    </div>
  )
}
