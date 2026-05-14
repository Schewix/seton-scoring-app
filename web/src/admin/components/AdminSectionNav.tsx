import {
  ADMIN_PAGE_ITEMS,
  type AdminPageKey,
} from '../adminRoutes';

type AdminSectionNavProps = {
  activePage: AdminPageKey;
  onNavigate: (page: AdminPageKey) => void;
};

export default function AdminSectionNav({ activePage, onNavigate }: AdminSectionNavProps) {
  return (
    <nav className="admin-section-nav" aria-label="Navigace administrace">
      <div className="admin-section-nav-scroll">
        {ADMIN_PAGE_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className="admin-section-nav-item"
            data-active={activePage === item.key ? '1' : '0'}
            onClick={() => onNavigate(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <label className="admin-section-nav-select">
        <span>Přejít na stránku</span>
        <select
          value={activePage}
          onChange={(event) => onNavigate(event.target.value as AdminPageKey)}
        >
          {ADMIN_PAGE_ITEMS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
