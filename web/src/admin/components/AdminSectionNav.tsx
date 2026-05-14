import {
  ADMIN_SECTION_ITEMS,
  type AdminSectionKey,
} from '../adminSections';

type AdminSectionNavProps = {
  activeSection: AdminSectionKey;
  onNavigate: (section: AdminSectionKey) => void;
};

export default function AdminSectionNav({ activeSection, onNavigate }: AdminSectionNavProps) {
  return (
    <nav className="admin-section-nav" aria-label="Navigace administrace">
      <div className="admin-section-nav-scroll">
        {ADMIN_SECTION_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className="admin-section-nav-item"
            data-active={activeSection === item.key ? '1' : '0'}
            onClick={() => onNavigate(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <label className="admin-section-nav-select">
        <span>Přeskočit na sekci</span>
        <select
          value={activeSection}
          onChange={(event) => onNavigate(event.target.value as AdminSectionKey)}
        >
          {ADMIN_SECTION_ITEMS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
