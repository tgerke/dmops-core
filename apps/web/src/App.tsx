import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { currentPersona, personas, setPersona } from "./auth";
import { KpiPackPage } from "./pages/KpiPackPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { StudiesPage } from "./pages/StudiesPage";
import { StudyBoardPage } from "./pages/StudyBoardPage";

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white print:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link to="/" className="text-lg font-semibold tracking-tight">
              dmops<span className="text-sky-600">-core</span>
              <span className="ml-3 text-xs font-normal text-slate-400">
                DM operations, beside the EDC
              </span>
            </Link>
            {/* Visible to every persona; a study-scoped seat that follows it
                gets an explanation, not a hidden feature (ADR-0015). */}
            <nav className="flex items-center gap-4 text-sm">
              <Link to="/" className="text-slate-500 hover:text-slate-900">
                Studies
              </Link>
              <Link to="/portfolio" className="text-slate-500 hover:text-slate-900">
                Portfolio
              </Link>
            </nav>
            <label className="flex items-center gap-2 text-sm text-slate-500">
              Viewing as
              <select
                className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                defaultValue={currentPersona().token}
                onChange={(e) => {
                  setPersona(e.target.value);
                  window.location.reload();
                }}
              >
                {personas.map((p) => (
                  <option key={p.token} value={p.token}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">
          <Routes>
            <Route path="/" element={<StudiesPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/studies/:studyId" element={<StudyBoardPage />} />
            <Route path="/studies/:studyId/kpi-pack" element={<KpiPackPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
