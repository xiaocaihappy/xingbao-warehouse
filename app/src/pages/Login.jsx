import { useState } from "react";
import { useAuth } from "../AuthContext";

const SAVED_EMAIL_KEY = "xingbao_saved_email";
const DISPLAY_NAME_KEY = "xingbao_display_name";

export default function Login() {
  const { signIn, signUp, resetPassword, guestLogin } = useAuth();

  const [isRegister, setIsRegister] = useState(false);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [email, setEmail] = useState(() => localStorage.getItem(SAVED_EMAIL_KEY) || "");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState(() => localStorage.getItem(DISPLAY_NAME_KEY) || "");
  const [remember, setRemember] = useState(() => !!localStorage.getItem(SAVED_EMAIL_KEY));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      // 密码重置模式
      if (isResetPassword) {
        const { error } = await resetPassword(email);
        if (error) throw error;
        setSuccess("密码重置邮件已发送！请检查您的邮箱。");
        setIsResetPassword(false);
        setLoading(false);
        return;
      }

      // 注册模式
      if (isRegister) {
        const { data, error } = await signUp(email, password, username);
        if (error) throw error;
        if (data?.user) {
          setSuccess("注册成功！请检查邮箱确认链接，或直接登录。");
          setIsRegister(false);
        }
        setLoading(false);
        return;
      }

      // 登录模式
      const { data, error } = await signIn(email, password);
      if (error) throw error;
      if (data?.user) {
        const nameToSave = displayName.trim();
        if (nameToSave) {
          localStorage.setItem(DISPLAY_NAME_KEY, nameToSave);
        }
        if (remember) {
          localStorage.setItem(SAVED_EMAIL_KEY, email);
        } else {
          localStorage.removeItem(SAVED_EMAIL_KEY);
        }
      }
    } catch (err) {
      setError(err.message || "操作失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  function switchMode(mode) {
    setIsRegister(mode === "register");
    setIsResetPassword(mode === "reset");
    setError("");
    setSuccess("");
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
        {success && <div className="login-success">{success}</div>}

        <form onSubmit={handleSubmit}>
          {/* 密码重置 - 只需要邮箱 */}
          {isResetPassword ? (
            <>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
                输入您的注册邮箱，我们将发送密码重置链接。
              </p>
              <div className="form-group">
                <label>邮箱</label>
                <input
                  type="email"
                  placeholder="请输入注册邮箱"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "发送中..." : "发送重置邮件"}
              </button>
            </>
          ) : (
            <>
              {/* 登录时显示显示名称 */}
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

              {/* 注册时显示用户名 */}
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
                {loading ? "处理中..." : isRegister ? "注册" : "登录"}
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

              {/* 游客登录：免认证只读进入 */}
              {!isRegister && !isResetPassword && (
                <button
                  type="button"
                  className="btn btn-ghost-guest"
                  onClick={() => guestLogin()}
                  title="无需账号即可进入，仅可查看、查询与导出，不能存储或修改数据"
                >
                  👁 游客登录（只读）
                </button>
              )}
            </>
          )}
        </form>

        <div className="login-toggle">
          {isResetPassword ? (
            <span>
              返回{" "}
              <a onClick={() => switchMode("login")}>登录</a>
            </span>
          ) : isRegister ? (
            <span>
              已有账号？<a onClick={() => switchMode("login")}>去登录</a>
            </span>
          ) : (
            <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
              <span>
                没有账号？<a onClick={() => switchMode("register")}>去注册</a>
              </span>
              <span>
                <a onClick={() => switchMode("reset")} style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                  忘记密码？
                </a>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
