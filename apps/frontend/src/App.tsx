import { APP_NAME } from '@kanban/shared';

export default function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="mt-4 text-slate-400">
          Project setup is ready. The collaborative board will be built here.
        </p>
      </div>
    </main>
  );
}
