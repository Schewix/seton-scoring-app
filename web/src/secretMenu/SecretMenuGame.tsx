import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/context';
import {
  MENU_CATEGORY_LABELS,
  MENU_CATEGORY_ORDER,
  MENU_ITEMS,
  type MenuCategory,
  type MenuItem,
} from '../data/menuItems';
import {
  addConsumedItem,
  createEmptySecretMenuState,
  getStatistics,
  normalizeSecretMenuState,
  removeConsumedItem,
  type SecretMenuState,
} from './gamification';
import './SecretMenuGame.css';

const SECRET_MENU_STORAGE_PREFIX = 'zl-secret-menu-game-v1';

function createStorageKey(userId: string) {
  return `${SECRET_MENU_STORAGE_PREFIX}:${userId}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getCategoryItems(category: MenuCategory) {
  return MENU_ITEMS.filter((menuItem) => menuItem.category === category);
}

function categoryLabel(category: MenuCategory) {
  return MENU_CATEGORY_LABELS[category];
}

function SecretMenuLockedState({ state }: { state: string }) {
  const message =
    state === 'locked'
      ? 'Aplikace je zamčená. Odemkni ji PINem v soutěžní aplikaci a tajné menu se otevře.'
      : 'Tajné menu je dostupné jen přihlášeným uživatelům.';
  return (
    <section className="secret-menu-card secret-menu-locked">
      <p className="secret-menu-kicker">Zamčeno</p>
      <h3>Nejdřív přihlášení</h3>
      <p>{message}</p>
      <a className="secret-menu-primary-link" href="/aplikace">
        Přejít do přihlášení
      </a>
    </section>
  );
}

function SecretMenuItemButton({
  item,
  consumedCount,
  onAdd,
}: {
  item: MenuItem;
  consumedCount: number;
  onAdd: () => void;
}) {
  return (
    <button type="button" className="secret-menu-item" onClick={onAdd}>
      <span>
        <strong>{item.name}</strong>
        <small>
          {item.points} bodů{consumedCount === 0 ? ' · první ochutnání +20' : ''}
        </small>
      </span>
      <span className={consumedCount > 0 ? 'secret-menu-count is-active' : 'secret-menu-count'}>
        ×{consumedCount}
      </span>
    </button>
  );
}

export default function SecretMenuGame({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { status } = useAuth();
  const [activeCategory, setActiveCategory] = useState<MenuCategory>('draft-beer');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SecretMenuState>(() => createEmptySecretMenuState());
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);

  const storageKey =
    status.state === 'authenticated'
      ? createStorageKey(status.manifest.judge.id || status.manifest.judge.email)
      : null;

  useEffect(() => {
    if (!open || !storageKey || loadedStorageKey === storageKey) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      setState(raw ? normalizeSecretMenuState(JSON.parse(raw)) : createEmptySecretMenuState());
    } catch {
      setState(createEmptySecretMenuState());
    }
    setLoadedStorageKey(storageKey);
  }, [loadedStorageKey, open, storageKey]);

  useEffect(() => {
    if (!open || !storageKey || loadedStorageKey !== storageKey) {
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [loadedStorageKey, open, state, storageKey]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  const statistics = useMemo(() => getStatistics(state), [state]);
  const consumedCounts = useMemo(() => {
    return state.consumedItems.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.itemId] = (acc[entry.itemId] ?? 0) + 1;
      return acc;
    }, {});
  }, [state.consumedItems]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('cs');
    return getCategoryItems(activeCategory).filter((item) => {
      if (!normalizedQuery) {
        return true;
      }
      return item.name.toLocaleLowerCase('cs').includes(normalizedQuery);
    });
  }, [activeCategory, query]);

  if (!open) {
    return null;
  }

  const handleAddItem = (itemId: string) => {
    setState((current) => addConsumedItem(current, itemId));
  };

  const handleRemoveEntry = (entryId: string) => {
    setState((current) => removeConsumedItem(current, entryId));
  };

  const profile =
    status.state === 'authenticated'
      ? {
          name: status.manifest.judge.displayName,
          email: status.manifest.judge.email,
          station: `${status.manifest.station.name} (${status.manifest.station.code})`,
          event: status.manifest.event.name,
        }
      : null;

  return (
    <div className="secret-menu-overlay" role="dialog" aria-modal="true" aria-labelledby="secret-menu-title">
      <div className="secret-menu-panel">
        <header className="secret-menu-header">
          <div>
            <p className="secret-menu-kicker">Secret section</p>
            <h2 id="secret-menu-title">Tajné menu Bezpráví</h2>
          </div>
          <button type="button" className="secret-menu-close" onClick={onClose}>
            Zavřít
          </button>
        </header>

        {status.state === 'loading' ? (
          <section className="secret-menu-card">
            <p>Ověřuji přihlášení…</p>
          </section>
        ) : status.state !== 'authenticated' ? (
          <SecretMenuLockedState state={status.state} />
        ) : (
          <>
            <section className="secret-menu-hero">
              <article className="secret-menu-card secret-menu-profile">
                <p className="secret-menu-kicker">Profil</p>
                <h3>{profile?.name || 'Přihlášený uživatel'}</h3>
                <p>{profile?.email}</p>
                <p>{profile?.station}</p>
                <p>{profile?.event}</p>
              </article>

              <article className="secret-menu-card secret-menu-score">
                <p className="secret-menu-kicker">Body a level</p>
                <div className="secret-menu-score-main">
                  <strong>{statistics.totalPoints}</strong>
                  <span>bodů</span>
                </div>
                <h3>{statistics.progressToNextLevel.currentLevel.name}</h3>
                <div className="secret-menu-progress">
                  <span style={{ width: `${statistics.progressToNextLevel.progressPercent}%` }} />
                </div>
                {statistics.progressToNextLevel.nextLevel ? (
                  <p>
                    Do levelu {statistics.progressToNextLevel.nextLevel.name} zbývá{' '}
                    <strong>{statistics.progressToNextLevel.pointsNeededForNextLevel}</strong> bodů.
                  </p>
                ) : (
                  <p>Jsi na nejvyšším levelu. To už není tajné menu, to je životní styl.</p>
                )}
              </article>

              <article className="secret-menu-card secret-menu-score">
                <p className="secret-menu-kicker">Dokončení menu</p>
                <div className="secret-menu-score-main">
                  <strong>{statistics.menuCompletion.percent}%</strong>
                </div>
                <p>
                  {statistics.menuCompletion.consumedItems} z {statistics.menuCompletion.totalItems} položek ·{' '}
                  {statistics.unlockedAchievements.length} achievementů odemčeno
                </p>
              </article>
            </section>

            <section className="secret-menu-card">
              <div className="secret-menu-section-head">
                <div>
                  <p className="secret-menu-kicker">Sbírka</p>
                  <h3>Přidat položku</h3>
                </div>
                <label className="secret-menu-search">
                  <span>Hledat</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Název položky"
                  />
                </label>
              </div>

              <div className="secret-menu-tabs" role="tablist" aria-label="Kategorie tajného menu">
                {MENU_CATEGORY_ORDER.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={category === activeCategory ? 'is-active' : ''}
                    onClick={() => setActiveCategory(category)}
                  >
                    {categoryLabel(category)}
                  </button>
                ))}
              </div>

              <div className="secret-menu-items">
                {visibleItems.map((item) => (
                  <SecretMenuItemButton
                    key={item.id}
                    item={item}
                    consumedCount={consumedCounts[item.id] ?? 0}
                    onAdd={() => handleAddItem(item.id)}
                  />
                ))}
              </div>
            </section>

            <section className="secret-menu-grid">
              <article className="secret-menu-card">
                <p className="secret-menu-kicker">Achievementy</p>
                <h3>Odměny a postup</h3>
                <div className="secret-menu-achievements">
                  {statistics.achievements.map((achievement) => (
                    <div
                      key={achievement.id}
                      className={achievement.unlocked ? 'secret-menu-achievement is-unlocked' : 'secret-menu-achievement'}
                    >
                      <div>
                        <strong>{achievement.title}</strong>
                        <span>
                          {achievement.current}/{achievement.target} · +{achievement.bonusPoints} bodů
                        </span>
                      </div>
                      <p>{achievement.description}</p>
                      <div className="secret-menu-progress is-small">
                        <span style={{ width: `${achievement.progressPercent}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="secret-menu-card">
                <p className="secret-menu-kicker">Statistiky</p>
                <h3>Kategorie</h3>
                <div className="secret-menu-category-stats">
                  {statistics.categoryProgress.map((category) => (
                    <div key={category.category} className="secret-menu-category-stat">
                      <strong>{category.label}</strong>
                      <span>
                        {category.consumedItems}/{category.totalItems} položek · {category.totalConsumed}× ·{' '}
                        {category.points} bodů
                      </span>
                      <div className="secret-menu-progress is-small">
                        <span style={{ width: `${category.completionPercent}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="secret-menu-card">
              <div className="secret-menu-section-head">
                <div>
                  <p className="secret-menu-kicker">Historie</p>
                  <h3>Poslední položky</h3>
                </div>
                <p className="secret-menu-muted">
                  {statistics.totalConsumed} zápisů · {statistics.visitDays} dní
                </p>
              </div>
              {statistics.history.length === 0 ? (
                <p className="secret-menu-muted">Zatím nic. Tajné menu čeká na první stopu.</p>
              ) : (
                <div className="secret-menu-history">
                  {statistics.history.slice(0, 24).map((entry) => (
                    <div key={entry.id} className="secret-menu-history-row">
                      <span>
                        <strong>{entry.item?.name}</strong>
                        <small>
                          {entry.item ? categoryLabel(entry.item.category) : 'Neznámá položka'} ·{' '}
                          {formatDateTime(entry.consumedAt)}
                        </small>
                      </span>
                      <button type="button" onClick={() => handleRemoveEntry(entry.id)}>
                        Odebrat
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
