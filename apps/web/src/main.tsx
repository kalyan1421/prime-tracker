import React from 'react';
import ReactDOM from 'react-dom/client';
import { HeroUIProvider, ToastProvider, addToast } from '@heroui/react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { errMsg } from './utils/fmt';
import './index.css';

// Dedupe identical error toasts fired within a short window — a page with several
// queries all hitting the same 500 shouldn't stack five identical toasts.
let lastErrToast = { msg: '', at: 0 };

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
  // Global query-failure surface: before this, a failed GET produced NO feedback and
  // pages fell straight through to their empty state — a 500 looked identical to "no data".
  // Now every query failure raises a toast so server errors are visible. 401s are left to
  // the axios interceptor (token refresh / redirect), so they're skipped here.
  queryCache: new QueryCache({
    onError: (error: any) => {
      if (error?.response?.status === 401) return;
      const msg = errMsg(error, 'Something went wrong loading data');
      const now = Date.now();
      if (msg === lastErrToast.msg && now - lastErrToast.at < 3000) return;
      lastErrToast = { msg, at: now };
      addToast({ title: msg, color: 'danger' });
    },
  }),
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HeroUIProvider>
      <ToastProvider placement="top-right" />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </HeroUIProvider>
  </React.StrictMode>,
);
