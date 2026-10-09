import { useState } from 'react'
import RcBackground from '../components/RcBackground'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function submit(e){ e.preventDefault(); setError(''); setLoading(true); try{ await onLogin(username,password) }catch(err){ setError(err.message || '登录失败') } finally{ setLoading(false) } }
  return <main className="login-page"><RcBackground/><section className="login-wrap"><header className="login-header"><img src="/hdkj.png" alt="黑洞科技" className="login-logo-img" style={{width:'80px',height:'80px',borderRadius:'16px',marginBottom:'12px',boxShadow:'0 4px 24px rgba(0,0,0,0.3)'}}/><h1>黑洞科技-设备管理后台</h1><p>Device Management System</p></header><form className="login-card" onSubmit={submit}><span className="corner tl"/><span className="corner tr"/><span className="corner bl"/><span className="corner br"/><div className="welcome">Secure Access <b>◆</b> 安全接入认证</div>{error&&<div className="login-error">{error}</div>}<label>管理员账号<input value={username} onChange={e=>setUsername(e.target.value)} placeholder="请输入账号" autoFocus /></label><label>安全密码<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="请输入密码" /></label><button disabled={loading}>{loading?'验证中...':'安全进入系统'}</button><footer>ENCRYPTED · 黑洞科技 设备管理后台</footer></form></section></main>
}
