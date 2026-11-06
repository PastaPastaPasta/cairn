// Every route of DESIGN.md section 5.
import { Suspense, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useApp } from './app/context.tsx';
import { preloadSdk } from './data/platform.ts';
import { HomePage } from './pages/HomePage.tsx';
import { LearnPage } from './pages/LearnPage.tsx';
import MePage from './pages/MePage.tsx';
import { GroupsPage, LookingPage, OperatorsPage } from './pages/ListPages.tsx';
import { CheckPage } from './formation/CheckPage.tsx';
import { GroupFormPage } from './formation/FormPage.tsx';
import { GroupLivePage } from './formation/LivePage.tsx';
import { GroupPage } from './pages/group/GroupPage.tsx';
import { NewGroupPage } from './pages/NewGroupPage.tsx';
import { OperatorPage } from './pages/OperatorsPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';


export function AppRoutes() {
  const { registry } = useApp();
  // the SDK (and its WASM) loads after first paint, so reads and sign-in start warm
  useEffect(() => {
    if (!registry.contractId) return;
    const t = setTimeout(() => preloadSdk(registry), 1200);
    return () => clearTimeout(t);
  }, [registry]);
  return (
    <Suspense fallback={<p className="page muted">Loading…</p>}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/groups/new" element={<NewGroupPage />} />
        <Route path="/g/:id" element={<GroupPage />} />
        <Route path="/g/:id/form" element={<GroupFormPage />} />
        <Route path="/g/:id/live" element={<GroupLivePage />} />
        <Route path="/looking" element={<LookingPage />} />
        <Route path="/operators" element={<OperatorsPage />} />
        <Route path="/operators/:id" element={<OperatorPage />} />
        <Route path="/me" element={<MePage />} />
        <Route path="/check" element={<CheckPage />} />
        <Route path="/learn" element={<LearnPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
