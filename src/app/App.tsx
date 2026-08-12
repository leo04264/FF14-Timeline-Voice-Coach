import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { LibraryProvider } from './LibraryContext';
import { SettingsProvider } from './SettingsContext';
import { LibraryPage } from '../pages/LibraryPage';
import { PlayerPage } from '../pages/PlayerPage';
import { PracticePage } from '../pages/PracticePage';
import { EditorPage } from '../pages/EditorPage';
import { SettingsPage } from '../pages/SettingsPage';

/**
 * Hash routing keeps GitHub Pages happy without an SPA fallback (spec §82).
 */
export function App() {
  return (
    <SettingsProvider>
      <LibraryProvider>
        <HashRouter>
          <header className="app-header">
            <span className="app-brand">FF14 Timeline Voice Coach</span>
            <nav className="app-nav">
              <NavLink to="/library">Library</NavLink>
              <NavLink to="/player">Player</NavLink>
              <NavLink to="/practice">Practice</NavLink>
              <NavLink to="/editor">Editor</NavLink>
              <NavLink to="/settings">Settings</NavLink>
            </nav>
            <span className="badge">V0.1</span>
          </header>
          <main className="app-main">
            <Routes>
              <Route path="/" element={<Navigate to="/library" replace />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/player" element={<PlayerPage />} />
              <Route path="/player/:timelineId" element={<PlayerPage />} />
              <Route path="/practice" element={<PracticePage />} />
              <Route path="/practice/:timelineId" element={<PracticePage />} />
              <Route path="/editor" element={<EditorPage />} />
              <Route path="/editor/:timelineId" element={<EditorPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/library" replace />} />
            </Routes>
          </main>
        </HashRouter>
      </LibraryProvider>
    </SettingsProvider>
  );
}
