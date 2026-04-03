import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/features/auth/use-auth";
import { ProtectedRoute } from "@/features/auth/protected-route";
import { AppLayout } from "@/app/layouts/app-layout";
import { AuthLayout } from "@/app/layouts/auth-layout";
import { LoginView } from "@/features/auth/login";
import { ChatPage } from "@/app/pages/chat-page";
import { ReviewPage } from "@/app/pages/review-page";
import { NotificationsPage } from "@/app/pages/notifications-page";

const queryClient = new QueryClient();

export function AppRoutes() {
  return (
    <Routes>
      {/* Auth layout — minimal, no shell */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginView />} />
      </Route>

      {/* App layout — full shell, protected */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:sessionId" element={<ChatPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
      </Route>

      {/* Redirects */}
      <Route path="/" element={<Navigate to="/chat" replace />} />
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
