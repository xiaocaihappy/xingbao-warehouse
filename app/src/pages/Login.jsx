import { useState } from 'react';
import { signIn, signUp } from '../supabase';

const SAVED_EMAIL_KEY = 'xingbao_saved_email';
const DISPLAY_NAME_KEY = 'xingbao_display_name';

export default function Login({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState(() => localStorage.getItem(SAVED_EMAIL_KEY) || '');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(() => localStorage.getItem(DISPLAY_NAME_KEY) || '');
  const [remember, setRemember] = useState(() => !!localStorage.getItem(SAVED_EMAIL_KEY));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        const { data, error } = await signUp(email, password, username);
        if (error) throw error;
        if (data?.user) {
          setError('注册成功！请检查邮箱确认链接，或直接登录。');
          setIsRegister(false);
        }
      } else {
        const { data, error } = await signIn(email, password);
        if (error) throw error;
        if (data?.user) {
          // 保存用户显示名称
          const nameToSave = displayName.trim();
          if (nameToSave) {
            localStorage.setItem(DISPLAY_NAME_KEY, nameToSave);
          }
          if (remember) {
            localStorage.setItem(SAVED_EMAIL_KEY, email);
          } else {
            localStorage.removeItem(SAVED_EMAIL_KEY);
          }
          onLogin(data.user);
        }
      }
    } catch (err) {
      setError(err.message || '操作失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <img src="./XBlogo.png" alt="星堡" className="login-logo" />
          <h1>星堡移印样品</h1>
          <p>仓储系统 · 高效管理 · 精准查询</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          {/* 用户名称 - 登录时显示 */}
          {!isRegister && (
            <div className="form-group">
              <label>用户名称</label>
              <input
                type="text"
                placeholder="请按个人名字填写"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          )}

          {isRegister && (
            <div className="form-group">
              <label>用户名</label>
              <input
                type="text"
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required={isRegister}
              />
            </div>
          )}

          <div className="form-group">
            <label>邮箱</label>
            <input
              type="email"
              placeholder="请输入邮箱地址"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label>密码</label>
            <input
              type="password"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '处理中...' : isRegister ? '注册' : '登录'}
          </button>

          {!isRegister && (
            <label className="remember-row">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => {
                  setRemember(e.target.checked);
                  if (!e.target.checked) localStorage.removeItem(SAVED_EMAIL_KEY);
                }}
              />
              记住账号
            </label>
          )}
        </form>

        <div className="login-toggle">
          {isRegister ? (
            <span>已有账号？<a onClick={() => { setIsRegister(false); setError(''); }}>去登录</a></span>
          ) : (
            <span>没有账号？<a onClick={() => { setIsRegister(true); setError(''); }}>去注册</a></span>
          )}
        </div>
      </div>
    </div>
  );
}