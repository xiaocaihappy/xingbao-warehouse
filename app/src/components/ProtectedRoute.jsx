import { useAuth } from "../AuthContext";

/**
 * ProtectedRoute - 受保护的路由组件
 * 包装需要登录才能访问的页面内容。
 * 用法: <ProtectedRoute><YourComponent /></ProtectedRoute>
 *
 * role (可选): 指定角色要求，如 "admin"
 */
export default function ProtectedRoute({ children, role }) {
  const { user, loading } = useAuth();

  // 加载中 - 显示加载状态
  if (loading) {
    return (
      <div className="login-container">
        <div className="loading">
          <div className="spinner" />
          <p style={{ marginTop: 16 }}>验证身份中...</p>
        </div>
      </div>
    );
  }

  // 未登录 - 由 App.jsx 自动处理，不会渲染 children
  if (!user) {
    return null;
  }

  // 角色检查 (可选)
  if (role && user?.user_metadata?.role !== role) {
    return (
      <div className="login-container">
        <div style={{ textAlign: "center", maxWidth: 400, padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🚫</div>
          <h2 style={{ color: "var(--text)", marginBottom: 8 }}>无权限访问</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
            您的账户没有访问此页面的权限。
          </p>
        </div>
      </div>
    );
  }

  return children;
}
