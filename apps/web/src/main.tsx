import React from 'react';
import ReactDOM from 'react-dom/client';
import { HeroUIProvider, ToastProvider } from '@heroui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { useAuthStore } from './store/authStore';
import './index.css';

// Always start at login screen — clear any persisted session
useAuthStore.getState().logout();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
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
