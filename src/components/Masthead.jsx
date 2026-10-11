import ThemeToggle from './ThemeToggle';
import Icon from './Icon';

export default function Masthead({ theme, onToggleTheme, showLogin, user }) {
  return (
    <header>
      <div className="masthead">
        <div className="shell masthead__inner">
          <img
            className="masthead__emblem"
            src="brand/emblem.svg"
            alt="شعار الجمهورية العربية السورية"
          />
          <div className="masthead__titles">
            <span className="masthead__title">منصة مديرية التخطيط والإحصاء</span>
            <span className="masthead__parent">وزارة الطوارئ وإدارة الكوارث</span>
          </div>
          <div className="masthead__tools">
            {user && (
              <span className="masthead__user">
                <span className="masthead__name">{user.name}</span>
                {user.workspace && <a className="masthead__login" href="#/admin">{user.workspace}</a>}
                <button type="button" className="masthead__login" onClick={user.onSignOut}>خروج</button>
              </span>
            )}
            {showLogin && !user && (
              <a className="masthead__login" href="#/admin">
                <Icon name="lock" className="masthead__loginicon" />
                دخول
              </a>
            )}
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
        </div>
      </div>
      <div className="brand-band" aria-hidden="true" />
    </header>
  );
}
